# Labirinto com Chaves — Grafo de Estados

Projeto de Teoria dos Grafos + AVD (CESAR School, 2026.2). A Parte 1 transforma mapas de
labirinto (`data/mapas/*.txt`) em um **grafo de estados dirigido** — estado = (linha, coluna,
chaves, bônus consumidos) — e roda BFS, DFS, Dijkstra e Bellman-Ford implementados pelo grupo
(sem networkx; ele só aparece em `tests/` como oráculo).

A mesma aplicação também é servida como **aplicação web** (Flask + gunicorn atrás do Apache),
usada na disciplina de Cloud (EC2 + AMI + Auto Scaling Group + Application Load Balancer).
Veja [`docs/cloud/ARQUITETURA_AWS.md`](docs/cloud/ARQUITETURA_AWS.md).

<!-- [IA] Claude – resumo da Parte 2 -->
A Parte 2 aplica os mesmos algoritmos a um grafo dirigido e ponderado da **NBA** (2000 a 2025): 776 nós
(time + temporada), 22.378 arcos e 11.006 pesos negativos, com benchmark, escalabilidade e tabelas de apoio à AVD.

## Instalação

<!-- [IA] Claude – ativação do venv no Windows e no Linux/macOS -->
Python 3.11+. Na raiz do repositório:

```powershell
# Windows (PowerShell)
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

```bash
# Linux/macOS
python3.11 -m venv .venv
source .venv/bin/activate
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

<!-- [IA] Claude – comandos da Parte 2 -->
**Parte 2** (o `arestas.csv` já está no repositório; os dados brutos vêm do DVC):

```bash
python -m src.cli --dataset ./data/dataset_parte2/                                       # |V| e |E|
python -m src.cli --dataset ./data/dataset_parte2/ --alg BFS --source "ATL|2000"
python -m src.cli --dataset ./data/dataset_parte2/ --alg DFS --source "ATL|2000"
python -m src.cli --dataset ./data/dataset_parte2/ --alg DIJKSTRA --source "ATL|2000" --target "SAN|2000"
python -m src.cli --dataset ./data/dataset_parte2/ --alg BELLMAN_FORD --source "ATL|2000"
python -m src.cli --dataset ./data/dataset_parte2/ --benchmark --out ./out/parte2/       # tempos e escalabilidade

python -m src.parte2.buscas      # BFS/DFS de 3 fontes        -> out/parte2/bfs_dfs.json
python -m src.parte2.caminhos    # Dijkstra em 5 pares        -> out/parte2/dijkstra.json
python -m src.parte2.bellman     # com ciclo e sem ciclo      -> out/parte2/bellman_ford.json
python -m src.parte2.graficos    # gráficos de comparação     -> out/parte2/graficos/
python -m src.avd.descricao      # descrição do grafo         -> out/avd/
python -m src.avd.tabelas        # tabelas de apoio à AVD     -> out/avd/tabelas/ (precisa dos dados brutos)
```

Nas tabelas de apoio, a média de um time na temporada só é calculada quando o atributo existe em pelo menos 80% dos
jogos, sem imputação. As colunas de detalhe (quartos, banco, garrafão etc.) faltam em 50,2% das linhas de 2000 e 99,9% de 2021.

<!-- [IA] Claude – roteiro do mapa surpresa, testado em 23/11 -->
### Mapa surpresa (apresentação)

```bash
python -m src.cli --mapa surpresa.txt --alg BFS --out ./out/surpresa/
python -m src.cli --mapa surpresa.txt --alg DIJKSTRA --out ./out/surpresa/
python -m src.cli --mapa surpresa.txt --alg BELLMAN_FORD --out ./out/surpresa/
python -m src.cli --mapa surpresa.txt --armadilhas --out ./out/surpresa/
python -m src.cli --mapa surpresa.txt --interactive --out ./out/surpresa/  # HTML com esse mapa
```

