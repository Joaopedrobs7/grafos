# [IA] Claude – orquestração das saídas da Parte 1 (revisar e explicar em grupo)
"""Resolve os mapas e gera os arquivos obrigatórios de out/parte1/."""
from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

from .graphs.algorithms import (
    INF, PesoNegativoError, alcancaveis, bellman_ford, bfs, caminho, custo_ciclo, dfs, dijkstra,
)
from .graphs.estados import ALVO, GrafoEstados, grafo_estados, grafo_posicoes, rotulo
from .graphs.io import PORTAS, SAIDA, Mapa, ler_mapa, listar_mapas

ALGORITMOS = ("BFS", "DIJKSTRA", "BELLMAN_FORD")


# ---------------------------------------------------------------- caminhos
def _percurso(ge: GrafoEstados, estados: list) -> list[dict]:
    """Detalha um caminho estado a estado (sem o ALVO), com custo acumulado."""
    passos, acumulado = [], 0.0
    for i, e in enumerate(estados):
        if e == ALVO:
            break
        if i > 0:
            arco = next(a for a in ge.grafo.vizinhos(estados[i - 1]) if a.destino == e)
            acumulado += arco.peso
            mov, casa = arco.info
        else:
            mov, casa = "", ge.mapa.casa(e[0], e[1])
        passos.append({
            "passo": i, "estado": rotulo(e), "linha": e[0], "coluna": e[1],
            "chaves": e[2], "bonus": list(e[3]), "movimento": mov, "casa": casa, "custo_acumulado": acumulado,
        })
    return passos


def resolver(ge: GrafoEstados, algoritmo: str) -> dict:
    """Roda um algoritmo no G_est até ALVO. Status: OK, RECUSA, CICLO_NEGATIVO, SEM_SOLUCAO."""
    g, s = ge.grafo, ge.inicio
    algoritmo = algoritmo.upper()
    res = {"mapa": ge.mapa.nome, "algoritmo": algoritmo, "passos": None, "custo": None,
           "status": "OK", "caminho": [], "percurso": [], "mensagem": ""}
    if algoritmo == "BFS":
        r = bfs(g, s)
        est = caminho(r.pai, ALVO)
    elif algoritmo == "DIJKSTRA":
        try:
            r = dijkstra(g, s)
        except PesoNegativoError as e:
            res.update(status="RECUSA", mensagem=str(e))
            return res
        est = r.caminho_ate(ALVO)
    elif algoritmo == "BELLMAN_FORD":
        r = bellman_ford(g, s)
        if r.ciclo_negativo:
            ciclo = r.ciclo_negativo
            res.update(status="CICLO_NEGATIVO", caminho=[rotulo(e) for e in ciclo],
                       custo=custo_ciclo(g, ciclo), percurso=_percurso(ge, ciclo),
                       mensagem=f"Ciclo negativo de {len(ciclo) - 1} arcos alcançável a partir do início.")
            return res
        est = r.caminho_ate(ALVO)
    else:
        raise ValueError(f"Algoritmo desconhecido: {algoritmo}")

    if not est:
        res.update(status="SEM_SOLUCAO", mensagem="ALVO inalcançável a partir do estado inicial.")
        return res
    percurso = _percurso(ge, est)
    res.update(passos=len(percurso) - 1, custo=percurso[-1]["custo_acumulado"],
               caminho=[p["estado"] for p in percurso], percurso=percurso)
    return res


def armadilhas(ge: GrafoEstados) -> list:
    """Estados alcançáveis do início dos quais ALVO é inalcançável (busca no transposto)."""
    chegam = alcancaveis(ge.grafo.transposto(), ALVO)
    alc = alcancaveis(ge.grafo, ge.inicio)
    return [e for e in ge.estados() if e in alc and e not in chegam]


# ---------------------------------------------------------------- métricas
def _desempate(e):
    return (e[0], e[1], e[2], e[3])


