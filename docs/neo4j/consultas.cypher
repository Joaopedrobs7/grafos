// [IA] Claude – consultas prontas para o Neo4j Browser (http://localhost:7474) sobre o grafo de rotação
// Pré-requisitos: docker compose -f docker-compose.neo4j.yml up -d  e  python -m src.parte2.neo4j_export
// Modelo: (X:Jogador)-[:SAIU_PARA]->(Y:Jogador) = "Y entrou no lugar de X", peso = saldo12(Y) - saldo12(X).
// Os caminhos, ciclos e camadas marcados vieram dos algoritmos do grupo (src/graphs/algorithms.py), calculados em
// Python e gravados em out/parte2/*.json. Nenhuma consulta abaixo usa algoritmo de grafo do Neo4j/GDS.
// Para trocar o time-temporada, altere os parâmetros (no Browser, rode a linha :param antes da consulta).

:param time => 'MIL';
:param temporada => 2022;

// 0. Contagens (conferência da importação)
MATCH (j:Jogador) WITH count(j) AS jogadores
MATCH ()-[r:SAIU_PARA]->() WITH jogadores, count(r) AS arcos, sum(CASE WHEN r.peso < 0 THEN 1 ELSE 0 END) AS negativos
MATCH (c:CicloNegativo) WITH jogadores, arcos, negativos, count(c) AS nos_ciclo
RETURN jogadores, arcos, negativos, nos_ciclo;

// 1. Rotação de um time-temporada (todos os arcos do componente)
MATCH (x:Jogador {time: $time, temporada: $temporada})-[r:SAIU_PARA]->(y:Jogador)
RETURN x, r, y;

// 1b. Mesma rotação em tabela, ordenada pelo peso
MATCH (x:Jogador {time: $time, temporada: $temporada})-[r:SAIU_PARA]->(y:Jogador)
RETURN x.nome AS saiu, y.nome AS entrou, r.peso AS peso, r.ocorrencias AS ocorrencias
ORDER BY peso;

// 2. Ciclo negativo detectado pelo Bellman-Ford do grupo no time-temporada
MATCH (x:CicloNegativo {time: $time, temporada: $temporada})-[r:SAIU_PARA {ciclo_negativo: true}]->(y:CicloNegativo)
RETURN x, r, y;

// 2b. Ciclo de exemplo com 7 arcos (CHI 2024, custo -53,7648 em out/parte2/bellman_ford.json)
MATCH (x:CicloNegativo {time: 'CHI', temporada: 2024})-[r:SAIU_PARA {ciclo_negativo: true}]->(y)
RETURN x, r, y;

// 2c. Custo do ciclo negativo por time-temporada (valor calculado em Python)
MATCH ()-[r:SAIU_PARA {ciclo_negativo: true}]->()
RETURN r.time AS time, r.temporada AS temporada, count(r) AS arcos_ciclo, max(r.custo_ciclo) AS custo_ciclo
ORDER BY temporada, time;

// 3. Caminho mínimo do Bellman-Ford no recorte sem ciclo (minutos(X) > minutos(Y)), do principal ao destino
MATCH (x:CaminhoBF {time: $time, temporada: $temporada})-[r:SAIU_PARA {em_caminho_bf: true}]->(y:CaminhoBF)
RETURN x, r, y;

// 3b. Recorte sem ciclo inteiro do time-temporada, para comparar com o caminho
MATCH (x:Jogador {time: $time, temporada: $temporada})-[r:SAIU_PARA {no_recorte_sem_ciclo: true}]->(y)
RETURN x, r, y;

// 3c. Fonte, destino e custo do caminho do Bellman-Ford em cada time-temporada
MATCH (d:DestinoBF)
RETURN d.time AS time, d.temporada AS temporada, d.fonte_bf AS fonte, d.nome AS destino, d.custo_bf AS custo
ORDER BY temporada, time;

// 4. Os 5 caminhos do Dijkstra (Johnson no recorte sem ciclo), um por par
MATCH (x)-[r:SAIU_PARA {em_caminho_dijkstra: true}]->(y)
RETURN x, r, y;

// 5. Camadas da BFS a partir das 3 fontes (out/parte2/bfs_dfs.json)
MATCH (j:Jogador) WHERE j.camada_bfs IS NOT NULL
RETURN j.fonte_busca AS fonte, j.camada_bfs AS camada, collect(j.nome) AS jogadores
ORDER BY fonte, camada;

// 6. Top 20 jogadores por impacto_medio (atributo calculado em Python em jogadores.csv, só ordenação)
MATCH (j:Jogador) WHERE j.impacto_medio IS NOT NULL
RETURN j.nome AS jogador, j.time AS time, j.temporada AS temporada, j.minutos AS minutos,
       j.entradas AS entradas, j.impacto_medio AS impacto_medio
ORDER BY impacto_medio DESC
LIMIT 20;

// 6b. Mesmo ranking dentro do time-temporada
MATCH (j:Jogador {time: $time, temporada: $temporada})
RETURN j.nome AS jogador, j.minutos AS minutos, j.impacto_medio AS impacto_medio
ORDER BY impacto_medio DESC;
