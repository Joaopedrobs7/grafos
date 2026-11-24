# [IA] Claude – testes da preparação das linhas do export para o Neo4j (sem precisar do container)
import json

from src.parte2 import neo4j_export as ne


def test_marcacoes_batem_com_os_json():
    m = ne.marcacoes(ne.RESULTADOS)
    bf = json.loads((ne.RESULTADOS / "bellman_ford.json").read_text(encoding="utf-8"))
    dj = json.loads((ne.RESULTADOS / "dijkstra.json").read_text(encoding="utf-8"))
    assert len(m["principal"]) == bf["com_ciclo"]["total"]
    assert len(m["ciclo_arcos"]) == sum(c["n_arcos_ciclo"] for c in bf["com_ciclo"]["componentes"])
    assert len(m["bf_arcos"]) == sum(c["n_arcos"] for c in bf["sem_ciclo"]["componentes"])
    assert len(m["dij_arcos"]) == sum(p["n_arcos"] for p in dj["pares"])
    assert {l["par"] for l in m["dij_arcos"]} == {1, 2, 3, 4, 5}
    assert all(l["camada"] >= 0 for l in m["busca_nos"])


def test_ler_arestas_marca_recorte_sem_ciclo(tmp_path):
    csv_ = tmp_path / "a.csv"
    csv_.write_text("origem,destino,peso,temporada,time,ocorrencias,saldo12_depois,saldo12_antes,min_depois,min_antes\n"
                    "A|X|2024,B|X|2024,-1.5,2024,X,2,1,2.5,3,4\n"
                    "B|X|2024,A|X|2024,2,2024,X,1,,,,\n", encoding="utf-8")
    linhas = ne.ler_arestas(csv_, {"A|X|2024": 100.0, "B|X|2024": 50.0})
    assert [l["no_recorte_sem_ciclo"] for l in linhas] == [True, False]
    assert linhas[0]["peso"] == -1.5 and linhas[1]["saldo12_depois"] is None


def test_credenciais_padrao(monkeypatch):
    monkeypatch.delenv("NEO4J_AUTH", raising=False)
    monkeypatch.delenv("NEO4J_URI", raising=False)
    assert ne._credenciais() == ("bolt://localhost:7687", ("neo4j", "grafos2026"))
