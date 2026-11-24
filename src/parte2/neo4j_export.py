# [IA] Claude – exportação do grafo de rotação e dos resultados já calculados para um Neo4j local (só visualização)
"""Carrega o grafo de rotação da Parte 2 e os resultados dos algoritmos do grupo num Neo4j local.

O Neo4j serve só para visualizar e explorar: nenhum algoritmo de grafo do Neo4j/GDS é usado. Os caminhos,
ciclos e camadas vêm dos JSON gerados por ``src.parte2.rotacao_casos`` (algoritmos de ``src/graphs/algorithms.py``).

Modelo no Neo4j:
- ``(:Jogador {no, personId, nome, time, temporada, componente, minutos, entradas, impacto_medio})``,
  chave ``no`` = ``Nome|TIM|ano`` (constraint de unicidade);
- ``(X:Jogador)-[:SAIU_PARA {peso, ocorrencias, saldo12_depois, saldo12_antes, min_depois, min_antes,
  temporada, time, no_recorte_sem_ciclo}]->(Y:Jogador)`` = um arco X -> Y do CSV, ou seja, "Y entrou no
  lugar de X" (mesma direção de ``arestas_rotacao.csv``);
- resultados importados de ``out/parte2/``:
  - ``bellman_ford.json`` (com ciclo): nós do ciclo negativo com label ``:CicloNegativo``; arcos do ciclo com
    ``ciclo_negativo = true`` e ``custo_ciclo``; fonte de cada time-temporada com label ``:Principal``;
  - ``bellman_ford.json`` (sem ciclo): arcos do caminho mínimo até o destino com ``em_caminho_bf = true``;
    nós com label ``:CaminhoBF``; o destino guarda ``custo_bf``;
  - ``dijkstra.json``: arcos dos 5 pares com ``em_caminho_dijkstra = true`` e ``par_dijkstra`` (1..5);
  - ``bfs_dfs.json``: nós alcançados a partir das 3 fontes guardam ``camada_bfs`` e ``ordem_dfs``.

Idempotente: MERGE nas chaves; as marcações de resultado são apagadas e regravadas a cada execução.

Uso (com o container de ``docker-compose.neo4j.yml`` rodando)::

    python -m src.parte2.neo4j_export            # NEO4J_URI / NEO4J_AUTH opcionais
"""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "data" / "dataset_parte2" / "rotacao"
ARESTAS = PASTA / "arestas_rotacao.csv"
JOGADORES = PASTA / "jogadores.csv"
RESULTADOS = RAIZ / "out" / "parte2"
URI_PADRAO = "bolt://localhost:7687"
AUTH_PADRAO = "neo4j/grafos2026"  # só para o container local (docker-compose.neo4j.yml)
LOTE = 2000


def _num(x: str) -> float | None:
    return float(x) if x not in ("", None) else None


def ler_jogadores(caminho: Path = JOGADORES) -> list[dict]:
    with Path(caminho).open(encoding="utf-8", newline="") as f:
        return [{"no": l["no"], "personId": l["personId"], "nome": l["nome"], "time": l["time"],
                 "temporada": int(l["temporada"]), "componente": f'{l["time"]}|{l["temporada"]}',
                 "minutos": _num(l["minutos_medidos"]) or 0.0, "entradas": _num(l["entradas"]),
                 "impacto_medio": _num(l["impacto_medio"])} for l in csv.DictReader(f)]


def ler_arestas(caminho: Path = ARESTAS, minutos: dict[str, float] | None = None) -> list[dict]:
    """Arcos do CSV; ``no_recorte_sem_ciclo`` repete a regra de ``rotacao_casos.descendente`` (só um filtro)."""
    minutos = minutos or {}
    chave = lambda v: (-minutos.get(v, 0.0), v)  # noqa: E731
    with Path(caminho).open(encoding="utf-8", newline="") as f:
        return [{"origem": l["origem"], "destino": l["destino"], "peso": float(l["peso"]),
                 "temporada": int(l["temporada"]), "time": l["time"], "ocorrencias": int(l["ocorrencias"]),
                 "saldo12_depois": _num(l["saldo12_depois"]), "saldo12_antes": _num(l["saldo12_antes"]),
                 "min_depois": _num(l["min_depois"]), "min_antes": _num(l["min_antes"]),
                 "no_recorte_sem_ciclo": chave(l["origem"]) < chave(l["destino"])}
                for l in csv.DictReader(f)]


def _pares(caminho: list[str]) -> list[tuple[str, str]]:
    return list(zip(caminho, caminho[1:]))


