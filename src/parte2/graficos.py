# [IA] Claude – ajuste de rótulos, legenda e margens dos gráficos de comparação
from __future__ import annotations

import json
import statistics
from pathlib import Path

from ..viz import _plt
from .buscas import SAIDA

GRAFICOS = SAIDA / "graficos"
CORES = {"BFS": "#2a78d6", "DFS": "#eb6834", "Dijkstra": "#1baf7a", "Bellman-Ford": "#eda100"}
CINZA = "#a3a29c"
TINTA = "#0b0b0b"
TINTA_2 = "#52514e"
GRADE = "#e6e5e1"


def _ler(nome: str):
    return json.loads((SAIDA / nome).read_text(encoding="utf-8"))


def _eixos(ax, grade: str = "both") -> None:
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(TINTA_2)
    ax.tick_params(colors=TINTA_2)
    ax.grid(axis=grade, color=GRADE, linewidth=0.8)
    ax.set_axisbelow(True)


def _salvar(plt, fig, destino: Path) -> None:
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def tempo_por_algoritmo(rel: dict, destino: Path) -> None:
    from matplotlib.lines import Line2D
    plt = _plt()
    fig, ax = plt.subplots(figsize=(10, 4.6))
    rotulos = []
    for i, alg in enumerate(CORES):
        tarefas = [t for t in rel["tarefas"] if t["algoritmo"] == alg]
        medias = [t["media_s"] * 1e3 for t in tarefas]
        m = statistics.fmean(medias)
        ax.scatter(medias, [i] * len(medias), s=30, color=CORES[alg], alpha=0.4, edgecolors="none")
        ax.scatter([m], [i], s=120, color=CORES[alg], edgecolors="white", linewidths=1.5, zorder=3)
        ax.annotate(f"{m:.3g} ms", (m, i), xytext=(0, 11), textcoords="offset points", ha="center", color=TINTA, fontsize=9)
        grafo = "subgrafo da temporada" if alg == "Bellman-Ford" else "grafo inteiro"
        rotulos.append(f"{alg}\n{len(tarefas)} tarefas, {grafo}")
    ax.set_xscale("log")
    ax.set_yticks(range(len(CORES)), rotulos)
    ax.set_ylim(len(CORES) - 0.5, -0.6)
    ax.set_xlabel("tempo médio por execução (ms, escala log)")
    _eixos(ax, "x")
    ax.legend(handles=[
        Line2D([0], [0], marker="o", lw=0, color=CINZA, alpha=0.6, markersize=6, label="uma tarefa (média de 5 execuções)"),
        Line2D([0], [0], marker="o", lw=0, color=TINTA_2, markersize=10, label="média do algoritmo"),
    ], loc="upper right", fontsize=8, frameon=False)
    ax.set_title(f"Tempo médio por algoritmo nas tarefas das partes 2–4 ({rel['repeticoes']} execuções cada)", fontsize=11)
    _salvar(plt, fig, destino)


def tempo_por_tamanho(rel: dict, destino: Path) -> None:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(10, 5.2))
    esc = rel["escalabilidade"]
    for alg in CORES:
        pts = sorted((e["E"], e["media_s"] * 1e3) for e in esc if e["algoritmo"] == alg)
        x, y = zip(*pts)
        ax.plot(x, y, "-o", color=CORES[alg], lw=2, markersize=7, label=alg)
        ax.annotate(f"{alg}: {y[-1]:.3g} ms" if y[-1] < 1000 else f"{alg}: {y[-1]:.0f} ms", (x[-1], y[-1]), xytext=(8, 0), textcoords="offset points",
                    va="center", color=TINTA, fontsize=9)
    tamanhos = sorted({(e["E"], e["V"], e["amostra"]) for e in esc})
    ax.set_xticks([t[0] for t in tamanhos], [f"|E|={E}\n|V|={V} ({a:.0%})" for E, V, a in tamanhos])
    ax.set_xlim(0, tamanhos[-1][0] * 1.25)
    ax.set_yscale("log")
    ax.set_xlabel("tamanho da amostra (fração das temporadas, seed 42)")
    ax.set_ylabel("tempo médio (ms, escala log)")
    _eixos(ax)
    ax.legend(loc="upper left", fontsize=8, frameon=False)
    ax.set_title("Tempo × tamanho do grafo: temporadas inteiras, uma fonte virtual", fontsize=11)
    _salvar(plt, fig, destino)


