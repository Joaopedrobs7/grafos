# [IA] Claude – pré-cálculo dos JSON pequenos que a página /parte2 do site desenha (o navegador não roda algoritmo)
"""Dados da página da Parte 2 (grafo de rotação) para o site Flask.

Lê o grafo de rotação (``data/dataset_parte2/rotacao/``) e os resultados já gravados pela frente de
algoritmos (``out/parte2/bellman_ford.json``, ``dijkstra.json`` e ``parte2_report.json``) e grava em
``out/parte2/web/``:

- ``indice.json``: temporadas e, por temporada, os times com contagens (nós, arcos, arcos negativos);
- ``rotacao/<TIME>_<ano>.json``: um time-temporada — nós (jogador, minutos, entradas, impacto médio),
  arcos ``[i, j, peso, ocorrencias]`` (índices na lista de nós), o ciclo negativo que o Bellman-Ford do grupo
  devolveu, o caminho do recorte sem ciclo e, quando o time-temporada é um dos pares do Dijkstra, esse caminho;
- ``benchmark.json``: tempos médios por algoritmo e tipo de grafo e a tabela de escalabilidade;
- ``graficos.json``: dados dos gráficos interativos (impacto × minutos, times, a faixa H3 e as barras 100% H1
  do peso de cada troca, lidos de ``trocas.csv``).

Nenhum algoritmo de busca ou caminho roda aqui: os ciclos e caminhos vêm prontos dos JSON da frente de
algoritmos; este módulo só procura o peso de cada arco listado e soma os custos acumulados para exibição.

Uso: ``python -m src.parte2.web_dados``
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "data" / "dataset_parte2" / "rotacao"
RESULTADOS = RAIZ / "out" / "parte2"
SAIDA = RESULTADOS / "web"

DESCRICAO_PESO = ("peso do arco X -> Y (Y entrou no lugar de X) = saldo do time por 12 min com Y em quadra "
                  "menos o saldo por 12 min do trecho anterior, com X em quadra")
DESCRICAO_IMPACTO = ("impacto médio = média dos pesos dos arcos que chegam ao jogador (vezes em que ele entrou), "
                     "ponderada pelas ocorrências")


def _num(valor, casas: int = 4):
    if valor in (None, ""):
        return None
    return round(float(valor), casas)


def _ler_csv(caminho: Path) -> list[dict]:
    with Path(caminho).open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _componente(no: str) -> tuple[str, int]:
    _, time, ano = no.rsplit("|", 2)
    return time, int(ano)


def nome_arquivo(time: str, ano: int) -> str:
    return f"{time}_{ano}.json"


# ---------------------------------------------------------------- time-temporada

def _passos(seq: list[str], idx: dict[str, int], pesos: dict[tuple[str, str], float]) -> list[dict]:
    """Arcos consecutivos de uma sequência de nós com o peso de cada um e o custo acumulado."""
    res, acum = [], 0.0
    for u, v in zip(seq, seq[1:]):
        p = pesos[(u, v)]
        acum += p
        res.append({"de": idx[u], "para": idx[v], "peso": round(p, 4), "acumulado": round(acum, 4)})
    return res


def montar_componentes(jogadores: list[dict], arestas: list[dict], bellman: dict, dijkstra: dict) -> dict:
    """{(time, ano): dados do time-temporada} no formato que a página lê."""
    info = {j["no"]: j for j in jogadores}
    nos: dict[tuple[str, int], set[str]] = defaultdict(set)
    for j in jogadores:
        nos[_componente(j["no"])].add(j["no"])
    arcos: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for a in arestas:
        c = _componente(a["origem"])
        arcos[c].append(a)
        nos[c].update((a["origem"], a["destino"]))

    com_ciclo = {(e["time"], e["temporada"]): e for e in bellman["com_ciclo"]["componentes"]}
    sem_ciclo = {(e["time"], e["temporada"]): e for e in bellman["sem_ciclo"]["componentes"]}
    pares = {(p["time"], p["temporada"]): p for p in dijkstra.get("pares", [])}

    res = {}
    for (time, ano) in sorted(nos, key=lambda c: (c[1], c[0])):
        def minutos(v):
            return float(info.get(v, {}).get("minutos_medidos") or 0)

        ordem = sorted(nos[(time, ano)], key=lambda v: (-minutos(v), v))
        idx = {v: i for i, v in enumerate(ordem)}
        pesos = {(a["origem"], a["destino"]): float(a["peso"]) for a in arcos[(time, ano)]}
        # [IA] Claude – impacto médio ponderado pelas ocorrências (arcos que chegam ao jogador) e personId (foto)
        chega: dict[str, list[float]] = defaultdict(lambda: [0.0, 0])
        for a in arcos[(time, ano)]:
            oc = int(float(a.get("ocorrencias") or 0))
            chega[a["destino"]][0] += float(a["peso"]) * oc
            chega[a["destino"]][1] += oc
        lista_nos = []
        for v in ordem:
            j = info.get(v, {})
            soma, ent = chega.get(v, (0.0, 0))
            pid = str(j.get("personId") or "").strip()
            lista_nos.append({
                "id": v, "nome": j.get("nome") or v.split("|")[0],
                "personId": int(float(pid)) if pid else None,
                "minutos": _num(j.get("minutos_medidos"), 2) or 0.0,
                "entradas": int(ent),
                "impacto_medio": _num(soma / ent) if ent else None,
            })
        lista_arcos = [[idx[a["origem"]], idx[a["destino"]], round(float(a["peso"]), 4),
                        int(float(a.get("ocorrencias") or 0))] for a in arcos[(time, ano)]]

        dados = {"time": time, "temporada": ano, "nos": lista_nos, "arcos": lista_arcos,
                 "arcos_negativos": sum(1 for a in lista_arcos if a[2] < 0)}

        cc = com_ciclo.get((time, ano))
        if cc:
            ciclo = cc.get("ciclo_negativo")
            dados["bellman_ford"] = {
                "fonte": idx[cc["fonte"]], "status": cc["status"],
                "ciclo": [idx[v] for v in ciclo] if ciclo else None,
                "passos": _passos(ciclo, idx, pesos) if ciclo else [],
                "custo": cc.get("custo_ciclo"),
            }
        sc = sem_ciclo.get((time, ano))
        if sc:
            dados["sem_ciclo"] = {
                "fonte": idx[sc["fonte"]], "status": sc["status"], "arcos_recorte": sc["arcos"],
                "destino": idx[sc["destino"]] if sc.get("destino") else None,
                "caminho": [idx[v] for v in sc["caminho"]],
                "passos": _passos(sc["caminho"], idx, pesos), "custo": sc["custo"],
            }
        p = pares.get((time, ano))
        if p:
            dados["dijkstra"] = {
                "origem": idx[p["origem"]], "destino": idx[p["destino"]],
                "caminho": [idx[v] for v in p["caminho_dijkstra"]],
                "passos": _passos(p["caminho_dijkstra"], idx, pesos),
                "custo_transformado": p["custo_transformado"],
                "custo_reconvertido": p["custo_original_reconvertido"],
                "custo_bellman_ford": p["custo_bellman_ford"], "caminho_igual": p["caminho_igual"],
            }
        res[(time, ano)] = dados
    return res


def montar_indice(componentes: dict, bellman: dict, dijkstra: dict) -> dict:
    temporadas: dict[int, list[dict]] = defaultdict(list)
    for (time, ano), d in componentes.items():
        temporadas[ano].append({"time": time, "nos": len(d["nos"]), "arcos": len(d["arcos"]),
                                "arcos_negativos": d["arcos_negativos"], "dijkstra": "dijkstra" in d})
    return {
        "grafo": "rotacao",
        "V": sum(len(d["nos"]) for d in componentes.values()),
        "E": sum(len(d["arcos"]) for d in componentes.values()),
        "componentes": len(componentes),
        "descricao_peso": DESCRICAO_PESO,
        "descricao_impacto": DESCRICAO_IMPACTO,
        "regra_ciclo": bellman["com_ciclo"]["regra"],
        "regra_sem_ciclo": bellman["sem_ciclo"]["regra"],
        "transformacao_dijkstra": dijkstra.get("transformacao"),
        "temporadas": [{"ano": ano, "times": sorted(ts, key=lambda t: t["time"])}
                       for ano, ts in sorted(temporadas.items())],
    }


# ---------------------------------------------------------------- benchmark

def _tipo_grafo(grafo: str) -> str:
    return grafo.split(" ", 1)[0]  # "completo", "componente", "recorte_sem_ciclo"


def montar_benchmark(relatorio: dict) -> dict:
    grupos: dict[tuple[str, str], list[float]] = defaultdict(list)
    ordem = ["BFS", "DFS", "Dijkstra", "Bellman-Ford"]
    for t in relatorio["tarefas"]:
        grupos[(t["algoritmo"], _tipo_grafo(t["grafo"]))].append(t["media_s"])
    tempos = []
    for (alg, tipo), medias in sorted(grupos.items(), key=lambda kv: (ordem.index(kv[0][0]) if kv[0][0] in ordem
                                                                      else 99, kv[0][1])):
        tempos.append({"algoritmo": alg, "grafo": tipo, "tarefas": len(medias),
                       "media_ms": round(sum(medias) / len(medias) * 1000, 4),
                       "min_ms": round(min(medias) * 1000, 4), "max_ms": round(max(medias) * 1000, 4)})
    escala = [{
        "grafo": c["grafo"], "algoritmo": c["algoritmo"], "amostra": c["amostra"], "V": c["V"], "E": c["E"],
        "complexidade": c["complexidade"], "media_ms": round(c["tempo_medio_s"] * 1000, 4),
        "crescimento_tempo": round(c["crescimento_tempo"], 2),
        "crescimento_teorico": round(c["crescimento_teorico"], 2),
    } for c in relatorio["complexidade"]]
    return {"grafo": relatorio.get("grafo"), "V": relatorio.get("V"), "E": relatorio.get("E"),
            "repeticoes": relatorio.get("repeticoes"), "semente": relatorio.get("semente"),
            "fracoes": relatorio.get("fracoes"), "tempos": tempos, "escalabilidade": escala}


# ---------------------------------------------------------------- gráficos escolhidos pelo grupo (versão interativa)

# [IA] Claude – dados das versões interativas dos gráficos "impacto x minutos" e X6 (mesmas definições de
# src/parte2/graficos_avd.py: impacto ponderado pelas ocorrências, >= 30 entradas no gráfico de bolinhas)
def montar_graficos(arestas: list[dict], jogadores: list[dict], min_entradas: int = 30, trocas=None) -> dict:
    chega: dict[str, list[float]] = {}
    times: dict[tuple[str, int | None], list[float]] = {}
    for a in arestas:
        oc, peso, ano = int(a["ocorrencias"]), float(a["peso"]), int(a["temporada"])
        c = chega.setdefault(a["destino"], [0.0, 0])
        c[0] += peso * oc
        c[1] += oc
        for chave in ((a["time"], ano), (a["time"], None)):
            t = times.setdefault(chave, [0.0, 0])
            t[0] += peso * oc
            t[1] += oc
    pontos = []
    for j in jogadores:
        soma, ent = chega.get(j["no"], (0.0, 0))
        if ent >= min_entradas:
            pontos.append([j["nome"], j["time"], int(j["temporada"]), _num(float(j["minutos_medidos"]), 1),
                           _num(soma / ent, 3), ent])
    por_time = {}
    for (time, ano), (soma, oc) in times.items():
        por_time.setdefault("todas" if ano is None else str(ano), []).append([time, _num(soma / oc, 3), oc])
    for v in por_time.values():
        v.sort(key=lambda x: x[1])
    # [IA] Claude – H3 (faixa por minuto do substituto em quadra) e H1 (barras 100% por placar no momento da
    # troca), por temporada, com as mesmas definições de src/parte2/graficos_avd.py
    from .graficos_avd import CATEGORIAS_H1, faixas_h3, pilhas_h1
    expl = {"h3": {}, "h1": {}}
    if trocas is not None:
        for chave, t in [("todas", trocas)] + [(str(a), g) for a, g in trocas.groupby("temporada")]:
            expl["h3"][chave] = faixas_h3(t)
            expl["h1"][chave] = pilhas_h1(t)
    return {"min_entradas": min_entradas, "h3": expl["h3"], "h1": expl["h1"], "categorias_h1": CATEGORIAS_H1,
            "colunas_jogadores": ["nome", "time", "temporada", "minutos", "impacto", "entradas"],
            "jogadores": pontos, "colunas_times": ["time", "impacto", "ocorrencias"], "times": por_time,
            "definicoes": {
                "impacto": "média do peso das trocas em que o jogador entrou (saldo por 12 min depois − antes), "
                           "ponderada pelas ocorrências",
                "minutos": "minutos em quadra medidos nos trechos antes e depois das trocas 1 por 1",
                "impacto_time": "média do peso de todas as trocas do time, ponderada pelas ocorrências"}}


# ---------------------------------------------------------------- main

def _gravar(caminho: Path, dados) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(pasta: Path = PASTA, resultados: Path = RESULTADOS, saida: Path = SAIDA) -> None:
    jogadores = _ler_csv(pasta / "jogadores.csv")
    arestas = _ler_csv(pasta / "arestas_rotacao.csv")
    bellman = json.loads((resultados / "bellman_ford.json").read_text(encoding="utf-8"))
    dijkstra = json.loads((resultados / "dijkstra.json").read_text(encoding="utf-8"))
    componentes = montar_componentes(jogadores, arestas, bellman, dijkstra)
    for (time, ano), d in componentes.items():
        _gravar(saida / "rotacao" / nome_arquivo(time, ano), d)
    _gravar(saida / "indice.json", montar_indice(componentes, bellman, dijkstra))
    import pandas as pd
    trocas = pd.read_csv(pasta / "trocas.csv") if (pasta / "trocas.csv").exists() else None
    _gravar(saida / "graficos.json", montar_graficos(arestas, jogadores, trocas=trocas))
    relatorio = resultados / "parte2_report.json"
    if relatorio.exists():
        _gravar(saida / "benchmark.json", montar_benchmark(json.loads(relatorio.read_text(encoding="utf-8"))))
    total = sum(p.stat().st_size for p in saida.rglob("*.json"))
    print(f"gravado: {saida} ({len(componentes)} time-temporadas, {total / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
