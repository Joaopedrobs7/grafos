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

SIMBOLOS_VALIDOS = {PAREDE, CHAO, INICIO, SAIDA, LAMA, AGUA, BONUS, FONTE, *CHAVES, *PORTAS, *ESTEIRAS}

CUSTO_BASE = {CHAO: 1, INICIO: 1, SAIDA: 1, LAMA: 3, AGUA: 5, BONUS: -4, FONTE: -2}
CUSTO_BASE.update(dict.fromkeys([*CHAVES, *PORTAS, *ESTEIRAS], 1))


class MapaInvalido(ValueError):
    pass


@dataclass
class Mapa:
    nome: str
    grade: list[str]
    inicio: tuple[int, int]
    saidas: list[tuple[int, int]]
    bonus: dict[tuple[int, int], int] = field(default_factory=dict)
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
        return r in range(self.linhas) and c in range(self.colunas)

    def casas_livres(self) -> list[tuple[int, int]]:
        return [(r, c) for r, linha in enumerate(self.grade) for c, s in enumerate(linha) if s != PAREDE]


def _linha_de_grade(linha: str) -> bool:
    limpa = linha.strip()
    return limpa != "" and not limpa.startswith(";")


def parse_mapa(texto: str, nome: str = "mapa") -> Mapa:
    grade = [linha for linha in texto.splitlines() if _linha_de_grade(linha)]
    if not grade:
        raise MapaInvalido(f"{nome}: mapa vazio (nenhuma linha de grade encontrada).")

    largura = len(grade[0])
    tortas = [i for i, linha in enumerate(grade) if len(linha) != largura]
    if tortas:
        i = tortas[0]
        raise MapaInvalido(f"{nome}: mapa não retangular — linha {i} tem {len(grade[i])} colunas, esperado {largura}.")

    posicoes: dict[str, list[tuple[int, int]]] = {}
    for r, linha in enumerate(grade):
        for c, ch in enumerate(linha):
            if ch not in SIMBOLOS_VALIDOS:
                raise MapaInvalido(f"{nome}: símbolo desconhecido {ch!r} na posição ({r},{c}).")
            posicoes.setdefault(ch, []).append((r, c))

    inicios = posicoes.get(INICIO, [])
    saidas = posicoes.get(SAIDA, [])
    if len(inicios) != 1:
        raise MapaInvalido(f"{nome}: o mapa deve ter exatamente um 'S' (encontrados {len(inicios)}).")
    if not saidas:
        raise MapaInvalido(f"{nome}: o mapa deve ter pelo menos um 'G' (nenhum encontrado).")

    return Mapa(
        nome=nome,
        grade=grade,
        inicio=inicios[0],
        saidas=saidas,
        bonus={pos: i for i, pos in enumerate(posicoes.get(BONUS, []))},
        fontes=posicoes.get(FONTE, []),
        chaves={ch: lista[-1] for ch, lista in posicoes.items() if ch in CHAVES},
    )


def ler_mapa(caminho: str | Path) -> Mapa:
    arquivo = Path(caminho)
    if not arquivo.exists():
        raise FileNotFoundError(f"Mapa não encontrado: {arquivo}")
    return parse_mapa(arquivo.read_text(encoding="utf-8"), nome=arquivo.stem)


def listar_mapas(*pastas: str | Path) -> list[Path]:
    return [arquivo for pasta in pastas for arquivo in sorted(Path(pasta).glob("*.txt"))]