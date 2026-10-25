# [IA] Claude – código de desenho (matplotlib) e montagem do HTML interativo
"""Visualizações da Parte 1 e dados para o labirinto interativo (HTML/web)."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

from .graphs.algorithms import bfs
from .graphs.estados import ALVO, grafo_estados, rotulo
from .graphs.io import ESTEIRAS, Mapa, ler_mapa, listar_mapas
from .solve import ALGORITMOS, armadilhas, resolver

CORES_CASA = {
    "#": "#3a3a3a", ".": "#ffffff", "S": "#7fc97f", "G": "#fdbf6f", ",": "#c8a26b", "~": "#7fb2d9",
    "+": "#a5e3a5", "*": "#ffd54f", **{k: "#fff0a0" for k in "abcd"}, **{p: "#b39ddb" for p in "ABCD"},
    **{e: "#d9d9d9" for e in ESTEIRAS},
}
CORES_CAMADA = ["#d62728", "#1f77b4", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#e377c2"]
TEMPLATE = Path(__file__).parent / "web" / "templates" / "labirinto.html"


# ---------------------------------------------------------------- dados (HTML e API web)
def dados_mapa(mapa: Mapa) -> dict:
    ge = grafo_estados(mapa)
    algs = {}
    for alg in ALGORITMOS:
        r = resolver(ge, alg)
        algs[alg] = {k: r[k] for k in ("status", "passos", "custo", "mensagem", "percurso")}
    if mapa.fontes:
        r = resolver(grafo_estados(mapa, fonte_consumivel=True), "BELLMAN_FORD")
        algs["BELLMAN_FORD_FONTE_CONSUMIVEL"] = {k: r[k] for k in ("status", "passos", "custo", "mensagem", "percurso")}
    camadas: dict[str, set] = defaultdict(set)
    for e in ge.estados():
        camadas[e[2] or "-"].add((e[0], e[1]))
    return {
        "nome": mapa.nome,
        "grade": mapa.grade,
        "estados": len(ge.estados()),
        "arcos": ge.sem_alvo.tamanho,
        "teto": ge.teto_teorico(),
        "algoritmos": algs,
        "armadilhas": [{"rotulo": rotulo(e), "linha": e[0], "coluna": e[1], "chaves": e[2] or "-"}
                       for e in armadilhas(ge)],
        "camadas": {k: sorted([list(p) for p in v]) for k, v in sorted(camadas.items(), key=lambda kv: (len(kv[0]), kv[0]))},
    }


def gerar_html_interativo(out: str | Path, pastas: list[str], extras: list[str] | None = None) -> Path:
    arquivos = listar_mapas(*pastas) + [Path(p) for p in (extras or [])]
    dados = {}
    for p in arquivos:
        m = ler_mapa(p)
        dados[m.nome] = dados_mapa(m)
    html = TEMPLATE.read_text(encoding="utf-8").replace(
        "/*__DADOS_EMBUTIDOS__*/", f"window.__DADOS__ = {json.dumps(dados, ensure_ascii=False)};")
    destino = Path(out) / "labirinto_interativo.html"
    destino.write_text(html, encoding="utf-8")
    return destino


# ---------------------------------------------------------------- figuras
def _plt():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    return plt


def _desenhar_grade(ax, mapa: Mapa, rotulos: bool = True) -> None:
    from matplotlib.patches import Rectangle
    for r, linha in enumerate(mapa.grade):
        for c, ch in enumerate(linha):
            ax.add_patch(Rectangle((c, r), 1, 1, facecolor=CORES_CASA[ch], edgecolor="#bbbbbb", linewidth=0.3))
            if rotulos and ch not in "#.":
                ax.text(c + 0.5, r + 0.5, ch, ha="center", va="center", fontsize=6, fontweight="bold")
    ax.set_xlim(0, mapa.colunas)
    ax.set_ylim(mapa.linhas, 0)
    ax.set_aspect("equal")
    ax.set_xlabel("coluna")
    ax.set_ylabel("linha")


def figura_percurso(mapa: Mapa, destino: Path) -> None:
    from matplotlib.lines import Line2D
    plt = _plt()
    r = resolver(grafo_estados(mapa), "DIJKSTRA")
    if r["status"] != "OK":
        r = resolver(grafo_estados(mapa), "BELLMAN_FORD")
    perc = r["percurso"]
    fig, ax = plt.subplots(figsize=(max(9, mapa.colunas * 0.25), max(4.5, mapa.linhas * 0.28)))
    _desenhar_grade(ax, mapa, rotulos=mapa.colunas <= 40)
    vistos = {}
    for a, b in zip(perc, perc[1:]):
        cor = CORES_CAMADA[len(a["chaves"]) % len(CORES_CAMADA)]
        vistos.setdefault(a["chaves"] or "-", cor)
        d = 0.5 + (len(a["chaves"]) - 1.5) * 0.12  # desloca cada camada para trechos repetidos ficarem visíveis
        ax.plot([a["coluna"] + d, b["coluna"] + d], [a["linha"] + d, b["linha"] + d], color=cor, linewidth=2.2)
    ax.plot(perc[0]["coluna"] + .5, perc[0]["linha"] + .5, "o", color="black", markersize=5)
    handles = [Line2D([0], [0], color=c, lw=3, label=f"chaves: {k}") for k, c in vistos.items()]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=len(handles), fontsize=8)
    ax.set_title(f"{mapa.nome}: caminho de menor custo ({r['passos']} passos, custo {r['custo']:g})\n"
                 "a cor do caminho muda a cada chave coletada", fontsize=10)
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def figura_camadas_m02(mapa: Mapa, destino: Path) -> None:
    from matplotlib.lines import Line2D
    plt = _plt()
    ge = grafo_estados(mapa)
    camadas = sorted({e[2] for e in ge.estados()}, key=lambda k: (len(k), k))
    deslocamento = {k: i * (mapa.linhas + 1) for i, k in enumerate(camadas)}

    def pos(e):
        return e[1], e[0] + deslocamento[e[2]]

    fig, ax = plt.subplots(figsize=(10, 2.2 * len(camadas) + 1))
    for a in ge.sem_alvo.arcos():
        (x1, y1), (x2, y2) = pos(a.origem), pos(a.destino)
        muda = a.origem[2] != a.destino[2]
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle="->", color="#d62728" if muda else "#999999",
                                    lw=2 if muda else 0.7, shrinkA=4, shrinkB=4))
    for e in ge.estados():
        x, y = pos(e)
        cor = CORES_CAMADA[camadas.index(e[2]) % len(CORES_CAMADA)]
        ax.plot(x, y, "o", color=cor, markersize=7, markeredgecolor="black", markeredgewidth=0.4)
    for k, d in deslocamento.items():
        ax.text(-0.8, d + mapa.linhas / 2, f"camada\n{k or '-'}", ha="right", va="center", fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("coluna")
    ax.set_ylabel("linha (deslocada por camada)")
    handles = [Line2D([0], [0], marker="o", lw=0, color=CORES_CAMADA[i], label=f"estados com chaves {k or '-'}")
               for i, k in enumerate(camadas)]
    handles += [Line2D([0], [0], color="#999999", label="arco na mesma camada"),
                Line2D([0], [0], color="#d62728", lw=2, label="arco que muda de camada")]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=4, fontsize=8)
    ax.set_title(f"Grafo de estados do {mapa.nome} em camadas ({len(ge.estados())} estados)")
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def figura_arvore_bfs(mapa: Mapa, destino: Path) -> None:
    plt = _plt()
    ge = grafo_estados(mapa)
    r = bfs(ge.grafo, ge.inicio)
    niveis = r.niveis()
    pos = {}
    for d, nivel in enumerate(niveis):
        for i, v in enumerate(nivel):
            pos[v] = (i - (len(nivel) - 1) / 2, d)
    fig, ax = plt.subplots(figsize=(10, max(6, len(niveis) * 0.32)))
    for v, p in r.pai.items():
        if p is not None:
            ax.plot([pos[p][0], pos[v][0]], [pos[p][1], pos[v][1]], color="#888888", lw=0.8)
    for v, (x, y) in pos.items():
        cor = "#fdbf6f" if v == ALVO else CORES_CAMADA[len(v[2]) % len(CORES_CAMADA)]
        ax.plot(x, y, "o", color=cor, markersize=6, markeredgecolor="black", markeredgewidth=0.4)
        ax.text(x + 0.12, y, rotulo(v), fontsize=5, va="center")
    ax.invert_yaxis()
    ax.set_ylabel("nível BFS (passos desde o início)")
    ax.set_xlabel("posição no nível")
    ax.set_title(f"Árvore BFS de estados do {mapa.nome} ({len(niveis)} níveis)")
    from matplotlib.lines import Line2D
    ax.legend(handles=[Line2D([0], [0], marker="o", lw=0, color=CORES_CAMADA[0], label="sem chave"),
                       Line2D([0], [0], marker="o", lw=0, color=CORES_CAMADA[1], label="com 1 chave"),
                       Line2D([0], [0], marker="o", lw=0, color="#fdbf6f", label="ALVO")], loc="lower right")
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def figura_heatmap(mapa: Mapa, destino: Path) -> None:
    import numpy as np
    plt = _plt()
    ge = grafo_estados(mapa)
    mult = Counter((e[0], e[1]) for e in ge.estados())
    m = np.full((mapa.linhas, mapa.colunas), np.nan)
    for (r, c), k in mult.items():
        m[r, c] = k
    fig, ax = plt.subplots(figsize=(14, 6.5))
    ax.set_facecolor("#3a3a3a")
    im = ax.imshow(m, cmap="viridis", interpolation="nearest")
    fig.colorbar(im, ax=ax, label="multiplicidade (nº de estados na casa)", shrink=0.8)
    ax.set_xlabel("coluna")
    ax.set_ylabel("linha")
    ax.set_title(f"{mapa.nome}: multiplicidade das casas (máx = {max(mult.values())}; paredes em cinza)")
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def gerar_figuras(out: str | Path, pasta_mapas: str = "data/mapas") -> None:
    out = Path(out)
    mapas = {p.stem[:3]: ler_mapa(p) for p in listar_mapas(pasta_mapas)}
    figura_percurso(mapas["m03"], out / "percurso_m03.png")
    figura_percurso(mapas["m08"], out / "percurso_m08.png")
    figura_camadas_m02(mapas["m02"], out / "camadas_m02.png")
    figura_arvore_bfs(mapas["m02"], out / "arvore_bfs_m02.png")
    figura_heatmap(mapas["m08"], out / "heatmap_multiplicidade_m08.png")
