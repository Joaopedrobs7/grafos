# [IA] Claude – cola de visualização: serializa o grafo de estados e a trilha de eventos dos algoritmos
"""Traço (trilha de eventos) de um algoritmo do grupo, em JSON compacto para o front.

Este módulo NÃO tem lógica de grafo nem de algoritmo. Ele só:
  1. monta o G_est com `grafo_estados` (src/graphs/estados.py);
  2. roda a função do grupo (bfs, dfs, dijkstra ou bellman_ford de src/graphs/algorithms.py)
     passando um `observador`, que anota cada evento que o algoritmo emite;
  3. troca cada nó pelo seu índice em `ge.grafo.nos()` e devolve tudo em listas
     (sem dicionários verbosos), para o m08 continuar pequeno.

O navegador só reproduz esses eventos (tabelas da aula, cores dos nós); ele não calcula nada.

Formato devolvido por `traco(...)`:
  {"algoritmo", "fonteConsumivel",
   "grafo": {"rotulos", "estados": [[r, c, chaves, [bônus]] | None (ALVO)],
             "adj": [[[para, peso, mov, casa], ...] por nó], "inicio", "alvo", "nEstados", "nArcos"},
   "resultado": {...}, "eventos": [{"t": ..., ...}, ...]}
Infinito vira None (JSON não tem Infinity); na BFS, distância desconhecida = -1; pai inexistente = -1.
"""
from __future__ import annotations

import json

from .graphs.algorithms import INF, PesoNegativoError, bellman_ford, bfs, dfs, dijkstra
from .graphs.estados import ALVO, grafo_estados, rotulo
from .graphs.io import Mapa

ALGORITMOS_TRACO = ("BFS", "DFS", "DIJKSTRA", "BELLMAN_FORD")
_CAMPOS_NO = ("u", "v", "p")  # campos dos eventos que guardam um nó


def _num(x):
    """Distância/custo para JSON: infinito vira None; inteiros ficam inteiros."""
    if x is None or x == INF:
        return None
    return int(x) if float(x).is_integer() else x


def _grafo_json(ge, idx: dict) -> dict:
    nos = ge.grafo.nos()
    return {
        "rotulos": [rotulo(v) for v in nos],
        "estados": [None if v == ALVO else [v[0], v[1], v[2], list(v[3])] for v in nos],
        "adj": [[[idx[a.destino], _num(a.peso), a.info[0], a.info[1]] for a in ge.grafo.vizinhos(v)] for v in nos],
        "inicio": idx[ge.inicio],
        "alvo": idx[ALVO],
        "nEstados": len(nos) - 1,
        "nArcos": ge.sem_alvo.tamanho,
    }


def _observador(idx: dict, eventos: list):
    """Anota os eventos com os nós trocados por índices. Para o Bellman-Ford também conta os
    relaxamentos de cada passada (o algoritmo só avisa início e fim da passada): `mudou` = houve
    relaxamento nela. Isso é contagem de eventos, não lógica do algoritmo."""
    contagem = {"k": 0, "relaxados": 0}

    def anotar(ev: dict) -> None:
        ev = dict(ev)
        for campo in _CAMPOS_NO:
            if campo in ev:
                ev[campo] = -1 if ev[campo] is None else idx[ev[campo]]
        for campo in ("d", "antes", "depois"):
            if campo in ev:
                ev[campo] = _num(ev[campo])
        t = ev["t"]
        if t == "passada":
            contagem["k"] += 1
            contagem["relaxados"] = 0
            ev["k"] = contagem["k"]
        elif t == "fimPassada":
            ev = {"t": t, "k": contagem["k"], "mudou": contagem["relaxados"] > 0, "relaxados": contagem["relaxados"]}
        elif t == "relaxa":
            contagem["relaxados"] += 1
        elif t == "ciclo":
            ev = {"t": t, "ciclo": [idx[x] for x in ev["ciclo"]], "u": ev["u"], "v": ev["v"]}
        eventos.append(ev)

    return anotar


