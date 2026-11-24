# [IA] Claude – código de desenho (matplotlib) dos 4 gráficos de dados da Parte 2 escolhidos pelo grupo
"""Gráficos de dados (AVD) da Parte 2, no grafo de rotação. Tipos e destaques escolhidos pelo grupo:

- E1 (exploratório): histograma do peso das trocas, linha no zero, negativos e positivos em cores
  diferentes, mediana marcada;
- E4 (exploratório): matriz de correlação de Spearman entre impacto, minutos, entradas, altura, peso e
  ano do draft (jogador-temporada com >= 30 entradas), valor escrito em cada célula, escala -1 a +1;
- impacto x minutos (explanatório): uma bolinha por jogador-temporada com >= 30 entradas, quadrante
  "impacto > 0 e minutos < mediana" destacado, cor por time e nome do jogador;
- X6 (explanatório): times mais eficientes em trocas, média das 6 temporadas, 30 times ordenados, zero
  marcado, 5 melhores e 5 piores em cor forte e o resto em cinza.

Definições: impacto de um jogador-temporada = média dos pesos dos arcos que chegam nele, ponderada pelas
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
    return arcos, jog


def e1_histograma(arcos: pd.DataFrame, destino: Path) -> dict:
    plt = _plt()
    w = arcos["peso"]
    fig, ax = plt.subplots(figsize=(9, 4.8))
    bins = range(-60, 62, 2)
    ax.hist(w[w < 0], bins=bins, color=NEG, label=f"troca piora o time (peso < 0): {_mil(int((w < 0).sum()))}")
    ax.hist(w[w >= 0], bins=bins, color=POS, label=f"troca melhora o time (peso ≥ 0): {_mil(int((w >= 0).sum()))}")
    ax.axvline(0, color="black", lw=1.2)
    med = float(w.median())
    ax.axvline(med, color="black", lw=1, ls="--", label=f"mediana = {med:+.2f}")
    ax.set_xlabel("peso do arco X → Y: saldo por 12 min depois da troca − antes (pontos)")
    ax.set_ylabel("número de arcos (tipos de troca)")
    ax.set_title(f"Distribuição do peso das trocas no grafo de rotação (2020-21 a 2025-26, {_mil(len(w))} arcos)")
    ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(destino, dpi=160); plt.close(fig)
    return {"arcos": int(len(w)), "negativos": int((w < 0).sum()), "mediana": med}


def e4_correlacao(jog: pd.DataFrame, destino: Path) -> dict:
    plt = _plt()
    cols = {"impacto": "impacto", "minutos_medidos": "minutos", "entradas": "entradas",
            "altura_cm": "altura", "peso_kg": "peso", "draftYear": "ano do draft"}
    base = jog[jog["entradas"] >= MIN_ENTRADAS][list(cols)].rename(columns=cols)
    c = base.corr(method="spearman")
    fig, ax = plt.subplots(figsize=(6.6, 5.6))
    im = ax.imshow(c.values, cmap="RdBu", vmin=-1, vmax=1)
    ax.set_xticks(range(len(c)), c.columns, rotation=35, ha="right")
    ax.set_yticks(range(len(c)), c.index)
    for i in range(len(c)):
        for j in range(len(c)):
            v = c.values[i, j]
            ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=9, color="white" if abs(v) > 0.6 else "black")
    fig.colorbar(im, ax=ax, label="correlação de Spearman (−1 a +1)", shrink=0.85)
    ax.set_title(f"Correlação de Spearman por jogador-temporada\n(≥ {MIN_ENTRADAS} entradas, n = {_mil(base.dropna().shape[0])})")
    ax.spines[:].set_visible(False)
    fig.tight_layout(); fig.savefig(destino, dpi=160); plt.close(fig)
    return {"n": int(len(base)), "n_completos": int(base.dropna().shape[0]),
            "faltantes": {k: int(v) for k, v in base.isna().sum().items()},
            "matriz": c.round(3).to_dict()}


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
    resumo = {
        "e1_histograma_peso": e1_histograma(arcos, SAIDA / "e1_histograma_peso.png"),
        "e4_correlacao_spearman": e4_correlacao(jog, SAIDA / "e4_correlacao_spearman.png"),
        "impacto_x_minutos": bolinhas(jog, args.temporada, SAIDA / f"impacto_x_minutos_{args.temporada}.png"),
        "x6_times_trocas": x6_times(arcos, SAIDA / "x6_times_trocas.png"),
    }
    jog.to_csv(SAIDA / "jogadores_impacto.csv", index=False)
    (SAIDA / "resumo.json").write_text(json.dumps(resumo, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("matriz", "impacto_por_time")}
                      for k, v in resumo.items()}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
