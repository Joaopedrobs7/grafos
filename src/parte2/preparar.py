# [IA] Claude – preparação do dataset da Parte 2 (pandas): limpeza dos jogos e lista de arcos (time, temporada)
"""Transforma `raw/Games.csv` na lista de arcos e de nós usada pela Parte 2.

Modelagem decidida pelo grupo:
- nó = (time, temporada), ex.: `LAL 2024-25` (o mesmo time em temporadas diferentes é outro nó);
- um arco por jogo, do vencedor para o perdedor, dentro da mesma temporada;
- peso = sinal_peso × margem de pontos (por padrão −margem: quanto menor, maior a vitória).

Este módulo só lê, limpa e grava tabelas; não monta o grafo nem roda algoritmos.
Parâmetros em `params.yaml` (seção `preparar`). Saídas em `data/dataset_parte2/processed/`.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import yaml

RAIZ = Path(__file__).resolve().parents[2]
RAW = RAIZ / "data" / "dataset_parte2" / "raw"
SAIDA = RAIZ / "data" / "dataset_parte2" / "processed"
TIPOS = {1: "Pré-temporada", 2: "Temporada regular", 3: "All-Star", 4: "Playoffs", 5: "Play-in", 6: "Final da NBA Cup"}


def _temporada_e_tipo(game_id: pd.Series) -> tuple[pd.Series, pd.Series]:
    """O gameId (10 dígitos) traz o tipo do jogo (3º dígito) e o ano de início da temporada (4º e 5º)."""
    s = game_id.astype("int64").astype(str).str.zfill(10)
    tipo = s.str[2].astype(int)
    aa = s.str[3:5].astype(int)
    inicio = (aa.where(aa >= 46, aa + 100) + 1900).astype(int)
    return inicio, tipo


def _rotulo_temporada(inicio: int) -> str:
    return f"{inicio}-{str(inicio + 1)[-2:]}"


def _siglas(hist: pd.DataFrame) -> pd.DataFrame:
    """Sigla, cidade e nome de cada franquia em cada temporada (TeamHistories tem os intervalos)."""
    linhas = []
    for r in hist.itertuples():
        for ano in range(int(r.seasonFounded), int(r.seasonActiveTill) + 1):
            linhas.append({"teamId": r.teamId, "temporada_inicio": ano, "sigla": str(r.teamAbbrev).strip(),
                           "cidade": r.teamCity, "nome_hist": r.teamName, "liga": r.league})
    return pd.DataFrame(linhas).drop_duplicates(["teamId", "temporada_inicio"], keep="last")


def preparar(params: dict, raw: Path = RAW, saida: Path = SAIDA) -> dict:
    g = pd.read_csv(raw / "Games.csv", low_memory=False)
    hist = pd.read_csv(raw / "TeamHistories.csv")
    rel: dict = {"linhas_brutas": int(len(g)), "removidos": {}}

    def remover(mascara: pd.Series, motivo: str) -> None:
        nonlocal g
        n = int(mascara.sum())
        if n:
            rel["removidos"][motivo] = rel["removidos"].get(motivo, 0) + n
        g = g[~mascara]

    remover(g.duplicated("gameId"), "gameId duplicado")
    g = g.assign(**dict(zip(("temporada_inicio", "tipo_cod"), _temporada_e_tipo(g["gameId"]))))
    remover(~g["tipo_cod"].isin(params["tipos"]), "tipo de jogo fora de params.tipos")
    remover(~g["temporada_inicio"].between(params["temporada_min"], params["temporada_max"]), "temporada fora do intervalo")
    remover((g["homeScore"] == 0) & (g["awayScore"] == 0), "placar 0 x 0 (jogo sem resultado)")
    remover(g["homeScore"] == g["awayScore"], "empate (não existe na NBA: inconsistência)")
    vencedor_casa = g["homeScore"] > g["awayScore"]
    remover(g["winner"] != g["hometeamId"].where(vencedor_casa, g["awayteamId"]), "coluna winner incoerente com o placar")

    vc = g["homeScore"] > g["awayScore"]
    arcos = pd.DataFrame({
        "gameId": g["gameId"].astype("int64"),
        "data": pd.to_datetime(g["gameDateTimeEst"]).dt.strftime("%Y-%m-%d"),
        "temporada_inicio": g["temporada_inicio"],
        "temporada": g["temporada_inicio"].map(_rotulo_temporada),
        "tipo": g["tipo_cod"].map(TIPOS),
        "vencedor_id": g["hometeamId"].where(vc, g["awayteamId"]).astype("int64"),
        "perdedor_id": g["awayteamId"].where(vc, g["hometeamId"]).astype("int64"),
        "pontos_vencedor": g["homeScore"].where(vc, g["awayScore"]).astype(int),
        "pontos_perdedor": g["awayScore"].where(vc, g["homeScore"]).astype(int),
        "vencedor_em_casa": vc.astype(int),
    })
    arcos["margem"] = arcos["pontos_vencedor"] - arcos["pontos_perdedor"]
    arcos["peso"] = params["sinal_peso"] * arcos["margem"]

    sig = _siglas(hist)
    def no(prefixo: str) -> pd.Series:
        m = arcos[[f"{prefixo}_id", "temporada_inicio"]].merge(
            sig, left_on=[f"{prefixo}_id", "temporada_inicio"], right_on=["teamId", "temporada_inicio"], how="left")
        sigla = m["sigla"].fillna(m[f"{prefixo}_id"].astype(str))
        return (sigla + " " + arcos["temporada"].values).values
    arcos.insert(1, "origem", no("vencedor"))
    arcos.insert(2, "destino", no("perdedor"))

    # nós: todo (time, temporada) que aparece em algum arco
    lados = pd.concat([
        arcos[["origem", "vencedor_id", "temporada_inicio", "temporada"]].set_axis(["no", "teamId", "temporada_inicio", "temporada"], axis=1).assign(v=1),
        arcos[["destino", "perdedor_id", "temporada_inicio", "temporada"]].set_axis(["no", "teamId", "temporada_inicio", "temporada"], axis=1).assign(v=0),
    ])
    nos = (lados.groupby(["no", "teamId", "temporada_inicio", "temporada"], as_index=False)
                .agg(jogos=("v", "size"), vitorias=("v", "sum")))
    nos = nos.merge(sig, on=["teamId", "temporada_inicio"], how="left").drop(columns=["nome_hist"])
    nos["derrotas"] = nos["jogos"] - nos["vitorias"]
    nos = nos.sort_values(["temporada_inicio", "no"]).reset_index(drop=True)

    saida.mkdir(parents=True, exist_ok=True)
    arcos.sort_values(["data", "gameId"]).to_csv(saida / "arestas.csv", index=False)
    nos.to_csv(saida / "nos.csv", index=False)
    rel.update({
        "parametros": params,
        "arcos": int(len(arcos)), "nos": int(len(nos)),
        "temporadas": int(arcos["temporada_inicio"].nunique()),
        "franquias": int(pd.concat([arcos["vencedor_id"], arcos["perdedor_id"]]).nunique()),
        "arcos_por_tipo": arcos["tipo"].value_counts().to_dict(),
        "peso_min": int(arcos["peso"].min()), "peso_max": int(arcos["peso"].max()),
        "nos_sem_sigla": int(nos["sigla"].isna().sum()),
    })
    (saida / "relatorio_preparacao.json").write_text(json.dumps(rel, indent=2, ensure_ascii=False), encoding="utf-8")
    return rel


def main() -> None:
    params = yaml.safe_load((RAIZ / "params.yaml").read_text(encoding="utf-8"))["preparar"]
    print(json.dumps(preparar(params), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
