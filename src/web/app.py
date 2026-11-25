# [IA] Claude – aplicação web (Flask) para servir o labirinto na AWS (EC2 + ALB + ASG)
"""Servidor web do Labirinto com Chaves.

Rotas:
  /                    menu de projetos (Parte 1 liberada, Parte 2 trancada até existir)
  /parte1              labirinto interativo (calcula os caminhos no servidor); /labirinto redireciona para cá
  /parte2              Parte 2: grafo de rotação por time-temporada e números do benchmark (dados pré-calculados)
  /health              health check do Target Group do ALB
  /api/info            identifica a instância EC2 que respondeu (prova do balanceamento)
  /api/mapas           lista de mapas
  /api/mapa/<nome>     grade, caminhos (BFS/Dijkstra/Bellman-Ford), armadilhas, camadas e métricas
  POST /api/mapa       mapa surpresa: corpo = texto do mapa (até 64 KB) -> mesmo formato, nome "personalizado"
  /api/traco/<nome>    ?alg=BFS|DFS|DIJKSTRA|BELLMAN_FORD&fonte=0|1 -> eventos do algoritmo (src/traco.py)
  POST /api/traco      ?alg=...&fonte=... com o texto do mapa no corpo (mapa surpresa)
  /api/resolver        ?mapa=m03_tres_chaves&alg=DIJKSTRA  -> resultado resumido
  /api/historico       últimas consultas gravadas no RDS (desligado sem DB_HOST)
  /api/carga           ?n=500 resolve o m08 n vezes (máx 2000) (gera CPU para testar o Auto Scaling)
  /api/parte2/indice               temporadas e times do grafo de rotação (out/parte2/web/indice.json)
  /api/parte2/rotacao/<time>/<ano> nós, arcos, ciclo negativo e caminhos de um time-temporada
  /api/parte2/caminho/<time>/<ano> ?de=i&para=j&grafo=completo|recorte -> BFS, DFS, Dijkstra e Bellman-Ford de A até B
  /api/parte2/graficos             dados dos gráficos interativos (impacto x minutos e times)
  /api/parte2/benchmark            tempos médios e escalabilidade (resumo de out/parte2/parte2_report.json)
"""
from __future__ import annotations

import json
import logging
import os
import re
import socket
import time
import urllib.request
from functools import lru_cache
from pathlib import Path

from flask import Flask, Response, abort, jsonify, redirect, request, send_from_directory, url_for

from ..graphs.estados import grafo_estados
from ..graphs.io import Mapa, MapaInvalido, ler_mapa, listar_mapas, parse_mapa
from ..parte2.par import caminho_entre
from ..solve import resolver
from ..traco import ALGORITMOS_TRACO, traco_json
from ..viz import dados_mapa
from . import db

RAIZ = Path(__file__).resolve().parents[2]
PASTAS = [RAIZ / "data" / "mapas", RAIZ / "data" / "mapas_grupo"]
TEMPLATES = Path(__file__).parent / "templates"
PARTE2_WEB = RAIZ / "out" / "parte2" / "web"  # gerado por python -m src.parte2.web_dados

app = Flask(__name__)
log = logging.getLogger(__name__)


def _imds(caminho: str, token: str | None) -> str | None:
    req = urllib.request.Request(f"http://169.254.169.254/latest/{caminho}")
    if token:
        req.add_header("X-aws-ec2-metadata-token", token)
    try:
        with urllib.request.urlopen(req, timeout=0.5) as r:
            return r.read().decode()
    except Exception:
        return None


@lru_cache(maxsize=1)
def info_servidor() -> dict:
    """Metadados da instância via IMDSv2; fora da AWS cai para o hostname local."""
    token = None
    try:
        req = urllib.request.Request("http://169.254.169.254/latest/api/token", method="PUT",
                                     headers={"X-aws-ec2-metadata-token-ttl-seconds": "300"})
        with urllib.request.urlopen(req, timeout=0.5) as r:
            token = r.read().decode()
    except Exception:
        pass
    hostname = socket.gethostname()
    return {
        "instancia": (token and _imds("meta-data/instance-id", token)) or hostname,
        "zona": (token and _imds("meta-data/placement/availability-zone", token)) or "local",
        "ip": (token and _imds("meta-data/local-ipv4", token)) or socket.gethostbyname(hostname),
        "hostname": hostname,
        "versao": os.environ.get("APP_VERSAO", "dev"),
    }


