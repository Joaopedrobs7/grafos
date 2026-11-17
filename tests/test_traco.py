# [IA] Claude – testes dos ganchos de observação (algorithms.py) e do traço serializado (src/traco.py)
import json
from collections import Counter

import pytest

from conftest import RAIZ
from src.graphs.algorithms import PesoNegativoError, bellman_ford, bfs, dfs, dijkstra
from src.graphs.estados import ALVO, grafo_estados, rotulo
from src.graphs.io import ler_mapa, listar_mapas
from src.solve import resolver
from src.traco import ALGORITMOS_TRACO, traco, traco_json

ARQUIVOS = listar_mapas(RAIZ / "data" / "mapas", RAIZ / "data" / "mapas_grupo")
CASOS = [(p, f) for p in ARQUIVOS for f in ([False, True] if ler_mapa(p).fontes else [False])]
IDS = [p.stem + ("-fonte" if f else "") for p, f in CASOS]


def _sem_e_com_observador(func, g, s):
    eventos = []
    sem = func(g, s)
    com = func(g, s, observador=eventos.append)
    return sem, com, eventos


@pytest.mark.parametrize("arquivo, fonte", CASOS, ids=IDS)
def test_observador_nao_muda_resultado(arquivo, fonte):
    ge = grafo_estados(ler_mapa(arquivo), fonte_consumivel=fonte)
    g, s = ge.grafo, ge.inicio

    a, b, ev = _sem_e_com_observador(bfs, g, s)
    assert (a.dist, a.pai, a.ordem) == (b.dist, b.pai, b.ordem)
    assert ev

    a, b, ev = _sem_e_com_observador(dfs, ge.sem_alvo, s)
    assert (a.descoberta, a.termino, a.pai, a.classes, a.arcos) == (b.descoberta, b.termino, b.pai, b.classes, b.arcos)

    if g.tem_peso_negativo():
        ev = []
        with pytest.raises(PesoNegativoError):
            dijkstra(g, s, observador=ev.append)
        assert ev == []
    else:
        a, b, ev = _sem_e_com_observador(dijkstra, g, s)
        assert (a.dist, a.pai) == (b.dist, b.pai)

    a, b, ev = _sem_e_com_observador(bellman_ford, g, s)
    assert (a.dist, a.pai, a.ciclo_negativo) == (b.dist, b.pai, b.ciclo_negativo)


@pytest.mark.parametrize("arquivo, fonte", CASOS, ids=IDS)
def test_contagem_de_eventos_consistente(arquivo, fonte):
    m = ler_mapa(arquivo)
    ge = grafo_estados(m, fonte_consumivel=fonte)
    n_arcos_total = ge.grafo.tamanho

    t = traco(m, "BFS", fonte)
    c = Counter(e["t"] for e in t["eventos"])
    alcancados = sum(d >= 0 for d in t["resultado"]["dist"])
    assert c["inicio"] == 1 and c["sai"] == c["encerra"] == alcancados
    assert c["entra"] == alcancados - 1
    # cada vértice que sai da fila olha todos os seus arcos
    assert c["olha"] == sum(len(t["grafo"]["adj"][v]) for v in t["resultado"]["ordem"])
    assert sum(e["novo"] for e in t["eventos"] if e["t"] == "olha") == c["entra"]

    t = traco(m, "DFS", fonte)
    c = Counter(e["t"] for e in t["eventos"])
    r = t["resultado"]
    assert c["descobre"] == c["encerra"] == len(r["ordem"])
    assert c["olha"] == len(r["arcos"]) == sum(r["classes"].values())
    assert c["descobre"] - 1 == r["classes"]["arvore"]
    assert t["grafo"]["alvo"] not in {e.get("v") for e in t["eventos"]}  # DFS roda em sem_alvo

    t = traco(m, "DIJKSTRA", fonte)
    r = t["resultado"]
    if r["recusa"]:
        assert t["eventos"] == [] and r["recusa"]["negativos"]
    else:
        c = Counter(e["t"] for e in t["eventos"])
        assert c["fecha"] == sum(d is not None for d in r["dist"])
        assert c["fecha"] + c["descarta"] == 1 + c["relaxa"]  # cada push vira um pop

    t = traco(m, "BELLMAN_FORD", fonte)
    r = t["resultado"]
    c = Counter(e["t"] for e in t["eventos"])
    assert c["passada"] == c["fimPassada"] == r["passadas"]
    fins = [e for e in t["eventos"] if e["t"] == "fimPassada"]
    assert [e["k"] for e in fins] == list(range(1, r["passadas"] + 1))
    assert sum(e["relaxados"] for e in fins) == c["relaxa"]
    assert c["ciclo"] == (1 if r["cicloNegativo"] else 0)
    assert r["passadas"] <= ge.grafo.ordem - 1
    assert t["grafo"]["nArcos"] + sum(1 for l in t["grafo"]["adj"] for a in l if a[2] == "ALVO") == n_arcos_total


