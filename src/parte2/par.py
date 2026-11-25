# [IA] Claude – orquestração do caminho entre dois jogadores escolhidos no site (só monta o grafo e chama os
# algoritmos do grupo em src/graphs/algorithms.py; o recorte e o Johnson são os de rotacao_casos.py)
"""Caminho de A até B dentro de um time-temporada do grafo de rotação, com o algoritmo escolhido.

Entrada: o JSON de ``out/parte2/web/rotacao/<TIME>_<ano>.json`` (nós em ordem de minutos decrescente,
arcos ``[i, j, peso, ocorrencias]``). Os nós do grafo são os índices dessa lista.

Grafos:
- ``completo``: todos os arcos do time-temporada (tem ciclo negativo em todos os 180 times-temporada);
- ``recorte``: o recorte "descer na rotação" de ``rotacao_casos.descendente`` (só arcos de quem tem mais
  minutos para quem tem menos), acíclico por construção.

Para cada algoritmo devolve status (OK, SEM_CAMINHO, RECUSA, CICLO_NEGATIVO), o caminho e os passos com o
peso de cada troca e o custo acumulado. Custo = soma dos pesos originais dos arcos do caminho.
"""
from __future__ import annotations

from time import perf_counter

from ..graphs.algorithms import PesoNegativoError, bellman_ford, bfs, custo_ciclo, dfs, dijkstra
from ..graphs.graph import Grafo
from .rotacao_casos import descendente, johnson

ALGORITMOS = ("BFS", "DFS", "DIJKSTRA", "BELLMAN_FORD")
GRAFOS = ("completo", "recorte")


def montar(dados: dict) -> tuple[Grafo, dict[int, float], dict[tuple[int, int], float]]:
    g = Grafo()
    for i in range(len(dados["nos"])):
        g.add_no(i)
    pesos = {}
    for i, j, peso, _ocorr in dados["arcos"]:
        g.add_arco(i, j, peso)
        pesos[(i, j)] = peso
    minutos = {i: float(n.get("minutos") or 0.0) for i, n in enumerate(dados["nos"])}
    return g, minutos, pesos


def _passos(seq: list[int], pesos: dict[tuple[int, int], float]) -> list[dict]:
    res, acum = [], 0.0
    for u, v in zip(seq, seq[1:]):
        acum += pesos[(u, v)]
        res.append({"de": u, "para": v, "peso": pesos[(u, v)], "acumulado": round(acum, 4)})
    return res


def _ok(alg: str, cam: list[int], pesos, tempo: float, **extra) -> dict:
    passos = _passos(cam, pesos)
    return {"algoritmo": alg, "status": "OK", "caminho": cam, "passos": passos, "trocas": len(passos),
            "custo": passos[-1]["acumulado"] if passos else 0.0, "tempo_ms": tempo, **extra}


def _sem_caminho(alg: str, tempo: float, mensagem: str) -> dict:
    return {"algoritmo": alg, "status": "SEM_CAMINHO", "caminho": None, "passos": [], "trocas": None,
            "custo": None, "tempo_ms": tempo, "mensagem": mensagem}


def _rodar(alg: str, g: Grafo, a: int, b: int, pesos, recorte: bool) -> dict:
    t0 = perf_counter()
    if alg == "BFS":
        r = bfs(g, a)
    elif alg == "DFS":
        r = dfs(g, a)
    elif alg == "DIJKSTRA":
        try:
            if recorte:
                _h, reponderado = johnson(g)  # pesos w' = w + h(u) - h(v) >= 0, mesmos caminhos mínimos
                r = dijkstra(reponderado, a)
            else:
                r = dijkstra(g, a)
        except PesoNegativoError as e:
            return {"algoritmo": alg, "status": "RECUSA", "caminho": None, "passos": [], "trocas": None,
                    "custo": None, "tempo_ms": (perf_counter() - t0) * 1000, "mensagem": str(e)}
    else:
        r = bellman_ford(g, a)
    tempo = (perf_counter() - t0) * 1000

    if r.status == "CICLO_NEGATIVO":
        ciclo = r.ciclo_negativo
        # contexto para a tela (busca em largura do grupo): como a origem chega ao ciclo e se o ciclo leva ao destino
        da_origem = bfs(g, a).dist
        entrada = min(ciclo[:-1], key=lambda v: (da_origem.get(v, float("inf")), v))
        acesso = bfs(g, a).caminho_ate(entrada)
        leva_ao_destino = b in bfs(g, entrada).dist
        # do ciclo até o destino: sai pelo nó do ciclo mais perto do destino (BFS do grupo)
        saida = []
        if leva_ao_destino:
            melhor = None
            for v in ciclo[:-1]:
                cam = bfs(g, v).caminho_ate(b)
                if cam and (melhor is None or len(cam) < len(melhor)):
                    melhor = cam
            saida = melhor or []
        msg = ("o Bellman-Ford parou ao achar um ciclo negativo alcançável a partir da origem" +
               (", e do ciclo dá para chegar ao destino: dar voltas nele baixa o custo até o destino sem limite, "
                "então o menor custo não existe" if leva_ao_destino else
                "; o destino não é alcançável a partir desse ciclo, mas o algoritmo não devolve distâncias "
                "quando detecta ciclo negativo"))
        return {"algoritmo": alg, "status": "CICLO_NEGATIVO", "caminho": None, "ciclo": ciclo,
                "passos": _passos(ciclo, pesos), "acesso": acesso, "passos_acesso": _passos(acesso, pesos),
                "saida": saida, "passos_saida": _passos(saida, pesos),
                "ciclo_leva_ao_destino": leva_ao_destino, "trocas": None, "custo": None,
                "custo_ciclo": custo_ciclo(g, ciclo), "tempo_ms": tempo, "mensagem": msg}
    cam = r.caminho_ate(b)
    if not cam:
        return _sem_caminho(alg, tempo, "nenhuma cadeia de trocas leva da origem ao destino" +
                            (" neste recorte (só arcos de quem jogou mais minutos para quem jogou menos)"
                             if recorte else ""))
    return _ok(alg, cam, pesos, tempo)


def caminho_entre(dados: dict, a: int, b: int, grafo: str = "completo") -> dict:
    """Roda os 4 algoritmos do grupo de A até B no grafo pedido e devolve um resultado por algoritmo."""
    n = len(dados["nos"])
    if not (0 <= a < n and 0 <= b < n):
        raise ValueError(f"jogador fora do intervalo 0..{n - 1}")
    if a == b:
        raise ValueError("origem e destino são o mesmo jogador")
    if grafo not in GRAFOS:
        raise ValueError(f"grafo deve ser um de {GRAFOS}")
    g, minutos, pesos = montar(dados)
    recorte = grafo == "recorte"
    if recorte:
        g = descendente(g, minutos)
    return {"de": a, "para": b, "grafo": grafo, "nos": g.ordem, "arcos": g.tamanho,
            "resultados": [_rodar(alg, g, a, b, pesos, recorte) for alg in ALGORITMOS]}
