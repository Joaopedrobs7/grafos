# [IA] Claude – sugestão de casos de teste (contagem à mão conferida pelo grupo)
from src.graphs.estados import ALVO, grafo_estados, rotulo
from src.graphs.io import ler_mapa, parse_mapa
from src.solve import armadilhas
# [IA] Claude – imports dos casos novos (3x4, esteira, bônus, ciclo negativo)
import pytest
from src.graphs.algorithms import bellman_ford, bfs
from src.graphs.estados import grafo_posicoes
from src.solve import metricas
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


# [IA] Claude – caso 1: mapa 3x4 com chave e porta (métricas e camadas)
def test_mapa_3x4_chave_porta_metricas_e_camadas():
    """Valida ordem, tamanho, teto, ocupação, densidade e camadas do G_est de S.a#/#.A#/#.G#."""
    # Grade (linha, coluna):   S . a #   /   # . A #   /   # . G #
    # 7 casas livres, 1 chave, 0 bônus -> T = 7 * 2^1 = 14
    # Camada "-" (porta A fechada): (0,0) (0,1) (1,1) (2,1) (2,2)G = 5 nós
    #   arcos: (0,0)->(0,1); (0,1)->(1,1),(0,0); (1,1)->(0,1),(2,1); (2,1)->(1,1),(2,2) = 7
    #   (0,1)->(0,2)a muda de camada = 1 arco entre camadas
    # Camada "a": (0,2) (1,2)A (0,1) (1,1) (2,1) (2,2)G (0,0) = 7 nós
    #   saídas: (0,2)=2 (1,2)=3 (0,1)=3 (1,1)=3 (2,1)=2 (2,2)=0 (0,0)=1 -> 14 arcos
    # Total: 5+7 = 12 estados; 7+14+1 = 22 arcos
    # Ocupação 12/14 ≈ 0,857; densidade 22/(12*11) = 22/132 ≈ 0,1667
    ge = grafo_estados(parse_mapa("S.a#\n#.A#\n#.G#\n", "c3x4"))
    glob, cam = metricas(ge)
    assert glob["G_est"]["ordem"] == 12
    assert glob["G_est"]["tamanho"] == 22
    assert glob["teto_teorico"] == 14
    assert glob["taxa_ocupacao"] == pytest.approx(12 / 14)
    assert glob["G_est"]["densidade"] == pytest.approx(22 / (12 * 11))
    camadas = {c["chaves"]: (c["ordem"], c["tamanho"]) for c in cam["camadas"]}
    assert camadas == {"-": (5, 7), "a": (7, 14)}
    assert cam["arcos_entre_camadas"] == 1


# [IA] Claude – caso 2: esteira apontando para parede gera armadilha
def test_esteira_armadilha_e_bfs():
    """Valida estados, arcos, armadilha (20%) e BFS até G no mapa S>#/..G."""
    # Grade:  S > #   /   . . G
    # (0,0)S: L->(0,1), S->(1,0)                  = 2 arcos
    # (0,1)>: só pode ir para L = (0,2) '#'        = 0 arcos (armadilha)
    # (1,0) : N->(0,0), L->(1,1)                  = 2 arcos
    # (1,1) : N->(0,1), L->(1,2)G, O->(1,0)       = 3 arcos
    # (1,2)G: só liga ao ALVO (fora da contagem)  = 0 arcos
    # 5 estados, 7 arcos; armadilhas = {(0,1)} -> 1/5 = 20%
    # BFS: (0,0) -> (1,0) -> (1,1) -> (1,2)G = 3 passos
    ge = grafo_estados(parse_mapa("S>#\n..G\n", "esteira"))
    assert len(ge.estados()) == 5
    assert ge.sem_alvo.tamanho == 7
    trap = armadilhas(ge)
    assert trap == [(0, 1, "", ())]
    assert len(trap) / len(ge.estados()) == pytest.approx(0.20)
    assert bfs(ge.grafo, ge.inicio).dist[(1, 2, "", ())] == 3


# [IA] Claude – caso 3: bônus seguido de esteira (teto, densidade, menor custo)
def test_bonus_esteira_1x4_custo_negativo():
    """Valida estados, arcos, teto, ocupação, densidade e menor custo no mapa S+>G."""
    # Grade: S + > G   (4 casas livres, 0 chaves, 1 bônus) -> T = 4 * 2^0 * 2^1 = 8
    # (0,0)|-|{}  -> (0,1)|-|{0}  peso -4 (1ª entrada no +)
    # (0,1)|-|{0} -> (0,2)|-|{0}  peso 1 ;  -> (0,0)|-|{0} peso 1
    # (0,2)|-|{0} -> (0,3)|-|{0}  peso 1 (esteira > só vai para L, onde está G)
    # (0,0)|-|{0} -> (0,1)|-|{0}  peso 1 (bônus já consumido)
    # 5 estados, 5 arcos; ocupação 5/8 = 0,625; densidade 5/(5*4) = 0,25
    # Menor custo: -4 + 1 + 1 = -2 (arco para ALVO vale 0)
    ge = grafo_estados(parse_mapa("S+>G\n", "bonus1x4"))
    assert len(ge.estados()) == 5
    assert ge.sem_alvo.tamanho == 5
    assert ge.teto_teorico() == 8
    assert len(ge.estados()) / ge.teto_teorico() == pytest.approx(0.625)
    assert ge.sem_alvo.densidade() == pytest.approx(0.25)
    assert bellman_ford(ge.grafo, ge.inicio).dist[ALVO] == -2


# [IA] Claude – extra: ciclo negativo existe no G_pos e some no G_est
def test_bonus_ciclo_negativo_so_no_g_pos():
    """Valida que Bellman-Ford acha ciclo negativo no G_pos de S+G, mas não no G_est."""
    # G_pos: (0,0)->(0,1) custa -4 e (0,1)->(0,0) custa 1 -> ciclo de custo -3 < 0
    # G_est: depois do 1º passo o bônus {0} está consumido; o + passa a custar 1
    #        ciclo (0,1)|{0} -> (0,0)|{0} -> (0,1)|{0} custa 1 + 1 = 2 > 0
    m = parse_mapa("S+G\n", "bonus1x3")
    assert bellman_ford(grafo_posicoes(m), m.inicio).ciclo_negativo is not None
    ge = grafo_estados(m)
    assert bellman_ford(ge.grafo, ge.inicio).ciclo_negativo is None
