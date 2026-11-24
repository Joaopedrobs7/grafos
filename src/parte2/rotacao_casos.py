# [IA] Claude – casos dos algoritmos do grupo (BFS, DFS, Dijkstra, Bellman-Ford) no grafo de rotação
"""Casos da Parte 2 no grafo de rotação (nó = ``Nome|TIM|ano``, arco X -> Y = Y entrou no lugar de X).

Os algoritmos são os de ``src/graphs/algorithms.py`` (do grupo); este módulo só monta os grafos,
escolhe as fontes por regras fixas e grava os resultados em ``out/parte2/``.

Regras de escolha (determinísticas):
- componente = time × temporada (os arcos nunca ligam componentes diferentes);
- "principal" de um componente = jogador com mais ``minutos_medidos`` (desempate pelo rótulo);
- BFS/DFS: temporadas na 1ª, na do meio ((n-1)//2) e na última posição da lista ordenada; em cada uma,
  o time com mais arcos (desempate pela sigla); fonte = principal desse time-temporada;
- Dijkstra: temporadas nas posições 0, n//4, n//2, 3n//4 e n-1 (mesma regra de ``caminhos.py``),
  time com mais arcos; destino = nó de menor distância original alcançável a partir da fonte;
- Bellman-Ford com ciclo: subgrafo de cada time-temporada, fonte = principal;
- Bellman-Ford sem ciclo: recorte "descer na rotação", só arcos X -> Y com minutos(X) > minutos(Y)
  (desempate pelo rótulo). A ordem (-minutos, rótulo) é total, então o recorte é acíclico.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from ..graphs.algorithms import PesoNegativoError, Resultado, bellman_ford, bfs, custo_ciclo, dfs, dijkstra
from ..graphs.graph import Grafo, No

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "data" / "dataset_parte2" / "rotacao"
ARESTAS = PASTA / "arestas_rotacao.csv"
JOGADORES = PASTA / "jogadores.csv"
SAIDA = RAIZ / "out" / "parte2"
SUPER_FONTE = "JOHNSON"
TOLERANCIA = 1e-9

REGRA_SEM_CICLO = ("em cada time-temporada, só arcos X -> Y com minutos_medidos(X) > minutos_medidos(Y) "
                   "(desempate pelo rótulo): grafo acíclico por construção")
TRANSFORMACAO = (
    "Johnson no recorte sem ciclo: super-fonte com arco de peso 0 para cada nó do recorte; "
    "h(v) = distância do Bellman-Ford do grupo a partir da super-fonte; w'(u,v) = w(u,v) + h(u) - h(v) >= 0 "
    "(valores entre -1e-9 e 0 por arredondamento de ponto flutuante viram 0). "
    "Todo caminho s -> t tem custo' = custo + h(s) - h(t), então os caminhos mínimos são os mesmos; "
    "custo_original = custo' - h(s) + h(t)."
)


# ---------------------------------------------------------------- carga

def carregar(caminho: Path = ARESTAS) -> Grafo:
    g = Grafo()
    with Path(caminho).open(encoding="utf-8", newline="") as f:
        for linha in csv.DictReader(f):
            g.add_arco(linha["origem"], linha["destino"], float(linha["peso"]))
    return g


def carregar_minutos(caminho: Path = JOGADORES) -> dict[No, float]:
    with Path(caminho).open(encoding="utf-8", newline="") as f:
        return {linha["no"]: float(linha["minutos_medidos"] or 0) for linha in csv.DictReader(f)}


def componente(no: No) -> tuple[str, int]:
    """(time, temporada) a partir do rótulo ``Nome|TIM|ano``."""
    _, time, ano = str(no).rsplit("|", 2)
    return time, int(ano)


def temporada(no: No) -> int:
    return componente(no)[1]


def dividir(g: Grafo) -> dict[tuple[str, int], Grafo]:
    """Um subgrafo por time-temporada (mesmo resultado de ``subgrafo_induzido`` em cada componente)."""
    partes: dict[tuple[str, int], Grafo] = {}
    for v in g.nos():
        partes.setdefault(componente(v), Grafo()).add_no(v)
    for a in g.arcos():
        partes[componente(a.origem)].add_arco(a.origem, a.destino, a.peso, a.info)
    return dict(sorted(partes.items(), key=lambda kv: (kv[0][1], kv[0][0])))


def subgrafo_componente(g: Grafo, time: str, ano: int) -> Grafo:
    return g.subgrafo_induzido({v for v in g.nos() if componente(v) == (time, ano)})


def principal(nos, minutos: dict[No, float]) -> No:
    return min(nos, key=lambda v: (-minutos.get(v, 0.0), v))


def time_com_mais_arcos(partes: dict[tuple[str, int], Grafo], ano: int) -> str:
    return min((c for c in partes if c[1] == ano), key=lambda c: (-partes[c].tamanho, c[0]))[0]


def _temporadas(partes) -> list[int]:
    return sorted({ano for _, ano in partes})


# ---------------------------------------------------------------- BFS / DFS

def fontes_buscas(partes, minutos) -> list[tuple[str, int, No]]:
    temps = _temporadas(partes)
    escolhidas = dict.fromkeys((temps[0], temps[(len(temps) - 1) // 2], temps[-1]))
    res = []
    for ano in escolhidas:
        time = time_com_mais_arcos(partes, ano)
        res.append((time, ano, principal(partes[(time, ano)].nos(), minutos)))
    return res


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
            "n_arcos_retorno": len(retorno),
            "arcos_retorno": retorno[:5],  # os 5 primeiros, na ordem em que a DFS os encontrou
        },
    }


def casos_buscas(g: Grafo, partes, minutos) -> list[dict]:
    res = []
    for time, ano, s in fontes_buscas(partes, minutos):
        res.append({"temporada": ano, "time": time, "fonte": s, "minutos_fonte": minutos.get(s),
                    "nos_componente": partes[(time, ano)].ordem, "arcos_componente": partes[(time, ano)].tamanho,
                    **buscar(g, s)})
    return res


# ---------------------------------------------------------------- Bellman-Ford com ciclo

def com_ciclo(partes, minutos) -> list[dict]:
    res = []
    for (time, ano), sub in partes.items():
        s = principal(sub.nos(), minutos)
        r = bellman_ford(sub, s)
        res.append({
            "temporada": ano, "time": time, "fonte": s, "nos": sub.ordem, "arcos": sub.tamanho,
            "arcos_negativos": sum(a.peso < 0 for a in sub.arcos()), "status": r.status,
            "ciclo_negativo": r.ciclo_negativo,
            "n_arcos_ciclo": len(r.ciclo_negativo) - 1 if r.ciclo_negativo else None,
            "custo_ciclo": custo_ciclo(sub, r.ciclo_negativo) if r.ciclo_negativo else None,
        })
    return res


# ---------------------------------------------------------------- recorte sem ciclo

def descendente(sub: Grafo, minutos: dict[No, float]) -> Grafo:
    """Recorte "descer na rotação": só arcos de quem tem mais minutos para quem tem menos."""
    chave = {v: (-minutos.get(v, 0.0), v) for v in sub.nos()}
    dag = Grafo()
    for v in sorted(chave, key=chave.get):
        dag.add_no(v)
    for a in sub.arcos():
        if chave[a.origem] < chave[a.destino]:
            dag.add_arco(a.origem, a.destino, a.peso, a.info)
    return dag


def _menor_destino(r: Resultado, s: No) -> No | None:
    outros = [v for v in r.dist if v != s]
    return min(outros, key=lambda v: (r.dist[v], v)) if outros else None


def sem_ciclo(partes, minutos) -> list[dict]:
    res = []
    for (time, ano), sub in partes.items():
        dag = descendente(sub, minutos)
        s = principal(dag.nos(), minutos)
        r = bellman_ford(dag, s)
        alvo = _menor_destino(r, s)
        cam = r.caminho_ate(alvo) if alvo is not None else [s]
        res.append({
            "temporada": ano, "time": time, "fonte": s, "nos": dag.ordem, "arcos": dag.tamanho,
            "arcos_negativos": sum(a.peso < 0 for a in dag.arcos()), "alcancados": len(r.dist),
            "status": r.status, "ciclo_negativo": r.ciclo_negativo,
            "destino": alvo, "caminho": cam, "n_arcos": len(cam) - 1,
            "custo": r.dist[alvo] if alvo is not None else 0.0,
        })
    return res


# ---------------------------------------------------------------- Dijkstra com Johnson

def johnson(dag: Grafo) -> tuple[dict[No, float], Grafo]:
    """Potencial h (Bellman-Ford do grupo a partir de uma super-fonte) e o grafo com pesos reponderados."""
    aux = Grafo()
    aux.add_no(SUPER_FONTE)
    for v in dag.nos():
        aux.add_arco(SUPER_FONTE, v, 0.0)
    for a in dag.arcos():
        aux.add_arco(a.origem, a.destino, a.peso)
    r = bellman_ford(aux, SUPER_FONTE)
    if r.status != "OK":
        raise ValueError("Johnson exige grafo sem ciclo negativo")
    h = {v: r.dist[v] for v in dag.nos()}
    t = Grafo()
    for v in dag.nos():
        t.add_no(v)
    for a in dag.arcos():
        w = a.peso + h[a.origem] - h[a.destino]
        t.add_arco(a.origem, a.destino, 0.0 if -TOLERANCIA < w < 0 else w, a.info)
    return h, t


def fontes_dijkstra(partes, minutos) -> list[tuple[str, int, No]]:
    temps = _temporadas(partes)
    n = len(temps)
    res = []
    for ano in dict.fromkeys(temps[i] for i in (0, n // 4, n // 2, 3 * n // 4, n - 1)):
        time = time_com_mais_arcos(partes, ano)
        res.append((time, ano, principal(partes[(time, ano)].nos(), minutos)))
    return res


def par_dijkstra(sub: Grafo, s: No, minutos) -> dict:
    dag = descendente(sub, minutos)
    rb = bellman_ford(dag, s)
    alvo = _menor_destino(rb, s)
    h, t = johnson(dag)
    rd = dijkstra(t, s)
    cam_d, cam_b = rd.caminho_ate(alvo), rb.caminho_ate(alvo)
    reconv = rd.dist[alvo] - h[s] + h[alvo]
    return {
        "destino": alvo, "nos_recorte": dag.ordem, "arcos_recorte": dag.tamanho,
        "arcos_negativos_recorte": sum(a.peso < 0 for a in dag.arcos()),
        "h_origem": h[s], "h_destino": h[alvo],
        "caminho_dijkstra": cam_d, "caminho_bellman_ford": cam_b, "n_arcos": len(cam_d) - 1,
        "custo_transformado": rd.dist[alvo], "custo_original_reconvertido": reconv,
        "custo_original_somado": custo_ciclo(dag, cam_d), "custo_bellman_ford": rb.dist[alvo],
        "caminho_igual": cam_d == cam_b, "custo_igual": abs(reconv - rb.dist[alvo]) < 1e-6,
        "_dag_transformado": t,
    }


def casos_dijkstra(g: Grafo, partes, minutos) -> dict:
    escolhidos = fontes_dijkstra(partes, minutos)
    try:
        dijkstra(g, escolhidos[0][2])
        recusa = None
    except PesoNegativoError as e:
        recusa = str(e)
    pares = []
    for time, ano, s in escolhidos:
        item = {"temporada": ano, "time": time, "origem": s, **par_dijkstra(partes[(time, ano)], s, minutos)}
        item.pop("_dag_transformado")
        pares.append(item)
    return {"transformacao": TRANSFORMACAO, "regra_recorte": REGRA_SEM_CICLO,
            "recusa_pesos_originais": recusa, "pares": pares}


# ---------------------------------------------------------------- main

def _gravar(saida: Path, nome: str, dados) -> None:
    saida.mkdir(parents=True, exist_ok=True)
    (saida / nome).write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"gravado: {saida / nome}")


def main(arestas: Path = ARESTAS, jogadores: Path = JOGADORES, saida: Path = SAIDA) -> None:
    g = carregar(arestas)
    minutos = carregar_minutos(jogadores)
    partes = dividir(g)
    print(f"grafo de rotação: |V|={g.ordem} |E|={g.tamanho} componentes (time × temporada)={len(partes)}")

    buscas = casos_buscas(g, partes, minutos)
    for e in buscas:
        b, d = e["BFS"], e["DFS"]
        print(f"{e['fonte']}: BFS visitados={len(b['ordem'])} nós por camada={[len(c) for c in b['camadas']]}")
        print(f"   DFS visitados={len(d['ordem'])} profundidade máx={len(d['profundidades']) - 1} "
              f"classes={d['classes']} tem_ciclo={d['tem_ciclo']}")
    _gravar(saida, "bfs_dfs.json", {"grafo": "rotacao", "fontes": buscas})

    cc = com_ciclo(partes, minutos)
    sc = sem_ciclo(partes, minutos)
    n_ciclo = sum(e["status"] == "CICLO_NEGATIVO" for e in cc)
    print(f"Bellman-Ford com ciclo: {n_ciclo} de {len(cc)} time-temporadas com ciclo negativo alcançável da fonte")
    print(f"Bellman-Ford sem ciclo: status OK em {sum(e['status'] == 'OK' for e in sc)} de {len(sc)}")
    _gravar(saida, "bellman_ford.json", {
        "grafo": "rotacao",
        "com_ciclo": {"regra": "subgrafo de cada time-temporada, fonte = jogador com mais minutos_medidos",
                      "total": len(cc), "com_ciclo_negativo": n_ciclo, "componentes": cc},
        "sem_ciclo": {"regra": REGRA_SEM_CICLO, "total": len(sc),
                      "status_ok": sum(e["status"] == "OK" for e in sc), "componentes": sc},
    })

    dj = casos_dijkstra(g, partes, minutos)
    print(f"Dijkstra com pesos originais: {dj['recusa_pesos_originais']}")
    for p in dj["pares"]:
        print(f"{p['temporada']} {p['time']}: {p['origem']} -> {p['destino']} arcos={p['n_arcos']} "
              f"custo'={p['custo_transformado']:.4f} reconvertido={p['custo_original_reconvertido']:.4f} "
              f"BF={p['custo_bellman_ford']:.4f} caminho_igual={p['caminho_igual']}")
    _gravar(saida, "dijkstra.json", {"grafo": "rotacao", **dj})


if __name__ == "__main__":
    main()
