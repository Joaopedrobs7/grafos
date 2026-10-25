# [IA] Claude – estrutura inicial do leitor/validador de mapas (revisar e explicar em grupo)
"""Leitura e validação dos mapas .txt do labirinto."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

PAREDE = "#"
CHAO = "."
INICIO = "S"
SAIDA = "G"
LAMA = ","
AGUA = "~"
BONUS = "+"
FONTE = "*"
CHAVES = "abcd"
PORTAS = "ABCD"
ESTEIRAS = {"^": (-1, 0), ">": (0, 1), "v": (1, 0), "<": (0, -1)}

SIMBOLOS_VALIDOS = set(PAREDE + CHAO + INICIO + SAIDA + LAMA + AGUA + BONUS + FONTE + CHAVES + PORTAS) | set(ESTEIRAS)

CUSTO_BASE = {
    CHAO: 1, INICIO: 1, SAIDA: 1, LAMA: 3, AGUA: 5,
    BONUS: -4, FONTE: -2,
    **{c: 1 for c in CHAVES}, **{p: 1 for p in PORTAS}, **{e: 1 for e in ESTEIRAS},
}


class MapaInvalido(ValueError):
    """Erro de validação com mensagem clara para o usuário."""


@dataclass
class Mapa:
    nome: str
    grade: list[str]
    inicio: tuple[int, int]
    saidas: list[tuple[int, int]]
    bonus: dict[tuple[int, int], int] = field(default_factory=dict)  # casa -> índice (ordem de leitura)
    fontes: list[tuple[int, int]] = field(default_factory=list)
    chaves: dict[str, tuple[int, int]] = field(default_factory=dict)

    @property
    def linhas(self) -> int:
        return len(self.grade)

    @property
    def colunas(self) -> int:
        return len(self.grade[0])

    def casa(self, r: int, c: int) -> str:
        return self.grade[r][c]

    def dentro(self, r: int, c: int) -> bool:
        return 0 <= r < self.linhas and 0 <= c < self.colunas

    def casas_livres(self) -> list[tuple[int, int]]:
        return [(r, c) for r in range(self.linhas) for c in range(self.colunas) if self.grade[r][c] != PAREDE]


def parse_mapa(texto: str, nome: str = "mapa") -> Mapa:
    linhas = [ln.rstrip("\r\n") for ln in texto.splitlines()]
    grade = [ln for ln in linhas if ln.strip() and not ln.lstrip().startswith(";")]
    if not grade:
        raise MapaInvalido(f"{nome}: mapa vazio (nenhuma linha de grade encontrada).")

    for i, ln in enumerate(grade):
        if len(ln) != len(grade[0]):
            raise MapaInvalido(
                f"{nome}: mapa não retangular — linha {i} tem {len(ln)} colunas, esperado {len(grade[0])}."
            )

    inicios, saidas, bonus, fontes, chaves = [], [], {}, [], {}
    for r, ln in enumerate(grade):
        for c, ch in enumerate(ln):
            if ch not in SIMBOLOS_VALIDOS:
                raise MapaInvalido(f"{nome}: símbolo desconhecido {ch!r} na posição ({r},{c}).")
            if ch == INICIO:
                inicios.append((r, c))
            elif ch == SAIDA:
                saidas.append((r, c))
            elif ch == BONUS:
                bonus[(r, c)] = len(bonus)
            elif ch == FONTE:
                fontes.append((r, c))
            elif ch in CHAVES:
                chaves[ch] = (r, c)

    if len(inicios) != 1:
        raise MapaInvalido(f"{nome}: o mapa deve ter exatamente um 'S' (encontrados {len(inicios)}).")
    if not saidas:
        raise MapaInvalido(f"{nome}: o mapa deve ter pelo menos um 'G' (nenhum encontrado).")

    return Mapa(nome=nome, grade=grade, inicio=inicios[0], saidas=saidas, bonus=bonus, fontes=fontes, chaves=chaves)


def ler_mapa(caminho: str | Path) -> Mapa:
    p = Path(caminho)
    if not p.exists():
        raise FileNotFoundError(f"Mapa não encontrado: {p}")
    return parse_mapa(p.read_text(encoding="utf-8"), nome=p.stem)


def listar_mapas(*pastas: str | Path) -> list[Path]:
    arquivos: list[Path] = []
    for pasta in pastas:
        arquivos.extend(sorted(Path(pasta).glob("*.txt")))
    return arquivos
