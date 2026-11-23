# [IA] Claude – testes da Parte 2 com dados sintéticos
import csv

import pytest

from src.cli import main
from src.graphs.algorithms import alcancaveis
from src.parte2.buscas import carregar, temporada
from src.parte2.bellman import hierarquia, sem_ciclo_por_temporada
from src.parte2.caminhos import custo_vitoria, transformar
from src.parte2.desempenho import INICIO, amostra
from src.graphs.algorithms import bellman_ford, bfs, dfs, dijkstra
from src.graphs.graph import Grafo
from src.parte2.preparar import preparar

PARAMS = {"tipos": [2], "temporada_min": 2000, "temporada_max": 2001, "sinal_peso": -1}

HISTORICO = """teamId,teamCity,teamName,teamAbbrev,seasonFounded,seasonActiveTill,league
1,Cidade A,Alfa,AAA,1990,2100,NBA
2,Cidade B,Beta,BBB,1990,2100,NBA
3,Cidade C,Gama,CCC,1990,2100,NBA
"""

# gameId com 10 dígitos "00TAA#####": T = tipo (2 regular, 4 playoffs), AA = ano de início da temporada
JOGOS = [
    (20000001, 1, 2, 100, 90),
    (20000002, 2, 1, 95, 93),
    (20000003, 2, 1, 100, 101),
    (20000004, 3, 1, 110, 105),
    (40000001, 1, 2, 80, 120),
    (20100001, 1, 2, 80, 70),
    (29900001, 1, 2, 99, 98),
]


