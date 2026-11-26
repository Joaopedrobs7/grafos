# Parte 2: como o peso é calculado e como cada algoritmo usa

Material de estudo para a arguição. Descreve o que o código faz (`src/parte2/rotacao.py`,
`src/parte2/rotacao_casos.py`, `src/parte2/par.py` e `src/graphs/algorithms.py`) e os números das saídas em
`out/parte2/`. As discussões e conclusões do relatório são texto do grupo e não estão aqui.

---

## 1. O grafo de rotação em uma frase

- **Nó**: um jogador dentro de um time-temporada, rótulo `Nome|TIM|ano` (ano = início da temporada; `2024` = 2024-25).
- **Arco X → Y**: "Y entrou no lugar de X" (substituição 1 por 1 no jogada a jogada).
- **Peso do arco**: quanto o **saldo do time** (pontos feitos menos pontos sofridos) muda, a cada 12 minutos,
  depois da troca.
- Tamanho: **3.507 nós, 21.672 arcos, 10.616 arcos negativos, 180 times-temporada** (30 times × 6 temporadas,
  2020-21 a 2025-26). Os arcos nunca ligam times-temporada diferentes, então cada time-temporada é uma parte
  separada do grafo.

## 2. A fórmula do peso

Para cada substituição de X por Y, o código mede dois trechos do jogo:

| Trecho | Começa | Termina | Mede |
|---|---|---|---|
| **antes** (X em quadra) | quando X entrou, ou no início do período | na troca | `saldo_antes`, `min_antes` |
| **depois** (Y em quadra) | na troca | quando Y sai, ou no fim do período | `saldo_depois`, `min_depois` |

Todas as vezes que a mesma troca X → Y aconteceu na temporada são **somadas antes de dividir**:

```
peso(X → Y) = 12 × (Σ saldo_depois / Σ min_depois)  −  12 × (Σ saldo_antes / Σ min_antes)
              └──── ritmo do saldo com Y ─────┘     └──── ritmo do saldo com X ─────┘
```

- **Peso positivo**: o time passou a jogar melhor depois da troca.
- **Peso negativo**: o time passou a jogar pior.
- O sinal vem direto do placar, sem inversão.

### Exemplo real (`data/dataset_parte2/rotacao/arestas_rotacao.csv`)

Arco **Al Horford → Jayson Tatum** (BOS, 2024-25), troca que aconteceu **6 vezes**:

| | saldo somado | minutos somados | saldo a cada 12 min |
|---|---|---|---|
| antes (Horford em quadra) | −14 | 28,13 | 12 × (−14 / 28,13) = **−5,97** |
| depois (Tatum em quadra) | +10 | 38,09 | 12 × (10 / 38,09) = **+3,15** |
| **peso do arco** | | | 3,15 − (−5,97) = **+9,12** |

Leitura: "quando Tatum entrou no lugar de Horford, o saldo do time a cada 12 min ficou, em média, 9,12 pontos
melhor do que antes". É essa frase que aparece no hover das arestas do site.

### Por que somar antes de dividir (e não tirar a média dos pesos de cada troca)

Uma troca que durou 40 segundos e outra que durou 10 minutos não podem valer o mesmo. Somando saldo e minutos
antes de dividir, cada minuto jogado pesa igual. A média simples daria a um trecho de 40 s, em que um único
arremesso de 3 vira "+45 por 12 min", o mesmo peso de um trecho longo.

## 3. Filtros que protegem o peso (`params.yaml`, seção `rotacao`)

| Filtro | Valor | Por quê |
|---|---|---|
| Só trocas **1 por 1** | | Em trocas múltiplas o dado não diz quem saiu por quem. |
| `min_ocorrencias` | **2** | Uma troca que aconteceu uma vez só é ruído. |
| `min_minutos` | **3** (antes e depois, somados) | Evita dividir por quase zero minutos. |
| Temporada regular, 2020-21 a 2025-26 | | Temporadas completas no formato novo do jogada a jogada. |

## 4. Por que "a cada 12 minutos" (o ×12)

