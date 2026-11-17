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
```

### Front-end

A página é um jogo e o seu manual: um diorama 3D em pixel art em que um aluno da CESAR School
(de moletom com a marca da CESAR em pixel art) percorre o caminho calculado pelo algoritmo, pega
as chaves e abre as portas. Não há etapa de build: HTML, CSS e scripts clássicos (sem módulos ES)
que compartilham o objeto global `window.LAB`. Three.js r159 e as fontes (Pixelify Sans e DM Sans,
licença OFL) ficam no repositório; as texturas são desenhadas em canvas, sem arquivos de imagem.

```bash
python -m src.web.app                 # http://localhost:8000
PORT=8765 python -m src.web.app       # outra porta
```

```
src/web/templates/labirinto.html    página: navbar, hero, player, manual, CTA e rodapé
src/web/templates/404.html          página 404 independente
src/web/static/vendor/three.min.js  Three.js r159 (global THREE)
src/web/static/js/pixel.js          paleta, texturas procedurais, marca da CESAR e sprite 2D do aluno (LAB.pixel)
src/web/static/js/voxel.js          aluno, chaves, portas, bônus e saída em voxels (LAB.voxel)
src/web/static/js/maze3d.js         diorama 3D: cena, câmera e animações do percurso (LAB.Maze3D)
src/web/static/js/app.js            dados (API ou embutidos), controles, HUD, linha do tempo e desenho 2D de reserva
src/web/static/css/app.css          estilos da página
src/web/static/fonts/               Pixelify Sans e DM Sans (woff2 + licenças)
src/web/static/favicon.svg          ícone em pixel art (também servido em /favicon.ico)
```

A ordem de carga é `three.min.js` → `pixel.js` → `voxel.js` → `maze3d.js` → dados → `app.js`.

**Arquivo standalone.** `--todos` e `--interactive` geram `out/parte1/labirinto_interativo.html`
com `gerar_html_interativo` (`src/viz.py`). Cada `<link>` e `<script src>` marcado com `data-inline`
no template vira conteúdo embutido (as fontes entram em base64 dentro do CSS, o favicon vira data
URI) e o marcador `/*__DADOS_EMBUTIDOS__*/` vira `window.__DADOS__`, com todos os mapas já
resolvidos. O arquivo abre direto no navegador, sem servidor. Se um arquivo marcado não existir,
a geração para com `ValueError` em vez de produzir uma página quebrada.

**Passo a passo dos algoritmos (traços).** O navegador não constrói o grafo nem roda algoritmo:
`bfs`, `dfs`, `dijkstra` e `bellman_ford` aceitam um `observador=None` opcional (só por palavra-chave)
que recebe um evento por passo (BFS `inicio/sai/olha/entra/encerra`; DFS `descobre/olha/encerra`;
Dijkstra `fecha/relaxa/descarta`; Bellman-Ford `passada/relaxa/fimPassada/ciclo`). Sem observador o
código roda como antes. `src/traco.py` só monta o G_est, roda essas funções com o observador e devolve
um JSON compacto (rótulos, adjacência, resultado final e eventos com nós como índices; ∞ vira `null`),
que o front reproduz nas tabelas da aula. A DFS roda em `ge.sem_alvo`, como em `dfs_classificacao.csv`.

| Rota | O que faz |
|---|---|
| `GET api/mapa/<nome>` | dados do mapa + `metricas` (`global` e `camadas`, as mesmas de `metricas_global.json`/`camadas.json`) e `comparacao_modelagem` (quando o mapa tem portas) |
| `GET api/traco/<nome>?alg=BFS\|DFS\|DIJKSTRA\|BELLMAN_FORD&fonte=0\|1` | traço do algoritmo (em cache) |
| `POST api/mapa` | mapa surpresa: o corpo é o texto do mapa (até 64 KB); devolve o mesmo formato com nome `personalizado`; mapa inválido → 400 `{"erro": mensagem do MapaInvalido}` |
| `POST api/traco?alg=...&fonte=...` | traço de um mapa enviado no corpo |

Mapas enviados não entram no histórico do RDS (só os mapas do repositório são gravados) e são recusados
se o teto teórico de estados passar de 250 000. No arquivo standalone os traços de todos os mapas vão
embutidos em `window.__TRACOS__` (`{mapa: {"BFS": traço, ..., "BELLMAN_FORD_FONTE_CONSUMIVEL": ...}}`).

**Página 404.** Endereços desconhecidos recebem `404.html` com status 404: as paredes do labirinto
formam "404", a saída fica presa dentro do zero e o aluno anda entre os becos sem saída (o trajeto
é uma BFS de verdade; dá para clicar no chão ou usar as setas). Respeita `prefers-reduced-motion`
e continua funcionando se o `pixel.js` ou as fontes não carregarem. Rotas `/api/*` mantêm o 404
padrão do Flask.

### Histórico de consultas no banco (Cloud, Exercício 05)

Detalhe periférico da aplicação web: cada mapa aberto na página grava uma linha por algoritmo
num MySQL (Amazon RDS), e o painel "Últimas consultas (RDS)" mostra as mais recentes, com a
instância do Auto Scaling Group que atendeu. Mapas e algoritmos não dependem do banco; sem
`DB_HOST` o painel simplesmente não aparece.

```bash
DB_HOST=<endpoint do RDS> DB_USER=labirinto_app DB_PASSWORD=<senha> DB_NAME=labirinto python -m src.web.app
```

- `deploy/db/schema.sql`: tabelas `algoritmo` e `execucao`, carga inicial e usuário `labirinto_app`.
- Na EC2, as variáveis ficam em `/etc/labirinto/db.env` (lido pelo `deploy/labirinto.service`).

### Deploy na AWS

As instâncias do Auto Scaling Group sobem da AMI e, no boot, o user data do launch template
(`deploy/boot.sh`) baixa a `main` do GitHub e reinicia a aplicação. Para publicar uma mudança:
push na `main` e, no console, **Auto Scaling Group → Atualização da instância → Iniciar**.
`/api/info` mostra a versão em execução (`main@<commit>`).

## Estrutura

```
data/mapas/          mapas fornecidos m01–m08
data/mapas_grupo/    g01_fabrica (3 chaves + esteira + bônus) e g02_armadilha (59,6% de armadilhas)
src/graphs/io.py     leitura e validação dos mapas
src/graphs/graph.py  lista de adjacência dirigida
src/graphs/estados.py  G_pos e G_est (exploração BFS a partir do início, nó virtual ALVO)
src/graphs/algorithms.py  BFS, DFS (árvore/retorno/avanço/cruzamento), Dijkstra, Bellman-Ford
src/solve.py         orquestração e arquivos de out/parte1/
src/traco.py         cola de visualização: eventos dos algoritmos em JSON para o front (sem lógica de algoritmo)
src/viz.py           figuras (matplotlib) e montagem do HTML interativo
src/cli.py           linha de comando
src/web/             aplicação Flask (API + labirinto interativo + identificação da instância EC2)
deploy/              user data, systemd, Apache e script de atualização para EC2
tests/               pytest (bfs, dfs, dijkstra, bellman_ford, estados, io, traco, web)
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