@pytest.fixture
def dataset(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    linhas = ["gameId,gameDateTimeEst,hometeamId,awayteamId,homeScore,awayScore,winner"]
    for gid, casa, fora, pc, pf in JOGOS:
        linhas.append(f"{gid},2000-11-01 19:00:00,{casa},{fora},{pc},{pf},{casa if pc > pf else fora}")
    (raw / "Games.csv").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    (raw / "TeamHistories.csv").write_text(HISTORICO, encoding="utf-8")
    arestas = tmp_path / "arestas.csv"
    rel = preparar(PARAMS, raw=raw, saida=tmp_path / "processed", arestas_csv=arestas)
    with arestas.open(encoding="utf-8", newline="") as f:
        linhas_csv = list(csv.DictReader(f))
    return rel, arestas, linhas_csv


def _peso(linhas, u, v):
    return next(float(l["peso"]) for l in linhas if (l["origem"], l["destino"]) == (u, v))


def test_carga_e_agrupamento_por_temporada_e_par(dataset):
    rel, _, linhas = dataset
    assert list(linhas[0]) == ["origem", "destino", "peso", "temporada"]
    assert rel["removidos"] == {"tipo de jogo fora de params.tipos": 1, "temporada fora do intervalo": 1}
    assert (rel["jogos"], rel["arcos"], rel["nos"], rel["temporadas"]) == (5, 6, 5, 2)
    pares_2000 = {(l["origem"], l["destino"]) for l in linhas if l["temporada"] == "2000"}
    assert pares_2000 == {("AAA|2000", "BBB|2000"), ("BBB|2000", "AAA|2000"),
                          ("AAA|2000", "CCC|2000"), ("CCC|2000", "AAA|2000")}


def test_saldo_medio_calculado_a_mao(dataset):
    _, _, linhas = dataset
    # AAA x BBB em 2000: +10, -2, +1 para AAA -> média 3,0 (playoff de 2000 fica de fora)
    assert _peso(linhas, "AAA|2000", "BBB|2000") == pytest.approx(-3.0)
    assert _peso(linhas, "CCC|2000", "AAA|2000") == pytest.approx(-5.0)
    assert _peso(linhas, "AAA|2001", "BBB|2001") == pytest.approx(-10.0)


def test_direcao_e_sinal_do_arco(dataset):
    _, _, linhas = dataset
    for l in linhas:
        assert float(l["peso"]) == -_peso(linhas, l["destino"], l["origem"])
    assert _peso(linhas, "AAA|2000", "BBB|2000") < 0 < _peso(linhas, "BBB|2000", "AAA|2000")


def test_no_em_texto_time_ano(dataset):
    _, arestas, _ = dataset
    g = carregar(arestas)
    assert sorted(g.nos()) == ["AAA|2000", "AAA|2001", "BBB|2000", "BBB|2001", "CCC|2000"]
    assert all(isinstance(v, str) for v in g.nos())
    assert temporada("AAA|2001") == 2001
    assert alcancaveis(g, "AAA|2000") == {"AAA|2000", "BBB|2000", "CCC|2000"}


# [IA] Claude – o comando do enunciado passa a pasta do dataset, não o CSV
def test_cli_aceita_pasta_do_dataset(tmp_path, capsys):
    pasta = tmp_path / "dataset"
    pasta.mkdir()
    (pasta / "arestas.csv").write_text(
        "origem,destino,peso,temporada\nAAA|2000,BBB|2000,-3.0,2000\nBBB|2000,AAA|2000,3.0,2000\n",
        encoding="utf-8",
    )
    assert main(["--dataset", str(pasta), "--out", str(tmp_path / "out")]) == 0
    assert "|V|=2 |E|=2" in capsys.readouterr().out


def test_cli_pasta_sem_arestas_da_erro_claro(tmp_path, capsys):
    assert main(["--dataset", str(tmp_path), "--out", str(tmp_path / "out")]) == 1
    assert "arquivo não encontrado" in capsys.readouterr().err


# [IA] Claude – casos das correções de Dijkstra, Bellman-Ford e escalabilidade
def _temporada_em_ciclo(t=2000):
    g = Grafo()
    # A vence B, B vence C, C vence A por pouco: ciclo negativo; A tem o maior saldo
    for u, v, w in (("A", "B", -10.0), ("B", "C", -6.0), ("C", "A", -1.0)):
        g.add_arco(f"{u}|{t}", f"{v}|{t}", w)
        g.add_arco(f"{v}|{t}", f"{u}|{t}", -w)
    return g


def test_custo_vitoria_positivo_e_monotono():
    assert custo_vitoria(0.0) == pytest.approx(0.6931, abs=1e-3)  # P = 1/2 -> log 2
    assert 0 < custo_vitoria(-20.0) < custo_vitoria(-5.0) < custo_vitoria(5.0) < custo_vitoria(20.0)


def test_dijkstra_prefere_cadeia_de_vitorias_ao_arco_ruim():
    g = Grafo()
    g.add_arco("A|2000", "C|2000", 15.0)    # A perde de C
    g.add_arco("A|2000", "B|2000", -15.0)   # A vence B
    g.add_arco("B|2000", "C|2000", -15.0)   # B vence C
    assert dijkstra(transformar(g), "A|2000").caminho_ate("C|2000") == ["A|2000", "B|2000", "C|2000"]


def test_hierarquia_e_aciclica_e_mantem_peso_negativo():
    g = _temporada_em_ciclo()
    assert bellman_ford(g, "A|2000").status == "CICLO_NEGATIVO"
    dag, fonte = hierarquia(g, 2000)
    assert fonte == "A|2000" and not dfs(dag, fonte).tem_ciclo
    assert any(a.peso < 0 for a in dag.arcos())
    e = sem_ciclo_por_temporada(g)[0]
    assert e["status"] == "OK" and e["ciclo_negativo"] is None and e["arcos"] == 3


def test_amostra_por_temporada_cresce_e_e_toda_alcancavel():
    g = Grafo()
    for t in range(2000, 2010):
        for a in _temporada_em_ciclo(t).arcos():
            g.add_arco(a.origem, a.destino, a.peso)
    pequena, media, inteira = (amostra(g, f) for f in (0.1, 0.5, 1.0))
    assert pequena.ordem < media.ordem < inteira.ordem == 31
    assert pequena.tamanho < media.tamanho < inteira.tamanho
    for h in (pequena, media, inteira):
        assert len(bfs(h, INICIO).dist) == h.ordem
