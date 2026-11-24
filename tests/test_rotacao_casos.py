# [IA] Claude – testes dos casos do grafo de rotação com um grafo sintético (2 times, 5 e 4 jogadores)
import csv
import json

import pytest

from src.cli import main
from src.graphs.algorithms import PesoNegativoError, bellman_ford, bfs, dfs, dijkstra
from src.parte2 import rotacao_casos as rc
from src.parte2 import rotacao_desempenho as rd

# time AAA (2024): A1 > A2 > A3 > A4 > A5 em minutos; ciclo negativo A1 -> A2 -> A1 (-3 + 1 = -2)
# time BBB (2024): B1 > B2 > B3 > B4; sem ciclo negativo
ARCOS = [
    ("A1", "A2", -3.0), ("A2", "A1", 1.0), ("A1", "A3", 2.0), ("A2", "A3", -4.0), ("A3", "A4", 1.5),
    ("A2", "A4", 0.0), ("A4", "A5", -2.0), ("A5", "A1", 5.0), ("A3", "A5", 6.0),
    ("B1", "B2", 2.0), ("B2", "B3", -1.0), ("B1", "B3", 0.5), ("B3", "B4", 1.0), ("B4", "B2", 3.0),
]
MINUTOS = {"A1": 500, "A2": 400, "A3": 300, "A4": 200, "A5": 100, "B1": 450, "B2": 350, "B3": 250, "B4": 150}


def rotulo(j):
    return f"Jogador {j}|{'AAA' if j[0] == 'A' else 'BBB'}|2024"


