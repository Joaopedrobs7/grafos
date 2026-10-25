# Labirinto com Chaves — Grafo de Estados

Projeto de Teoria dos Grafos + AVD (CESAR School, 2026.2). A Parte 1 transforma mapas de
labirinto (`data/mapas/*.txt`) em um **grafo de estados dirigido** — estado = (linha, coluna,
chaves, bônus consumidos) — e roda BFS, DFS, Dijkstra e Bellman-Ford implementados pelo grupo
(sem networkx; ele só aparece em `tests/` como oráculo).

A mesma aplicação também é servida como **aplicação web** (Flask + gunicorn atrás do Apache),
usada na disciplina de Cloud (EC2 + AMI + Auto Scaling Group + Application Load Balancer).
Veja [`docs/cloud/ARQUITETURA_AWS.md`](docs/cloud/ARQUITETURA_AWS.md).

## Instalação

```bash
python3.11 -m venv .venv && source .venv/bin/activate   # Python 3.11+
pip install -r requirements.txt
```

## Como executar

```bash
# todas as saídas obrigatórias da Parte 1 (CSV/JSON, figuras e HTML interativo)
python -m src.cli --todos --out ./out/parte1/

# um mapa / um algoritmo
python -m src.cli --mapa ./data/mapas/m03_tres_chaves.txt --alg BFS --out ./out/parte1/
python -m src.cli --mapa ./data/mapas/m03_tres_chaves.txt --alg DIJKSTRA --out ./out/parte1/
python -m src.cli --mapa ./data/mapas/m05_bonus.txt --alg BELLMAN_FORD --out ./out/parte1/
python -m src.cli --mapa ./data/mapas/m06_fonte.txt --alg BELLMAN_FORD --fonte-consumivel --out ./out/parte1/
python -m src.cli --mapa ./data/mapas/m04_esteiras.txt --armadilhas --out ./out/parte1/
python -m src.cli --mapa ./data/mapas/m03_tres_chaves.txt --interactive --out ./out/parte1/

# testes
pytest -q

# aplicação web local (http://localhost:8000)
python -m src.web.app
```

## Estrutura

```
data/mapas/          mapas fornecidos m01–m08
data/mapas_grupo/    g01_fabrica (3 chaves + esteira + bônus) e g02_armadilha (59,6% de armadilhas)
src/graphs/io.py     leitura e validação dos mapas
src/graphs/graph.py  lista de adjacência dirigida
src/graphs/estados.py  G_pos e G_est (exploração BFS a partir do início, nó virtual ALVO)
src/graphs/algorithms.py  BFS, DFS (árvore/retorno/avanço/cruzamento), Dijkstra, Bellman-Ford
src/solve.py         orquestração e arquivos de out/parte1/
src/viz.py           figuras (matplotlib) e montagem do HTML interativo
src/cli.py           linha de comando
src/web/             aplicação Flask (API + labirinto interativo + identificação da instância EC2)
deploy/              user data, systemd, Apache e script de atualização para EC2
tests/               pytest (bfs, dfs, dijkstra, bellman_ford, estados, io)
out/parte1/          saídas geradas
```

## Regras implementadas

- Movimentos N, L, S, O (essa ordem define a lista de adjacência); custo = custo da casa de destino.
- Porta só com a chave correspondente; esteira só deixa sair na direção da seta; estados em `G` não
  têm saída e ligam ao nó virtual `ALVO` com custo 0 (não entra nas métricas nem em `arestas_*.csv`).
- `+` vale −4 na primeira entrada (o índice entra no conjunto de bônus do estado) e 1 depois.
- `*` vale −2 sempre. Com `--fonte-consumivel`, cada `*` passa a se comportar como um bônus de −2
  (numerado depois dos `+`, em ordem de leitura) e o Bellman-Ford do m06 volta a ter resposta finita.
- Dijkstra recusa (status `RECUSA`) qualquer grafo com arco negativo.

## Resultados (gerados por `--todos`)

| mapa | estados | arcos | BFS (passos) | menor custo | observação |
|---|---|---|---|---|---|
| m01 | 24 | 46 | 10 | 20 (Dijkstra) | BFS custa 30 |
| m02 | 39 | 74 | 34 | 46 | |
| m03 | 213 | 466 | 87 | 99 (91 passos) | ordem a → b → c |
| m04 | 37 | 66 | 20 | 36 | armadilhas em `armadilhas_m04.csv` |
| m05 | 215 | 438 | 12 | 5 (Bellman-Ford) | Dijkstra recusa |
| m06 | 24 | 46 | 10 | ciclo negativo −1 | com `--fonte-consumivel`: custo 10 |
| m07 | 16 | 38 | — | — | sem solução |
| m08 | 2919 | 6364 | 392 | 482 (396 passos) | |
| g01 | 186 | 346 | 42 | 37 (Bellman-Ford) | passa por bônus e esteira |
| g02 | 94 | 212 | 10 | 10 | 56 de 94 estados são armadilha |

## Status da entrega parcial

Feito: Parte 1 (código, saídas obrigatórias, figuras, HTML interativo, mapas do grupo, testes) e
o deploy web. Pendente: PDF (manual + técnica, prova do m05, discussões, matriz de contribuição),
`docs/DECLARACAO_IA.pdf` assinada e a Parte 2 inteira (dataset, benchmark, AVD).

## Uso de IA

Partes deste código foram geradas com apoio de IA (Claude) e estão marcadas com `# [IA]`.
Esse uso precisa constar na Declaração de Uso de IA (`docs/DECLARACAO_USO_IA_2026-2.docx`).
