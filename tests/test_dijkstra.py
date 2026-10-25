# [IA] Claude – sugestão de casos de teste (conferidos pelo grupo)
import networkx as nx  # permitido apenas em tests/, como oráculo
import pytest

from src.graphs.algorithms import PesoNegativoError, dijkstra
from src.graphs.estados import ALVO, grafo_estados
from src.graphs.graph import Grafo
from src.graphs.io import ler_mapa
from conftest import MAPAS


def test_caminhos_corretos_com_pesos_positivos():
    g = Grafo()
    for u, v, w in [("s", "a", 4), ("s", "b", 1), ("b", "a", 2), ("a", "t", 1), ("b", "t", 5)]:
        g.add_arco(u, v, w)
    r = dijkstra(g, "s")
    assert r.dist == {"s": 0, "b": 1, "a": 3, "t": 4}
    assert r.caminho_ate("t") == ["s", "b", "a", "t"]


def test_recusa_peso_negativo():
    g = Grafo()
    g.add_arco("s", "a", 1)
    g.add_arco("a", "b", -2)
    with pytest.raises(PesoNegativoError, match="negativo"):
        dijkstra(g, "s")


@pytest.mark.parametrize("arquivo", ["m01_terreno.txt", "m03_tres_chaves.txt", "m08_grande.txt"])
def test_confere_com_networkx(arquivo):
    ge = grafo_estados(ler_mapa(MAPAS / arquivo))
    nxg = nx.DiGraph()
    for a in ge.grafo.arcos():
        nxg.add_edge(a.origem, a.destino, weight=a.peso)
    esperado = nx.dijkstra_path_length(nxg, ge.inicio, ALVO)
    assert dijkstra(ge.grafo, ge.inicio).dist[ALVO] == esperado
