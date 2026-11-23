# [IA] Claude – testes das tabelas de apoio à AVD com dados sintéticos
import json

import pandas as pd
import pytest

from src.avd.tabelas import gerar, por_time_temporada

PARAMS = {"tipos": [2], "temporada_min": 2000, "temporada_max": 2000, "sinal_peso": -1}


@pytest.fixture
def tabelas(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    pd.DataFrame({
        "gameId": [20000001, 20000002, 20000003, 40000001],
        "hometeamCity": ["X"] * 4, "hometeamName": ["A", "B", "A", "A"], "hometeamId": [1, 2, 1, 1],
        "awayteamCity": ["Y"] * 4, "awayteamName": ["B", "A", "B", "B"], "awayteamId": [2, 1, 2, 2],
        "homeScore": [100, 90, 80, 70], "awayScore": [90, 95, 80, 60],
        "gameDate": ["2000-11-01"] * 4, "attendance": [1000.0, None, 900.0, 800.0],
    }).to_csv(raw / "Games.csv", index=False)
    linhas = []
    for jogo, casa, fora, pc, pf in ((20000001, 1, 2, 100, 90), (20000002, 2, 1, 90, 95), (20000003, 1, 2, 80, 80)):
        linhas += [(jogo, casa, "T%d" % casa, fora, 1, pc > pf, pc, pf), (jogo, fora, "T%d" % fora, casa, 0, pf > pc, pf, pc)]
    linhas.append((20000002, 0, None, 0, 1, None, 0, 0))  # linha-fantasma de jogo remarcado
    pd.DataFrame(linhas, columns=["gameId", "teamId", "teamName", "opponentTeamId", "home", "win", "teamScore", "opponentScore"]
                 ).to_csv(raw / "TeamStatistics.csv", index=False)
    arestas = tmp_path / "arestas.csv"
    arestas.write_text("origem,destino,peso,temporada\nA|2000,B|2000,-2.0,2000\nB|2000,A|2000,2.0,2000\n", encoding="utf-8")
    saida = tmp_path / "saida"
    return gerar(raw, saida, arestas_csv=arestas, params=PARAMS), saida


def test_recorte_exclui_empate_playoff_e_fantasma(tabelas):
    resumo, _ = tabelas
    assert resumo["jogos_completo"] == 4 and resumo["jogos_recorte"] == 2
    assert resumo["linhas_time_jogo"] == 4 and resumo["linhas_fantasma_removidas"] == 1


def test_faltantes_e_margem(tabelas):
    _, saida = tabelas
    f = pd.read_csv(saida / "faltantes.csv")
    linha = f[(f.tabela == "Games (recorte)") & (f.coluna == "attendance")].iloc[0]
    assert linha.faltantes == 1 and linha.faltantes_pct == 50
    casa = pd.read_csv(saida / "casa_fora.csv").set_index("home")
    assert casa.loc[1, "margem_media"] == pytest.approx(2.5)
    assert casa.loc[0, "margem_media"] == pytest.approx(-2.5)


def test_correlacao_e_nos(tabelas):
    _, saida = tabelas
    c = pd.read_csv(saida / "correlacoes_alvo.csv")
    assert {"pearson", "spearman"} <= set(c.columns) and c.alvo.eq("margem").all()
    n = pd.read_csv(saida / "nos_grafo.csv").set_index("no")
    assert n.loc["A|2000", "arcos_negativos"] == 1 and n.loc["B|2000", "arcos_positivos"] == 1
    assert json.loads((saida / "resumo.json").read_text(encoding="utf-8"))["alvo"] == "margem"


def test_media_com_pouca_cobertura_fica_vazia():
    df = pd.DataFrame({"gameId": range(5), "teamId": [1] * 5, "teamName": ["A"] * 5, "temporada": [2000] * 5,
                       "margem": [1, 2, 3, 4, 5], "q1Points": [20, None, None, None, None]})
    linha = por_time_temporada(df).iloc[0]
    assert linha.margem == 3 and pd.isna(linha.q1Points)
    assert linha.jogos == 5 and linha.jogos_com_detalhe == 1