Na interface, o botão de carregar mapa só resolve com o servidor rodando (`python -m src.web.app`); no HTML
estático ele mostra o comando acima. O leitor recusa **espaço no fim da linha** e **BOM** (arquivo salvo como
"UTF-8 com BOM" no Bloco de Notas): se aparecer esse erro, salve o mapa como UTF-8 sem espaços sobrando.

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

<!-- [IA] Claude – menu de projetos e uma rota por parte -->
`/` abre o menu de projetos (estilo tela de seleção de videogame: ↑/↓ ou W/S escolhem, Enter abre).
A Parte 1 fica em `/parte1` (`/labirinto` redireciona para lá) e a Parte 2 em `/parte2`, por
enquanto uma página provisória; os resultados da Parte 2 ficam em `out/parte2/`.

```
src/web/templates/menu.html         menu de projetos em "/" (Parte 1 liberada, Parte 2 trancada)
src/web/templates/labirinto.html    Parte 1 em "/parte1": navbar, hero, player, manual, CTA e rodapé
src/web/templates/parte2.html       Parte 2 em "/parte2" (provisória)
src/web/templates/404.html          página 404 independente
src/web/static/js/menu.js           cursor do menu, parede de pedra e pill do servidor (menu e Parte 2)
src/web/static/css/menu.css         estilos do menu e da página da Parte 2
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
formam "404", a saída fica presa dentro do zero e o aluno anda entre os becos sem saída (dá para clicar no chão ou usar as setas). Respeita `prefers-reduced-motion`
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


<!-- [IA] Claude – branches e de onde cada ambiente puxa o código -->
## Branches e deploy

| Branch | Papel |
|---|---|
| `main` | integração: Parte 1 + Parte 2, com o menu de projetos em `/`. É o que vai para produção. |
| `entrega2` | desenvolvimento da Parte 2; entra na `main` por pull request |

Versões entregues ficam em **tags** (não em branches): `entrega1` (Parte 1, 17/11/2026) e `ex05-rds`
(Cloud, Exercício 05). Para ver uma delas: `git checkout entrega1`.

- **AWS:** o Auto Scaling Group faz deploy da `main` (`deploy/boot.sh`, `BRANCH=main`); `/api/info`
  mostra a versão em execução (`main@<commit>`).
- **Vercel:** a branch de produção do projeto deve ser a `main` (Settings → Git → Production Branch).

<!-- [IA] Claude – dados da Parte 2: download, versionamento com DVC e preparação -->
## Parte 2 — dataset (NBA, Kaggle + DVC)

Dataset: [Historical NBA Data and Player Box Scores](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores)
(licença CC0). Os arquivos não vão para o git: o **DVC** guarda o snapshot usado pelo grupo no drive
compartilhado do Google Drive (o Kaggle atualiza o dataset todo dia; o `dvc.lock` fixa a versão).

<!-- [IA] Claude – descrição do modelo atual e dos casos implementados -->
Modelagem: **nó = time + temporada**, ex. `LAL|2024` (temporada 2024-25); há **um arco em cada sentido** entre dois
times que se enfrentaram na temporada; **peso de A para B = −(saldo médio de pontos de A sobre B)**, então é negativo
quando A leva vantagem no confronto. Recorte: temporada regular de 2000 a 2025.

| Caso | Como é calculado |
|---|---|
| Dijkstra (5 pares) | custo `w' = -log P(vitória) = log(1 + exp(w / s))`, com `s = 13,712 · √3 / π ≈ 7,56` |
| Bellman-Ford com ciclo | subgrafo de cada temporada (ciclo negativo nas 26) |
| Bellman-Ford sem ciclo | em cada temporada, só arcos do time de maior saldo para o de menor (grafo acíclico) |
| Escalabilidade | 10%, 50% e 100% das **temporadas** (V = 91, 390, 777; E = 2.613, 11.255, 22.404), com o nó `INICIO` ligado a uma entrada por temporada |

