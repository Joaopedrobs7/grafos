# [IA] Claude – código de desenho (matplotlib) dos 4 gráficos de dados da Parte 2 escolhidos pelo grupo
"""Gráficos de dados (AVD) da Parte 2, no grafo de rotação. Tipos e destaques escolhidos pelo grupo:

- H3 (exploratório): boxplot do peso de cada troca por tempo que o substituto ficou em quadra
  (1–2, 2–4, 4–8 e 8+ min), com n e % de extremos (|peso| > 30) por grupo e linha no zero;
- H1 (exploratório): boxplot do peso de cada troca pela diferença absoluta no placar no momento da troca
  (até 5, 6 a 15 e mais de 15 pontos), com n e % de extremos por grupo e linha no zero;
- impacto x minutos (explanatório): uma bolinha por jogador-temporada com >= 30 entradas, quadrante
  "impacto > 0 e minutos < mediana" destacado, cor por time e nome do jogador;
- X6 (explanatório): times mais eficientes em trocas, média das 6 temporadas, 30 times ordenados, zero
  marcado, 5 melhores e 5 piores em cor forte e o resto em cinza.

Definições: peso de uma troca (ocorrência) = 12 × (saldo depois / min depois − saldo antes / min antes),
só trocas com os dois trechos de pelo menos 1 minuto (``trocas.csv``); nos boxplots a caixa vai do 1º ao
3º quartil, a linha é a mediana e os bigodes vão até o dado mais distante dentro de 1,5 × IIQ (pontos além
dos bigodes não são desenhados). Impacto de um jogador-temporada = média dos pesos dos arcos que chegam nele, ponderada pelas
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


# [IA] Claude – grupos dos boxplots H3 e H1 (peso de cada troca) e resumo de cada grupo
LIMITE_EXTREMO = 30.0
GRUPOS_H3 = [("1–2 min", 1, 2), ("2–4 min", 2, 4), ("4–8 min", 4, 8), ("8+ min", 8, float("inf"))]
GRUPOS_H1 = [("até 5 pts", 0, 5), ("6 a 15 pts", 6, 15), ("mais de 15 pts", 16, float("inf"))]
CAIXA, BORDA = "#CFC8BD", "#57534E"


def trocas(rot: Path = ROT) -> pd.DataFrame:
    """Uma linha por troca (trocas.csv, gravado por src/parte2/rotacao.py)."""
    return pd.read_csv(rot / "trocas.csv")


def grupos(t: pd.DataFrame, qual: str) -> list[tuple[str, pd.Series]]:
    """[(rótulo, pesos)] na ordem dos grupos: H3 por minutos do substituto, H1 por diferença no placar."""
    if qual == "h3":
        return [(r, t.loc[(t["min_depois"] >= a) & (t["min_depois"] < b), "peso_ocorrencia"]) for r, a, b in GRUPOS_H3]
    return [(r, t.loc[(t["placar"] >= a) & (t["placar"] <= b), "peso_ocorrencia"]) for r, a, b in GRUPOS_H1]


def resumo_grupo(w: pd.Series) -> dict:
    """n, quartis, bigodes (1,5 × IIQ, limitados ao dado), % de extremos e % de negativos."""
    q1, med, q3 = (float(w.quantile(q)) for q in (0.25, 0.5, 0.75))
    iiq = q3 - q1
    dentro = w[(w >= q1 - 1.5 * iiq) & (w <= q3 + 1.5 * iiq)]
    return {"n": int(len(w)), "q1": round(q1, 3), "mediana": round(med, 3), "q3": round(q3, 3),
            "bigode_min": round(float(dentro.min()), 3), "bigode_max": round(float(dentro.max()), 3),
            "pct_extremos": round(float((w.abs() > LIMITE_EXTREMO).mean() * 100), 2),
            "pct_negativos": round(float((w < 0).mean() * 100), 2)}


def boxplot_grupos(t: pd.DataFrame, qual: str, destino: Path) -> dict:
    plt = _plt()
    gs = grupos(t, qual)
    res = {r: resumo_grupo(w) for r, w in gs}
    fig, ax = plt.subplots(figsize=(9, 5.4))
    ax.axhline(0, color="black", lw=1, zorder=1)
    ax.boxplot([w.to_numpy() for _, w in gs], whis=1.5, showfliers=False, widths=0.55, patch_artist=True,
               boxprops={"facecolor": CAIXA, "edgecolor": BORDA, "lw": 1}, whiskerprops={"color": BORDA, "lw": 1},
               capprops={"color": BORDA, "lw": 1}, medianprops={"color": "black", "lw": 2.4}, zorder=2)
    topo = max(v["bigode_max"] for v in res.values())
    base = min(v["bigode_min"] for v in res.values())
    for i, (r, v) in enumerate(res.items(), start=1):
        ax.text(i, v["bigode_max"] + (topo - base) * 0.03, f"{v['pct_extremos']:.1f}% extremos".replace(".", ","),
                ha="center", va="bottom", fontsize=9, color=NEG, weight="bold")
        ax.text(i + 0.3, v["mediana"], f"{v['mediana']:+.2f}".replace(".", ","), ha="left", va="center", fontsize=8.5,
                bbox={"facecolor": "white", "edgecolor": "none", "pad": 1.5}, zorder=3)
    ax.set_xticks(range(1, len(res) + 1), [f"{r}\nn = {_mil(v['n'])}" for r, v in res.items()])
    ax.set_ylim(base - (topo - base) * 0.06, topo + (topo - base) * 0.12)
    ax.set_ylabel("peso da troca: saldo por 12 min depois − antes (pontos)")
    total = _mil(sum(v["n"] for v in res.values()))
    if qual == "h3":
        ax.set_xlabel("tempo que o substituto ficou em quadra")
        titulo = "Tempo do substituto em quadra"
    else:
        ax.set_xlabel("diferença no placar no momento da troca (pontos, em módulo)")
        titulo = "Placar no momento da troca"
    ax.set_title(f"{titulo}: peso de cada troca, 2020-21 a 2025-26 ({total} trocas)\n"
                 f"caixa = 1º a 3º quartil; traço = mediana; bigodes = 1,5 × IIQ (pontos além deles omitidos); "
                 f"extremos = |peso| > {LIMITE_EXTREMO:.0f}", fontsize=10)
    fig.tight_layout(); fig.savefig(destino, dpi=160); plt.close(fig)
    return {"trocas": int(sum(v["n"] for v in res.values())), "grupos": res}


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
        "h3_tempo_em_quadra": boxplot_grupos(tr, "h3", SAIDA / "h3_tempo_em_quadra.png"),
        "h1_placar_momento": boxplot_grupos(tr, "h1", SAIDA / "h1_placar_momento.png"),
        "impacto_x_minutos": bolinhas(jog, args.temporada, SAIDA / f"impacto_x_minutos_{args.temporada}.png"),
        "x6_times_trocas": x6_times(arcos, SAIDA / "x6_times_trocas.png"),
    }
    jog.to_csv(SAIDA / "jogadores_impacto.csv", index=False)
    (SAIDA / "resumo.json").write_text(json.dumps(resumo, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("impacto_por_time",)}
                      for k, v in resumo.items()}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
