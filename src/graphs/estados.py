from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from .graph import Grafo
from .io import CHAVES, CUSTO_BASE, ESTEIRAS, PAREDE, PORTAS, SAIDA, Mapa

ALVO = "ALVO"
DIRECOES = [("N", -1, 0), ("L", 0, 1), ("S", 1, 0), ("O", 0, -1)]

Estado = tuple[int, int, str, tuple[int, ...]]


def rotulo(e) -> str:
    match e:
        case (r, c, chaves, bonus):
            lista = ",".join(str(i) for i in bonus)
            return f"({r},{c})|{chaves or '-'}|{{{lista}}}"
        case _:
            return str(e)


def _livre(mapa: Mapa, r: int, c: int) -> bool:
    return mapa.dentro(r, c) and mapa.casa(r, c) != PAREDE


def movimentos(mapa: Mapa, r: int, c: int):
    casa = mapa.casa(r, c)
    if casa == SAIDA:
        return []
    passo = ESTEIRAS.get(casa)
    opcoes = [d for d in DIRECOES if passo is None or (d[1], d[2]) == passo]
    return [(nome, r + dr, c + dc) for nome, dr, dc in opcoes if _livre(mapa, r + dr, c + dc)]


def grafo_posicoes(mapa: Mapa, portas: str = "chao") -> Grafo:
    match portas:
        case "parede":
            bloqueadas = set(PORTAS)
        case _:
            bloqueadas = set()
    g = Grafo()
    for r, c in mapa.casas_livres():
        if mapa.casa(r, c) in bloqueadas:
            continue
        g.add_no((r, c))
        for mov, nr, nc in movimentos(mapa, r, c):
            destino = mapa.casa(nr, nc)
            if destino not in bloqueadas:
                g.add_arco((r, c), (nr, nc), CUSTO_BASE[destino], (mov, destino))
    return g


@dataclass
class GrafoEstados:
    mapa: Mapa
    grafo: Grafo
    inicio: Estado
    fonte_consumivel: bool = False

    @property
    def sem_alvo(self) -> Grafo:
        return self.grafo.sem_no(ALVO)

    def estados(self) -> list[Estado]:
        return [v for v in self.grafo.nos() if v != ALVO]

    def n_consumiveis(self) -> int:
        fontes = len(self.mapa.fontes) if self.fonte_consumivel else 0
        return len(self.mapa.bonus) + fontes

    def teto_teorico(self) -> int:
        bits = len(self.mapa.chaves) + self.n_consumiveis()
        return len(self.mapa.casas_livres()) * 2 ** bits


def _indices_consumiveis(mapa: Mapa, fonte_consumivel: bool) -> dict[tuple[int, int], int]:
    indices = dict(mapa.bonus)
    if fonte_consumivel:
        for i, pos in enumerate(mapa.fontes, start=len(mapa.bonus)):
            indices[pos] = i
    return indices


def transicao(mapa: Mapa, e: Estado, consumiveis: dict[tuple[int, int], int], fonte_consumivel: bool):
    r, c, chaves, bonus = e
    for mov, nr, nc in movimentos(mapa, r, c):
        destino = mapa.casa(nr, nc)
        if destino in PORTAS and destino.lower() not in chaves:
            continue
        peso = CUSTO_BASE[destino]
        novas_chaves = "".join(sorted(set(chaves + destino))) if destino in CHAVES else chaves
        novo_bonus = bonus
        match consumiveis.get((nr, nc)):
            case None:
                pass
            case i if i in bonus:
                peso = 1
            case i:
                novo_bonus = tuple(sorted(bonus + (i,)))
        yield mov, destino, peso, (nr, nc, novas_chaves, novo_bonus)


def grafo_estados(mapa: Mapa, fonte_consumivel: bool = False) -> GrafoEstados:
    consumiveis = _indices_consumiveis(mapa, fonte_consumivel)
    r0, c0 = mapa.inicio
    inicio: Estado = (r0, c0, "", ())
    g = Grafo()
    g.add_no(inicio)
    vistos = {inicio}
    fila = deque([inicio])
    while fila:
        e = fila.popleft()
        if mapa.casa(e[0], e[1]) == SAIDA:
            g.add_arco(e, ALVO, 0, ("ALVO", ""))
            continue
        for mov, destino, peso, novo in transicao(mapa, e, consumiveis, fonte_consumivel):
            g.add_arco(e, novo, peso, (mov, destino))
            if novo not in vistos:
                vistos.add(novo)
                fila.append(novo)
    g.add_no(ALVO)
    return GrafoEstados(mapa, g, inicio, fonte_consumivel)