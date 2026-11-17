# [IA] Claude – sugestão de casos de teste (conferidos à mão pelo grupo)
import pytest

from src.graphs.algorithms import PesoNegativoError, dfs, dijkstra
from src.graphs.graph import Grafo


# [IA] Claude – DFS classifica os 4 tipos de arco e detecta ciclo
def test_dfs_quatro_tipos_e_ciclo():
    """Valida a classificação da DFS (árvore, retorno, avanço, cruzamento) e a detecção de ciclo."""
    # Arcos inseridos em ordem alfabética: a→b, a→c, a→d, b→c, c→a, d→c. DFS a partir de a:
    #   a→b árvore; b→c árvore; c→a retorno (a ainda na pilha); c e b terminam
    #   a→c avanço (c já terminou e desc[a] < desc[c]); a→d árvore
    #   d→c cruzamento (c já terminou e desc[d] > desc[c])
    # Total: 3 árvore, 1 retorno, 1 avanço, 1 cruzamento; ciclo a→b→c→a (retorno > 0)
    g = Grafo()
    for u, v in [("a", "b"), ("a", "c"), ("a", "d"), ("b", "c"), ("c", "a"), ("d", "c")]:
        g.add_arco(u, v)
    r = dfs(g, "a")
    assert r.classes == {"arvore": 3, "retorno": 1, "avanco": 1, "cruzamento": 1}
    assert r.tem_ciclo


# [IA] Claude – Dijkstra recusa grafo com peso negativo
def test_dijkstra_recusa_peso_negativo():
    """Valida que Dijkstra levanta PesoNegativoError quando existe arco de peso negativo."""
    # a→b custa 2, b→c custa -1: um arco negativo basta para a recusa
    g = Grafo()
    g.add_arco("a", "b", 2)
    g.add_arco("b", "c", -1)
    with pytest.raises(PesoNegativoError):
        dijkstra(g, "a")
