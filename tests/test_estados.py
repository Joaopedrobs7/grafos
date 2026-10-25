# [IA] Claude – sugestão de casos de teste (contagem à mão conferida pelo grupo)
from src.graphs.estados import ALVO, grafo_estados, rotulo
from src.graphs.io import ler_mapa, parse_mapa
from src.solve import armadilhas
from conftest import MAPAS

# Mapa mínimo do grupo (4x7). Contagem à mão:
#   camada "-": (1,2) S, (1,3), (1,1) esteira ^ -> 3 estados
#   camada "a": (1,4) a, (1,5) A, (1,3), (2,5) G, (1,2), (1,1) -> 6 estados
#   total 9 estados; arcos: (1,2)-:2  (1,3)-:2  (1,1)-:0  (1,4)a:2  (1,5)a:2
#                            (1,3)a:2  (2,5)a:0  (1,2)a:2  (1,1)a:0  -> 12 arcos
MINI = """\
#######
#^S.aA#
#####G#
#######
"""


def test_mapa_minimo_contado_a_mao():
    ge = grafo_estados(parse_mapa(MINI, "mini"))
    assert len(ge.estados()) == 9
    assert ge.sem_alvo.tamanho == 12
    assert ge.teto_teorico() == 6 * 2  # 6 casas livres x 2^1 chave


def test_esteira_para_parede_gera_estado_sem_saida():
    ge = grafo_estados(parse_mapa(MINI, "mini"))
    graus = ge.sem_alvo.graus()
    assert graus[(1, 1, "", ())] == (1, 0)
    assert graus[(1, 1, "a", ())][1] == 0


def test_coletar_chave_muda_de_camada():
    ge = grafo_estados(parse_mapa(MINI, "mini"))
    entre = [a for a in ge.sem_alvo.arcos() if a.origem[2] != a.destino[2]]
    assert len(entre) == 1
    assert (rotulo(entre[0].origem), rotulo(entre[0].destino)) == ("(1,3)|-|{}", "(1,4)|a|{}")


def test_rotulo_e_estado_inicial_m02():
    ge = grafo_estados(ler_mapa(MAPAS / "m02_uma_chave.txt"))
    assert rotulo(ge.inicio) == "(1,1)|-|{}"
    assert rotulo((3, 5, "ab", (0, 2))) == "(3,5)|ab|{0,2}"


def test_porta_sem_chave_e_parede():
    ge = grafo_estados(ler_mapa(MAPAS / "m02_uma_chave.txt"))
    assert all(not (e[0] == 1 and e[1] == 6 and e[2] == "") for e in ge.estados())


def test_estados_em_g_so_ligam_ao_alvo():
    ge = grafo_estados(ler_mapa(MAPAS / "m03_tres_chaves.txt"))
    for e in ge.estados():
        if ge.mapa.casa(e[0], e[1]) == "G":
            assert [a.destino for a in ge.grafo.vizinhos(e)] == [ALVO]


def test_m07_sem_solucao_e_todos_armadilha():
    ge = grafo_estados(ler_mapa(MAPAS / "m07_impossivel.txt"))
    assert len(armadilhas(ge)) == len(ge.estados())
