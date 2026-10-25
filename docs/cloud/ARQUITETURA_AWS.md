# Exercício 04 — Auto Scaling e Load Balancing: Labirinto com Chaves na AWS

## 1. Escopo da aplicação

**Labirinto com Chaves** é um serviço web que resolve labirintos modelados como grafo de estados
(posição + chaves + bônus). O usuário escolhe um mapa e um algoritmo (BFS, Dijkstra, Bellman-Ford)
e o servidor constrói o grafo, calcula o caminho e devolve a animação passo a passo, os
estados-armadilha e as camadas. É CPU-bound (cada requisição monta e percorre um grafo de até
~3 mil estados), o que justifica a elasticidade: com muitas consultas simultâneas a CPU sobe e o
Auto Scaling adiciona uma segunda instância.

| Rota | Uso |
|---|---|
| `/` | interface do labirinto interativo |
| `/health` | health check do Target Group |
| `/api/info` | instance-id, AZ e IP privado de quem respondeu (via IMDSv2) |
| `/api/mapa/<nome>` | grade, caminhos, armadilhas e camadas de um mapa |
| `/api/resolver?mapa=m08_grande&alg=DIJKSTRA` | resultado resumido + tempo |
| `/api/carga?n=500` | resolve o m08 n vezes (gera carga para testar o scaling) |

Toda resposta tem o cabeçalho `X-Servido-Por: <instance-id>`, e a interface mostra
"servido por i-…" no topo: é assim que se comprova que o ALB está distribuindo entre os nós.

## 2. Arquitetura

```
                       Internet
                           │ HTTP :80
                ┌──────────▼───────────┐
                │ alb-labirinto (ALB)  │  sg-labirinto-alb: 80 de 0.0.0.0/0
                └───┬──────────────┬───┘
     ┌──────────────┼──────────────┼──────────────────── vpc-labirinto 10.0.0.0/16
     │  sn-pub-1a 10.0.1.0/24   sn-pub-1b 10.0.2.0/24   (rt-pub → igw-labirinto)
     │  ┌───────────▼──┐        ┌──▼───────────┐
     │  │ EC2 (ASG)    │        │ EC2 (ASG)    │  asg-labirinto: min 1 / desejada 1 / máx 2
     │  │ Apache :80   │        │ Apache :80   │  t2.micro, AMI ami-labirinto-v1
     │  │ └ gunicorn   │        │ └ gunicorn   │  sg-labirinto-app: 80 só do sg-labirinto-alb
     │  │   └ Flask    │        │   └ Flask    │                      22 só do seu IP
     │  └──────────────┘        └──────────────┘
     │  sn-priv-1a 10.0.3.0/24  sn-priv-1b 10.0.4.0/24  (rt-priv, sem rota para a internet)
     │  ┌──────────────┐
     │  │ ec2-privada  │  instância do exercício anterior; sg-labirinto-priv: 22 só do sg-labirinto-app
     │  └──────────────┘
     └──────────────────────────────────────────────────────────────────────
```

Requisição: cliente → ALB (porta 80) → Target Group `tg-labirinto` (HTTP 80, health `/health`)
→ Apache na instância → proxy para gunicorn em `127.0.0.1:8000` → Flask.

## 3. Nomes e configuração dos recursos

| Recurso | Nome | Configuração |
|---|---|---|
| VPC | `vpc-labirinto` | 10.0.0.0/16, DNS hostnames habilitado |
| Subnets públicas | `sn-pub-1a`, `sn-pub-1b` | 10.0.1.0/24 (us-east-1a), 10.0.2.0/24 (us-east-1b), auto-assign IP público |
| Subnets privadas | `sn-priv-1a`, `sn-priv-1b` | 10.0.3.0/24, 10.0.4.0/24 |
| Internet Gateway | `igw-labirinto` | anexado à VPC |
| Route table pública | `rt-pub` | 0.0.0.0/0 → igw; associada às duas públicas |
| Route table privada | `rt-priv` | só rota local; associada às duas privadas |
| SG do ALB | `sg-labirinto-alb` | entrada 80/tcp de 0.0.0.0/0 |
| SG das instâncias | `sg-labirinto-app` | entrada 80/tcp origem `sg-labirinto-alb`; 22/tcp do seu IP |
| SG da privada | `sg-labirinto-priv` | entrada 22/tcp origem `sg-labirinto-app` |
| EC2 pública (base) | `ec2-labirinto-base` | t2.micro, Amazon Linux 2023, `sn-pub-1a`, user data `deploy/user_data.sh` |
| AMI | `ami-labirinto-v1` | criada a partir da `ec2-labirinto-base` |
| Launch template | `lt-labirinto` | AMI `ami-labirinto-v1`, t2.micro, `sg-labirinto-app` |
| Target group | `tg-labirinto` | HTTP 80, alvo do tipo instância, health check `GET /health` → 200 |
| Load balancer | `alb-labirinto` | internet-facing, `sn-pub-1a` + `sn-pub-1b`, listener HTTP 80 → `tg-labirinto` |
| Auto Scaling | `asg-labirinto` | min 1, desejada 1, máx 2; subnets públicas; target tracking CPU média 50% |

