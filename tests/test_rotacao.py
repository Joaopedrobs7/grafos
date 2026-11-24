# [IA] Claude – testes da preparação do grafo de rotação com um jogo sintético calculado à mão
import csv
import json

import pandas as pd
import pytest

from src.parte2.rotacao import preparar_rotacao, trechos

# Jogo 0022400001 (temporada regular 2024-25): time 1 em casa, time 2 fora. Placar como no jogada a jogada.
# Q1  12:00  início                      0 x 0
#     08:00  time 1: sai 10, entra 11    6 x 4      (10 estava em quadra desde o início: 4 min, saldo +2)
#     05:00  time 1: sai 11, entra 10    8 x 9      (11 jogou 3 min: saldo 2 - 5 = -3)
#     03:00  time 1: saem 12 e 13, entram 14 e 15 (troca 2 por 2: ignorada)
#     02:00  time 2 (formato explícito): sai 20, entra 21    10 x 12
#     00:00  fim do período              12 x 12
EVENTOS = [
    # gameId, period, clock, order, actionType, subType, personId, subsInPersonId, teamId, home, away
    ("0022400001", 1, "PT12M00.00S", 1, "period", "start", "0", None, None, 0, 0),
    ("0022400001", 1, "PT08M00.00S", 2, "substitution", "out", "10", None, "1", 6, 4),
    ("0022400001", 1, "PT08M00.00S", 3, "substitution", "in", "11", None, "1", 6, 4),
    ("0022400001", 1, "PT05M00.00S", 4, "substitution", "out", "11", None, "1", 8, 9),
    ("0022400001", 1, "PT05M00.00S", 5, "substitution", "in", "10", None, "1", 8, 9),
    ("0022400001", 1, "PT03M00.00S", 6, "substitution", "out", "12", None, "1", 9, 10),
    ("0022400001", 1, "PT03M00.00S", 7, "substitution", "out", "13", None, "1", 9, 10),
    ("0022400001", 1, "PT03M00.00S", 8, "substitution", "in", "14", None, "1", 9, 10),
    ("0022400001", 1, "PT03M00.00S", 9, "substitution", "in", "15", None, "1", 9, 10),
    ("0022400001", 1, "PT00M00.00S", 11, "period", "end", "0", None, None, 12, 12),
]
EXPLICITO = ("0022400002", 1, "PT02M00.00S", 1, "substitution", "out", "20", "21", "2", 10, 12)


def _pbp(eventos):
    cols = ["gameId", "period", "clock", "orderNumber", "actionType", "subType", "personId",
            "subsInPersonId", "teamId", "scoreHome", "scoreAway"]
    df = pd.DataFrame(eventos, columns=cols)
    df["actionNumber"] = df["orderNumber"]
    df["playerteamId"] = df["teamId"]
    df["temporada"] = 2024
    return df


def test_trechos_antes_e_depois_calculados_a_mao():
    jogos = pd.DataFrame({"gameId": ["0022400001"], "hometeamId": ["1"]})
    tr, rel = trechos(_pbp(EVENTOS), jogos)
    assert rel["blocos_de_substituicao"] == 3 and rel["blocos_1_por_1"] == 2  # o 2 por 2 fica de fora
    t = tr.set_index(["X", "Y"])
    # 10 -> 11 aos 8:00: antes (10 desde o início) 6-4 = +2 em 4 min; depois (11 até 5:00) 2-5 = -3 em 3 min
    assert t.loc[("10", "11"), ["saldo_antes", "min_antes", "saldo_depois", "min_depois"]].tolist() == \
        pytest.approx([2, 4, -3, 3])
    # 11 -> 10 aos 5:00: antes = o trecho de 11 (-3 em 3 min); depois 10 fica até o fim: 4-3 = +1 em 5 min
    assert t.loc[("11", "10"), ["saldo_antes", "min_antes", "saldo_depois", "min_depois"]].tolist() == \
        pytest.approx([-3, 3, 1, 5])
    # [IA] Claude – período e diferença absoluta no placar no momento da troca (6 x 4 e 8 x 9)
    assert t.loc[("10", "11"), ["periodo", "placar"]].tolist() == [1, 2]
    assert t.loc[("11", "10"), ["periodo", "placar"]].tolist() == [1, 1]