def bfs_x_dfs(dados: list, destino: Path) -> None:
    plt = _plt()
    fig, axs = plt.subplots(1, len(dados), figsize=(14, 4.4), sharey=True)
    for ax, e in zip(axs, dados):
        b = [len(c) for c in e["BFS"]["camadas"]]
        d = [len(c) for c in e["DFS"]["profundidades"]]
        ax.bar([i - 0.2 for i in range(len(b))], b, width=0.4, color=CORES["BFS"], label="BFS: nós por camada (distância em arcos)")
        ax.bar([i + 0.2 for i in range(len(d))], d, width=0.4, color=CORES["DFS"], label="DFS: nós por profundidade na árvore")
        for i, n in enumerate(b):
            ax.annotate(str(n), (i - 0.2, n), xytext=(0, 3), textcoords="offset points", ha="center", color=TINTA, fontsize=8)
        ax.annotate(f"DFS: {max(d)} nó por nível,\nprofundidade máx. {len(d) - 1}", (len(d) - 1, max(d)), xytext=(0, 18),
                    textcoords="offset points", ha="right", color=TINTA, fontsize=8)
        ax.set_title(f"fonte {e['fonte']} ({len(e['BFS']['ordem'])} nós alcançados)", fontsize=10)
        ax.set_xlabel("camada (BFS) / profundidade (DFS)")
        _eixos(ax, "y")
    axs[0].set_ylabel("número de nós")
    handles, labels = axs[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=2, fontsize=9, frameon=False)
    fig.suptitle("BFS × DFS nas 3 fontes: a BFS abre em largura, a DFS desce em profundidade", fontsize=11)
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def caminhos_dijkstra(d: dict, destino: Path) -> None:
    plt = _plt()
    pares = d["pares"]
    y = range(len(pares))
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.6), sharey=True, gridspec_kw={"width_ratios": [3, 1]})
    for desloc, chave, cor, rotulo in ((-0.2, "custo_transformado", CORES["Dijkstra"], "custo −log P(vitória) (o que o Dijkstra minimiza)"),
                                       (0.2, "custo_original", CINZA, "custo nos pesos originais (saldo médio)")):
        vals = [p[chave] for p in pares]
        a1.barh([i + desloc for i in y], vals, height=0.38, color=cor, label=rotulo)
        for i, v in zip(y, vals):
            a1.annotate(f"{v:.2f}", (v, i + desloc), xytext=(4 if v >= 0 else -4, 0), textcoords="offset points",
                        ha="left" if v >= 0 else "right", va="center", color=TINTA, fontsize=8)
    a1.axvline(0, color=TINTA_2, lw=0.8)
    a1.margins(x=0.1)
    a1.set_yticks(list(y), [f"{p['temporada']}: {p['origem']} → {p['destino']}" for p in pares])
    a1.invert_yaxis()
    a1.set_xlabel("custo do caminho")
    a1.legend(loc="lower center", bbox_to_anchor=(0.5, -0.32), ncol=2, fontsize=8, frameon=False)
    _eixos(a1, "x")
    arcos = [p["n_arcos"] for p in pares]
    a2.barh(list(y), arcos, height=0.5, color=CORES["Dijkstra"])
    for i, n in zip(y, arcos):
        a2.annotate(str(n), (n, i), xytext=(4, 0), textcoords="offset points", va="center", color=TINTA, fontsize=8)
    a2.set_xlim(0, max(arcos) + 1)
    a2.set_xticks(range(max(arcos) + 2))
    a2.set_xlabel("nº de arcos no caminho")
    _eixos(a2, "x")
    fig.suptitle("Caminhos do Dijkstra nos 5 pares (custo = −log da probabilidade de vitória)", fontsize=11)
    _salvar(plt, fig, destino)


def main() -> None:
    GRAFICOS.mkdir(parents=True, exist_ok=True)
    rel = _ler("partidas_report.json")
    figuras = {
        "tempo_por_algoritmo.png": lambda p: tempo_por_algoritmo(rel, p),
        "tempo_por_tamanho.png": lambda p: tempo_por_tamanho(rel, p),
        "bfs_x_dfs.png": lambda p: bfs_x_dfs(_ler("bfs_dfs.json"), p),
        "caminhos_dijkstra.png": lambda p: caminhos_dijkstra(_ler("dijkstra.json"), p),
    }
    for nome, desenhar in figuras.items():
        desenhar(GRAFICOS / nome)
        print(f"gravado: {GRAFICOS / nome}")


if __name__ == "__main__":
    main()
