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


# [IA] Claude – recorte sem ciclo: só arcos do time melhor classificado para o pior (grafo acíclico).
# Saldo total do time = soma dos pesos dos arcos de saída (peso = saldo médio contra cada adversário).
def hierarquia(g: Grafo, t: int) -> tuple[Grafo, str]:
    sub = subgrafo_temporada(g, t)
    saldo = {v: sum(a.peso for a in sub.vizinhos(v)) for v in sub.nos()}
    posicao = {v: i for i, v in enumerate(sorted(saldo, key=lambda v: (-saldo[v], v)))}
    dag = Grafo()
    for v in sorted(posicao, key=posicao.get):
        dag.add_no(v)
    for a in sub.arcos():
        if posicao[a.origem] < posicao[a.destino]:
            dag.add_arco(a.origem, a.destino, a.peso)
    return dag, min(posicao, key=posicao.get)


def sem_ciclo_por_temporada(g: Grafo) -> list[dict]:
    res = []
    for t in sorted({temporada(v) for v in g.nos()}):
        dag, s = hierarquia(g, t)
        r = bellman_ford(dag, s)
        alvo = min(r.dist, key=lambda v: (r.dist[v], v))
        cam = r.caminho_ate(alvo)
        res.append({
            "temporada": t, "fonte": s, "nos": dag.ordem, "arcos": dag.tamanho,
            "arcos_negativos": sum(a.peso < 0 for a in dag.arcos()),
            "arcos_positivos": sum(a.peso > 0 for a in dag.arcos()),
            "status": r.status, "ciclo_negativo": r.ciclo_negativo,
            "destino": alvo, "caminho": cam, "n_arcos": len(cam) - 1, "custo": r.dist[alvo],
        })
    return res


def main() -> None:
    g = carregar()
    temporadas = por_temporada(g)
    for e in temporadas:
        print(f"{e['temporada']} fonte={e['fonte']} |V|={e['nos']} |E|={e['arcos']} status={e['status']}")
        if e["ciclo_negativo"]:
            print(f"     ciclo ({len(e['ciclo_negativo']) - 1} arcos, custo {e['custo_ciclo']:.4f}): {' -> '.join(e['ciclo_negativo'])}")
    recorte = sem_ciclo_por_temporada(g)
    for e in recorte:
        print(f"{e['temporada']} hierarquia: |V|={e['nos']} |E|={e['arcos']} negativos={e['arcos_negativos']} "
              f"status={e['status']} menor custo={e['custo']:.2f} em {e['n_arcos']} arcos")
    if any(e["status"] != "OK" for e in recorte):
        print("ATENÇÃO: recorte devolveu ciclo")
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / "bellman_ford.json").write_text(
        json.dumps({"temporadas": temporadas, "recorte_sem_ciclo": {
            "regra": "em cada temporada, só arcos do time com maior saldo para o de menor saldo (grafo acíclico)",
            "temporadas": recorte}}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"gravado: {SAIDA / 'bellman_ford.json'}")


if __name__ == "__main__":
    main()