def _mapas() -> dict[str, Path]:
    return {p.stem: p for p in listar_mapas(*PASTAS)}


@app.after_request
def cabecalho_servidor(resp):
    resp.headers["X-Servido-Por"] = info_servidor()["instancia"]
    return resp


# [IA] Claude – menu de projetos em "/" e uma rota por parte. As páginas usam caminhos relativos
# ("static/...", "api/..."), que resolvem igual a partir de "/", "/parte1" e "/parte2" (sem barra final).
@app.get("/")
def index():
    return send_from_directory(TEMPLATES, "menu.html")


@app.get("/parte1")
def parte1():
    return send_from_directory(TEMPLATES, "labirinto.html")


@app.get("/parte2")
def parte2():
    return send_from_directory(TEMPLATES, "parte2.html")


def _com_query(destino: str) -> str:
    # mantém a query string (ex.: /labirinto?mapa=m05 -> /parte1?mapa=m05)
    q = request.query_string.decode("latin-1")
    return f"{destino}?{q}" if q else destino


@app.get("/parte1/")
@app.get("/labirinto")
@app.get("/labirinto/")
def labirinto_antigo():
    # links antigos e a barra final (que quebraria os caminhos relativos) vão para /parte1
    return redirect(_com_query(url_for("parte1")), 302)


@app.get("/parte2/")
def parte2_barra():
    return redirect(_com_query(url_for("parte2")), 302)


@app.get("/favicon.ico")
def favicon():
    # navegadores pedem /favicon.ico por conta própria; servimos o ícone em pixel art (SVG)
    return send_from_directory(app.static_folder, "favicon.svg", mimetype="image/svg+xml")


@app.errorhandler(404)
def nao_encontrado(e):
    # [IA] Claude – página 404 do front; a API mantém a resposta padrão do Flask
    if request.path.startswith("/api/"):
        return e
    return send_from_directory(TEMPLATES, "404.html", conditional=False), 404


@app.get("/health")
def health():
    return jsonify(status="ok", instancia=info_servidor()["instancia"])


@app.get("/api/info")
def api_info():
    return jsonify(info_servidor())


@lru_cache(maxsize=64)
def _grade_texto(caminho: str, mtime: float) -> list[str]:
    # [IA] Claude – só as linhas do arquivo (miniaturas dos cartões de mapa); não monta grafo nem resolve nada
    linhas = Path(caminho).read_text(encoding="utf-8").splitlines()
    return [ln.rstrip("\r\n") for ln in linhas if ln.strip() and not ln.lstrip().startswith(";")]


@app.get("/api/mapas")
def api_mapas():
    mapas = _mapas()
    grades = {}
    for nome, p in mapas.items():
        try:
            grades[nome] = _grade_texto(str(p), p.stat().st_mtime)
        except OSError:
            pass
    return jsonify(mapas=list(mapas), grades=grades, servidor=info_servidor())


@app.get("/api/mapa/<nome>")
def api_mapa(nome: str):
    mapas = _mapas()
    if nome not in mapas:
        abort(404, f"mapa {nome!r} não existe")
    dados = dados_mapa(ler_mapa(mapas[nome]))
    if db.habilitado():
        try:
            db.registrar(nome, dados["algoritmos"], info_servidor()["instancia"])
        except Exception as e:  # o histórico é opcional: falha no banco não afeta a resposta
            log.warning("não foi possível gravar no RDS: %s", e)
    return jsonify(dados | {"servidor": info_servidor()})


# [IA] Claude – mapa surpresa e traços dos algoritmos para o replay do front
LIMITE_MAPA = 64 * 1024     # bytes do texto enviado
LIMITE_TETO = 250_000       # teto teórico de estados aceito de um mapa enviado (o m08 tem 18 704)


def _erro(mensagem: str, status: int = 400):
    return jsonify(erro=mensagem), status


