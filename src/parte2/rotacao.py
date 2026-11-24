# [IA] Claude – preparação do grafo de rotação (pandas/pyarrow): substituições do jogada a jogada viram arcos
"""Grafo de rotação da Parte 2: o impacto de cada substituição no placar.

Modelagem decidida pelo grupo:
- nó = jogador dentro de um time-temporada, rótulo ``Nome Sobrenome|TIM|ano`` (ano = início da temporada);
- arco X -> Y = "Y entrou no lugar de X" (a direção vem do próprio evento de substituição);
- peso = saldo do time por 12 minutos com Y em quadra (do momento da troca até Y sair ou o período acabar)
  MENOS o saldo por 12 minutos do trecho anterior, com X em quadra (desde que X entrou ou desde o início do
  período). Negativo quando o time passou a jogar pior depois da troca. O sinal vem do placar, sem inversão.
  Por arco, os saldos e minutos de todas as ocorrências da temporada são somados antes de dividir.

Recorte (params.yaml, seção ``rotacao``): temporada regular, temporadas completas no formato novo do
jogada a jogada (2020-21 a 2025-26) e só trocas 1 por 1, em que o dado diz exatamente quem saiu por quem.
Este módulo só lê, filtra e agrega tabelas; não monta o grafo nem roda algoritmos.

Saídas em ``data/dataset_parte2/rotacao/``: ``arestas_rotacao.csv`` (arcos), ``jogadores.csv`` (nós),
``trocas.csv`` (uma linha por troca com os dois trechos de pelo menos 1 minuto, com período, diferença
absoluta no placar no momento da troca e o peso da ocorrência) e ``relatorio_rotacao.json``.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq
import yaml

from .preparar import _siglas

RAIZ = Path(__file__).resolve().parents[2]
RAW = RAIZ / "data" / "dataset_parte2" / "raw"
SAIDA = RAIZ / "data" / "dataset_parte2" / "rotacao"
COLUNAS = ["gameId", "period", "clock", "orderNumber", "actionNumber", "actionType", "subType",
           "personId", "subsInPersonId", "teamId", "playerteamId", "scoreHome", "scoreAway"]
MINUTOS_REFERENCIA = 12.0  # o peso é expresso em pontos de saldo por 12 minutos (um quarto)
MIN_TRECHO_OCORRENCIA = 1.0  # [IA] Claude – minutos mínimos antes e depois para uma troca entrar em trocas.csv


def _ler_jogada_a_jogada(raw: Path, temporada_min: int, temporada_max: int) -> pd.DataFrame:
    """Lê só as colunas usadas e só a temporada regular do intervalo pedido (filtro feito no pyarrow)."""
    tb = pq.read_table(raw / "PlayByPlay.parquet", columns=COLUNAS)
    gid = pc.cast(tb["gameId"], "int64")
    tipo = pc.cast(pc.divide(gid, 10**7), "int64")
    aa = pc.subtract(pc.cast(pc.divide(gid, 10**5), "int64"), pc.multiply(tipo, 100))
    ano = pc.add(aa, 2000)
    tb = tb.filter(pc.and_(pc.equal(tipo, 2), pc.and_(pc.greater_equal(ano, temporada_min),
                                                       pc.less_equal(ano, temporada_max))))
    df = tb.to_pandas()
    df["temporada"] = (pd.to_numeric(df["gameId"]) // 10**5 % 100 + 2000).astype(int)
    df["teamId"] = df["teamId"].fillna(df["playerteamId"])
    return df


def _segundos(relogio: pd.Series) -> pd.Series:
    m = relogio.str.extract(r"PT(\d+)M([\d.]+)S")
    return m[0].astype(float) * 60 + m[1].astype(float)


def trechos(df: pd.DataFrame, jogos: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Uma linha por substituição 1 por 1 válida, com o saldo e os minutos do trecho antes (X) e depois (Y)."""
    rel: dict = {}
    # IDs sempre como texto do mesmo tipo (o pyarrow e o pandas devolvem tipos de texto diferentes)
    df = df.copy()
    for c in ("gameId", "teamId", "personId", "subsInPersonId"):
        df[c] = df[c].astype("string")
    jogos = jogos.astype({"gameId": "string", "hometeamId": "string"})
    novos = set(df.loc[df["actionType"] == "substitution", "gameId"])
    df = df[df["gameId"].isin(novos)].copy()
    rel["jogos_com_substituicoes"] = len(novos)
    df = df.sort_values(["gameId", "orderNumber", "actionNumber"]).reset_index(drop=True)
    df["seq"] = np.arange(len(df))
    df[["scoreHome", "scoreAway"]] = df.groupby("gameId")[["scoreHome", "scoreAway"]].ffill().fillna(0)
    duracao = np.where(df["period"] <= 4, 720.0, 300.0)
    df["t"] = duracao - _segundos(df["clock"])  # segundos decorridos no período

    casa = jogos.set_index("gameId")["hometeamId"]
    df["casa"] = df["gameId"].map(casa)
    sem_casa = df["casa"].isna()
    rel["jogos_sem_mandante_descartados"] = int(df.loc[sem_casa, "gameId"].nunique())
    df = df[~sem_casa]
    em_casa = (df["teamId"] == df["casa"]).fillna(False).to_numpy(bool)
    df["pts_time"] = np.where(em_casa, df["scoreHome"], df["scoreAway"])
    df["pts_adv"] = np.where(em_casa, df["scoreAway"], df["scoreHome"])

    # placar no início e no fim de cada período, do ponto de vista dos dois times
    per = df.groupby(["gameId", "period"]).agg(h0=("scoreHome", "first"), a0=("scoreAway", "first"),
                                               h1=("scoreHome", "last"), a1=("scoreAway", "last"),
                                               casa=("casa", "first")).reset_index()
    per["fim_t"] = np.where(per["period"] <= 4, 720.0, 300.0)

    sub = df[df["actionType"] == "substitution"]
    # pares explícitos (linha 'out' que já traz quem entrou)
    expl = sub[sub["subsInPersonId"].notna() & (sub["subType"] == "out")]
    pares_expl = expl.assign(X=expl["personId"], Y=expl["subsInPersonId"])
    # formato com 'out' e 'in' separados: só blocos com exatamente uma saída e uma entrada no mesmo instante
    resto = sub[~sub["gameId"].isin(set(expl["gameId"]))]
    chave = ["gameId", "period", "teamId", "clock"]
    n = resto.groupby(chave + ["subType"]).size().unstack(fill_value=0).reindex(columns=["out", "in"], fill_value=0)
    um_a_um = n[(n["out"] == 1) & (n["in"] == 1)].index
    rel["blocos_de_substituicao"] = int(len(n))
    rel["blocos_1_por_1"] = int(len(um_a_um))
    resto = resto.set_index(chave)
    so11 = resto[resto.index.isin(um_a_um)].reset_index()
    saida = so11[so11["subType"] == "out"][chave + ["personId"]].rename(columns={"personId": "X"})
    entrada = so11[so11["subType"] == "in"].rename(columns={"personId": "Y"})
    pares_v3 = entrada.merge(saida, on=chave)
    cols = ["gameId", "period", "teamId", "temporada", "X", "Y", "seq", "t", "pts_time", "pts_adv"]
    pares = pd.concat([pares_expl[cols], pares_v3[cols]], ignore_index=True)
    rel["trocas_1_por_1"] = int(len(pares))

    # depois: Y fica em quadra até a próxima saída dele no mesmo período (ou o fim do período)
    saidas = sub[sub["subType"] == "out"][["gameId", "period", "personId", "seq", "t", "pts_time", "pts_adv"]]
    saidas = saidas.rename(columns={"personId": "Y", "seq": "seq_fim", "t": "t_fim",
                                    "pts_time": "pt_fim", "pts_adv": "pa_fim"}).sort_values("seq_fim")
    pares = pd.merge_asof(pares.sort_values("seq"), saidas, left_on="seq", right_on="seq_fim",
                          by=["gameId", "period", "Y"], direction="forward", allow_exact_matches=False)
    # antes: X estava em quadra desde a última entrada dele no período (ou o início do período)
    entradas = pd.concat([
        sub[(sub["subType"] == "in")][["gameId", "period", "personId", "seq", "t", "pts_time", "pts_adv"]],
        expl[["gameId", "period", "subsInPersonId", "seq", "t", "pts_time", "pts_adv"]]
        .rename(columns={"subsInPersonId": "personId"}),
    ]).rename(columns={"personId": "X", "seq": "seq_ini", "t": "t_ini",
                       "pts_time": "pt_ini", "pts_adv": "pa_ini"}).sort_values("seq_ini")
    pares = pd.merge_asof(pares.sort_values("seq"), entradas, left_on="seq", right_on="seq_ini",
                          by=["gameId", "period", "X"], direction="backward", allow_exact_matches=False)
    pares = pares.merge(per, on=["gameId", "period"], how="left")
    casa_p = (pares["teamId"] == pares["casa"]).fillna(False).to_numpy(bool)
    ini_time, ini_adv = np.where(casa_p, pares["h0"], pares["a0"]), np.where(casa_p, pares["a0"], pares["h0"])
    fim_time, fim_adv = np.where(casa_p, pares["h1"], pares["a1"]), np.where(casa_p, pares["a1"], pares["h1"])
    tem_fim, tem_ini = pares["seq_fim"].notna().to_numpy(), pares["seq_ini"].notna().to_numpy()
    pares["saldo_depois"] = (np.where(tem_fim, pares["pt_fim"], fim_time) - pares["pts_time"]) \
        - (np.where(tem_fim, pares["pa_fim"], fim_adv) - pares["pts_adv"])
    pares["min_depois"] = (np.where(tem_fim, pares["t_fim"], pares["fim_t"]) - pares["t"]) / 60
    pares["saldo_antes"] = (pares["pts_time"] - np.where(tem_ini, pares["pt_ini"], ini_time)) \
        - (pares["pts_adv"] - np.where(tem_ini, pares["pa_ini"], ini_adv))
    pares["min_antes"] = (pares["t"] - np.where(tem_ini, pares["t_ini"], 0.0)) / 60
    validos = (pares["min_depois"] > 0) & (pares["min_antes"] > 0)
    rel["trocas_sem_tempo_antes_ou_depois_descartadas"] = int((~validos).sum())
    pares = pares[validos]
    # [IA] Claude – período e diferença absoluta no placar no momento da troca (usados nos gráficos H1/H3)
    pares = pares.assign(periodo=pares["period"].astype(int),
                         placar=(pares["pts_time"] - pares["pts_adv"]).abs().astype(int))
    return pares[["temporada", "gameId", "teamId", "X", "Y", "periodo", "placar", "saldo_antes", "min_antes",
                  "saldo_depois", "min_depois"]].reset_index(drop=True), rel


