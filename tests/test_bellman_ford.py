# [IA] Claude – sugestão de casos de teste (conferidos pelo grupo)
from src.graphs.algorithms import bellman_ford, custo_ciclo
from src.graphs.estados import ALVO, grafo_estados, grafo_posicoes
from src.graphs.graph import Grafo
from src.graphs.io import ler_mapa
from conftest import MAPAS


def test_pesos_negativos_sem_ciclo():
    g = Grafo()
    for u, v, w in [("s", "a", 4), ("s", "b", 2), ("a", "c", -3), ("b", "a", 1), ("c", "t", 2)]:
        g.add_arco(u, v, w)
    r = bellman_ford(g, "s")
    assert r.ciclo_negativo is None
    assert r.dist == {"s": 0, "b": 2, "a": 3, "c": 0, "t": 2}


def test_detecta_e_devolve_ciclo_negativo():
    g = Grafo()
    for u, v, w in [("s", "a", 1), ("a", "b", 1), ("b", "c", -3), ("c", "a", 1), ("c", "t", 1)]:
        g.add_arco(u, v, w)
    r = bellman_ford(g, "s")
    assert r.ciclo_negativo is not None
    ciclo = r.ciclo_negativo
    assert ciclo[0] == ciclo[-1] and set(ciclo) == {"a", "b", "c"}
    assert custo_ciclo(g, ciclo) == -1


def test_m05_ciclo_no_g_pos_mas_nao_no_g_est():
    m = ler_mapa(MAPAS / "m05_bonus.txt")
    assert bellman_ford(grafo_posicoes(m), m.inicio).ciclo_negativo is not None
    ge = grafo_estados(m)
    r = bellman_ford(ge.grafo, ge.inicio)
    assert r.ciclo_negativo is None and r.dist[ALVO] < float("inf")


def test_m06_ciclo_e_correcao_fonte_consumivel():
    m = ler_mapa(MAPAS / "m06_fonte.txt")
    ge = grafo_estados(m)
    r = bellman_ford(ge.grafo, ge.inicio)
    assert r.ciclo_negativo and custo_ciclo(ge.grafo, r.ciclo_negativo) < 0
    corr = grafo_estados(m, fonte_consumivel=True)
    rc = bellman_ford(corr.grafo, corr.inicio)
    assert rc.ciclo_negativo is None and rc.dist[ALVO] < float("inf")