def test_formato_explicito_e_ponto_de_vista_do_visitante():
    eventos = [e for e in EVENTOS if e[0] == "0022400001"][:1]
    eventos = [("0022400002",) + eventos[0][1:], EXPLICITO,
               ("0022400002", 1, "PT00M00.00S", 9, "period", "end", "0", None, None, 15, 14)]
    jogos = pd.DataFrame({"gameId": ["0022400002"], "hometeamId": ["1"]})
    tr, _ = trechos(_pbp(eventos), jogos)
    r = tr.iloc[0]
    assert (r["X"], r["Y"]) == ("20", "21")
    # time 2 é o visitante: antes 12-10 = +2 em 10 min; depois (14-12) - (15-10) = -3 em 2 min
    assert [r["saldo_antes"], r["min_antes"], r["saldo_depois"], r["min_depois"]] == pytest.approx([2, 10, -3, 2])


def test_preparar_rotacao_gera_arestas_com_peso_por_12_minutos(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    eventos = EVENTOS + [(g, *e[1:]) for g in ("0022400003",) for e in EVENTOS]  # a mesma troca em 2 jogos
    df = _pbp(eventos).drop(columns=["temporada"])
    df.to_parquet(raw / "PlayByPlay.parquet")
    pd.DataFrame({"gameId": ["0022400001", "0022400003"], "hometeamId": ["1", "1"]}).to_csv(raw / "Games.csv", index=False)
    pd.DataFrame({"personId": [10, 11], "firstName": ["Ana", "Bia"], "lastName": ["A", "B"]}).to_csv(raw / "Players.csv", index=False)
    (raw / "TeamHistories.csv").write_text(
        "teamId,teamCity,teamName,teamAbbrev,seasonFounded,seasonActiveTill,league\n"
        "1,Cidade,Um,UMM,2000,2100,NBA\n2,Outra,Dois,DOS,2000,2100,NBA\n", encoding="utf-8")
    params = {"temporada_min": 2024, "temporada_max": 2024, "min_ocorrencias": 2, "min_minutos": 3}
    rel = preparar_rotacao(params, raw=raw, saida=tmp_path / "rot")
    with (tmp_path / "rot" / "arestas_rotacao.csv").open(encoding="utf-8") as f:
        linhas = {(l["origem"], l["destino"]): l for l in csv.DictReader(f)}
    a = linhas[("Ana A|UMM|2024", "Bia B|UMM|2024")]
    # por 12 min: depois -3/3*12 = -12; antes +2/4*12 = +6; peso = -12 - 6 = -18 (somando os 2 jogos, igual)
    assert float(a["peso"]) == pytest.approx(-18.0) and int(a["ocorrencias"]) == 2
    assert float(linhas[("Bia B|UMM|2024", "Ana A|UMM|2024")]["peso"]) == pytest.approx(1 / 5 * 12 - (-3) / 3 * 12)
    assert rel["arcos"] == 2 and rel["pesos_negativos"] == 1
    assert json.loads((tmp_path / "rot" / "relatorio_rotacao.json").read_text(encoding="utf-8"))["arcos"] == 2
    # [IA] Claude – trocas.csv: uma linha por ocorrência, com o peso da própria troca na mesma unidade do arco
    trocas = pd.read_csv(tmp_path / "rot" / "trocas.csv")
    assert len(trocas) == 4 and set(trocas["time"]) == {"UMM"}
    ida = trocas[(trocas["sai_personId"] == 10) & (trocas["entra_personId"] == 11)]
    assert ida["peso_ocorrencia"].tolist() == pytest.approx([-18.0, -18.0]) and ida["placar"].tolist() == [2, 2]