def _rotulos(arcos: pd.DataFrame, raw: Path) -> dict:
    """Rótulo legível e único para cada (jogador, time, temporada)."""
    pl = pd.read_csv(raw / "Players.csv", usecols=["personId", "firstName", "lastName"])
    nome = (pl["firstName"].fillna("") + " " + pl["lastName"].fillna("")).str.strip()
    nome = pd.Series(nome.values, index=pl["personId"].astype(str))
    sig = _siglas(pd.read_csv(raw / "TeamHistories.csv")).set_index(["teamId", "temporada_inicio"])["sigla"]
    chaves = pd.concat([arcos[["X", "teamId", "temporada"]].set_axis(["p", "teamId", "temporada"], axis=1),
                        arcos[["Y", "teamId", "temporada"]].set_axis(["p", "teamId", "temporada"], axis=1)]
                       ).drop_duplicates()
    chaves["nome"] = chaves["p"].map(nome).fillna(chaves["p"])
    chaves["sigla"] = [sig.get((int(t), int(a)), str(t)) for t, a in zip(chaves["teamId"], chaves["temporada"])]
    chaves["rotulo"] = chaves["nome"] + "|" + chaves["sigla"] + "|" + chaves["temporada"].astype(str)
    dup = chaves["rotulo"].duplicated(keep=False)
    chaves.loc[dup, "rotulo"] = (chaves["nome"] + " #" + chaves["p"] + "|" + chaves["sigla"] + "|"
                                 + chaves["temporada"].astype(str))[dup]
    return {(r.p, r.teamId, r.temporada): (r.rotulo, r.nome, r.sigla) for r in chaves.itertuples()}


