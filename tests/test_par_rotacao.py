# [IA] Claude – testes do caminho entre dois jogadores (src/parte2/par.py) e da rota api/parte2/caminho
import pytest

from conftest import RAIZ
from src.parte2.par import caminho_entre
from src.web.app import app

# 4 jogadores em ordem de minutos decrescente (como no JSON do site).
# Arcos: 0->1 (-2), 1->2 (-3), 0->2 (1), 2->3 (4), 0->3 (10) e 2->1 (1): 1->2->1 é ciclo de custo -2.
DADOS = {
    "nos": [{"minutos": 400.0}, {"minutos": 300.0}, {"minutos": 200.0}, {"minutos": 100.0}],
    "arcos": [[0, 1, -2.0, 1], [1, 2, -3.0, 1], [0, 2, 1.0, 1], [2, 3, 4.0, 1], [0, 3, 10.0, 1], [2, 1, 1.0, 1]],
}


def _por_alg(res):
    return {r["algoritmo"]: r for r in res["resultados"]}


def test_completo_bfs_dijkstra_recusa_e_bellman_ford_acha_o_ciclo():
    r = _por_alg(caminho_entre(DADOS, 0, 3, "completo"))
    assert r["BFS"]["status"] == "OK" and r["BFS"]["caminho"] == [0, 3] and r["BFS"]["custo"] == 10.0
    assert r["DFS"]["status"] == "OK" and r["DFS"]["caminho"][0] == 0 and r["DFS"]["caminho"][-1] == 3
    assert r["DIJKSTRA"]["status"] == "RECUSA" and "negativo" in r["DIJKSTRA"]["mensagem"]
    bf = r["BELLMAN_FORD"]
    assert bf["status"] == "CICLO_NEGATIVO"
    assert bf["ciclo"][0] == bf["ciclo"][-1] and set(bf["ciclo"]) == {1, 2}
    assert bf["custo_ciclo"] == pytest.approx(-2.0)


def test_recorte_sem_ciclo_dijkstra_e_bellman_ford_concordam():
    r = _por_alg(caminho_entre(DADOS, 0, 3, "recorte"))
    # recorte: some o 2->1 (de quem jogou menos para quem jogou mais), então não há ciclo
    assert r["BELLMAN_FORD"]["status"] == "OK" and r["DIJKSTRA"]["status"] == "OK"
    assert r["BELLMAN_FORD"]["caminho"] == r["DIJKSTRA"]["caminho"] == [0, 1, 2, 3]
    assert r["BELLMAN_FORD"]["custo"] == r["DIJKSTRA"]["custo"] == pytest.approx(-1.0)
    passos = r["DIJKSTRA"]["passos"]
    assert [p["acumulado"] for p in passos] == pytest.approx([-2.0, -5.0, -1.0])
    assert r["BFS"]["trocas"] == 1


def test_sem_caminho_e_entradas_invalidas():
    r = _por_alg(caminho_entre(DADOS, 3, 0, "completo"))
    # 3 não tem arcos de saída; o Dijkstra recusa antes de buscar (o grafo completo tem peso negativo)
    assert [r[a]["status"] for a in ("BFS", "DFS", "BELLMAN_FORD")] == ["SEM_CAMINHO"] * 3
    assert r["DIJKSTRA"]["status"] == "RECUSA"
    with pytest.raises(ValueError):
        caminho_entre(DADOS, 1, 1)
    with pytest.raises(ValueError):
        caminho_entre(DADOS, 0, 9)
    with pytest.raises(ValueError):
        caminho_entre(DADOS, 0, 1, "outro")


ROTACAO = RAIZ / "out" / "parte2" / "web" / "rotacao" / "MIL_2022.json"


@pytest.mark.skipif(not ROTACAO.exists(), reason="JSON do site da Parte 2 não gerado")
def test_rota_caminho_no_site():
    c = app.test_client()
    r = c.get("/api/parte2/caminho/MIL/2022?de=0&para=16&grafo=recorte")
    assert r.status_code == 200
    d = r.get_json()
    assert d["de"] == 0 and d["para"] == 16 and len(d["resultados"]) == 4
    por = _por_alg(d)
    assert por["DIJKSTRA"]["custo"] == pytest.approx(por["BELLMAN_FORD"]["custo"])
    assert c.get("/api/parte2/caminho/MIL/2022?de=0&para=0").status_code == 400
    assert c.get("/api/parte2/caminho/MIL/2022?de=0").status_code == 400
    assert c.get("/api/parte2/caminho/ZZZ/2022?de=0&para=1").status_code == 404