def _vetor(dic: dict, idx: dict, n: int, vazio, conv=lambda x: x) -> list:
    out = [vazio] * n
    for v, x in dic.items():
        out[idx[v]] = vazio if x is None else conv(x)
    return out


def traco(mapa: Mapa, alg: str, fonte_consumivel: bool = False) -> dict:
    alg = alg.upper()
    if alg == "BELLMAN_FORD_FONTE_CONSUMIVEL":
        alg, fonte_consumivel = "BELLMAN_FORD", True
    if alg not in ALGORITMOS_TRACO:
        raise ValueError(f"Algoritmo desconhecido: {alg} (use {', '.join(ALGORITMOS_TRACO)})")
    ge = grafo_estados(mapa, fonte_consumivel=fonte_consumivel)
    nos = ge.grafo.nos()
    idx = {v: i for i, v in enumerate(nos)}
    n = len(nos)
    eventos: list[dict] = []
    obs = _observador(idx, eventos)
    no = lambda v: idx[v]  # noqa: E731

    if alg == "BFS":
        r = bfs(ge.grafo, ge.inicio, observador=obs)
        resultado = {"dist": _vetor(r.dist, idx, n, -1), "pai": _vetor(r.pai, idx, n, -1, no),
                     "ordem": [idx[v] for v in r.ordem]}
    elif alg == "DFS":
        # como solve.py faz para dfs_classificacao.csv: DFS no grafo sem o nó virtual ALVO
        r = dfs(ge.sem_alvo, ge.inicio, observador=obs)
        # o Resultado do grupo não guarda d/f: os tempos vêm dos eventos 'descobre'/'encerra' (só serialização)
        descoberta, termino = [-1] * n, [-1] * n
        for ev in eventos:
            if ev["t"] == "descobre":
                descoberta[ev["v"]] = ev["d"]
            elif ev["t"] == "encerra":
                termino[ev["v"]] = ev["f"]
        resultado = {"descoberta": descoberta, "termino": termino,
                     "pai": _vetor(r.pai, idx, n, -1, no), "classes": r.classes,
                     "arcos": [[idx[u], idx[v], tipo] for u, v, tipo in r.arcos],
                     "ordem": [idx[v] for v in r.ordem], "temCiclo": r.classes.get("retorno", 0) > 0,
                     "semAlvo": True}
    elif alg == "DIJKSTRA":
        try:
            r = dijkstra(ge.grafo, ge.inicio, observador=obs)
            resultado = {"recusa": None, "dist": _vetor(r.dist, idx, n, None, _num),
                         "pai": _vetor(r.pai, idx, n, -1, no)}
        except PesoNegativoError as e:
            negativos = [[idx[a.origem], idx[a.destino], _num(a.peso)] for a in ge.grafo.arcos() if a.peso < 0]
            resultado = {"recusa": {"mensagem": str(e), "negativos": negativos}, "dist": [None] * n, "pai": [-1] * n}
    else:
        r = bellman_ford(ge.grafo, ge.inicio, observador=obs)
        # a implementação do grupo faz sempre as |V|-1 passadas (sem parada antecipada)
        resultado = {"dist": _vetor(r.dist, idx, n, None, _num), "pai": _vetor(r.pai, idx, n, -1, no),
                     "passadas": sum(1 for ev in eventos if ev["t"] == "passada"), "parouCedo": False,
                     "cicloNegativo": [idx[v] for v in r.ciclo_negativo] if r.ciclo_negativo else None}

    return {"algoritmo": alg, "fonteConsumivel": fonte_consumivel, "grafo": _grafo_json(ge, idx),
            "resultado": resultado, "eventos": eventos}


def traco_json(mapa: Mapa, alg: str, fonte_consumivel: bool = False) -> str:
    """O traço já serializado, sem espaços (é o que a API e o HTML standalone entregam)."""
    return json.dumps(traco(mapa, alg, fonte_consumivel), ensure_ascii=False, separators=(",", ":"))