- O ×12 é só a **unidade**: 12 minutos = 1 quarto de jogo da NBA, uma escala fácil de imaginar.
- O resultado é **determinístico**, não uma projeção: o mesmo dado sempre gera o mesmo peso. O ×12 não prevê
  nada; ele só converte "pontos por minuto" em "pontos por quarto".
- **Não muda nenhum resultado dos algoritmos.** Multiplicar todos os pesos por uma constante positiva
  (12) multiplica o custo de **todo** caminho e de **todo** ciclo pela mesma constante:
  - o caminho mais barato continua o mais barato (a ordem entre custos não muda);
  - um ciclo negativo continua negativo (12 × negativo = negativo).
  Com "pontos por minuto" os algoritmos dariam exatamente os mesmos caminhos e ciclos.

## 5. Como cada algoritmo usa o peso

O custo de um caminho é sempre a **soma dos pesos originais** dos arcos (no site: "Custo do caminho").

### BFS: ignora o peso

- Conta **arcos** (trocas), não soma pesos. Acha o caminho com **menos trocas** da origem até cada jogador.
- Peso negativo não atrapalha em nada, porque ele não olha o peso.
- Custo exibido no site = soma dos pesos do caminho que a BFS achou (calculada depois; não é o que ela minimiza).

### DFS: ignora o peso

- Explora em profundidade e classifica os arcos (árvore, retorno, avanço, cruzamento).
- Arco de **retorno** = existe ciclo no grafo (em qualquer peso). Serve para mostrar que o grafo de rotação
  tem ciclos (X sai por Y, e em outro jogo Y sai por X).

### Dijkstra: recusa os pesos originais

- O Dijkstra "fecha" o nó mais próximo e assume que nenhum caminho que chegue depois fica mais barato. Com
  arco negativo isso deixa de ser verdade.
- O grafo tem 10.616 arcos negativos, então o código do grupo **recusa** antes de rodar:
  `"Dijkstra não aceita peso negativo. Use Bellman-Ford."` (status `RECUSA`).

### Dijkstra no recorte sem ciclo: reponderação de Johnson

Para o Dijkstra rodar, o código usa a **reponderação de Johnson** (`johnson` em `rotacao_casos.py`), que só
funciona em grafo **sem ciclo negativo**. Por isso ela é aplicada no **recorte "descer na rotação"** (seção 6):

1. Cria uma **super-fonte** `JOHNSON` com arco de peso 0 para cada nó.
2. Roda o **Bellman-Ford do grupo** a partir dela: `h(v)` = menor distância da super-fonte até v (h ≤ 0).
3. Troca cada peso por `w'(u,v) = w(u,v) + h(u) − h(v)`. Pela desigualdade triangular
   (`h(v) ≤ h(u) + w(u,v)`), todo `w'` fica **≥ 0**. O Dijkstra passa a aceitar o grafo.
4. Roda o Dijkstra com `w'`.
5. **Reconverte** o custo: `custo_original = dist'(destino) − h(origem) + h(destino)`.

Por que o caminho não muda: num caminho de s até t, os `h` do meio se cancelam (soma telescópica):

```
Σ w'(arcos) = Σ w(arcos) + h(s) − h(t)
```

Todo caminho de s até t recebe o **mesmo** acréscimo `h(s) − h(t)`. Então o mais barato com `w'` é o mais
barato com `w`.

