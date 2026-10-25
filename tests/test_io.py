# [IA] Claude – sugestão de casos de teste (conferidos pelo grupo)
import pytest

from src.graphs.io import MapaInvalido, ler_mapa, parse_mapa
from conftest import MAPAS


def test_le_todos_os_mapas_fornecidos():
    for p in sorted(MAPAS.glob("*.txt")):
        m = ler_mapa(p)
        assert m.casa(*m.inicio) == "S"


def test_ignora_comentarios():
    m = parse_mapa("; comentario\n#####\n#S.G#\n#####\n")
    assert m.linhas == 3 and m.inicio == (1, 1) and m.saidas == [(1, 3)]


def test_m08_tem_31x71_e_4_chaves():
    m = ler_mapa(MAPAS / "m08_grande.txt")
    assert (m.linhas, m.colunas, len(m.chaves)) == (31, 71, 4)


@pytest.mark.parametrize("texto, trecho", [
    ("#####\n#S.G#\n####\n", "não retangular"),
    ("######\n#S.SG#\n######\n", "exatamente um 'S'"),
    ("#####\n#...#\n#####\n", "exatamente um 'S'"),
    ("#####\n#S..#\n#####\n", "pelo menos um 'G'"),
    ("#####\n#S?G#\n#####\n", "símbolo desconhecido"),
])
def test_mapas_invalidos(texto, trecho):
    with pytest.raises(MapaInvalido, match=trecho):
        parse_mapa(texto)
