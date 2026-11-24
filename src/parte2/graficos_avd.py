# [IA] Claude – código de desenho (matplotlib) dos 4 gráficos de dados da Parte 2 escolhidos pelo grupo
"""Gráficos de dados (AVD) da Parte 2, no grafo de rotação. Tipos e destaques escolhidos pelo grupo:

- H3 (exploratório): faixa do peso de cada troca por minuto que o substituto ficou em quadra (1, 2, …, 9 e
  10+ min): linha da mediana, faixa do 10º ao 90º percentil, faixa interna do 25º ao 75º, n por minuto e zero;
- H1 (exploratório): barras 100% empilhadas, uma por diferença absoluta no placar no momento da troca (até 5,
  6 a 15 e mais de 15 pontos), divididas em 5 categorias do peso: < −30, −30 a −5, −5 a +5, +5 a +30, > +30;
- impacto x minutos (explanatório): uma bolinha por jogador-temporada com >= 30 entradas, quadrante
  "impacto > 0 e minutos < mediana" destacado, cor por time e nome do jogador;
- X6 (explanatório): times mais eficientes em trocas, média das 6 temporadas, 30 times ordenados, zero
  marcado, 5 melhores e 5 piores em cor forte e o resto em cinza.

Definições: peso de uma troca (ocorrência) = 12 × (saldo depois / min depois − saldo antes / min antes),
só trocas com os dois trechos de pelo menos 1 minuto (``trocas.csv``); minuto k do H3 = [k, k+1); categorias
do H1: < −30, [−30, −5), [−5, +5], (+5, +30], > +30. Impacto de um jogador-temporada = média dos pesos dos arcos que chegam nele, ponderada pelas
ocorrências; entradas = soma das ocorrências; impacto de um time = média dos pesos de todos os arcos do
time, ponderada pelas ocorrências. Este módulo só calcula essas médias e desenha; não interpreta.

Uso: python -m src.parte2.graficos_avd [--temporada 2025]  (temporada do gráfico de bolinhas no PDF)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parents[2]
ROT = RAIZ / "data" / "dataset_parte2" / "rotacao"
RAW = RAIZ / "data" / "dataset_parte2" / "raw"
SAIDA = RAIZ / "out" / "parte2" / "graficos_avd"
MIN_ENTRADAS = 30
NEG, POS, CINZA, DESTAQUE = "#C8553D", "#2E86AB", "#B8B8B8", "#F2C14E"


def _mil(n: int) -> str:
    """Inteiro com ponto de milhar (padrão brasileiro)."""
    return f"{n:,}".replace(",", ".")


def _rotular_sem_sobrepor(ax, pontos, limite: int) -> int:
    """Escreve nomes em ordem de prioridade pulando os que colidem com um nome já escrito (em pixels)."""
    fig = ax.figure
    fig.canvas.draw()
    ocupadas, escritos = [], 0
    for x, y, texto, tamanho, cor in pontos:
        if escritos >= limite:
            break
        px, py = ax.transData.transform((x, y))
        larg, alt = len(texto) * tamanho * 0.62, tamanho * 1.5
        caixa = (px + 3, py + 2, px + 3 + larg, py + 2 + alt)
        if any(not (caixa[2] < o[0] or caixa[0] > o[2] or caixa[3] < o[1] or caixa[1] > o[3]) for o in ocupadas):
            continue
        ocupadas.append(caixa)
        ax.annotate(texto, (x, y), xytext=(3, 2), textcoords="offset points", fontsize=tamanho, color=cor, zorder=4)
        escritos += 1
    return escritos


def _plt():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    return plt


def dados(rot: Path = ROT, raw: Path = RAW) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Arcos e uma tabela por jogador-temporada com impacto, entradas, minutos e atributos do cadastro."""
    arcos = pd.read_csv(rot / "arestas_rotacao.csv")
    jog = pd.read_csv(rot / "jogadores.csv")
    arcos["peso_x_oc"] = arcos["peso"] * arcos["ocorrencias"]
    chega = arcos.groupby("destino").agg(soma=("peso_x_oc", "sum"), entradas=("ocorrencias", "sum"))
    chega["impacto"] = chega["soma"] / chega["entradas"]
    jog = jog.drop(columns=["entradas", "impacto_medio"], errors="ignore").join(
        chega[["impacto", "entradas"]], on="no")
    pl = pd.read_csv(raw / "Players.csv", usecols=["personId", "heightInches", "bodyWeightLbs", "draftYear",
                                                    "guard", "forward", "center"])
    jog = jog.merge(pl, on="personId", how="left")
    jog["altura_cm"] = (jog["heightInches"] * 2.54).round(1)
    jog["peso_kg"] = (jog["bodyWeightLbs"] * 0.4536).round(1)
    est = estatisticas_36(raw)
    if est is not None:
        jog = jog.merge(est, on=["personId", "temporada"], how="left")
    return arcos, jog


