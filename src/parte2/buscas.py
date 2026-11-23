from __future__ import annotations

import csv
import json
from pathlib import Path

from ..graphs.algorithms import Resultado, bfs, dfs
from ..graphs.graph import Grafo, No

RAIZ = Path(__file__).resolve().parents[2]
ARESTAS = RAIZ / "data" / "dataset_parte2" / "arestas.csv"
SAIDA = RAIZ / "out" / "parte2"


def carregar(caminho: Path = ARESTAS) -> Grafo:
    g = Grafo()
    with caminho.open(encoding="utf-8", newline="") as f:
        for linha in csv.DictReader(f):
            g.add_arco(linha["origem"], linha["destino"], float(linha["peso"]))
    return g


def temporada(no: No) -> int:
    return int(str(no).rsplit("|", 1)[1])


def fontes(g: Grafo) -> list[tuple[int, No]]:
    graus = g.graus()
    temps = sorted({temporada(v) for v in graus})
    escolhidas = dict.fromkeys((temps[0], temps[len(temps) // 2], temps[-1]))
    return [(t, min((v for v in graus if temporada(v) == t), key=lambda v: (-graus[v][1], v))) for t in escolhidas]


def buscar(g: Grafo, s: No) -> dict:
    rb, rd = bfs(g, s), dfs(g, s)
    prof = {s: 0}
    for v in rd.ordem[1:]:
        prof[v] = prof[rd.pai[v]] + 1
    retorno = []
    for u, v, tipo in rd.arcos:
        if tipo == "retorno":
            cam = rd.caminho_ate(u)
            retorno.append({"arco": [u, v], "ciclo": cam[cam.index(v):] + [v]})
    return {
        "BFS": {"ordem": rb.ordem, "camadas": rb.niveis()},
        "DFS": {
            "ordem": rd.ordem,
            "profundidades": Resultado(dist=prof, ordem=rd.ordem).niveis(),
            "classes": rd.classes,
            "tem_ciclo": rd.tem_ciclo,
            "arcos_retorno": retorno,
        },
    }


def main() -> None:
    g = carregar()
    graus = g.graus()
    saida = []
    for t, s in fontes(g):
        r = buscar(g, s)
        saida.append({"temporada": t, "fonte": s, "grau_saida": graus[s][1], **r})
        b, d = r["BFS"], r["DFS"]
        print(f"{s}: grau_saida={graus[s][1]}  BFS visitados={len(b['ordem'])} nós por camada={[len(c) for c in b['camadas']]}")
        print(f"{' ' * len(s)}  DFS visitados={len(d['ordem'])} profundidade máx={len(d['profundidades']) - 1} "
              f"classes={d['classes']} tem_ciclo={d['tem_ciclo']}")
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / "bfs_dfs.json").write_text(json.dumps(saida, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"gravado: {SAIDA / 'bfs_dfs.json'}")


if __name__ == "__main__":
    main()
