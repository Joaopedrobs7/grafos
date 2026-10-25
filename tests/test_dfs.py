# [IA] Claude – sugestão de casos de teste (conferidos pelo grupo)
from src.graphs.algorithms import dfs
from src.graphs.graph import Grafo


def _grafo(arcos):
    g = Grafo()
    for u, v in arcos:
        g.add_arco(u, v)
    return g


def test_classifica_os_quatro_tipos():
    # DFS a partir de 1: 1->2 (árvore), 2->3 (árvore), 3->1 (retorno),
    # 1->3 (avanço), 1->4 (árvore), 4->3 (cruzamento)
    g = _grafo([(1, 2), (1, 3), (1, 4), (2, 3), (3, 1), (4, 3)])
    r = dfs(g, 1)
    assert r.classes == {"arvore": 3, "retorno": 1, "avanco": 1, "cruzamento": 1}
    assert (3, 1, "retorno") in r.arcos and (1, 3, "avanco") in r.arcos and (4, 3, "cruzamento") in r.arcos
    assert r.tem_ciclo


def test_dag_sem_ciclo():
    r = dfs(_grafo([("a", "b"), ("b", "c"), ("a", "c")]), "a")
    assert not r.tem_ciclo
    assert r.classes["retorno"] == 0
