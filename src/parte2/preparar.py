# [IA] Claude – preparação do dataset da Parte 2 (pandas): limpeza dos jogos e lista de arcos (time, temporada)
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import yaml

RAIZ = Path(__file__).resolve().parents[2]
RAW = RAIZ / "data" / "dataset_parte2" / "raw"
SAIDA = RAIZ / "data" / "dataset_parte2" / "processed"
ARESTAS = RAIZ / "data" / "dataset_parte2" / "arestas.csv"
TIPOS = {1: "Pré-temporada", 2: "Temporada regular", 3: "All-Star", 4: "Playoffs", 5: "Play-in", 6: "Final da NBA Cup"}


def _temporada_e_tipo(game_id: pd.Series) -> tuple[pd.Series, pd.Series]:
    s = game_id.astype("int64").astype(str).str.zfill(10)
    tipo = s.str[2].astype(int)
    aa = s.str[3:5].astype(int)
    inicio = (aa.where(aa >= 46, aa + 100) + 1900).astype(int)
    return inicio, tipo


def _rotulo_temporada(inicio: int) -> str:
    return f"{inicio}-{str(inicio + 1)[-2:]}"


def _siglas(hist: pd.DataFrame) -> pd.DataFrame:
    linhas = []
    for r in hist.itertuples():
        for ano in range(int(r.seasonFounded), int(r.seasonActiveTill) + 1):
            linhas.append({"teamId": r.teamId, "temporada_inicio": ano, "sigla": str(r.teamAbbrev).strip(),
                           "cidade": r.teamCity, "nome_hist": r.teamName, "liga": r.league})
    return pd.DataFrame(linhas).drop_duplicates(["teamId", "temporada_inicio"], keep="last")


def preparar(params: dict, raw: Path = RAW, saida: Path = SAIDA, arestas_csv: Path = ARESTAS) -> dict:
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
    jogos = pd.DataFrame({
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
    jogos["margem"] = jogos["pontos_vencedor"] - jogos["pontos_perdedor"]

    sig = _siglas(hist)
    def no(prefixo: str) -> pd.Series:
        m = jogos[[f"{prefixo}_id", "temporada_inicio"]].merge(
            sig, left_on=[f"{prefixo}_id", "temporada_inicio"], right_on=["teamId", "temporada_inicio"], how="left")
        sigla = m["sigla"].fillna(m[f"{prefixo}_id"].astype(str))
        return (sigla + "|" + jogos["temporada_inicio"].astype(str).values).values
    jogos.insert(1, "origem", no("vencedor"))
    jogos.insert(2, "destino", no("perdedor"))

    ida = jogos[["temporada_inicio", "origem", "destino", "margem"]]
    volta = ida.assign(origem=ida["destino"], destino=ida["origem"], margem=-ida["margem"])
    saldo = pd.concat([ida, volta]).groupby(["temporada_inicio", "origem", "destino"], as_index=False)["margem"].mean()
    arestas = pd.DataFrame({
        "origem": saldo["origem"], "destino": saldo["destino"],
        "peso": params["sinal_peso"] * saldo["margem"] + 0.0,
        "temporada": saldo["temporada_inicio"],
    })

    lados = pd.concat([
        jogos[["origem", "vencedor_id", "temporada_inicio", "temporada"]].set_axis(["no", "teamId", "temporada_inicio", "temporada"], axis=1).assign(v=1),
        jogos[["destino", "perdedor_id", "temporada_inicio", "temporada"]].set_axis(["no", "teamId", "temporada_inicio", "temporada"], axis=1).assign(v=0),
    ])
    nos = (lados.groupby(["no", "teamId", "temporada_inicio", "temporada"], as_index=False)
                .agg(jogos=("v", "size"), vitorias=("v", "sum")))
    if nos["no"].duplicated().any():
        raise ValueError(f"duas franquias com o mesmo rótulo TIME|ano: {sorted(nos.loc[nos['no'].duplicated(), 'no'])}")
    nos = nos.merge(sig, on=["teamId", "temporada_inicio"], how="left").drop(columns=["nome_hist"])
    nos["derrotas"] = nos["jogos"] - nos["vitorias"]
    nos = nos.sort_values(["temporada_inicio", "no"]).reset_index(drop=True)

    saida.mkdir(parents=True, exist_ok=True)
    arestas.to_csv(arestas_csv, index=False)
    nos.to_csv(saida / "nos.csv", index=False)
    rel.update({
        "parametros": params,
        "jogos": int(len(jogos)),
        "arcos": int(len(arestas)), "nos": int(len(nos)),
        "temporadas": int(arestas["temporada"].nunique()),
        "franquias": int(pd.concat([jogos["vencedor_id"], jogos["perdedor_id"]]).nunique()),
        "jogos_por_tipo": jogos["tipo"].value_counts().to_dict(),
        "peso_min": float(arestas["peso"].min()), "peso_max": float(arestas["peso"].max()),
        "nos_sem_sigla": int(nos["sigla"].isna().sum()),
    })
    (saida / "relatorio_preparacao.json").write_text(json.dumps(rel, indent=2, ensure_ascii=False), encoding="utf-8")
    return rel


def main() -> None:
    params = yaml.safe_load((RAIZ / "params.yaml").read_text(encoding="utf-8"))["preparar"]
    rel = preparar(params)
    print(json.dumps(rel, indent=2, ensure_ascii=False))
    print(f"|V| = {rel['nos']}  |E| = {rel['arcos']}  temporadas = {rel['temporadas']}  "
          f"peso mín = {rel['peso_min']:.4f}  peso máx = {rel['peso_max']:.4f}")
    if rel["arcos"] < 20000:
        print(f"AVISO: |E| = {rel['arcos']} é menor que 20000")


if __name__ == "__main__":
    main()