def marcacoes(resultados: Path = RESULTADOS) -> dict[str, list[dict]]:
    """Linhas prontas para UNWIND a partir dos JSON dos algoritmos do grupo."""
    bf = json.loads((resultados / "bellman_ford.json").read_text(encoding="utf-8"))
    dj = json.loads((resultados / "dijkstra.json").read_text(encoding="utf-8"))
    bd = json.loads((resultados / "bfs_dfs.json").read_text(encoding="utf-8"))
    m: dict[str, list[dict]] = {k: [] for k in ("principal", "ciclo_nos", "ciclo_arcos", "bf_nos", "bf_arcos",
                                                "bf_destino", "dij_arcos", "busca_nos")}
    for c in bf["com_ciclo"]["componentes"]:
        m["principal"].append({"no": c["fonte"]})
        ciclo = c.get("ciclo_negativo") or []
        m["ciclo_nos"] += [{"no": v} for v in dict.fromkeys(ciclo)]
        m["ciclo_arcos"] += [{"origem": u, "destino": v, "custo": c.get("custo_ciclo")} for u, v in _pares(ciclo)]
    for c in bf["sem_ciclo"]["componentes"]:
        caminho = c.get("caminho") or []
        m["bf_nos"] += [{"no": v} for v in caminho]
        m["bf_arcos"] += [{"origem": u, "destino": v} for u, v in _pares(caminho)]
        if caminho:
            m["bf_destino"].append({"no": caminho[-1], "custo": c.get("custo"), "fonte": c["fonte"]})
    for i, p in enumerate(dj["pares"], start=1):
        m["dij_arcos"] += [{"origem": u, "destino": v, "par": i} for u, v in _pares(p["caminho_dijkstra"])]
    for f in bd["fontes"]:
        prof = {v: k for k, nivel in enumerate(f["DFS"]["profundidades"]) for v in nivel}
        ordem_dfs = {v: i for i, v in enumerate(f["DFS"]["ordem"])}
        for k, camada in enumerate(f["BFS"]["camadas"]):
            for v in camada:
                m["busca_nos"].append({"no": v, "camada": k, "ordem_dfs": ordem_dfs.get(v),
                                       "prof_dfs": prof.get(v), "fonte": f["fonte"]})
    return m


def _lotes(linhas: list[dict], tam: int = LOTE):
    for i in range(0, len(linhas), tam):
        yield linhas[i:i + tam]


def _rodar(sessao, cypher: str, linhas: list[dict]) -> None:
    for lote in _lotes(linhas):
        sessao.run(cypher, linhas=lote).consume()


CONSTRAINT = "CREATE CONSTRAINT jogador_no IF NOT EXISTS FOR (j:Jogador) REQUIRE j.no IS UNIQUE"
NOS = """UNWIND $linhas AS l
MERGE (j:Jogador {no: l.no})
SET j.personId = l.personId, j.nome = l.nome, j.time = l.time, j.temporada = l.temporada,
    j.componente = l.componente, j.minutos = l.minutos, j.entradas = l.entradas, j.impacto_medio = l.impacto_medio"""
ARCOS = """UNWIND $linhas AS l
MATCH (x:Jogador {no: l.origem}), (y:Jogador {no: l.destino})
MERGE (x)-[r:SAIU_PARA]->(y)
SET r.peso = l.peso, r.temporada = l.temporada, r.time = l.time, r.ocorrencias = l.ocorrencias,
    r.saldo12_depois = l.saldo12_depois, r.saldo12_antes = l.saldo12_antes,
    r.min_depois = l.min_depois, r.min_antes = l.min_antes, r.no_recorte_sem_ciclo = l.no_recorte_sem_ciclo"""