> Durante o teste a `ec2-labirinto-base` fica com o `sg-labirinto-app` + regra 80 do seu IP para
> você abrir direto pelo IP público ("instância pública acessível pela internet").

## 4. Passo a passo

### 4.1 VPC, subnets e rotas (já feitas no exercício anterior)
Conferir: as públicas usam `rt-pub` (rota para o IGW) e auto-assign de IP público; as privadas
usam `rt-priv`.

### 4.2 Security groups
1. `sg-labirinto-alb`: inbound HTTP 80 de `0.0.0.0/0`.
2. `sg-labirinto-app`: inbound HTTP 80 com **origem = sg-labirinto-alb**; SSH 22 de "My IP".
3. Para a instância base apenas: inbound HTTP 80 de "My IP" (para testar sem o ALB).

### 4.3 Instância pública com a aplicação
EC2 → Launch instance: Amazon Linux 2023, t2.micro, `sn-pub-1a`, IP público habilitado,
`sg-labirinto-app`, e em *Advanced details → User data* cole `deploy/user_data.sh`.
Após ~3 min:
```bash
curl http://<IP-publico>/health          # {"instancia":"i-...","status":"ok"}
curl http://<IP-publico>/api/info
```
Abra `http://<IP-publico>/` no navegador. Se falhar: `sudo cat /var/log/cloud-init-output.log`,
`systemctl status labirinto httpd`.

### 4.4 AMI
EC2 → instância `ec2-labirinto-base` → Actions → Image and templates → **Create image**
(`ami-labirinto-v1`). A AMI copia o volume com Apache, gunicorn e a aplicação já habilitados no
boot, então as instâncias do ASG não precisam de user data.

### 4.5 Launch template
`lt-labirinto`: AMI `ami-labirinto-v1`, t2.micro, key pair, SG `sg-labirinto-app`
(sem subnet fixa; o ASG escolhe).

### 4.6 Target group e ALB
1. Target group `tg-labirinto`: Instances, HTTP 80, VPC `vpc-labirinto`, health check path
   `/health`, healthy threshold 2, interval 15 s. Não registrar alvos manualmente.
2. Load balancer `alb-labirinto`: Application, internet-facing, subnets `sn-pub-1a` e `sn-pub-1b`,
   SG `sg-labirinto-alb`, listener HTTP:80 → forward `tg-labirinto`.

### 4.7 Auto Scaling Group
`asg-labirinto`: launch template `lt-labirinto`, subnets `sn-pub-1a` + `sn-pub-1b`, anexar ao
`tg-labirinto`, health check type **ELB** (grace 120 s), capacidade **min 1 / desejada 1 / máx 2**,
política *Target tracking*: Average CPU utilization 50%.

### 4.8 Testes
```bash
ALB=http://<dns-do-alb>

# 1) acesso pelo ALB
curl -s $ALB/health

# 2) ver qual nó respondeu (repetir; com 2 instâncias os IDs se alternam)
for i in $(seq 1 10); do curl -s -D - -o /dev/null $ALB/health | grep -i x-servido-por; done

# 3) forçar o scale-out (CPU alta por alguns minutos)
for i in $(seq 1 8); do curl -s "$ALB/api/carga?n=2000" > /dev/null & done; wait
```
Para ver respostas de nós diferentes sem esperar o scaling, dá para mudar temporariamente a
capacidade desejada do ASG para 2. Evidências para o relatório: health checks *healthy* no
target group, atividade do ASG (launch da 2ª instância), CloudWatch de CPU e a saída do loop
mostrando dois `instance-id`.

## 5. Limpeza (obrigatória)
Na ordem: excluir o ASG (termina as instâncias) → ALB → target group → launch template →
deregister da AMI e exclusão do snapshot → terminar `ec2-labirinto-base` e a privada → security
groups criados neste exercício. **Manter VPC e subnets.**

## 6. Boas práticas aplicadas
- Instâncias só aceitam HTTP vindo do SG do ALB (referência de SG, não CIDR).
- SSH restrito ao seu IP; a instância privada não tem rota para a internet.
- Aplicação roda com usuário de sistema sem shell (`labirinto`), atrás do Apache, com restart
  automático pelo systemd.
- Health check dedicado (`/health`) e ASG usando health check do ELB.
- Duas AZs para o ALB e o ASG.