# [IA] Claude – estatísticas de jogo por 36 minutos (temporada regular), somando todos os jogos do jogador na temporada
def estatisticas_36(raw: Path = RAW) -> pd.DataFrame | None:
    caminho = raw / "PlayerStatistics.csv"
    if not caminho.exists():
        return None
    cols = ["personId", "gameId", "numMinutes", "points", "assists", "reboundsTotal", "steals", "blocks", "turnovers",
            "fieldGoalsAttempted", "threePointersAttempted", "freeThrowsAttempted", "plusMinusPoints"]
    ps = pd.read_csv(caminho, usecols=cols, low_memory=False)
    for c in cols:
        ps[c] = pd.to_numeric(ps[c], errors="coerce")
    ps["temporada"] = ps["gameId"] // 10**5 % 100 + 2000
    ps = ps[(ps["gameId"] // 10**7 == 2) & (ps["numMinutes"] > 0)]
    g = ps.groupby(["personId", "temporada"]).sum(numeric_only=True)
    por36 = lambda c: g[c] / g["numMinutes"] * 36
    return pd.DataFrame({
        "pontos36": por36("points"), "assist36": por36("assists"), "rebotes36": por36("reboundsTotal"),
        "roubos36": por36("steals"), "tocos36": por36("blocks"), "erros36": por36("turnovers"),
        # true shooting: pontos / (2 × (arremessos + 0,44 × lances livres))
        "arremesso_real": g["points"] / (2 * (g["fieldGoalsAttempted"] + 0.44 * g["freeThrowsAttempted"])),
        "taxa_de_3": g["threePointersAttempted"] / g["fieldGoalsAttempted"],
        "pm36": por36("plusMinusPoints"),
    }).reset_index()


# [IA] Claude – faixas do H3 (minuto a minuto) e categorias do H1 (barras 100% empilhadas) do peso de cada troca
LIMITE_EXTREMO = 30.0
# minutos inteiros do substituto em quadra: [k, k+1); o trecho fica dentro de um período (máx. 11 min nos dados,
# só 10 trocas com 11), por isso a última faixa junta 10 min ou mais
FAIXAS_H3 = [(f"{k}", k, k + 1) for k in range(1, 10)] + [("10+", 10, float("inf"))]
GRUPOS_H1 = [("até 5 pts", 0, 5), ("6 a 15 pts", 6, 15), ("mais de 15 pts", 16, float("inf"))]
# categorias do peso: < −30, [−30, −5), [−5, +5], (+5, +30], > +30
CATEGORIAS_H1 = ["piorou muito (< −30)", "piorou (−30 a −5)", "perto de zero (−5 a +5)",
                 "melhorou (+5 a +30)", "melhorou muito (> +30)"]
FAIXA, FAIXA_INTERNA, MEDIANA = "#D6CFC4", "#B5AA9A", "#E8590C"
CORES_H1 = [NEG, "#E6A596", "#D4D4D4", "#97C3DA", POS]


def trocas(rot: Path = ROT) -> pd.DataFrame:
    """Uma linha por troca (trocas.csv, gravado por src/parte2/rotacao.py)."""
    return pd.read_csv(rot / "trocas.csv")


def faixas_h3(t: pd.DataFrame) -> list[dict]:
    """Por minuto do substituto em quadra: n, percentis 10/25/50/75/90, % além de ±30 e % negativas."""
    res = []
    for r, a, b in FAIXAS_H3:
        w = t.loc[(t["min_depois"] >= a) & (t["min_depois"] < b), "peso_ocorrencia"]
        if w.empty:
            continue
        p = {k: round(float(w.quantile(q)), 3) for k, q in
             (("p10", 0.10), ("p25", 0.25), ("mediana", 0.5), ("p75", 0.75), ("p90", 0.90))}
        res.append({"minutos": r, "n": int(len(w)), **p,
                    "pct_extremos": round(float((w.abs() > LIMITE_EXTREMO).mean() * 100), 2),
                    "pct_negativos": round(float((w < 0).mean() * 100), 2)})
    return res


def categoria_peso(w: pd.Series) -> pd.Series:
    """Índice da categoria do peso (0 a 4) na ordem de CATEGORIAS_H1."""
    import numpy as np
    return pd.Series(np.select([w < -30, w < -5, w <= 5, w <= 30], [0, 1, 2, 3], 4), index=w.index)


def pilhas_h1(t: pd.DataFrame) -> list[dict]:
    """Por grupo de placar: n, mediana, contagem e % de cada categoria do peso (as % somam 100)."""
    res = []
    for r, a, b in GRUPOS_H1:
        w = t.loc[(t["placar"] >= a) & (t["placar"] <= b), "peso_ocorrencia"]
        cont = categoria_peso(w).value_counts().reindex(range(5), fill_value=0)
        res.append({"grupo": r, "n": int(len(w)), "mediana": round(float(w.median()), 3),
                    "contagens": [int(c) for c in cont],
                    "pcts": [round(float(c) / len(w) * 100, 2) for c in cont]})
    return res


def _fim(fig, ax, plt, destino: Path) -> None:
    fig.tight_layout(); fig.savefig(destino, dpi=160); plt.close(fig)


def faixa_h3(t: pd.DataFrame, destino: Path) -> dict:
    plt = _plt()
    fs = faixas_h3(t)
    x = list(range(len(fs)))
    fig, ax = plt.subplots(figsize=(10, 5.6))
    ax.axhline(0, color="black", lw=1, zorder=1)
    ax.fill_between(x, [f["p10"] for f in fs], [f["p90"] for f in fs], color=FAIXA, lw=0, zorder=2,
                    label="80% das trocas (10º ao 90º percentil)")
    ax.fill_between(x, [f["p25"] for f in fs], [f["p75"] for f in fs], color=FAIXA_INTERNA, lw=0, zorder=2,
                    label="50% das trocas (25º ao 75º percentil)")
    med = [f["mediana"] for f in fs]
    ax.plot(x, med, color=MEDIANA, lw=2.4, marker="o", ms=5, zorder=3, label="mediana")
    for i, v in enumerate(med):
        rot = "0,0" if abs(v) < 0.05 else f"{v:+.1f}".replace(".", ",").replace("-", "−")
        ax.annotate(rot, (i, v), xytext=(0, 7), textcoords="offset points", ha="center",
                    fontsize=8, color=MEDIANA, weight="bold", zorder=4)
    ax.set_xticks(x, [f"{f['minutos']}\nn = {_mil(f['n'])}" for f in fs], fontsize=8.5)
    ax.set_xlim(-0.3, len(fs) - 0.7)
    ax.set_xlabel("minutos que o substituto ficou em quadra (1 = de 1 a 2 min; 10+ = 10 min ou mais)")
    ax.set_ylabel("peso da troca: saldo por 12 min depois − antes (pontos)")
    total = _mil(sum(f["n"] for f in fs))
    ax.set_title(f"Tempo do substituto em quadra: peso de cada troca, 2020-21 a 2025-26 ({total} trocas)", fontsize=10.5)
    ax.legend(loc="upper left", fontsize=8.5, frameon=False)
    _fim(fig, ax, plt, destino)
    return {"trocas": int(sum(f["n"] for f in fs)), "faixas": fs}


def pilhas_100(t: pd.DataFrame, destino: Path) -> dict:
    plt = _plt()
    gs = pilhas_h1(t)
    fig, ax = plt.subplots(figsize=(10, 4.2))
    ys = list(range(len(gs)))[::-1]
    for y, g in zip(ys, gs):
        esq = 0.0
        for c, pct in enumerate(g["pcts"]):
            ax.barh(y, pct, left=esq, color=CORES_H1[c], height=0.62, edgecolor="white", lw=1)
            if pct >= 5:
                ax.text(esq + pct / 2, y, f"{pct:.0f}%", ha="center", va="center", fontsize=9,
                        color="white" if c in (0, 4) else "#222222", weight="bold")
            esq += pct
    ax.set_yticks(ys, [f"{g['grupo']}\nn = {_mil(g['n'])}" for g in gs])
    ax.set_xlim(0, 100)
    ax.set_xticks(range(0, 101, 20), [f"{v}%" for v in range(0, 101, 20)])
    ax.spines["left"].set_visible(False); ax.tick_params(axis="y", length=0)
    ax.set_xlabel("% das trocas do grupo")
    ax.set_ylabel("diferença no placar no momento da troca")
    total = _mil(sum(g["n"] for g in gs))
    ax.set_title(f"Placar no momento da troca: peso de cada troca, 2020-21 a 2025-26 ({total} trocas)\n"
                 "peso = saldo por 12 min depois − antes (pontos)", fontsize=10.5)
    from matplotlib.patches import Patch
    ax.legend([Patch(color=c) for c in CORES_H1], CATEGORIAS_H1, ncol=5, fontsize=7.6, frameon=False,
              loc="upper center", bbox_to_anchor=(0.45, -0.2), handlelength=1.2, columnspacing=1.2)
    _fim(fig, ax, plt, destino)
    return {"trocas": int(sum(g["n"] for g in gs)), "categorias": CATEGORIAS_H1, "grupos": gs}


def _cores_times(times) -> dict:
    import matplotlib
    pal = list(matplotlib.colormaps["tab20"].colors) + list(matplotlib.colormaps["tab20b"].colors)
    return {t: pal[i % len(pal)] for i, t in enumerate(sorted(times))}


def bolinhas(jog: pd.DataFrame, temporada: int, destino: Path) -> dict:
    plt = _plt()
    d = jog[(jog["temporada"] == temporada) & (jog["entradas"] >= MIN_ENTRADAS)].copy()
    med = float(d["minutos_medidos"].median())
    cores = _cores_times(jog["time"].unique())
    fig, ax = plt.subplots(figsize=(12, 7.5))
    ymin, ymax = d["impacto"].min() - 1, d["impacto"].max() + 1
    ax.axhspan(0, ymax, xmin=0, xmax=(med - d["minutos_medidos"].min() * 0.95) / (d["minutos_medidos"].max() * 1.05 - d["minutos_medidos"].min() * 0.95),
               color=DESTAQUE, alpha=0.18, lw=0)
    ax.axhline(0, color="black", lw=1)
    ax.axvline(med, color="black", lw=1, ls="--")
    for t, g in d.groupby("time"):
        ax.scatter(g["minutos_medidos"], g["impacto"], s=38, color=cores[t], edgecolor="white", lw=0.5, label=t, zorder=3)
    quad = d[(d["impacto"] > 0) & (d["minutos_medidos"] < med)]
    ax.set_xlim(d["minutos_medidos"].min() * 0.95, d["minutos_medidos"].max() * 1.05)
    ax.set_ylim(ymin, ymax)
    ax.text(0.99, 0.985, "quadrante destacado: impacto > 0 e minutos < mediana", transform=ax.transAxes,
            fontsize=9, va="top", ha="right", weight="bold")
    # nomes: primeiro os do quadrante (maior impacto antes), depois os demais; pula o que colidir
    prioridade = pd.concat([quad.sort_values("impacto", ascending=False),
                            d.drop(quad.index).reindex(d.drop(quad.index)["impacto"].abs().sort_values(ascending=False).index)])
    pontos = [(r.minutos_medidos, r.impacto, r.nome, 7 if i in quad.index else 5.5,
               "black" if i in quad.index else "#888888") for i, r in prioridade.iterrows()]
    _rotular_sem_sobrepor(ax, pontos, limite=len(pontos))
    ax.set_xlabel(f"minutos em quadra medidos nas trocas (linha tracejada = mediana, {med:.0f} min)")
    ax.set_ylabel("impacto: saldo por 12 min depois − antes, média das entradas (pontos)")
    rot = f"{temporada}-{str(temporada + 1)[-2:]}"
    ax.set_title(f"Impacto ao entrar × minutos em quadra, temporada {rot} (jogadores com ≥ {MIN_ENTRADAS} entradas, n = {len(d)})")
    ax.legend(ncol=2, fontsize=6.5, frameon=False, title="time", title_fontsize=7, bbox_to_anchor=(1.01, 1), loc="upper left")
    fig.tight_layout(); fig.savefig(destino, dpi=170); plt.close(fig)
    return {"temporada": temporada, "jogadores": int(len(d)), "mediana_minutos": med, "no_quadrante": int(len(quad))}


def x6_times(arcos: pd.DataFrame, destino: Path) -> dict:
    plt = _plt()
    g = arcos.groupby("time").agg(soma=("peso_x_oc", "sum"), oc=("ocorrencias", "sum"))
    g["impacto"] = g["soma"] / g["oc"]
    g = g.sort_values("impacto")
    n = len(g)
    cores = [NEG if i < 5 else (POS if i >= n - 5 else CINZA) for i in range(n)]
    fig, ax = plt.subplots(figsize=(8, 8.5))
    ax.barh(g.index, g["impacto"], color=cores)
    ax.axvline(0, color="black", lw=1)
    for y, v in enumerate(g["impacto"]):
        ax.text(v + (0.03 if v >= 0 else -0.03), y, f"{v:+.2f}", va="center", ha="left" if v >= 0 else "right", fontsize=8)
    ax.set_xlabel("impacto médio das trocas do time: saldo por 12 min depois − antes (pontos), ponderado pelas ocorrências")
    ax.set_title("Impacto médio das trocas por time, 2020-21 a 2025-26\n(5 maiores e 5 menores destacados)")
    fig.tight_layout(); fig.savefig(destino, dpi=160); plt.close(fig)
    return {"times": int(n), "impacto_por_time": g["impacto"].round(4).to_dict()}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--temporada", type=int, default=2025, help="temporada do gráfico de bolinhas no PDF (ano de início)")
    args = ap.parse_args(argv)
    SAIDA.mkdir(parents=True, exist_ok=True)
    arcos, jog = dados()
    tr = trocas()
    resumo = {
        "h3_tempo_em_quadra": faixa_h3(tr, SAIDA / "h3_tempo_em_quadra.png"),
        "h1_placar_momento": pilhas_100(tr, SAIDA / "h1_placar_momento.png"),
        "impacto_x_minutos": bolinhas(jog, args.temporada, SAIDA / f"impacto_x_minutos_{args.temporada}.png"),
        "x6_times_trocas": x6_times(arcos, SAIDA / "x6_times_trocas.png"),
    }
    jog.to_csv(SAIDA / "jogadores_impacto.csv", index=False)
    (SAIDA / "resumo.json").write_text(json.dumps(resumo, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("impacto_por_time",)}
                      for k, v in resumo.items()}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
