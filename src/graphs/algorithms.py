# [IA] Claude – implementação de BFS, DFS, Dijkstra e Bellman-Ford (revisar e explicar em grupo)
"""Algoritmos próprios (sem networkx): BFS, DFS com classificação de arcos,
Dijkstra (recusa pesos negativos) e Bellman-Ford (detecta e devolve ciclo negativo)."""
from __future__ import annotations

import heapq
from collections import deque
from dataclasses import dataclass, field
from itertools import count

from .graph import Grafo, No

INF = float("inf")

# [IA] Claude – ganchos de observação para a visualização (não alteram o algoritmo)
# bfs, dfs, dijkstra e bellman_ford aceitam `observador=None` (só por palavra-chave). Quando ele é
# passado, cada função o chama com um dicionário {"t": evento, ...} nos pontos em que o algoritmo já
# faz alguma coisa (tira da fila, olha um arco, relaxa...). As linhas `if observador: observador({...})`
# só leem as variáveis; sem observador o código roda exatamente como antes. Quem usa: src/traco.py.


class PesoNegativoError(ValueError):
    """Dijkstra não aceita arcos de peso negativo."""


def caminho(pai: dict[No, No | None], destino: No) -> list[No]:
    if destino not in pai:
        return []
    seq = []
    v: No | None = destino
    while v is not None:
        seq.append(v)
        v = pai[v]
    return seq[::-1]


# ---------------------------------------------------------------- BFS
@dataclass
class ResultadoBFS:
    dist: dict[No, int]
    pai: dict[No, No | None]
    ordem: list[No]

    def niveis(self) -> list[list[No]]:
        camadas: list[list[No]] = []
        for v in self.ordem:
            d = self.dist[v]
            while len(camadas) <= d:
                camadas.append([])
            camadas[d].append(v)
        return camadas


def bfs(g: Grafo, origem: No, *, observador=None) -> ResultadoBFS:
    dist = {origem: 0}
    pai: dict[No, No | None] = {origem: None}
    ordem = [origem]
    fila = deque([origem])
    # [IA] Claude – ganchos de observação para a visualização (não alteram o algoritmo)
    if observador: observador({"t": "inicio", "v": origem, "d": 0})
    while fila:
        u = fila.popleft()
        if observador: observador({"t": "sai", "v": u})
        for a in g.vizinhos(u):
            if observador: observador({"t": "olha", "u": u, "v": a.destino, "novo": a.destino not in dist})
            if a.destino not in dist:
                dist[a.destino] = dist[u] + 1
                pai[a.destino] = u
                ordem.append(a.destino)
                fila.append(a.destino)
                if observador: observador({"t": "entra", "v": a.destino, "d": dist[a.destino], "p": u})
        if observador: observador({"t": "encerra", "v": u})
    return ResultadoBFS(dist, pai, ordem)


def alcancaveis(g: Grafo, origem: No) -> set[No]:
    return set(bfs(g, origem).dist)


# ---------------------------------------------------------------- DFS
@dataclass
class ResultadoDFS:
    descoberta: dict[No, int]
    termino: dict[No, int]
    pai: dict[No, No | None]
    classes: dict[str, int] = field(default_factory=lambda: {"arvore": 0, "retorno": 0, "avanco": 0, "cruzamento": 0})
    arcos: list[tuple[No, No, str]] = field(default_factory=list)

    @property
    def tem_ciclo(self) -> bool:
        return self.classes["retorno"] > 0


def dfs(g: Grafo, origem: No, *, observador=None) -> ResultadoDFS:
    """DFS iterativa (mapas grandes estourariam a recursão) que classifica cada arco
    em árvore, retorno, avanço ou cruzamento usando tempos de descoberta/término."""
    branco, cinza, preto = 0, 1, 2
    cor: dict[No, int] = {}
    res = ResultadoDFS({}, {}, {origem: None})
    t = 0

    def classificar(u: No, v: No) -> str:
        c = cor.get(v, branco)
        if c == branco:
            return "arvore"
        if c == cinza:
            return "retorno"
        return "avanco" if res.descoberta[u] < res.descoberta[v] else "cruzamento"

    cor[origem] = cinza
    res.descoberta[origem] = t
    t += 1
    # [IA] Claude – ganchos de observação para a visualização (não alteram o algoritmo)
    if observador: observador({"t": "descobre", "v": origem, "d": res.descoberta[origem], "p": None})
    pilha: list[tuple[No, int]] = [(origem, 0)]
    while pilha:
        u, i = pilha[-1]
        viz = g.vizinhos(u)
        if i < len(viz):
            pilha[-1] = (u, i + 1)
            v = viz[i].destino
            tipo = classificar(u, v)
            res.classes[tipo] += 1
            res.arcos.append((u, v, tipo))
            if observador: observador({"t": "olha", "u": u, "v": v, "tipo": tipo})
            if tipo == "arvore":
                cor[v] = cinza
                res.pai[v] = u
                res.descoberta[v] = t
                t += 1
                if observador: observador({"t": "descobre", "v": v, "d": res.descoberta[v], "p": u})
                pilha.append((v, 0))
        else:
            pilha.pop()
            cor[u] = preto
            res.termino[u] = t
            t += 1
            if observador: observador({"t": "encerra", "v": u, "f": res.termino[u]})
    return res