def _mapa_do_corpo() -> Mapa:
    """Lê o mapa enviado no corpo (texto puro). MapaInvalido sai com a mensagem para o usuário."""
    if (request.content_length or 0) > LIMITE_MAPA:
        raise MapaInvalido(f"mapa grande demais: o limite é {LIMITE_MAPA // 1024} KB de texto.")
    corpo = request.get_data(cache=True)
    if len(corpo) > LIMITE_MAPA:
        raise MapaInvalido(f"mapa grande demais: o limite é {LIMITE_MAPA // 1024} KB de texto.")
    try:
        texto = corpo.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise MapaInvalido("o arquivo precisa ser texto UTF-8 (.txt).") from None
    mapa = parse_mapa(texto, nome="personalizado")
    consumiveis = len(mapa.bonus) + len(mapa.fontes)  # pior caso: fonte consumível
    teto = len(mapa.casas_livres()) * 2 ** len(mapa.chaves) * 2 ** consumiveis
    if teto > LIMITE_TETO:
        raise MapaInvalido(f"personalizado: mapa grande demais para resolver aqui — até {teto} estados possíveis "
                           f"(limite {LIMITE_TETO}). Use menos bônus '+'/fontes '*' ou rode "
                           "python -m src.cli --mapa arquivo.txt --interactive.")
    return mapa


def _parametros_traco() -> tuple[str, bool]:
    alg = request.args.get("alg", "BFS").upper()
    fonte = request.args.get("fonte", "0").lower() in ("1", "true", "sim")
    if alg == "BELLMAN_FORD_FONTE_CONSUMIVEL":
        alg, fonte = "BELLMAN_FORD", True
    if alg not in ALGORITMOS_TRACO:
        raise ValueError(f"parâmetro alg inválido: use {'|'.join(ALGORITMOS_TRACO)} (e fonte=0|1).")
    return alg, fonte


def _json_pronto(texto: str) -> Response:
    return Response(texto, mimetype="application/json")


@lru_cache(maxsize=128)
def _traco_cache(nome: str, alg: str, fonte: bool) -> str:
    return traco_json(ler_mapa(_mapas()[nome]), alg, fonte)


@app.get("/api/traco/<nome>")
def api_traco(nome: str):
    if nome not in _mapas():
        return _erro(f"mapa {nome!r} não existe", 404)
    try:
        alg, fonte = _parametros_traco()
    except ValueError as e:
        return _erro(str(e))
    return _json_pronto(_traco_cache(nome, alg, fonte))


@app.post("/api/traco")
def api_traco_personalizado():
    try:
        alg, fonte = _parametros_traco()
        mapa = _mapa_do_corpo()
    except ValueError as e:  # MapaInvalido também é ValueError
        return _erro(str(e))
    return _json_pronto(traco_json(mapa, alg, fonte))


@app.post("/api/mapa")
def api_mapa_personalizado():
    """Mapa surpresa da apresentação. Não grava no histórico do RDS (só os mapas do repositório entram lá)."""
    try:
        mapa = _mapa_do_corpo()
    except MapaInvalido as e:
        return _erro(str(e))
    return jsonify(dados_mapa(mapa) | {"servidor": info_servidor()})


@app.get("/api/resolver")
def api_resolver():
    mapas = _mapas()
    nome = request.args.get("mapa", "m03_tres_chaves")
    alg = request.args.get("alg", "DIJKSTRA").upper()
    if nome not in mapas or alg not in ("BFS", "DIJKSTRA", "BELLMAN_FORD"):
        abort(400, "parâmetros: mapa=<nome> alg=BFS|DIJKSTRA|BELLMAN_FORD")
    t = time.perf_counter()
    r = resolver(grafo_estados(ler_mapa(mapas[nome])), alg)
    r.pop("percurso")
    return jsonify(r | {"tempo_ms": round((time.perf_counter() - t) * 1000, 2), "servidor": info_servidor()})


@app.get("/api/historico")
def api_historico():
    if not db.habilitado():
        abort(404, "histórico desligado (sem banco configurado)")
    try:
        return jsonify(consultas=db.ultimas())
    except Exception as e:
        log.warning("RDS indisponível: %s", e)
        abort(503, "banco indisponível")


@app.get("/api/carga")
def api_carga():
    n = max(1, min(int(request.args.get("n", 10)), 2000))
    m08 = ler_mapa(_mapas()["m08_grande"])
    t = time.perf_counter()
    for _ in range(n):
        resolver(grafo_estados(m08), "BELLMAN_FORD")
    return jsonify(execucoes=n, tempo_s=round(time.perf_counter() - t, 3), servidor=info_servidor())


