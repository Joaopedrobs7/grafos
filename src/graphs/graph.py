# [IA] Claude – lista de adjacência dirigida (revisar e explicar em grupo)
"""Grafo dirigido e ponderado em lista de adjacência.

A ordem de inserção dos arcos é preservada: no labirinto ela segue N, L, S, O,
o que torna BFS/DFS determinísticas.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Hashable, Iterator

No = Hashable


@dataclass(frozen=True)
class Arco:
    origem: No
    destino: No
    peso: float
    info: Any = None  # metadados (ex.: movimento e casa de destino)


class Grafo:
    def __init__(self) -> None:
        self._adj: dict[No, list[Arco]] = {}

    def add_no(self, v: No) -> None:
        self._adj.setdefault(v, [])

    def add_arco(self, u: No, v: No, peso: float = 1, info: Any = None) -> None:
        self.add_no(u)
        self.add_no(v)
        self._adj[u].append(Arco(u, v, peso, info))

    def __contains__(self, v: No) -> bool:
        return v in self._adj

    def __len__(self) -> int:
        return len(self._adj)

    def nos(self) -> list[No]:
        return list(self._adj)

    def vizinhos(self, u: No) -> list[Arco]:
        return self._adj.get(u, [])

    def arcos(self) -> Iterator[Arco]:
        for lista in self._adj.values():
            yield from lista

    @property
    def ordem(self) -> int:
        return len(self._adj)

    @property
    def tamanho(self) -> int:
        return sum(len(l) for l in self._adj.values())

    def densidade(self) -> float:
        n = self.ordem
        return 0.0 if n < 2 else self.tamanho / (n * (n - 1))

    def tem_peso_negativo(self) -> bool:
        return any(a.peso < 0 for a in self.arcos())

    def graus(self) -> dict[No, tuple[int, int]]:
        """nó -> (grau_entrada, grau_saida)."""
        entrada = {v: 0 for v in self._adj}
        for a in self.arcos():
            entrada[a.destino] += 1
        return {v: (entrada[v], len(self._adj[v])) for v in self._adj}

    def transposto(self) -> "Grafo":
        t = Grafo()
        for v in self._adj:
            t.add_no(v)
        for a in self.arcos():
            t.add_arco(a.destino, a.origem, a.peso, a.info)
        return t

    def subgrafo_induzido(self, nos: set[No]) -> "Grafo":
        s = Grafo()
        for v in self._adj:
            if v in nos:
                s.add_no(v)
        for a in self.arcos():
            if a.origem in nos and a.destino in nos:
                s.add_arco(a.origem, a.destino, a.peso, a.info)
        return s

    def sem_no(self, removido: No) -> "Grafo":
        return self.subgrafo_induzido({v for v in self._adj if v != removido})
