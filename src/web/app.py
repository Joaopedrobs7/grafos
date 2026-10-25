# [IA] Claude – aplicação web (Flask) para servir o labirinto na AWS (EC2 + ALB + ASG)
"""Servidor web do Labirinto com Chaves.

Rotas:
  /                    labirinto interativo (calcula os caminhos no servidor)
  /health              health check do Target Group do ALB
  /api/info            identifica a instância EC2 que respondeu (prova do balanceamento)
  /api/mapas           lista de mapas
  /api/mapa/<nome>     grade, caminhos (BFS/Dijkstra/Bellman-Ford), armadilhas e camadas
  /api/resolver        ?mapa=m03_tres_chaves&alg=DIJKSTRA  -> resultado resumido
  /api/carga           ?n=500 resolve o m08 n vezes (máx 2000) (gera CPU para testar o Auto Scaling)
"""
from __future__ import annotations

import os
import socket
import time
import urllib.request
from functools import lru_cache
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

from ..graphs.estados import grafo_estados
from ..graphs.io import ler_mapa, listar_mapas
from ..solve import resolver
from ..viz import dados_mapa

RAIZ = Path(__file__).resolve().parents[2]
PASTAS = [RAIZ / "data" / "mapas", RAIZ / "data" / "mapas_grupo"]
TEMPLATES = Path(__file__).parent / "templates"

app = Flask(__name__)


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


@app.get("/")
def index():
    return send_from_directory(TEMPLATES, "labirinto.html")


@app.get("/health")
def health():
    return jsonify(status="ok", instancia=info_servidor()["instancia"])


@app.get("/api/info")
def api_info():
    return jsonify(info_servidor())


@app.get("/api/mapas")
def api_mapas():
    return jsonify(mapas=list(_mapas()), servidor=info_servidor())


@app.get("/api/mapa/<nome>")
def api_mapa(nome: str):
    mapas = _mapas()
    if nome not in mapas:
        abort(404, f"mapa {nome!r} não existe")
    return jsonify(dados_mapa(ler_mapa(mapas[nome])) | {"servidor": info_servidor()})


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


@app.get("/api/carga")
def api_carga():
    n = max(1, min(int(request.args.get("n", 10)), 2000))
    m08 = ler_mapa(_mapas()["m08_grande"])
    t = time.perf_counter()
    for _ in range(n):
        resolver(grafo_estados(m08), "BELLMAN_FORD")
    return jsonify(execucoes=n, tempo_s=round(time.perf_counter() - t, 3), servidor=info_servidor())


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)
