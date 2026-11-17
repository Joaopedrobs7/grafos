from __future__ import annotations

import heapq
from collections import deque
from dataclasses import dataclass, field
from itertools import count

from .graph import Arco, Grafo, No

INF = float("inf")


class PesoNegativoError(ValueError):
    pass


@dataclass
class Resultado:
    dist: dict = field(default_factory=dict)
    pai: dict = field(default_factory=dict)
    ordem: list = field(default_factory=list)
    status: str = "OK"
    ciclo_negativo: list | None = None
    classes: dict = field(default_factory=dict)
    arcos: list = field(default_factory=list)

    @property
    def tem_ciclo(self) -> bool:
        return self.classes.get("retorno", 0) > 0

    def caminho_ate(self, v: No) -> list[No]:
        return caminho(self.pai, v)

    def niveis(self) -> list[list[No]]:
        if not self.dist:
            return []
        n = [[] for _ in range(max(self.dist.values()) + 1)]
        for v in self.ordem:
            n[self.dist[v]].append(v)
        return n


def caminho(pai: dict, alvo: No) -> list[No]:
    if alvo not in pai:
        return []
    cam = [alvo]
    while pai[cam[-1]] is not None:
        cam.append(pai[cam[-1]])
    return cam[::-1]


def _melhora(r: Resultado, a: Arco) -> bool:
    return r.dist.get(a.origem, INF) + a.peso < r.dist.get(a.destino, INF)


def _relaxa(r: Resultado, a: Arco) -> None:
    r.dist[a.destino] = r.dist[a.origem] + a.peso
    r.pai[a.destino] = a.origem


def bfs(g: Grafo, origem: No) -> Resultado:
    r = Resultado(dist={origem: 0}, pai={origem: None}, ordem=[origem])
    fila = deque([origem])
    while fila:
        u = fila.popleft()
        for a in g.vizinhos(u):
            if a.destino not in r.dist:
                r.dist[a.destino] = r.dist[u] + 1
                r.pai[a.destino] = u
                r.ordem.append(a.destino)
                fila.append(a.destino)
    return r


def alcancaveis(g: Grafo, origem: No) -> set[No]:
    return set(bfs(g, origem).dist)


def dfs(g: Grafo, origem: No) -> Resultado:
    r = Resultado(pai={origem: None}, ordem=[origem], classes=dict.fromkeys(("arvore", "retorno", "avanco", "cruzamento"), 0))
    desc = {origem: 0}
    fim: dict = {}
    tempo = 1
    pilha = [(origem, 0)]
    while pilha:
        u, i = pilha[-1]
        vizinhos = g.vizinhos(u)
        if i == len(vizinhos):
            fim[u] = tempo
            tempo += 1
            pilha.pop()
            continue
        pilha[-1] = (u, i + 1)
        v = vizinhos[i].destino
        match (v in desc, v in fim):
            case (False, _):
                tipo = "arvore"
                desc[v] = tempo
                tempo += 1
                r.pai[v] = u
                r.ordem.append(v)
                pilha.append((v, 0))
            case (True, False):
                tipo = "retorno"
            case _:
                tipo = "avanco" if desc[u] < desc[v] else "cruzamento"
        r.classes[tipo] += 1
        r.arcos.append((u, v, tipo))
    return r

def dijkstra(g: Grafo, origem: No) -> Resultado:
    if g.tem_peso_negativo():
        raise PesoNegativoError("Dijkstra não aceita peso negativo. Use Bellman-Ford.")
    r = Resultado(dist={origem: 0}, pai={origem: None})
    desempate = count(1)
    heap = [(0, 0, origem)]
    while heap:
        d, _, u = heapq.heappop(heap)
        if d > r.dist[u]:
            continue
        r.ordem.append(u)
        for a in g.vizinhos(u):
            if _melhora(r, a):
                _relaxa(r, a)
                heapq.heappush(heap, (r.dist[a.destino], next(desempate), a.destino))
    return r


def _extrair_ciclo(g: Grafo, pai: dict, x: No) -> list[No]:
    for _ in range(g.ordem):
        x = pai[x]
    ciclo = [x]
    v = pai[x]
    while v != x:
        ciclo.append(v)
        v = pai[v]
    ciclo.reverse()
    ciclo.append(ciclo[0])
    return ciclo


def bellman_ford(g: Grafo, origem: No) -> Resultado:
    arcos = list(g.arcos())
    r = Resultado(dist={origem: 0}, pai={origem: None})
    for _ in range(g.ordem - 1):
        for a in arcos:
            if _melhora(r, a):
                _relaxa(r, a)
    match next((a for a in arcos if _melhora(r, a)), None):
        case None:
            return r
        case a:
            r.pai[a.destino] = a.origem
            r.ciclo_negativo = _extrair_ciclo(g, r.pai, a.destino)
            r.status = "CICLO_NEGATIVO"
            return r


def custo_ciclo(g: Grafo, ciclo: list[No]) -> float:
    total = 0.0
    for u, v in zip(ciclo, ciclo[1:]):
        total += min(a.peso for a in g.vizinhos(u) if a.destino == v)
    return total