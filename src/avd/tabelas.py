# [IA] Claude – tabelas de apoio à AVD com pandas (só contagens e estatísticas; a interpretação é do grupo)
"""Gera em out/avd/tabelas/ os números de apoio para a análise exploratória.

Uso: python -m src.avd.tabelas [--raw PASTA] [--saida PASTA] [--alvo COLUNA]

O recorte é o mesmo do grafo (params.yaml): temporada regular, 2000 a 2025, sem empates nem
0 x 0. O alvo padrão é a margem de pontos, de onde vem o peso dos arcos; troque com --alvo se a
pergunta de pesquisa usar outra variável. Este módulo não classifica nem interpreta resultados.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
import yaml

from ..parte2.preparar import _temporada_e_tipo

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "data" / "dataset_parte2"
SAIDA = RAIZ / "out" / "avd" / "tabelas"
IDS = {"gameId", "teamId", "opponentTeamId", "coachId"}
MIN_COBERTURA = 0.8  # média de time-temporada só vale com o atributo presente em 80% dos jogos


def _raw(pasta: Path | None) -> Path:
    if pasta is not None:
        return pasta
    return PASTA / "raw" if (PASTA / "raw" / "Games.csv").exists() else PASTA


def carregar(raw: Path, params: dict) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, int]:
    """Devolve jogos completos, jogos do recorte, linhas time-jogo e nº de linhas-fantasma removidas."""
    jogos = pd.read_csv(raw / "Games.csv", low_memory=False)
    inicio, tipo = _temporada_e_tipo(jogos["gameId"])
    jogos = jogos.assign(temporada=inicio, tipo_cod=tipo)
    mascara = (jogos["tipo_cod"].isin(params["tipos"])
               & jogos["temporada"].between(params["temporada_min"], params["temporada_max"])
               & (jogos["homeScore"] != jogos["awayScore"]))
    recorte = jogos[mascara].drop_duplicates("gameId")
    times = pd.read_csv(raw / "TeamStatistics.csv", low_memory=False)
    times = times[times["gameId"].isin(recorte["gameId"])]
    # jogos remarcados deixam uma linha sem time (teamId = 0, placar 0 x 0) além das duas reais
    fantasmas = int((times["teamId"] == 0).sum())
    times = times[times["teamId"] != 0].merge(recorte[["gameId", "temporada"]], on="gameId")
    times = times.assign(margem=times["teamScore"] - times["opponentScore"])
    return jogos, recorte, times, fantasmas


def _numericas(df: pd.DataFrame) -> list[str]:
    return [c for c in df.select_dtypes("number").columns if c not in IDS and c not in {"temporada", "tipo_cod"}]


def faltantes(tabelas: dict[str, pd.DataFrame]) -> pd.DataFrame:
    linhas = []
    for nome, df in tabelas.items():
        for c in df.columns:
            s = df[c]
            zeros = int((s == 0).sum()) if pd.api.types.is_numeric_dtype(s) else None
            linhas.append({"tabela": nome, "coluna": c, "linhas": len(s), "faltantes": int(s.isna().sum()),
                           "faltantes_pct": round(float(s.isna().mean()) * 100, 3), "zeros": zeros})
    return pd.DataFrame(linhas)


def faltantes_por_temporada(tabelas: dict[str, pd.DataFrame]) -> pd.DataFrame:
    partes = []
    for nome, df in tabelas.items():
        colunas = [c for c in df.columns if c != "temporada" and df[c].isna().any()]
        if colunas:
            pct = df[colunas].isna().groupby(df["temporada"]).mean().mul(100).round(3)
            longa = pct.reset_index().melt("temporada", var_name="coluna", value_name="faltantes_pct")
            partes.append(longa.assign(tabela=nome)[["tabela", "temporada", "coluna", "faltantes_pct"]])
    return pd.concat(partes, ignore_index=True) if partes else pd.DataFrame()


def estatisticas(times: pd.DataFrame) -> pd.DataFrame:
    linhas = []
    for c in _numericas(times):
        s = times[c].dropna()
        if s.empty:
            continue
        linhas.append({"coluna": c, "n": len(s), "media": s.mean(), "desvio": s.std(), "min": s.min(),
                       "q1": s.quantile(.25), "mediana": s.median(), "q3": s.quantile(.75), "max": s.max(),
                       "assimetria": s.skew(), "curtose": s.kurt()})
    return pd.DataFrame(linhas).round(4)


def outliers_iqr(times: pd.DataFrame) -> pd.DataFrame:
    linhas = []
    for c in _numericas(times):
        s = times[c].dropna()
        if s.empty:
            continue
        q1, q3 = s.quantile(.25), s.quantile(.75)
        baixo, alto = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
        n_b, n_a = int((s < baixo).sum()), int((s > alto).sum())
        linhas.append({"coluna": c, "n": len(s), "limite_inferior": baixo, "limite_superior": alto,
                       "abaixo": n_b, "acima": n_a, "candidatos_pct": round((n_b + n_a) / len(s) * 100, 3)})
    return pd.DataFrame(linhas).round(4)


def maiores_margens(recorte: pd.DataFrame, n: int = 20) -> pd.DataFrame:
    df = recorte.assign(margem_abs=(recorte["homeScore"] - recorte["awayScore"]).abs())
    colunas = ["gameId", "gameDate", "temporada", "hometeamCity", "hometeamName", "homeScore",
               "awayteamCity", "awayteamName", "awayScore", "margem_abs"]
    return df.nlargest(n, "margem_abs")[colunas]


def por_time_temporada(times: pd.DataFrame) -> pd.DataFrame:
    base = times.groupby(["teamId", "teamName", "temporada"], as_index=False)
    numericas = [c for c in _numericas(times) if c not in {"seasonWins", "seasonLosses"}]
    medias = base[numericas].mean().round(4)
    contagens = base[numericas].count()
    jogos = base.size()["size"]
    # sem imputação: uma média feita com poucos jogos não representa a temporada (ex.: detalhes de 2021)
    medias[numericas] = medias[numericas].where(contagens[numericas].div(jogos, axis=0) >= MIN_COBERTURA)
    medias["jogos"] = jogos
    if "q1Points" in contagens:
        medias["jogos_com_detalhe"] = contagens["q1Points"]
    return medias


def nos_do_grafo(arestas: pd.DataFrame) -> pd.DataFrame:
    g = arestas.groupby("origem")["peso"]
    return pd.DataFrame({"grau_saida": g.size(), "soma_peso_saida": g.sum().round(4), "media_peso_saida": g.mean().round(4),
                         "arcos_negativos": g.apply(lambda s: int((s < 0).sum())),
                         "arcos_positivos": g.apply(lambda s: int((s > 0).sum()))}).reset_index().rename(columns={"origem": "no"})


def pesos_por_temporada(arestas: pd.DataFrame) -> pd.DataFrame:
    g = arestas.groupby("temporada")["peso"]
    return pd.DataFrame({"arcos": g.size(), "negativos": g.apply(lambda s: int((s < 0).sum())),
                         "zeros": g.apply(lambda s: int((s == 0).sum())), "desvio": g.std().round(4),
                         "media_abs": g.apply(lambda s: s.abs().mean()).round(4), "min": g.min(), "max": g.max()}).reset_index()


def correlacoes(jogo: pd.DataFrame, temporada: pd.DataFrame, alvo: str) -> pd.DataFrame:
    linhas = []
    for nivel, df in (("time-jogo", jogo), ("time-temporada", temporada)):
        if alvo not in df.columns:
            raise ValueError(f"coluna-alvo {alvo!r} não existe no nível {nivel}")
        for c in _numericas(df):
            if c == alvo or c in {"jogos", "jogos_com_detalhe"}:
                continue
            par = df[[alvo, c]].dropna()
            if len(par) < 3 or par[c].nunique() < 2 or par[alvo].nunique() < 2:
                continue
            linhas.append({"nivel": nivel, "alvo": alvo, "atributo": c, "n": len(par),
                           "pearson": round(par[alvo].corr(par[c]), 4),
                           # Spearman = Pearson dos postos (evita depender do scipy)
                           "spearman": round(par[alvo].rank().corr(par[c].rank()), 4)})
    return pd.DataFrame(linhas)


def casa_fora(times: pd.DataFrame) -> pd.DataFrame:
    g = times.groupby("home")
    return pd.DataFrame({"linhas": g.size(), "vitorias_pct": g["win"].mean().mul(100).round(3),
                         "margem_media": g["margem"].mean().round(4), "pontos_media": g["teamScore"].mean().round(4)}).reset_index()


def gerar(raw: Path | None = None, saida: Path = SAIDA, alvo: str = "margem",
          arestas_csv: Path = PASTA / "arestas.csv", params: dict | None = None) -> dict:
    params = params or yaml.safe_load((RAIZ / "params.yaml").read_text(encoding="utf-8"))["preparar"]
    jogos, recorte, times, fantasmas = carregar(_raw(raw), params)
    arestas = pd.read_csv(arestas_csv)
    tabelas = {"Games (completo)": jogos.drop(columns="tipo_cod"), "Games (recorte)": recorte.drop(columns="tipo_cod"),
               "TeamStatistics (recorte)": times}
    temporada = por_time_temporada(times)
    arquivos = {
        "faltantes.csv": faltantes(tabelas),
        "faltantes_por_temporada.csv": faltantes_por_temporada(tabelas),
        "estatisticas.csv": estatisticas(times),
        "outliers_iqr.csv": outliers_iqr(times),
        "maiores_margens.csv": maiores_margens(recorte),
        "time_temporada.csv": temporada,
        "nos_grafo.csv": nos_do_grafo(arestas),
        "pesos_por_temporada.csv": pesos_por_temporada(arestas),
        "correlacoes_alvo.csv": correlacoes(times, temporada, alvo),
        "casa_fora.csv": casa_fora(times),
    }
    saida.mkdir(parents=True, exist_ok=True)
    for nome, df in arquivos.items():
        df.to_csv(saida / nome, index=False)
    resumo = {"recorte": params, "alvo": alvo, "jogos_completo": len(jogos), "jogos_recorte": len(recorte),
              "linhas_time_jogo": len(times), "linhas_fantasma_removidas": fantasmas, "cobertura_minima_time_temporada": MIN_COBERTURA, "times_temporada": len(temporada),
              "arquivos": {n: len(df) for n, df in arquivos.items()}}
    (saida / "resumo.json").write_text(json.dumps(resumo, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return resumo


def main() -> None:
    ap = argparse.ArgumentParser(description="Tabelas de apoio à AVD (out/avd/tabelas/)")
    ap.add_argument("--raw", type=Path, help="pasta com Games.csv e TeamStatistics.csv")
    ap.add_argument("--saida", type=Path, default=SAIDA)
    ap.add_argument("--alvo", default="margem", help="coluna-alvo das correlações (padrão: margem)")
    args = ap.parse_args()
    resumo = gerar(args.raw, args.saida, args.alvo)
    print(json.dumps(resumo, indent=2, ensure_ascii=False))
    print(f"gravado em {args.saida}")


if __name__ == "__main__":
    main()