# ---------------------------------------------------------------- Dijkstra
@dataclass
class ResultadoCaminho:
    dist: dict[No, float]
    pai: dict[No, No | None]
    ciclo_negativo: list[No] | None = None

    def caminho_ate(self, destino: No) -> list[No]:
        return caminho(self.pai, destino) if self.dist.get(destino, INF) < INF else []


def dijkstra(g: Grafo, origem: No, *, observador=None) -> ResultadoCaminho:
    negativos = [a for a in g.arcos() if a.peso < 0]
    if negativos:
        a = negativos[0]
        raise PesoNegativoError(
            f"Dijkstra recusado: o grafo tem {len(negativos)} arco(s) de peso negativo "
            f"(ex.: {a.origem} -> {a.destino} com peso {a.peso}). Use Bellman-Ford."
        )
    dist: dict[No, float] = {origem: 0}
    pai: dict[No, No | None] = {origem: None}
    desempate = count()  # nós podem não ser comparáveis entre si
    heap = [(0, next(desempate), origem)]
    fechados: set[No] = set()
    while heap:
        d, _, u = heapq.heappop(heap)
        # [IA] Claude – ganchos de observação para a visualização (não alteram o algoritmo)
        if u in fechados:
            if observador: observador({"t": "descarta", "u": u, "d": d})
            continue
        fechados.add(u)
        if observador: observador({"t": "fecha", "u": u, "d": d})
        for a in g.vizinhos(u):
            nd = d + a.peso
            if nd < dist.get(a.destino, INF):
                if observador: observador({"t": "relaxa", "u": u, "v": a.destino, "antes": dist.get(a.destino, INF), "depois": nd})
                dist[a.destino] = nd
                pai[a.destino] = u
                heapq.heappush(heap, (nd, next(desempate), a.destino))
    return ResultadoCaminho(dist, pai)


# ---------------------------------------------------------------- Bellman-Ford
def bellman_ford(g: Grafo, origem: No, *, observador=None) -> ResultadoCaminho:
    """Relaxa |V|-1 vezes (com parada antecipada). Se a |V|-ésima rodada ainda relaxa
    algum arco, existe ciclo negativo alcançável: ele é reconstruído pelos pais."""
    arcos = list(g.arcos())
    dist: dict[No, float] = {origem: 0}
    pai: dict[No, No | None] = {origem: None}
    n = g.ordem
    for _ in range(n - 1):
        mudou = False
        # [IA] Claude – ganchos de observação para a visualização (não alteram o algoritmo)
        # (o número da passada e a contagem de relaxamentos são somados por quem observa: src/traco.py)
        if observador: observador({"t": "passada"})
        for a in arcos:
            du = dist.get(a.origem, INF)
            if du < INF and du + a.peso < dist.get(a.destino, INF):
                if observador: observador({"t": "relaxa", "u": a.origem, "v": a.destino, "antes": dist.get(a.destino, INF), "depois": du + a.peso})
                dist[a.destino] = du + a.peso
                pai[a.destino] = a.origem
                mudou = True
        if observador: observador({"t": "fimPassada", "mudou": mudou})
        if not mudou:
            return ResultadoCaminho(dist, pai)

    for a in arcos:
        du = dist.get(a.origem, INF)
        if du < INF and du + a.peso < dist.get(a.destino, INF):
            pai[a.destino] = a.origem
            x = a.destino
            for _ in range(n):  # anda n vezes para garantir que caiu dentro do ciclo
                x = pai[x]
            ciclo = [x]
            y = pai[x]
            while y != x:
                ciclo.append(y)
                y = pai[y]
            ciclo.append(x)
            # [IA] Claude – ganchos de observação para a visualização (não alteram o algoritmo)
            if observador: observador({"t": "ciclo", "ciclo": ciclo[::-1], "u": a.origem, "v": a.destino})
            return ResultadoCaminho(dist, pai, ciclo_negativo=ciclo[::-1])
    return ResultadoCaminho(dist, pai)


def custo_ciclo(g: Grafo, ciclo: list[No]) -> float:
    total = 0.0
    for u, v in zip(ciclo, ciclo[1:]):
        total += min(a.peso for a in g.vizinhos(u) if a.destino == v)
    return total
