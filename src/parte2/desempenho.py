from __future__ import annotations

import csv
import json
import math
import random
import statistics
import time
from pathlib import Path

from ..graphs.algorithms import bellman_ford, bfs, dfs, dijkstra
from ..graphs.graph import Grafo
from .bellman import recorte_par, subgrafo_temporada
from .buscas import ARESTAS, SAIDA, carregar, fontes, maior_grau_saida, temporada
from .caminhos import pares, transformar

REPETICOES = 5
FRACOES = (0.1, 0.5, 1.0)
SEMENTE = 42
COMPLEXIDADE = {
    "BFS": ("O(V+E)", lambda v, e: v + e),
    "DFS": ("O(V+E)", lambda v, e: v + e),
    "Dijkstra": ("O((V+E)·log V)", lambda v, e: (v + e) * math.log2(v)),
    "Bellman-Ford": ("O(V·E)", lambda v, e: v * e),
}


def cronometrar(f, g: Grafo, s) -> dict:
    tempos = []
    for _ in range(REPETICOES):
        t0 = time.perf_counter()
        f(g, s)
        tempos.append(time.perf_counter() - t0)
    return {"V": g.ordem, "E": g.tamanho, "tempos_s": tempos, "media_s": statistics.fmean(tempos)}


def tarefas(g: Grafo) -> list[dict]:
    res = []
    for _, s in fontes(g):
        res.append({"parte": 2, "algoritmo": "BFS", "tarefa": f"fonte {s}", **cronometrar(bfs, g, s)})
        res.append({"parte": 2, "algoritmo": "DFS", "tarefa": f"fonte {s}", **cronometrar(dfs, g, s)})
    h, _ = transformar(g)
    for _, s, alvo, _ in pares(g, h):
        res.append({"parte": 3, "algoritmo": "Dijkstra", "tarefa": f"{s} -> {alvo}", **cronometrar(dijkstra, h, s)})
    graus = g.graus()
    for t in sorted({temporada(v) for v in graus}):
        s = maior_grau_saida(graus, t)
        res.append({"parte": 4, "algoritmo": "Bellman-Ford", "tarefa": f"temporada {t} fonte {s}",
                    **cronometrar(bellman_ford, subgrafo_temporada(g, t), s)})
    par = recorte_par(g)
    res.append({"parte": 4, "algoritmo": "Bellman-Ford", "tarefa": f"recorte {par['nos'][0]} <-> {par['nos'][1]}",
                **cronometrar(bellman_ford, g.subgrafo_induzido(set(par["nos"])), par["fonte"])})
    return res


def amostra(g: Grafo, fracao: float) -> Grafo:
    arcos = list(g.arcos())
    ga = Grafo()
    for i in sorted(random.Random(SEMENTE).sample(range(len(arcos)), round(fracao * len(arcos)))):
        ga.add_arco(arcos[i].origem, arcos[i].destino, arcos[i].peso)
    return ga


def escalabilidade(g: Grafo) -> list[dict]:
    res = []
    for fr in FRACOES:
        ga = amostra(g, fr)
        s = fontes(ga)[0][1]
        ha, _ = transformar(ga)
        for nome, f, grafo in (("BFS", bfs, ga), ("DFS", dfs, ga), ("Dijkstra", dijkstra, ha), ("Bellman-Ford", bellman_ford, ga)):
            res.append({"amostra": fr, "algoritmo": nome, "fonte": s, **cronometrar(f, grafo, s)})
    return res


def tabela(esc: list[dict]) -> list[dict]:
    linhas = []
    for e in esc:
        nome, valor = COMPLEXIDADE[e["algoritmo"]]
        v = valor(e["V"], e["E"])
        linhas.append({"algoritmo": e["algoritmo"], "amostra": e["amostra"], "V": e["V"], "E": e["E"], "complexidade": nome,
                       "valor_teorico": v, "tempo_medio_s": e["media_s"], "razao_tempo_valor": e["media_s"] / v})
    return linhas


def main(caminho: Path = ARESTAS, saida: Path = SAIDA) -> None:
    g = carregar(caminho)
    tar = tarefas(g)
    for t in tar:
        print(f"P{t['parte']} {t['algoritmo']:12s} {t['tarefa']:34s} V={t['V']:4d} E={t['E']:6d} média={t['media_s'] * 1e3:9.3f} ms")
    esc = escalabilidade(g)
    linhas = tabela(esc)
    for l in linhas:
        print(f"{l['amostra']:4.0%} {l['algoritmo']:12s} V={l['V']:4d} E={l['E']:6d} média={l['tempo_medio_s'] * 1e3:10.3f} ms "
              f"{l['complexidade']:15s} valor={l['valor_teorico']:14.1f} razão={l['razao_tempo_valor']:.3e}")
    saida.mkdir(parents=True, exist_ok=True)
    rel = {"repeticoes": REPETICOES, "semente": SEMENTE, "tarefas": tar, "escalabilidade": esc}
    (saida / "parte2_report.json").write_text(json.dumps(rel, indent=2, ensure_ascii=False), encoding="utf-8")
    with (saida / "complexidade.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0]))
        w.writeheader()
        w.writerows(linhas)
    print(f"gravado: {saida / 'parte2_report.json'} e {saida / 'complexidade.csv'}")


if __name__ == "__main__":
    main()
