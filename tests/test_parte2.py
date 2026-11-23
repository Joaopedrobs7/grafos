# [IA] Claude – testes da Parte 2 com dados sintéticos
import csv

import pytest

from src.cli import main
from src.graphs.algorithms import alcancaveis
from src.parte2.buscas import carregar, temporada
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
