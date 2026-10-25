# [IA] Claude – sugestão de casos de teste (conferidos pelo grupo)
from src.graphs.algorithms import bfs
from src.graphs.graph import Grafo


def test_niveis_em_grafo_pequeno():
    g = Grafo()
    for u, v in [("s", "a"), ("s", "b"), ("a", "c"), ("b", "c"), ("c", "d"), ("d", "s")]:
        g.add_arco(u, v)
    r = bfs(g, "s")
    assert r.dist == {"s": 0, "a": 1, "b": 1, "c": 2, "d": 3}
    assert r.niveis() == [["s"], ["a", "b"], ["c"], ["d"]]
    assert r.pai["c"] == "a"  # primeiro a descobrir c (ordem dos vizinhos)


def test_bfs_respeita_direcao():
    g = Grafo()
    g.add_arco("a", "b")
    assert "a" not in bfs(g, "b").dist