LIMPAR = [
    "MATCH (j:Jogador) REMOVE j:CicloNegativo:CaminhoBF:DestinoBF:Principal:FonteBusca "
    "SET j.custo_bf = null, j.fonte_bf = null, j.camada_bfs = null, j.ordem_dfs = null, "
    "j.prof_dfs = null, j.fonte_busca = null",
    "MATCH ()-[r:SAIU_PARA]->() WHERE r.ciclo_negativo IS NOT NULL OR r.em_caminho_bf IS NOT NULL "
    "OR r.em_caminho_dijkstra IS NOT NULL "
    "SET r.ciclo_negativo = null, r.custo_ciclo = null, r.em_caminho_bf = null, "
    "r.em_caminho_dijkstra = null, r.par_dijkstra = null",
]
_ARCO = "UNWIND $linhas AS l MATCH (:Jogador {no: l.origem})-[r:SAIU_PARA]->(:Jogador {no: l.destino}) "
MARCAR = {
    "principal": "UNWIND $linhas AS l MATCH (j:Jogador {no: l.no}) SET j:Principal",
    "ciclo_nos": "UNWIND $linhas AS l MATCH (j:Jogador {no: l.no}) SET j:CicloNegativo",
    "ciclo_arcos": _ARCO + "SET r.ciclo_negativo = true, r.custo_ciclo = l.custo",
    "bf_nos": "UNWIND $linhas AS l MATCH (j:Jogador {no: l.no}) SET j:CaminhoBF",
    "bf_arcos": _ARCO + "SET r.em_caminho_bf = true",
    "bf_destino": "UNWIND $linhas AS l MATCH (j:Jogador {no: l.no}) "
                  "SET j:DestinoBF, j.custo_bf = l.custo, j.fonte_bf = l.fonte",
    "dij_arcos": _ARCO + "SET r.em_caminho_dijkstra = true, r.par_dijkstra = l.par",
    "busca_nos": "UNWIND $linhas AS l MATCH (j:Jogador {no: l.no}) "
                 "SET j.camada_bfs = l.camada, j.ordem_dfs = l.ordem_dfs, j.prof_dfs = l.prof_dfs, "
                 "j.fonte_busca = l.fonte",
}
FONTES_BUSCA = "MATCH (j:Jogador) WHERE j.camada_bfs = 0 SET j:FonteBusca"
CONTAGENS = {
    "jogadores": "MATCH (j:Jogador) RETURN count(j) AS n",
    "arcos_saiu_para": "MATCH ()-[r:SAIU_PARA]->() RETURN count(r) AS n",
    "arcos_negativos": "MATCH ()-[r:SAIU_PARA]->() WHERE r.peso < 0 RETURN count(r) AS n",
    "arcos_recorte_sem_ciclo": "MATCH ()-[r:SAIU_PARA {no_recorte_sem_ciclo: true}]->() RETURN count(r) AS n",
    "componentes": "MATCH (j:Jogador) RETURN count(DISTINCT j.componente) AS n",
    "principais": "MATCH (j:Principal) RETURN count(j) AS n",
    "nos_ciclo_negativo": "MATCH (j:CicloNegativo) RETURN count(j) AS n",
    "arcos_ciclo_negativo": "MATCH ()-[r:SAIU_PARA {ciclo_negativo: true}]->() RETURN count(r) AS n",
    "nos_caminho_bf": "MATCH (j:CaminhoBF) RETURN count(j) AS n",
    "arcos_caminho_bf": "MATCH ()-[r:SAIU_PARA {em_caminho_bf: true}]->() RETURN count(r) AS n",
    "arcos_caminho_dijkstra": "MATCH ()-[r:SAIU_PARA {em_caminho_dijkstra: true}]->() RETURN count(r) AS n",
    "nos_com_camada_bfs": "MATCH (j:Jogador) WHERE j.camada_bfs IS NOT NULL RETURN count(j) AS n",
}


def _credenciais() -> tuple[str, tuple[str, str]]:
    uri = os.environ.get("NEO4J_URI", URI_PADRAO)
    usuario, _, senha = os.environ.get("NEO4J_AUTH", AUTH_PADRAO).partition("/")
    return uri, (usuario, senha)


def importar(driver, arestas: Path = ARESTAS, jogadores: Path = JOGADORES,
             resultados: Path = RESULTADOS) -> dict[str, int]:
    nos = ler_jogadores(jogadores)
    arcos = ler_arestas(arestas, {j["no"]: j["minutos"] for j in nos})
    m = marcacoes(resultados)
    with driver.session() as s:
        s.run(CONSTRAINT).consume()
        _rodar(s, NOS, nos)
        _rodar(s, ARCOS, arcos)
        for q in LIMPAR:
            s.run(q).consume()
        for chave, cypher in MARCAR.items():
            _rodar(s, cypher, m[chave])
        s.run(FONTES_BUSCA).consume()
        return {nome: s.run(q).single()["n"] for nome, q in CONTAGENS.items()}


def main() -> None:
    from neo4j import GraphDatabase

    uri, auth = _credenciais()
    with GraphDatabase.driver(uri, auth=auth) as driver:
        driver.verify_connectivity()
        contagens = importar(driver)
    for nome, n in contagens.items():
        print(f"{nome:26s} {n}")


if __name__ == "__main__":
    main()