# [IA] Claude – uma linha por troca (ocorrência) com os dois trechos completos, para os gráficos H1/H3
def trocas_por_ocorrencia(tr: pd.DataFrame, raw: Path) -> pd.DataFrame:
    """Trocas com os dois trechos de pelo menos ``MIN_TRECHO_OCORRENCIA`` minuto e o peso de cada uma.

    peso_ocorrencia = 12 × (saldo_depois / min_depois − saldo_antes / min_antes), a mesma unidade do arco.
    """
    t = tr[(tr["min_antes"] >= MIN_TRECHO_OCORRENCIA) & (tr["min_depois"] >= MIN_TRECHO_OCORRENCIA)].copy()
    sig = _siglas(pd.read_csv(raw / "TeamHistories.csv")).set_index(["teamId", "temporada_inicio"])["sigla"]
    t["time"] = [sig.get((int(i), int(a)), str(i)) for i, a in zip(t["teamId"], t["temporada"])]
    t["peso_ocorrencia"] = MINUTOS_REFERENCIA * (t["saldo_depois"] / t["min_depois"] - t["saldo_antes"] / t["min_antes"])
    t = t.rename(columns={"X": "sai_personId", "Y": "entra_personId"})
    cols = ["temporada", "time", "gameId", "periodo", "sai_personId", "entra_personId", "placar",
            "saldo_antes", "min_antes", "saldo_depois", "min_depois", "peso_ocorrencia"]
    return t.sort_values(["temporada", "gameId", "periodo"], kind="stable")[cols].round(4)


