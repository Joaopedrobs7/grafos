# [IA] Claude – gráficos de comparação dos algoritmos no grafo de rotação (mesmos tipos e paleta de graficos.py)
from __future__ import annotations

import json
import statistics
from pathlib import Path

from ..viz import _plt
from .rotacao_casos import SAIDA

GRAFICOS = SAIDA / "graficos"
# mesma paleta e mesmos eixos de src/parte2/graficos.py
CORES = {"BFS": "#2a78d6", "DFS": "#eb6834", "Dijkstra": "#1baf7a", "Bellman-Ford": "#eda100"}
CINZA = "#a3a29c"
TINTA = "#0b0b0b"
TINTA_2 = "#52514e"
GRADE = "#e6e5e1"
GRAFO_TAREFA = {"BFS": "grafo inteiro", "DFS": "grafo inteiro",
                "Dijkstra": "recorte sem ciclo (Johnson)", "Bellman-Ford": "time-temporada e recorte"}


def _ler(saida: Path, nome: str):
    return json.loads((saida / nome).read_text(encoding="utf-8"))


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
        rotulos.append(f"{alg}\n{len(tarefas)} tarefas, {GRAFO_TAREFA[alg]}")
    ax.set_xscale("log")
    ax.set_yticks(range(len(CORES)), rotulos)
    ax.set_ylim(len(CORES) - 0.5, -0.6)
    ax.set_xlabel("tempo médio por execução (ms, escala log)")
    _eixos(ax, "x")
    ax.legend(handles=[
        Line2D([0], [0], marker="o", lw=0, color=CINZA, alpha=0.6, markersize=6,
               label=f"uma tarefa (média de {rel['repeticoes']} execuções)"),
        Line2D([0], [0], marker="o", lw=0, color=TINTA_2, markersize=10, label="média do algoritmo"),
    ], loc="upper right", fontsize=8, frameon=False)
    ax.set_title(f"Grafo de rotação: tempo médio por algoritmo nas tarefas das partes 2–4 "
                 f"({rel['repeticoes']} execuções cada)", fontsize=11)
    _salvar(plt, fig, destino)


def tempo_por_tamanho(rel: dict, destino: Path) -> None:
    plt = _plt()
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(14, 5.2))
    estilos = {"recorte_sem_ciclo": ("-o", "recorte sem ciclo"), "completo": ("--s", "grafo completo")}
    for grafo, (marca, nome) in estilos.items():
        for alg in CORES:
            pts = sorted((e["E"], e["media_s"] * 1e3) for e in rel["escalabilidade"]
                         if e["algoritmo"] == alg and e["grafo"] == grafo)
            if not pts:
                continue
            x, y = zip(*pts)
            a1.plot(x, y, marca, color=CORES[alg], lw=2, markersize=6, label=f"{alg} ({nome})")
            a1.annotate(f"{y[-1]:.3g} ms" if y[-1] < 1000 else f"{y[-1]:.0f} ms", (x[-1], y[-1]), xytext=(6, 0),
                        textcoords="offset points", va="center", color=TINTA, fontsize=8)
            lin = sorted((l["amostra"], l["crescimento_tempo"], l["crescimento_teorico"]) for l in rel["complexidade"]
                         if l["algoritmo"] == alg and l["grafo"] == grafo)
            fr, cresc, _ = zip(*lin)
            a2.plot([f"{f:.0%}" for f in fr], cresc, marca, color=CORES[alg], lw=2, markersize=6, label=f"{alg} ({nome})")
    teor = {}
    for l in rel["complexidade"]:
        if l["grafo"] == "recorte_sem_ciclo":
            teor.setdefault(l["complexidade"], []).append((l["amostra"], l["crescimento_teorico"]))
    for nome, pts in teor.items():
        fr, c = zip(*sorted(set(pts)))
        a2.plot([f"{f:.0%}" for f in fr], c, ":", color=CINZA, lw=1.5)
        a2.annotate(f"teórico {nome}", (len(fr) - 1, c[-1]), xytext=(6, 0), textcoords="offset points",
                    va="center", color=TINTA_2, fontsize=8)
    a1.set_xscale("log")
    a1.set_yscale("log")
    a1.set_xlabel("|E| da amostra (escala log; 10%, 50% e 100% dos time-temporadas, semente 42)")
    a1.set_ylabel("tempo médio (ms, escala log)")
    a1.set_title("Tempo × tamanho do grafo (fonte virtual INICIO)", fontsize=10)
    a1.legend(loc="upper left", fontsize=7, frameon=False)
    _eixos(a1)
    a2.set_yscale("log")
    a2.set_xlabel("amostra (fração dos time-temporadas)")
    a2.set_ylabel("crescimento em relação à amostra de 10% (escala log)")
    a2.set_title("Crescimento do tempo medido × crescimento da complexidade teórica (pontilhado)", fontsize=10)
    a2.margins(x=0.25)
    _eixos(a2)
    fig.suptitle("Grafo de rotação: escalabilidade dos quatro algoritmos", fontsize=11)
    _salvar(plt, fig, destino)


