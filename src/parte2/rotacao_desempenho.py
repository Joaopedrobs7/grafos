# [IA] Claude – benchmark e escalabilidade dos algoritmos do grupo no grafo de rotação
"""Tempos (média de REPETICOES execuções, time.perf_counter) das tarefas de ``rotacao_casos`` e
escalabilidade com 10%, 50% e 100% dos componentes time × temporada (amostra com semente fixa).

Na escalabilidade, o nó INICIO tem um arco de peso 0 para o jogador principal de cada componente
amostrado, para cada algoritmo partir de uma única fonte. São medidos dois grafos por amostra:
- "completo": todos os arcos dos componentes amostrados (BFS, DFS, Bellman-Ford);
- "recorte_sem_ciclo": recorte "descer na rotação" dos mesmos componentes (BFS, DFS, Bellman-Ford e
  Dijkstra; o Dijkstra roda nos pesos reponderados por Johnson, com os mesmos |V| e |E|).
"""
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
from .rotacao_casos import (ARESTAS, JOGADORES, SAIDA, carregar, carregar_minutos, descendente, dividir,
                            fontes_buscas, fontes_dijkstra, johnson, par_dijkstra, principal)

REPETICOES = 5
FRACOES = (0.1, 0.5, 1.0)
SEMENTE = 42
INICIO = "INICIO"
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
        r = f(g, s)
        tempos.append(time.perf_counter() - t0)
    alcancados = len(r.dist) if r.dist else len(r.ordem)
    return {"V": g.ordem, "E": g.tamanho, "alcancados": alcancados, "tempos_s": tempos,
            "media_s": statistics.fmean(tempos)}


def tarefas(g: Grafo, partes, minutos) -> list[dict]:
    res = []
    for _, _, s in fontes_buscas(partes, minutos):
        res.append({"parte": 2, "algoritmo": "BFS", "grafo": "completo", "tarefa": f"fonte {s}", **cronometrar(bfs, g, s)})
        res.append({"parte": 2, "algoritmo": "DFS", "grafo": "completo", "tarefa": f"fonte {s}", **cronometrar(dfs, g, s)})
    for time_, ano, s in fontes_dijkstra(partes, minutos):
        p = par_dijkstra(partes[(time_, ano)], s, minutos)
        res.append({"parte": 3, "algoritmo": "Dijkstra", "grafo": f"recorte_sem_ciclo {time_}|{ano} (Johnson)",
                    "tarefa": f"{s} -> {p['destino']}", **cronometrar(dijkstra, p["_dag_transformado"], s)})
    for (time_, ano), sub in partes.items():
        s = principal(sub.nos(), minutos)
        res.append({"parte": 4, "algoritmo": "Bellman-Ford", "grafo": f"componente {time_}|{ano}",
                    "tarefa": f"com ciclo, fonte {s}", **cronometrar(bellman_ford, sub, s)})
        res.append({"parte": 4, "algoritmo": "Bellman-Ford", "grafo": f"recorte_sem_ciclo {time_}|{ano}",
                    "tarefa": f"sem ciclo, fonte {s}", **cronometrar(bellman_ford, descendente(sub, minutos), s)})
    return res


def sortear(partes, fracao: float) -> list:
    chaves = list(partes)
    random.Random(SEMENTE).shuffle(chaves)
    return sorted(chaves[:max(1, round(fracao * len(chaves)))], key=lambda c: (c[1], c[0]))


def _unir(componentes: list[tuple], fontes: list) -> Grafo:
    ga = Grafo()
    ga.add_no(INICIO)
    for f in fontes:
        ga.add_arco(INICIO, f, 0.0)
    for c in componentes:
        for v in c.nos():
            ga.add_no(v)
        for a in c.arcos():
            ga.add_arco(a.origem, a.destino, a.peso)
    return ga


def amostras(partes, minutos, fracao: float) -> dict[str, Grafo]:
    chaves = sortear(partes, fracao)
    fontes = [principal(partes[c].nos(), minutos) for c in chaves]
    dags = [descendente(partes[c], minutos) for c in chaves]
    return {
        "completo": _unir([partes[c] for c in chaves], fontes),
        "recorte_sem_ciclo": _unir(dags, fontes),
        "recorte_johnson": _unir([johnson(d)[1] for d in dags], fontes),
        "_componentes": len(chaves),
    }