@pytest.fixture
def pasta(tmp_path):
    p = tmp_path / "dataset_parte2" / "rotacao"
    p.mkdir(parents=True)
    with (p / "arestas_rotacao.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["origem", "destino", "peso", "temporada", "time"])
        for u, v, peso in ARCOS:
            w.writerow([rotulo(u), rotulo(v), peso, 2024, rotulo(u).split("|")[1]])
    with (p / "jogadores.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["no", "minutos_medidos"])
        for j, m in MINUTOS.items():
            w.writerow([rotulo(j), m])
    return p


@pytest.fixture
def dados(pasta):
    g = rc.carregar(pasta / "arestas_rotacao.csv")
    return g, rc.carregar_minutos(pasta / "jogadores.csv"), rc.dividir(rc.carregar(pasta / "arestas_rotacao.csv"))


def test_componentes_e_principal(dados):
    g, minutos, partes = dados
    assert set(partes) == {("AAA", 2024), ("BBB", 2024)}
    assert partes[("AAA", 2024)].ordem == 5 and partes[("AAA", 2024)].tamanho == 9
    assert rc.principal(partes[("BBB", 2024)].nos(), minutos) == rotulo("B1")
    sub = rc.subgrafo_componente(g, "BBB", 2024)
    assert sorted(sub.nos()) == sorted(partes[("BBB", 2024)].nos()) and sub.tamanho == 5


def test_recorte_descendente_e_aciclico(dados):
    _, minutos, partes = dados
    for sub in partes.values():
        dag = rc.descendente(sub, minutos)
        assert all(minutos[a.origem] > minutos[a.destino] for a in dag.arcos())
        for v in dag.nos():
            assert not dfs(dag, v).tem_ciclo
        assert bellman_ford(dag, rc.principal(dag.nos(), minutos)).status == "OK"
    # A2->A1, A5->A1 e B4->B2 sobem na rotação e saem do recorte
    assert rc.descendente(partes[("AAA", 2024)], minutos).tamanho == 7
    assert rc.descendente(partes[("BBB", 2024)], minutos).tamanho == 4


def test_dijkstra_recusa_peso_negativo(dados):
    g, _, _ = dados
    with pytest.raises(PesoNegativoError):
        dijkstra(g, rotulo("A1"))


def test_johnson_preserva_caminho_e_custo(dados):
    _, minutos, partes = dados
    for sub in partes.values():
        dag = rc.descendente(sub, minutos)
        h, t = rc.johnson(dag)
        assert not t.tem_peso_negativo()
        s = rc.principal(dag.nos(), minutos)
        rb, rj = bellman_ford(dag, s), dijkstra(t, s)
        assert set(rb.dist) == set(rj.dist)
        for v in rb.dist:
            assert rj.dist[v] - h[s] + h[v] == pytest.approx(rb.dist[v])
            assert rj.caminho_ate(v) == rb.caminho_ate(v)
    p = rc.par_dijkstra(partes[("AAA", 2024)], rotulo("A1"), minutos)
    # A1 -> A2 -> A3 -> A4 -> A5 = -3 - 4 + 1.5 - 2 = -7.5 (nó de menor distância)
    assert p["destino"] == rotulo("A5") and p["custo_bellman_ford"] == pytest.approx(-7.5)
    assert p["caminho_igual"] and p["custo_igual"]
    assert p["custo_original_reconvertido"] == pytest.approx(-7.5)


def test_ciclo_negativo_detectado(dados):
    _, minutos, partes = dados
    res = {(e["time"]): e for e in rc.com_ciclo(partes, minutos)}
    a = res["AAA"]
    assert a["status"] == "CICLO_NEGATIVO" and a["custo_ciclo"] < 0
    assert a["ciclo_negativo"][0] == a["ciclo_negativo"][-1]
    assert res["BBB"]["status"] == "OK"
    assert all(e["status"] == "OK" for e in rc.sem_ciclo(partes, minutos))


def test_buscas_tres_fontes_e_ciclos(dados):
    g, minutos, partes = dados
    r = rc.buscar(g, rotulo("A1"))
    assert r["BFS"]["ordem"][0] == rotulo("A1") and len(r["BFS"]["ordem"]) == 5
    assert r["DFS"]["tem_ciclo"]
    for item in r["DFS"]["arcos_retorno"]:
        assert item["ciclo"][0] == item["ciclo"][-1]
    assert bfs(g, rotulo("A1")).niveis()[1] == [rotulo("A2"), rotulo("A3")]


def test_main_e_benchmark_gravam_saidas(pasta, tmp_path, monkeypatch):
    out = tmp_path / "out"
    monkeypatch.setattr(rd, "REPETICOES", 2)
    rc.main(pasta / "arestas_rotacao.csv", pasta / "jogadores.csv", out)
    rd.main(pasta / "arestas_rotacao.csv", pasta / "jogadores.csv", out)
    for nome in ("bfs_dfs.json", "bellman_ford.json", "dijkstra.json", "parte2_report.json", "complexidade.csv"):
        assert (out / nome).is_file()
    dj = json.loads((out / "dijkstra.json").read_text(encoding="utf-8"))
    assert dj["recusa_pesos_originais"] and all(p["custo_igual"] for p in dj["pares"])
    rel = json.loads((out / "parte2_report.json").read_text(encoding="utf-8"))
    assert rel["grafo"] == "rotacao" and {e["amostra"] for e in rel["escalabilidade"]} == {0.1, 0.5, 1.0}
    assert all(len(t["tempos_s"]) == 2 for t in rel["tarefas"])


def test_cli_usa_rotacao_por_padrao(pasta, tmp_path, capsys):
    out = tmp_path / "out"
    assert main(["--dataset", str(pasta.parent), "--alg", "BELLMAN_FORD", "--source", rotulo("A1"), "--out", str(out)]) == 0
    texto = capsys.readouterr().out
    assert "grafo de rotação" in texto and "CICLO_NEGATIVO" in texto
    assert main(["--dataset", str(pasta.parent), "--alg", "DIJKSTRA", "--source", rotulo("A1"),
                 "--target", rotulo("A5"), "--out", str(out)]) == 0
    res = json.loads(next(out.glob("resultado_rotacao_DIJKSTRA_*.json")).read_text(encoding="utf-8"))
    assert res["custo_reconvertido"] == pytest.approx(-7.5) and res["recusa_pesos_originais"]
    assert main(["--dataset", str(pasta.parent), "--grafo", "partidas", "--out", str(out)]) == 1  # sem arestas.csv