def metricas(ge: GrafoEstados) -> tuple[dict, dict]:
    m = ge.mapa
    gp = grafo_posicoes(m)
    ge_g = ge.sem_alvo
    graus = ge_g.graus()
    estados = ge.estados()

    max_saida = min(estados, key=lambda e: (-graus[e][1], _desempate(e)))
    max_entrada = min(estados, key=lambda e: (-graus[e][0], _desempate(e)))
    mult = Counter((e[0], e[1]) for e in estados)
    mult_max = max(mult.values())
    becos = [e for e in estados if graus[e][1] == 0 and m.casa(e[0], e[1]) != SAIDA]
    trap = armadilhas(ge)

    glob = {
        "linhas": m.linhas, "colunas": m.colunas, "casas_livres": len(m.casas_livres()),
        "n_chaves": len(m.chaves), "n_bonus": len(m.bonus), "n_fontes": len(m.fontes),
        "G_pos": {"ordem": gp.ordem, "tamanho": gp.tamanho, "densidade": gp.densidade()},
        "G_est": {"ordem": ge_g.ordem, "tamanho": ge_g.tamanho, "densidade": ge_g.densidade()},
        "teto_teorico": ge.teto_teorico(),
        "taxa_ocupacao": ge_g.ordem / ge.teto_teorico(),
        "maior_grau_saida": {"estado": rotulo(max_saida), "grau": graus[max_saida][1]},
        "maior_grau_entrada": {"estado": rotulo(max_entrada), "grau": graus[max_entrada][0]},
        "multiplicidade_maxima": mult_max,
        "casas_com_multiplicidade_maxima": sorted([list(p) for p, k in mult.items() if k == mult_max]),
        "becos": [rotulo(e) for e in becos],
        "n_armadilhas": len(trap),
        "pct_armadilhas": len(trap) / len(estados),
    }

    # camadas: subgrafo induzido por conjunto de chaves
    por_camada: dict[str, set] = defaultdict(set)
    for e in estados:
        por_camada[e[2]].add(e)
    camadas = []
    for chaves in sorted(por_camada, key=lambda k: (len(k), k)):
        sub = ge_g.subgrafo_induzido(por_camada[chaves])
        camadas.append({"chaves": chaves or "-", "ordem": sub.ordem, "tamanho": sub.tamanho,
                        "densidade": sub.densidade()})
    entre = [a for a in ge_g.arcos() if a.origem[2] != a.destino[2]]
    casas = Counter((a.destino[0], a.destino[1], a.info[1]) for a in entre)
    cam = {
        "camadas": camadas,
        "arcos_entre_camadas": len(entre),
        "casas_que_mudam_camada": [{"casa": [r, c], "simbolo": s, "arcos": n} for (r, c, s), n in sorted(casas.items())],
    }
    return glob, cam


# ---------------------------------------------------------------- comparação de modelagens
def _bfs_pos(mapa: Mapa, portas: str):
    gp = grafo_posicoes(mapa, portas)
    if mapa.inicio not in gp:
        return None, []
    r = bfs(gp, mapa.inicio)
    alcancadas = [g for g in mapa.saidas if g in r.dist]
    if not alcancadas:
        return None, []
    g = min(alcancadas, key=lambda x: r.dist[x])
    return r.dist[g], caminho(r.pai, g)


def _caminho_valido(mapa: Mapa, posicoes: list) -> bool:
    chaves = set()
    for r, c in posicoes[1:]:
        ch = mapa.casa(r, c)
        if ch in PORTAS and ch.lower() not in chaves:
            return False
        if ch.islower():
            chaves.add(ch)
    return True


def comparacao_modelagem(mapa: Mapa) -> list[dict]:
    linhas = []
    p, cam = _bfs_pos(mapa, "chao")
    linhas.append({"mapa": mapa.nome, "abordagem": "G_pos_porta_chao", "passos": p,
                   "caminho_valido": _caminho_valido(mapa, cam) if cam else False,
                   "observacao": "atravessa porta sem a chave" if cam and not _caminho_valido(mapa, cam)
                   else "caminho coincide com regras"})
    p, cam = _bfs_pos(mapa, "parede")
    linhas.append({"mapa": mapa.nome, "abordagem": "G_pos_porta_parede", "passos": p,
                   "caminho_valido": bool(cam),
                   "observacao": "G inalcançável: porta nunca abre" if not cam else "chega sem passar por porta"})
    r = resolver(grafo_estados(mapa), "BFS")
    linhas.append({"mapa": mapa.nome, "abordagem": "G_est", "passos": r["passos"],
                   "caminho_valido": r["status"] == "OK", "observacao": "coleta a chave antes de passar pela porta"})
    return linhas


# ---------------------------------------------------------------- escrita
def _csv(caminho_arq: Path, campos: list[str], linhas: list[dict]) -> None:
    with caminho_arq.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(linhas)


def _json(caminho_arq: Path, dados) -> None:
    caminho_arq.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")