def escalabilidade(partes, minutos) -> list[dict]:
    res = []
    for fr in FRACOES:
        a = amostras(partes, minutos, fr)
        medir = (("completo", "BFS", bfs, a["completo"]), ("completo", "DFS", dfs, a["completo"]),
                 ("completo", "Bellman-Ford", bellman_ford, a["completo"]),
                 ("recorte_sem_ciclo", "BFS", bfs, a["recorte_sem_ciclo"]),
                 ("recorte_sem_ciclo", "DFS", dfs, a["recorte_sem_ciclo"]),
                 ("recorte_sem_ciclo", "Dijkstra", dijkstra, a["recorte_johnson"]),
                 ("recorte_sem_ciclo", "Bellman-Ford", bellman_ford, a["recorte_sem_ciclo"]))
        for grafo, nome, f, g in medir:
            item = {"amostra": fr, "componentes": a["_componentes"], "grafo": grafo, "algoritmo": nome,
                    "fonte": INICIO, **cronometrar(f, g, INICIO)}
            res.append(item)
            print(f"{fr:4.0%} {grafo:18s} {nome:12s} V={item['V']:5d} E={item['E']:6d} "
                  f"alcançados={item['alcancados']:5d} média={item['media_s'] * 1e3:10.3f} ms")
    return res


def tabela(esc: list[dict]) -> list[dict]:
    linhas = []
    for e in esc:
        nome, valor = COMPLEXIDADE[e["algoritmo"]]
        v = valor(e["V"], e["E"])
        linhas.append({"grafo": e["grafo"], "algoritmo": e["algoritmo"], "amostra": e["amostra"],
                       "V": e["V"], "E": e["E"], "complexidade": nome, "valor_teorico": v,
                       "tempo_medio_s": e["media_s"], "razao_tempo_valor": e["media_s"] / v})
    base = {(l["grafo"], l["algoritmo"]): l for l in linhas if l["amostra"] == FRACOES[0]}
    for l in linhas:
        b = base[(l["grafo"], l["algoritmo"])]
        l["crescimento_tempo"] = l["tempo_medio_s"] / b["tempo_medio_s"]
        l["crescimento_teorico"] = l["valor_teorico"] / b["valor_teorico"]
    return linhas


def main(arestas: Path = ARESTAS, jogadores: Path = JOGADORES, saida: Path = SAIDA) -> None:
    g = carregar(arestas)
    minutos = carregar_minutos(jogadores)
    partes = dividir(g)
    tar = tarefas(g, partes, minutos)
    for alg in ("BFS", "DFS", "Dijkstra", "Bellman-Ford"):
        ts = [t["media_s"] for t in tar if t["algoritmo"] == alg]
        print(f"tarefas {alg:12s} n={len(ts):3d} média das médias={statistics.fmean(ts) * 1e3:9.4f} ms")
    esc = escalabilidade(partes, minutos)
    linhas = tabela(esc)
    for l in linhas:
        print(f"{l['amostra']:4.0%} {l['grafo']:18s} {l['algoritmo']:12s} {l['complexidade']:15s} "
              f"razão={l['razao_tempo_valor']:.3e} crescimento tempo={l['crescimento_tempo']:8.2f}x "
              f"teórico={l['crescimento_teorico']:8.2f}x")
    saida.mkdir(parents=True, exist_ok=True)
    rel = {"grafo": "rotacao", "arestas": str(Path(arestas).name), "repeticoes": REPETICOES, "semente": SEMENTE,
           "fracoes": list(FRACOES), "componentes_total": len(partes), "V": g.ordem, "E": g.tamanho,
           "tarefas": tar, "escalabilidade": esc, "complexidade": linhas}
    (saida / "parte2_report.json").write_text(json.dumps(rel, indent=2, ensure_ascii=False), encoding="utf-8")
    with (saida / "complexidade.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0]))
        w.writeheader()
        w.writerows(linhas)
    print(f"gravado: {saida / 'parte2_report.json'} e {saida / 'complexidade.csv'}")


if __name__ == "__main__":
    main()