def preparar_rotacao(params: dict, raw: Path = RAW, saida: Path = SAIDA) -> dict:
    df = _ler_jogada_a_jogada(raw, params["temporada_min"], params["temporada_max"])
    jogos = pd.read_csv(raw / "Games.csv", usecols=["gameId", "hometeamId"], dtype=str)
    tr, rel = trechos(df, jogos)

    g = tr.groupby(["temporada", "teamId", "X", "Y"])
    arcos = g.agg(ocorrencias=("saldo_depois", "size"), saldo_depois=("saldo_depois", "sum"),
                  min_depois=("min_depois", "sum"), saldo_antes=("saldo_antes", "sum"),
                  min_antes=("min_antes", "sum")).reset_index()
    arcos = arcos[(arcos["ocorrencias"] >= params["min_ocorrencias"])
                  & (arcos["min_depois"] >= params["min_minutos"]) & (arcos["min_antes"] >= params["min_minutos"])]
    ritmo_depois = arcos["saldo_depois"] / arcos["min_depois"] * MINUTOS_REFERENCIA
    ritmo_antes = arcos["saldo_antes"] / arcos["min_antes"] * MINUTOS_REFERENCIA
    arcos = arcos.assign(saldo12_depois=ritmo_depois.round(4), saldo12_antes=ritmo_antes.round(4),
                         peso=(ritmo_depois - ritmo_antes).round(4))

    rot = _rotulos(arcos, raw)
    arcos["origem"] = [rot[(x, t, a)][0] for x, t, a in zip(arcos["X"], arcos["teamId"], arcos["temporada"])]
    arcos["destino"] = [rot[(y, t, a)][0] for y, t, a in zip(arcos["Y"], arcos["teamId"], arcos["temporada"])]
    arcos["time"] = [rot[(x, t, a)][2] for x, t, a in zip(arcos["X"], arcos["teamId"], arcos["temporada"])]

    # minutos medidos em quadra por jogador (trechos antes e depois das trocas), usados no recorte sem ciclo
    lados = pd.concat([tr[["temporada", "teamId", "X", "min_antes"]].set_axis(["temporada", "teamId", "p", "m"], axis=1),
                       tr[["temporada", "teamId", "Y", "min_depois"]].set_axis(["temporada", "teamId", "p", "m"], axis=1)])
    minutos = lados.groupby(["temporada", "teamId", "p"])["m"].sum()
    # [IA] Claude – impacto médio ponderado pelas ocorrências (mesma definição de graficos_avd.py e da página)
    entrada = (arcos.assign(_pxo=arcos["peso"] * arcos["ocorrencias"]).groupby("destino")
               .agg(entradas=("ocorrencias", "sum"), _soma=("_pxo", "sum")))
    entrada["impacto_medio"] = entrada["_soma"] / entrada["entradas"]
    entrada = entrada[["entradas", "impacto_medio"]]
    nos = pd.DataFrame([{"no": r[0], "personId": p, "nome": r[1], "time": r[2], "temporada": a,
                         "minutos_medidos": round(float(minutos.get((a, t, p), 0.0)), 2)}
                        for (p, t, a), r in rot.items()])
    nos = nos.join(entrada, on="no").fillna({"entradas": 0})
    nos = nos.sort_values(["temporada", "time", "minutos_medidos"], ascending=[True, True, False])

    saida.mkdir(parents=True, exist_ok=True)
    colunas = ["origem", "destino", "peso", "temporada", "time", "ocorrencias",
               "saldo12_depois", "saldo12_antes", "min_depois", "min_antes"]
    arcos.sort_values(["temporada", "time", "origem", "destino"])[colunas].round(4).to_csv(
        saida / "arestas_rotacao.csv", index=False)
    nos.to_csv(saida / "jogadores.csv", index=False)
    trocas_por_ocorrencia(tr, raw).to_csv(saida / "trocas.csv", index=False)
    rel.update({
        "parametros": params,
        "arcos": int(len(arcos)), "nos": int(len(nos)),
        "temporadas": sorted(int(a) for a in arcos["temporada"].unique()),
        "arcos_por_temporada": {int(k): int(v) for k, v in arcos["temporada"].value_counts().sort_index().items()},
        "pesos_negativos": int((arcos["peso"] < 0).sum()), "pesos_zero": int((arcos["peso"] == 0).sum()),
        "pesos_positivos": int((arcos["peso"] > 0).sum()),
        "peso_min": float(arcos["peso"].min()), "peso_max": float(arcos["peso"].max()),
        "peso_mediana": float(arcos["peso"].median()),
    })
    (saida / "relatorio_rotacao.json").write_text(json.dumps(rel, indent=2, ensure_ascii=False), encoding="utf-8")
    return rel


def main() -> None:
    params = yaml.safe_load((RAIZ / "params.yaml").read_text(encoding="utf-8"))["rotacao"]
    rel = preparar_rotacao(params)
    print(json.dumps(rel, indent=2, ensure_ascii=False))
    if rel["arcos"] < 20000:
        print(f"AVISO: |E| = {rel['arcos']} é menor que 20000")


if __name__ == "__main__":
    main()