@pytest.mark.parametrize("arquivo, fonte", CASOS, ids=IDS)
def test_eventos_entra_da_bfs_reproduzem_dist_e_pai(arquivo, fonte):
    t = traco(ler_mapa(arquivo), "BFS", fonte)
    n = len(t["grafo"]["rotulos"])
    dist, pai = [-1] * n, [-1] * n
    for e in t["eventos"]:
        if e["t"] == "inicio":
            dist[e["v"]] = e["d"]
        elif e["t"] == "entra":
            dist[e["v"]], pai[e["v"]] = e["d"], e["p"]
    assert dist == t["resultado"]["dist"]
    assert pai == t["resultado"]["pai"]


@pytest.mark.parametrize("arquivo, fonte", CASOS, ids=IDS)
def test_relaxamentos_reproduzem_dist_e_pai(arquivo, fonte):
    m = ler_mapa(arquivo)
    for alg in ("DIJKSTRA", "BELLMAN_FORD"):
        t = traco(m, alg, fonte)
        r = t["resultado"]
        if alg == "DIJKSTRA" and r["recusa"]:
            continue
        n = len(t["grafo"]["rotulos"])
        dist, pai = [None] * n, [-1] * n
        dist[t["grafo"]["inicio"]] = 0
        for e in t["eventos"]:
            if e["t"] == "relaxa":
                assert e["antes"] == dist[e["v"]] and (e["antes"] is None or e["depois"] < e["antes"])
                dist[e["v"]], pai[e["v"]] = e["depois"], e["u"]
            elif e["t"] == "ciclo":
                pai[e["v"]] = e["u"]
        assert dist == r["dist"] and pai == r["pai"]


@pytest.mark.parametrize("arquivo, fonte", CASOS, ids=IDS)
def test_traco_e_json_e_confere_com_resolver(arquivo, fonte):
    m = ler_mapa(arquivo)
    ge = grafo_estados(m, fonte_consumivel=fonte)
    for alg in ALGORITMOS_TRACO:
        texto = traco_json(m, alg, fonte)
        assert "Infinity" not in texto and "NaN" not in texto
        t = json.loads(texto)
        assert t["algoritmo"] == alg and t["fonteConsumivel"] == fonte
        g = t["grafo"]
        assert g["rotulos"] == [rotulo(v) for v in ge.grafo.nos()]
        assert g["rotulos"][g["alvo"]] == ALVO and g["estados"][g["alvo"]] is None
        assert g["nEstados"] == len(ge.estados()) and g["nArcos"] == ge.sem_alvo.tamanho
    # o final do traço é o mesmo resultado que solve.resolver usa
    alvo = t["grafo"]["alvo"]
    bfs_r = traco(m, "BFS", fonte)["resultado"]
    r = resolver(ge, "BFS")
    assert (r["passos"] is None) == (bfs_r["dist"][alvo] < 0)
    if r["passos"] is not None:
        assert bfs_r["dist"][alvo] == r["passos"] + 1  # +1 = arco G -> ALVO
    bf = traco(m, "BELLMAN_FORD", fonte)["resultado"]
    rb = resolver(ge, "BELLMAN_FORD")
    if rb["status"] == "CICLO_NEGATIVO":
        assert [g["rotulos"][i] for i in bf["cicloNegativo"]] == rb["caminho"]
    elif rb["status"] == "OK":
        assert bf["dist"][alvo] == rb["custo"]


def test_m06_ciclo_negativo_e_variante_fonte():
    m = ler_mapa(RAIZ / "data" / "mapas" / "m06_fonte.txt")
    normal = traco(m, "BELLMAN_FORD")
    assert normal["resultado"]["cicloNegativo"] and normal["eventos"][-1]["t"] == "ciclo"
    assert not normal["resultado"]["parouCedo"]
    fonte = traco(m, "BELLMAN_FORD_FONTE_CONSUMIVEL")
    assert fonte["fonteConsumivel"] is True and fonte["resultado"]["cicloNegativo"] is None
    assert traco(m, "DIJKSTRA")["resultado"]["recusa"]["mensagem"].startswith("Dijkstra recusado")


def test_algoritmo_desconhecido():
    with pytest.raises(ValueError):
        traco(ler_mapa(ARQUIVOS[0]), "A_ESTRELA")