def exportar_arestas(ge: GrafoEstados, out: Path) -> None:
    linhas = [{"origem": rotulo(a.origem), "destino": rotulo(a.destino), "movimento": a.info[0],
               "casa_destino": a.info[1], "peso": a.peso}
              for a in ge.grafo.arcos() if a.destino != ALVO]
    with (out / f"arestas_{ge.mapa.nome}.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["origem", "destino", "movimento", "casa_destino", "peso"],
                           quoting=csv.QUOTE_NONNUMERIC)
        w.writeheader()
        w.writerows(linhas)


def exportar_graus(ge: GrafoEstados, out: Path) -> None:
    graus = ge.sem_alvo.graus()
    _csv(out / f"graus_{ge.mapa.nome}.csv", ["estado", "grau_entrada", "grau_saida"],
         [{"estado": rotulo(e), "grau_entrada": gi, "grau_saida": go} for e, (gi, go) in graus.items()])


def gerar_tudo(pastas_mapas: list[str], out: str | Path = "out/parte1") -> dict:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    mapas = [ler_mapa(p) for p in listar_mapas(*pastas_mapas)]

    metricas_global, camadas, solucoes, dfs_linhas, comparacao = {}, {}, [], [], []
    for m in mapas:
        ge = grafo_estados(m)
        exportar_arestas(ge, out)
        exportar_graus(ge, out)
        metricas_global[m.nome], camadas[m.nome] = metricas(ge)

        for alg in ALGORITMOS:
            r = resolver(ge, alg)
            solucoes.append({k: r[k] for k in ("mapa", "algoritmo", "passos", "custo", "status")}
                            | {"caminho": " -> ".join(r["caminho"])})
            if m.nome.startswith("m03") and alg == "DIJKSTRA":
                _json(out / "percurso_m03.json", r)

        d = dfs(ge.sem_alvo, ge.inicio)
        dfs_linhas.append({"mapa": m.nome, **d.classes, "tem_ciclo": d.tem_ciclo})

        if m.nome[:3] in ("m02", "m03", "m04"):
            comparacao.extend(comparacao_modelagem(m))

        if m.nome[:3] in ("m04", "m07"):
            trap = armadilhas(ge)
            _csv(out / f"armadilhas_{m.nome[:3]}.csv", ["estado", "linha", "coluna", "chaves", "bonus"],
                 [{"estado": rotulo(e), "linha": e[0], "coluna": e[1], "chaves": e[2] or "-",
                   "bonus": list(e[3])} for e in trap])

        if m.nome.startswith("m05"):
            # G_pos com + valendo -4 fixo: aparece ciclo negativo; no G_est ele some
            gp = grafo_posicoes(m)
            bp = bellman_ford(gp, m.inicio)
            be = bellman_ford(ge.grafo, ge.inicio)
            _json(out / "bellman_ford_m05.json", {
                "G_pos": {"ciclo_negativo": [list(p) for p in bp.ciclo_negativo or []],
                          "custo_ciclo": custo_ciclo(gp, bp.ciclo_negativo) if bp.ciclo_negativo else None},
                "G_est": {"ciclo_negativo": None if not be.ciclo_negativo else [rotulo(e) for e in be.ciclo_negativo],
                          "custo_ate_ALVO": be.dist.get(ALVO)},
            })

        if m.nome.startswith("m06"):
            r = resolver(ge, "BELLMAN_FORD")
            corr = resolver(grafo_estados(m, fonte_consumivel=True), "BELLMAN_FORD")
            _json(out / "ciclo_negativo_m06.json", {
                "status": r["status"], "ciclo": r["caminho"], "custo_ciclo": r["custo"],
                "correcao_fonte_consumivel": {k: corr[k] for k in ("status", "passos", "custo", "caminho")},
            })
            solucoes.append({k: corr[k] for k in ("algoritmo", "passos", "custo", "status")}
                            | {"mapa": f"{m.nome}--fonte-consumivel", "caminho": " -> ".join(corr["caminho"])})

    _json(out / "metricas_global.json", metricas_global)
    _json(out / "camadas.json", camadas)
    _csv(out / "solucoes.csv", ["mapa", "algoritmo", "passos", "custo", "status", "caminho"], solucoes)
    _csv(out / "dfs_classificacao.csv", ["mapa", "arvore", "retorno", "avanco", "cruzamento", "tem_ciclo"], dfs_linhas)
    _csv(out / "comparacao_modelagem.csv", ["mapa", "abordagem", "passos", "caminho_valido", "observacao"], comparacao)
    return {"mapas": [m.nome for m in mapas], "out": str(out)}
