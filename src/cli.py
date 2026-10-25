# [IA] Claude – interface de linha de comando (revisar e explicar em grupo)
"""Uso:
  python -m src.cli --todos --out ./out/parte1/
  python -m src.cli --mapa ./data/mapas/m03_tres_chaves.txt --alg DIJKSTRA --out ./out/parte1/
  python -m src.cli --mapa ./data/mapas/m06_fonte.txt --alg BELLMAN_FORD --fonte-consumivel
  python -m src.cli --mapa ./data/mapas/m04_esteiras.txt --armadilhas --out ./out/parte1/
  python -m src.cli --mapa ./data/mapas/m03_tres_chaves.txt --interactive --out ./out/parte1/
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .graphs.estados import grafo_estados, rotulo
from .graphs.io import MapaInvalido, ler_mapa
from .solve import armadilhas, gerar_tudo, resolver

PASTAS_MAPAS = ["data/mapas", "data/mapas_grupo"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.cli", description="Labirinto com chaves (grafo de estados)")
    ap.add_argument("--mapa", help="caminho do mapa .txt")
    ap.add_argument("--alg", choices=["BFS", "DIJKSTRA", "BELLMAN_FORD"], help="algoritmo de caminho")
    ap.add_argument("--fonte-consumivel", action="store_true", help="correção do m06: '*' vale -2 só na 1ª vez")
    ap.add_argument("--armadilhas", action="store_true", help="lista estados-armadilha do mapa")
    ap.add_argument("--interactive", action="store_true", help="gera out/parte1/labirinto_interativo.html")
    ap.add_argument("--todos", action="store_true", help="gera todas as saídas obrigatórias da Parte 1")
    ap.add_argument("--viz", action="store_true", help="gera as figuras PNG da Parte 1")
    ap.add_argument("--dataset", help="(Parte 2 — ainda não implementada)")
    ap.add_argument("--out", default="out/parte1", help="pasta de saída")
    args = ap.parse_args(argv)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if args.dataset:
        print("Parte 2 ainda não implementada nesta entrega.", file=sys.stderr)
        return 2

    if args.todos:
        info = gerar_tudo(PASTAS_MAPAS, out)
        print(f"Saídas geradas em {info['out']} para {len(info['mapas'])} mapas.")
        from .viz import gerar_figuras, gerar_html_interativo
        gerar_figuras(out)
        gerar_html_interativo(out, PASTAS_MAPAS)
        print("Figuras e labirinto_interativo.html gerados.")
        return 0

    if args.viz:
        from .viz import gerar_figuras
        gerar_figuras(out)
        return 0

    if not args.mapa:
        ap.error("informe --mapa (ou use --todos)")
    try:
        mapa = ler_mapa(args.mapa)
    except (MapaInvalido, FileNotFoundError) as e:
        print(f"Erro: {e}", file=sys.stderr)
        return 1

    if args.interactive:
        from .viz import gerar_html_interativo
        destino = gerar_html_interativo(out, PASTAS_MAPAS, extras=[args.mapa])
        print(f"Abra no navegador: {destino}")
        return 0

    ge = grafo_estados(mapa, fonte_consumivel=args.fonte_consumivel)
    print(f"{mapa.nome}: {len(ge.estados())} estados, {ge.sem_alvo.tamanho} arcos "
          f"(teto teórico {ge.teto_teorico()})")

    if args.armadilhas:
        trap = armadilhas(ge)
        print(f"{len(trap)} estados-armadilha:")
        for e in trap:
            print("  ", rotulo(e))
        (out / f"armadilhas_{mapa.nome}.txt").write_text("\n".join(rotulo(e) for e in trap), encoding="utf-8")

    if args.alg:
        r = resolver(ge, args.alg)
        print(f"{args.alg}: status={r['status']} passos={r['passos']} custo={r['custo']}")
        if r["mensagem"]:
            print(r["mensagem"])
        if r["caminho"]:
            print(" -> ".join(r["caminho"]))
        sufixo = "_fonte_consumivel" if args.fonte_consumivel else ""
        (out / f"resultado_{mapa.nome}_{args.alg}{sufixo}.json").write_text(
            json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
