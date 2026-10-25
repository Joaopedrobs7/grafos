# [IA] Claude – construção do grafo de posições e do grafo de estados (revisar e explicar em grupo)
"""Grafo de posições (G_pos) e grafo de estados (G_est) de um mapa.

Estado = (linha, coluna, chaves, bônus consumidos). O G_est é construído por
exploração em largura a partir do estado inicial: só entram estados alcançáveis.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from .graph import Grafo
from .io import BONUS, CHAVES, CUSTO_BASE, ESTEIRAS, FONTE, PAREDE, PORTAS, SAIDA, Mapa

ALVO = "ALVO"
DIRECOES = [("N", -1, 0), ("L", 0, 1), ("S", 1, 0), ("O", 0, -1)]  # ordem obrigatória

Estado = tuple[int, int, str, tuple[int, ...]]  # (r, c, chaves ordenadas, bônus ordenados)


def rotulo(e) -> str:
    if e == ALVO:
        return ALVO
    r, c, chaves, bonus = e
    return f"({r},{c})|{chaves or '-'}|{{{','.join(map(str, bonus))}}}"


def movimentos(mapa: Mapa, r: int, c: int):
    """Movimentos geométricos (paredes, borda e esteiras) a partir de (r, c), na ordem N, L, S, O.
    Portas não são tratadas aqui: dependem das chaves do estado."""
    casa = mapa.casa(r, c)
    if casa == SAIDA:
        return []  # jogo terminou
    if casa in ESTEIRAS:
        dr, dc = ESTEIRAS[casa]
        direcoes = [d for d in DIRECOES if (d[1], d[2]) == (dr, dc)]
    else:
        direcoes = DIRECOES
    saida = []
    for nome, dr, dc in direcoes:
        nr, nc = r + dr, c + dc
        if mapa.dentro(nr, nc) and mapa.casa(nr, nc) != PAREDE:
            saida.append((nome, nr, nc))
    return saida


# ---------------------------------------------------------------- G_pos
def grafo_posicoes(mapa: Mapa, portas: str = "chao") -> Grafo:
    """Modelo ingênuo: nó = casa livre. portas='chao' (atravessáveis) ou 'parede'.
    Bônus vale -4 sempre (não há memória de consumo)."""
    g = Grafo()
    bloqueada = (lambda ch: ch in PORTAS) if portas == "parede" else (lambda ch: False)
    for r, c in mapa.casas_livres():
        if bloqueada(mapa.casa(r, c)):
            continue
        g.add_no((r, c))
        for mov, nr, nc in movimentos(mapa, r, c):
            destino = mapa.casa(nr, nc)
            if bloqueada(destino):
                continue
            g.add_arco((r, c), (nr, nc), CUSTO_BASE[destino], (mov, destino))
    return g


# ---------------------------------------------------------------- G_est
@dataclass
class GrafoEstados:
    mapa: Mapa
    grafo: Grafo  # inclui o nó virtual ALVO
    inicio: Estado
    fonte_consumivel: bool = False

    @property
    def sem_alvo(self) -> Grafo:
        return self.grafo.sem_no(ALVO)

    def estados(self) -> list[Estado]:
        return [v for v in self.grafo.nos() if v != ALVO]

    def n_consumiveis(self) -> int:
        return len(self.mapa.bonus) + (len(self.mapa.fontes) if self.fonte_consumivel else 0)

    def teto_teorico(self) -> int:
        return len(self.mapa.casas_livres()) * 2 ** len(self.mapa.chaves) * 2 ** self.n_consumiveis()


def _indices_consumiveis(mapa: Mapa, fonte_consumivel: bool) -> dict[tuple[int, int], int]:
    idx = dict(mapa.bonus)
    if fonte_consumivel:  # fontes numeradas depois dos bônus, em ordem de leitura
        for i, pos in enumerate(mapa.fontes):
            idx[pos] = len(mapa.bonus) + i
    return idx


def transicao(mapa: Mapa, e: Estado, consumiveis: dict[tuple[int, int], int], fonte_consumivel: bool):
    """Gera (movimento, casa_destino, peso, novo_estado) a partir de e, na ordem N, L, S, O."""
    r, c, chaves, bonus = e
    for mov, nr, nc in movimentos(mapa, r, c):
        destino = mapa.casa(nr, nc)
        if destino in PORTAS and destino.lower() not in chaves:
            continue  # porta trancada funciona como parede
        novas_chaves = chaves
        novo_bonus = bonus
        peso = CUSTO_BASE[destino]
        if destino in CHAVES and destino not in chaves:
            novas_chaves = "".join(sorted(chaves + destino))
        if destino == BONUS or (destino == FONTE and fonte_consumivel):
            i = consumiveis[(nr, nc)]
            if i in bonus:
                peso = 1  # já consumido: vira chão
            else:
                novo_bonus = tuple(sorted(bonus + (i,)))
        yield mov, destino, peso, (nr, nc, novas_chaves, novo_bonus)


def grafo_estados(mapa: Mapa, fonte_consumivel: bool = False) -> GrafoEstados:
    consumiveis = _indices_consumiveis(mapa, fonte_consumivel)
    inicio: Estado = (*mapa.inicio, "", ())
    g = Grafo()
    g.add_no(inicio)
    visitados = {inicio}
    fila = deque([inicio])
    while fila:
        e = fila.popleft()
        if mapa.casa(e[0], e[1]) == SAIDA:
            g.add_arco(e, ALVO, 0, ("ALVO", ""))
            continue
        for mov, destino, peso, novo in transicao(mapa, e, consumiveis, fonte_consumivel):
            g.add_arco(e, novo, peso, (mov, destino))
            if novo not in visitados:
                visitados.add(novo)
                fila.append(novo)
    g.add_no(ALVO)
    return GrafoEstados(mapa, g, inicio, fonte_consumivel)
