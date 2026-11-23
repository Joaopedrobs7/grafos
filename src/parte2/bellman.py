from __future__ import annotations

import json

from ..graphs.algorithms import bellman_ford, custo_ciclo
from ..graphs.graph import Grafo
from .buscas import SAIDA, carregar, maior_grau_saida, temporada


def subgrafo_temporada(g: Grafo, t: int) -> Grafo:
    return g.subgrafo_induzido({v for v in g.nos() if temporada(v) == t})


def por_temporada(g: Grafo) -> list[dict]:
    graus = g.graus()
    res = []
    for t in sorted({temporada(v) for v in graus}):
        sub = subgrafo_temporada(g, t)
        s = maior_grau_saida(graus, t)
        r = bellman_ford(sub, s)
        res.append({
            "temporada": t, "fonte": s, "nos": sub.ordem, "arcos": sub.tamanho, "status": r.status,
            "ciclo_negativo": r.ciclo_negativo,
            "custo_ciclo": custo_ciclo(sub, r.ciclo_negativo) if r.ciclo_negativo else None,
        })
    return res


def recorte_par(g: Grafo) -> dict:
    graus = g.graus()
    t = min(temporada(v) for v in graus)
    a = maior_grau_saida(graus, t)
    b = next(x.destino for x in g.vizinhos(a) if x.peso != 0)
    sub = g.subgrafo_induzido({a, b})
    r = bellman_ford(sub, a)
    return {
        "temporada": t, "fonte": a, "nos": [a, b],
        "arcos": [[x.origem, x.destino, x.peso] for x in sub.arcos()],
        "custo_ciclo_ida_volta": custo_ciclo(sub, [a, b, a]),
        "status": r.status, "ciclo_negativo": r.ciclo_negativo,
    }


def main() -> None:
    g = carregar()
    temporadas = por_temporada(g)
    for e in temporadas:
        print(f"{e['temporada']} fonte={e['fonte']} |V|={e['nos']} |E|={e['arcos']} status={e['status']}")
        if e["ciclo_negativo"]:
            print(f"     ciclo ({len(e['ciclo_negativo']) - 1} arcos, custo {e['custo_ciclo']:.4f}): {' -> '.join(e['ciclo_negativo'])}")
    par = recorte_par(g)
    print(f"recorte {par['nos'][0]} <-> {par['nos'][1]}: arcos={par['arcos']} "
          f"custo ida e volta={par['custo_ciclo_ida_volta']} status={par['status']} ciclo={par['ciclo_negativo']}")
    print("sem ciclo negativo" if par["status"] == "OK" and par["ciclo_negativo"] is None else "ATENÇÃO: recorte devolveu ciclo")
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / "bellman_ford.json").write_text(
        json.dumps({"temporadas": temporadas, "recorte_sem_ciclo": par}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"gravado: {SAIDA / 'bellman_ford.json'}")


if __name__ == "__main__":
    main()