def bfs_x_dfs(dados: dict, destino: Path) -> None:
    plt = _plt()
    from matplotlib.ticker import MaxNLocator
    fontes = dados["fontes"]
    fig, axs = plt.subplots(1, len(fontes), figsize=(14, 4.4), sharey=True)
    for ax, e in zip(axs, fontes):
        b = [len(c) for c in e["BFS"]["camadas"]]
        d = [len(c) for c in e["DFS"]["profundidades"]]
        ax.bar([i - 0.2 for i in range(len(b))], b, width=0.4, color=CORES["BFS"], label="BFS: nós por camada (distância em arcos)")
        ax.bar([i + 0.2 for i in range(len(d))], d, width=0.4, color=CORES["DFS"], label="DFS: nós por profundidade na árvore")
        for i, n in enumerate(b):
            ax.annotate(str(n), (i - 0.2, n), xytext=(0, 3), textcoords="offset points", ha="center", color=TINTA, fontsize=8)
        cl = e["DFS"]["classes"]
        ax.annotate(f"DFS: profundidade máx. {len(d) - 1}\nretorno={cl['retorno']} avanço={cl['avanco']} "
                    f"cruzamento={cl['cruzamento']}", (0.98, 0.95), xycoords="axes fraction", ha="right", va="top",
                    color=TINTA, fontsize=8)
        ax.set_title(f"fonte {e['fonte']}\n({len(e['BFS']['ordem'])} nós alcançados)", fontsize=9)
        ax.set_xlabel("camada (BFS) / profundidade (DFS)")
        ax.xaxis.set_major_locator(MaxNLocator(integer=True))
        _eixos(ax, "y")
    axs[0].set_ylabel("número de nós")
    handles, labels = axs[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=2, fontsize=9, frameon=False)
    fig.suptitle("Grafo de rotação: BFS × DFS nas 3 fontes (nós por camada e por profundidade)", fontsize=11)
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def caminhos_dijkstra(d: dict, destino: Path) -> None:
    plt = _plt()
    pares = d["pares"]
    y = range(len(pares))
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.8), sharey=True, gridspec_kw={"width_ratios": [3, 1]})
    series = ((-0.27, "custo_transformado", CINZA, "Dijkstra: custo com pesos de Johnson (w')"),
              (0.0, "custo_original_reconvertido", CORES["Dijkstra"], "Dijkstra: custo reconvertido (w' − h(s) + h(t))"),
              (0.27, "custo_bellman_ford", CORES["Bellman-Ford"], "Bellman-Ford: custo no recorte sem ciclo"))
    for desloc, chave, cor, rotulo in series:
        vals = [p[chave] for p in pares]
        a1.barh([i + desloc for i in y], vals, height=0.26, color=cor, label=rotulo)
        for i, v in zip(y, vals):
            a1.annotate(f"{v:.2f}", (v, i + desloc), xytext=(4 if v >= 0 else -4, 0), textcoords="offset points",
                        ha="left" if v >= 0 else "right", va="center", color=TINTA, fontsize=7)
    a1.axvline(0, color=TINTA_2, lw=0.8)
    a1.margins(x=0.15)
    a1.set_yticks(list(y), [f"{p['temporada']}: {p['origem']}\n→ {p['destino']}" for p in pares], fontsize=8)
    a1.invert_yaxis()
    a1.set_xlabel("custo do caminho (soma dos pesos)")
    a1.legend(loc="lower center", bbox_to_anchor=(0.5, -0.38), ncol=2, fontsize=8, frameon=False)
    _eixos(a1, "x")
    largura = 0.38
    arcos_d = [len(p["caminho_dijkstra"]) - 1 for p in pares]
    arcos_b = [len(p["caminho_bellman_ford"]) - 1 for p in pares]
    a2.barh([i - largura / 2 for i in y], arcos_d, height=largura, color=CORES["Dijkstra"], label="Dijkstra")
    a2.barh([i + largura / 2 for i in y], arcos_b, height=largura, color=CORES["Bellman-Ford"], label="Bellman-Ford")
    for i, (nd, nb, p) in enumerate(zip(arcos_d, arcos_b, pares)):
        a2.annotate(f"{nd} | {nb} {'(mesmo caminho)' if p['caminho_igual'] else '(caminhos diferentes)'}",
                    (max(nd, nb), i), xytext=(4, 0), textcoords="offset points", va="center", color=TINTA, fontsize=7)
    a2.set_xlim(0, max(arcos_d + arcos_b) * 2.2)
    a2.set_xlabel("nº de arcos no caminho")
    a2.legend(loc="lower center", bbox_to_anchor=(0.5, -0.38), ncol=2, fontsize=8, frameon=False)
    _eixos(a2, "x")
    fig.suptitle("Grafo de rotação: caminhos do Dijkstra (pesos de Johnson) × Bellman-Ford nos 5 pares", fontsize=11)
    _salvar(plt, fig, destino)


def main(saida: Path = SAIDA) -> None:
    graficos = saida / "graficos"
    graficos.mkdir(parents=True, exist_ok=True)
    rel = _ler(saida, "parte2_report.json")
    figuras = {
        "tempo_por_algoritmo.png": lambda p: tempo_por_algoritmo(rel, p),
        "tempo_por_tamanho.png": lambda p: tempo_por_tamanho(rel, p),
        "bfs_x_dfs.png": lambda p: bfs_x_dfs(_ler(saida, "bfs_dfs.json"), p),
        "caminhos_dijkstra.png": lambda p: caminhos_dijkstra(_ler(saida, "dijkstra.json"), p),
    }
    for nome, desenhar in figuras.items():
        desenhar(graficos / nome)
        print(f"gravado: {graficos / nome}")


if __name__ == "__main__":
    main()