```bash
dvc pull            # baixa raw/ e processed/ do drive do grupo (1ª vez abre o login do Google)
dvc repro           # refaz só o que mudou: baixar (Kaggle) -> preparar (params.yaml)
```

| Estágio | Comando | Saída |
|---|---|---|
| `baixar` | `python -m src.parte2.baixar` | `data/dataset_parte2/raw/` (CSV do Kaggle + `MANIFESTO.json` com SHA-256) |
| `preparar` | `python -m src.parte2.preparar` | `data/dataset_parte2/processed/arestas.csv`, `nos.csv`, `relatorio_preparacao.json` |

`params.yaml` controla a limpeza (tipos de jogo, intervalo de temporadas, sinal do peso). A temporada e o tipo
de jogo vêm do `gameId` (ex.: os playoffs da "bolha" de 2020 pertencem à temporada 2019-20).

**Acesso ao remoto (cada integrante, uma vez):** o e-mail precisa estar em *Usuários de teste* no projeto
`grafos-dvc` do Google Cloud e como membro do drive compartilhado. Peça o arquivo `client_secret_*.json` a quem
administra (nunca pelo repositório) e rode:

```bash
python - client_secret_XXXX.json <<'PY'
import json, subprocess, sys
c = json.load(open(sys.argv[1]))["installed"]
for k, v in (("gdrive_client_id", c["client_id"]), ("gdrive_client_secret", c["client_secret"])):
    subprocess.run(["dvc", "remote", "modify", "--local", "gdrive", k, v], check=True)
PY
```

As credenciais ficam em `.dvc/config.local`, fora do git.

## Estrutura

<!-- [IA] Claude – linha tests/ inclui test_algorithms.py -->
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
src/web/             aplicação Flask (menu de projetos, API, labirinto interativo, identificação da instância EC2)
deploy/              user data, systemd, Apache e script de atualização para EC2
src/parte2/          dataset da NBA: baixar, preparar, buscas, caminhos, bellman, desempenho, graficos
src/avd/             descrição do grafo e tabelas de apoio à análise exploratória
tests/               pytest (algorithms, bfs, dfs, dijkstra, bellman_ford, estados, io, traco, web, parte2, avd)
out/parte1/          saídas geradas da Parte 1
out/parte2/          parte2_report.json, resultados dos algoritmos e gráficos de comparação
out/avd/             descrição do grafo e tabelas de apoio (out/avd/tabelas/)
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

## Status

Feito: Parte 1 (código, saídas obrigatórias, figuras, HTML interativo, mapas do grupo, testes), deploy web e, na
Parte 2, dataset, casos dos 4 algoritmos, benchmark, escalabilidade, gráficos de comparação e tabelas de apoio à AVD.

Pendente: análise exploratória e explanatória (AVD), visualizações e notas analíticas, discussão crítica, PDF (manual +
técnica, prova do m05, discussões, matriz de contribuição) e `docs/DECLARACAO_IA.pdf` assinada.

## Uso de IA

Partes deste código foram geradas com apoio de IA (Claude) e estão marcadas com `# [IA]`.
<!-- [IA] Claude – aponta para a declaração assinada em PDF -->
Esse uso precisa constar na Declaração de Uso de IA (`docs/DECLARACAO_IA.pdf`).

- Declaração em edição (Google Docs): <https://docs.google.com/document/d/114ikHSDgZ674UKYB-E7fYnSYn1WqNbiF/edit>
- Versão final assinada: `docs/DECLARACAO_IA.pdf`.
- A primeira versão de `io.py`, `estados.py`, `graph.py` e `algorithms.py` (25/10) foi um protótipo gerado com IA só
  para validar o funcionamento do projeto; em 17/11 o grupo reescreveu esses arquivos à mão (commits `58cd061` e `3899ee2`).
  Em `algorithms.py` restam apenas os ganchos de visualização `observador=None`, marcados com `# [IA]`, que não alteram
  a lógica.