# [IA] Claude – API da página da Parte 2: só lê os JSON pré-calculados (src/parte2/web_dados.py), com cache.
# Só /api/parte2/caminho roda algoritmo no pedido (os do grupo); o navegador só desenha.
SIGLA_TIME = re.compile(r"^[A-Z]{2,4}$")


@lru_cache(maxsize=256)
def _parte2_texto(caminho: str, mtime: float) -> str:
    return Path(caminho).read_text(encoding="utf-8")


def _parte2_json(relativo: str):
    caminho = PARTE2_WEB / relativo
    try:
        texto = _parte2_texto(str(caminho), caminho.stat().st_mtime)
    except OSError:
        return None
    resp = _json_pronto(texto)
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


@app.get("/api/parte2/indice")
def api_parte2_indice():
    resp = _parte2_json("indice.json")
    if resp is None:
        return _erro("dados da Parte 2 não gerados: rode python -m src.parte2.web_dados", 503)
    return resp


@app.get("/api/parte2/rotacao/<sigla>/<int:ano>")
def api_parte2_rotacao(sigla: str, ano: int):
    sigla = sigla.upper()
    if not SIGLA_TIME.match(sigla):
        return _erro("sigla de time inválida", 400)
    resp = _parte2_json(f"rotacao/{sigla}_{ano}.json")
    if resp is None:
        return _erro(f"time-temporada {sigla} {ano} não existe", 404)
    return resp


# [IA] Claude – caminho entre dois jogadores escolhidos no grafo: única rota da Parte 2 que roda algoritmo no
# pedido (os 4 do grupo, em src/parte2/par.py, num time-temporada de ~20 nós; leva menos de 1 ms)
@lru_cache(maxsize=64)
def _parte2_dados(caminho: str, mtime: float) -> dict:
    return json.loads(Path(caminho).read_text(encoding="utf-8"))


@app.get("/api/parte2/caminho/<sigla>/<int:ano>")
def api_parte2_caminho(sigla: str, ano: int):
    sigla = sigla.upper()
    if not SIGLA_TIME.match(sigla):
        return _erro("sigla de time inválida", 400)
    caminho = PARTE2_WEB / "rotacao" / f"{sigla}_{ano}.json"
    try:
        dados = _parte2_dados(str(caminho), caminho.stat().st_mtime)
    except OSError:
        return _erro(f"time-temporada {sigla} {ano} não existe", 404)
    try:
        de, para = int(request.args["de"]), int(request.args["para"])
    except (KeyError, ValueError):
        return _erro("informe de=<índice> e para=<índice> dos dois jogadores", 400)
    try:
        res = caminho_entre(dados, de, para, request.args.get("grafo", "completo"))
    except ValueError as e:
        return _erro(str(e), 400)
    return jsonify(res)


@app.get("/api/parte2/graficos")
def api_parte2_graficos():
    resp = _parte2_json("graficos.json")
    if resp is None:
        return _erro("gráficos da Parte 2 não gerados: rode python -m src.parte2.web_dados", 503)
    return resp


# [IA] Claude – figuras PNG de comparação dos algoritmos (out/parte2/graficos), só nomes conhecidos
FIGURAS_PARTE2 = {"tempo_por_algoritmo", "tempo_por_tamanho", "bfs_x_dfs", "caminhos_dijkstra"}


@app.get("/api/parte2/figura/<nome>.png")
def api_parte2_figura(nome: str):
    if nome not in FIGURAS_PARTE2:
        return _erro("figura desconhecida", 404)
    pasta = RAIZ / "out" / "parte2" / "graficos"
    if not (pasta / f"{nome}.png").exists():
        return _erro("figura não gerada: rode python -m src.parte2.rotacao_graficos", 503)
    resp = send_from_directory(pasta, f"{nome}.png", mimetype="image/png")
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


@app.get("/api/parte2/benchmark")
def api_parte2_benchmark():
    resp = _parte2_json("benchmark.json")
    if resp is None:
        return _erro("benchmark da Parte 2 não gerado: rode python -m src.parte2.web_dados", 503)
    return resp


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)