Exemplo real (`out/parte2/dijkstra.json`, HOU 2020-21, de Jae'Sean Tate até Armoni Brooks, 6 arcos):
`h(origem) = 0`, `h(destino) = −81,61`, custo com `w'` = 0, reconvertido = 0 − 0 + (−81,61) = **−81,61**, igual ao
Bellman-Ford. Nos 5 pares testados, Dijkstra (com Johnson) e Bellman-Ford dão **o mesmo caminho e o mesmo custo**.

### Bellman-Ford: usa os pesos originais, com o sinal

- Relaxa todos os arcos |V| − 1 vezes e depois faz mais uma passada. Se ainda dá para baixar alguma
  distância, existe **ciclo negativo** alcançável, e ele devolve o ciclo em vez de distâncias.
- **No grafo completo**: ciclo negativo em **180 de 180** times-temporada.
  Exemplo (ATL 2020-21): `Trae Young → Skylar Mays → Trae Young`, 2 arcos, **custo −12,54 por volta**.
  Dar mais uma volta sempre baixa o custo, então "menor custo" não existe nesse grafo.
- **No recorte sem ciclo**: **180 de 180** com status OK (caminho mínimo bem definido).

## 6. O recorte "descer na rotação" (por que ele não tem ciclo)

- Em cada time-temporada, fica só o arco X → Y quando **X jogou mais minutos que Y**
  (`minutos_medidos`, com desempate pelo rótulo).
- A ordem `(−minutos, rótulo)` é **total**: todo par de jogadores tem um "maior" e um "menor". Todo arco desce
  nessa ordem, e um ciclo teria que voltar a subir. Logo o recorte é **acíclico** (um DAG), sem ciclo nenhum,
  negativo ou não.
- Custo: perde os arcos que "sobem" na rotação. No site, quando o destino jogou mais minutos que a origem, o
  recorte mostra "sem caminho" e explica o motivo.

## 7. Resumo em tabela

| Algoritmo | Peso usado | Grafo completo (tem ciclo negativo) | Recorte sem ciclo |
|---|---|---|---|
| BFS | ignora (conta trocas) | roda | roda |
| DFS | ignora | roda; arcos de retorno mostram ciclos | roda; sem arcos de retorno |
| Dijkstra | precisa de peso ≥ 0 | **recusa** | roda com **Johnson** (`w' ≥ 0`), custo reconvertido |
| Bellman-Ford | peso original, com sinal | **detecta o ciclo negativo** (180/180) | **menor custo** (180/180) |

## 8. A segunda visão: grafo de partidas (`out/parte2/partidas/`)

Não é o grafo principal, mas usa outra transformação de peso, e ela pode cair na arguição:

- Arco A → B com peso `w` = saldo médio de A contra B (positivo se A venceu o confronto).
- Para usar Dijkstra, o peso vira **custo de vitória**: `w' = −log P(A vence B) = log(1 + exp(−w / s))`, com
  `s = 13,71 × √3 / π ≈ 7,56` (13,71 = desvio-padrão da margem por jogo).
- `w'` é sempre **> 0**, então não há ciclo negativo e o Dijkstra roda direto.
- Somar `−log P` ao longo do caminho é o mesmo que **multiplicar as probabilidades**, então o menor custo é a
  cadeia de vitórias mais provável.

## 9. Perguntas prováveis

1. **O que é um arco com peso −5?** O time, a cada 12 min, passou a ter saldo 5 pontos pior depois que Y entrou
   no lugar de X (média ponderada pelos minutos das vezes que a troca aconteceu).
2. **Por que o Dijkstra recusa?** Há arcos negativos. O Dijkstra fecha nós de forma gulosa e pode dar resposta
   errada sem avisar; o código recusa antes.
3. **Por que não somar uma constante grande para deixar tudo positivo?** Somar `c` a cada arco soma
   `c × (número de arcos)` ao caminho. Isso favorece caminhos curtos e muda o caminho mínimo. Johnson soma
   `h(u) − h(v)`, que se cancela ao longo do caminho, e por isso preserva o caminho mínimo.
4. **Por que Johnson não funciona no grafo completo?** O `h` vem do Bellman-Ford, que não devolve distâncias
   quando há ciclo negativo. E com ciclo negativo o caminho mínimo nem existe.
5. **O ×12 muda algum resultado?** Não. É escala positiva: mesmos caminhos, mesmos ciclos, mesmo sinal.
6. **O resultado é uma previsão?** Não. É uma medida do que aconteceu nos jogos (determinística). O ×12 só muda a
   unidade.
7. **Por que o recorte não tem ciclo?** Todo arco vai de quem jogou mais para quem jogou menos, numa ordem total;
   um ciclo teria que voltar para cima.
