from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Hashable, Iterator

No = Hashable


@dataclass(frozen=True)
class Arco:
    origem: No
    destino: No
    peso: float
    info: Any = None


class Grafo:
    def __init__(self) -> None:
        self._adj: dict[No, list[Arco]] = {}

    def add_no(self, v: No) -> None:
        if v not in self._adj:
            self._adj[v] = []

    def add_arco(self, u: No, v: No, peso: float = 1, info: Any = None) -> None:
        self.add_no(u)
        self.add_no(v)
        self._adj[u].append(Arco(u, v, peso, info))

    def __contains__(self, v: No) -> bool:
        return v in self._adj

    def __len__(self) -> int:
        return self.ordem

    def nos(self) -> list[No]:
        return list(self._adj.keys())

    def vizinhos(self, u: No) -> list[Arco]:
        return self._adj.get(u, [])

    def arcos(self) -> Iterator[Arco]:
        return (a for saida in self._adj.values() for a in saida)

    @property
    def ordem(self) -> int:
        return len(self._adj)

    @property
    def tamanho(self) -> int:
        return sum(map(len, self._adj.values()))

    def densidade(self) -> float:
        match self.ordem:
            case 0 | 1:
                return 0.0
            case n:
                return self.tamanho / (n * (n - 1))

    def tem_peso_negativo(self) -> bool:
        return any(a.peso < 0 for a in self.arcos())

    def graus(self) -> dict[No, tuple[int, int]]:
        entrada = dict.fromkeys(self._adj, 0)
        for a in self.arcos():
            entrada[a.destino] += 1
        return {v: (entrada[v], len(saida)) for v, saida in self._adj.items()}

    def transposto(self) -> Grafo:
        invertido = Grafo()
        for v in self.nos():
            invertido.add_no(v)
        for a in self.arcos():
            invertido.add_arco(a.destino, a.origem, a.peso, a.info)
        return invertido

    def subgrafo_induzido(self, nos: set[No]) -> Grafo:
        sub = Grafo()
        for v in self.nos():
            if v in nos:
                sub.add_no(v)
        for a in self.arcos():
            if a.origem in nos and a.destino in nos:
                sub.add_arco(a.origem, a.destino, a.peso, a.info)
        return sub

    def sem_no(self, removido: No) -> Grafo:
        return self.subgrafo_induzido(set(self._adj) - {removido})