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


def _dataset(ap: argparse.ArgumentParser, args: argparse.Namespace, out: Path) -> int:
    from .graphs.algorithms import bellman_ford, bfs, custo_ciclo, dfs, dijkstra
    from .parte2 import desempenho
    from .parte2.bellman import subgrafo_temporada
    from .parte2.buscas import carregar, temporada
    from .parte2.caminhos import transformar

    caminho = Path(args.dataset)
    if not caminho.is_file():
        print(f"Erro: arquivo não encontrado: {caminho}", file=sys.stderr)
        return 1
    if args.benchmark:
        desempenho.main(caminho, out)
        return 0
    g = carregar(caminho)
    print(f"{caminho.name}: |V|={g.ordem} |E|={g.tamanho}")
    if not args.alg:
        return 0
    if not args.source:
        ap.error("--alg com --dataset exige --source (ex.: --source \"ATL|2000\")")
    for no in filter(None, (args.source, args.target)):
        if no not in g:
            print(f"Erro: nó {no!r} não está no grafo (formato TIME|ano, ex.: ATL|2000)", file=sys.stderr)
            return 1

    s, alvo = args.source, args.target
    res: dict = {"algoritmo": args.alg, "fonte": s, "destino": alvo}
    if args.alg == "BFS":
        r = bfs(g, s)
        res.update(ordem=r.ordem, camadas=r.niveis())
        print(f"BFS: visitados={len(r.ordem)} nós por camada={[len(c) for c in res['camadas']]}")
    elif args.alg == "DFS":
        r = dfs(g, s)
        res.update(ordem=r.ordem, classes=r.classes, tem_ciclo=r.tem_ciclo)
        print(f"DFS: visitados={len(r.ordem)} classes={r.classes} tem_ciclo={r.tem_ciclo}")
    elif args.alg == "DIJKSTRA":
        h, minimo = transformar(g)
        r = dijkstra(h, s)
        res["minimo_temporada"] = minimo[temporada(s)]
        print(f"DIJKSTRA: pesos deslocados por temporada (mínimo da temporada = {minimo[temporada(s)]}), "
              f"alcançados={len(r.dist)}")
    else:
        sub = subgrafo_temporada(g, temporada(s))
        r = bellman_ford(sub, s)
        res.update(status=r.status, ciclo_negativo=r.ciclo_negativo)
        print(f"BELLMAN_FORD (temporada {temporada(s)}, |V|={sub.ordem} |E|={sub.tamanho}): status={r.status}")
        if r.ciclo_negativo:
            res["custo_ciclo"] = custo_ciclo(sub, r.ciclo_negativo)
            print(f"ciclo negativo (custo {res['custo_ciclo']:.4f}): {' -> '.join(r.ciclo_negativo)}")

    if alvo and not res.get("ciclo_negativo"):
        cam = r.caminho_ate(alvo)
        res.update(caminho=cam, n_arcos=max(len(cam) - 1, 0), custo_original=custo_ciclo(g, cam) if cam else None)
        if args.alg == "DIJKSTRA" and cam:
            res["custo_transformado"] = r.dist[alvo]
        print(f"caminho ({res['n_arcos']} arcos, custo original {res['custo_original']}): {' -> '.join(cam)}"
              if cam else f"{alvo} inalcançável a partir de {s}")
    destino = out / f"resultado_{args.alg}_{s.replace('|', '_')}.json"
    destino.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"gravado: {destino}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.cli", description="Labirinto com chaves (grafo de estados)")
    ap.add_argument("--mapa", help="caminho do mapa .txt")
    ap.add_argument("--alg", choices=["BFS", "DFS", "DIJKSTRA", "BELLMAN_FORD"], help="algoritmo (DFS só com --dataset)")
    ap.add_argument("--fonte-consumivel", action="store_true", help="correção do m06: '*' vale -2 só na 1ª vez")
    ap.add_argument("--armadilhas", action="store_true", help="lista estados-armadilha do mapa")
    ap.add_argument("--interactive", action="store_true", help="gera out/parte1/labirinto_interativo.html")
    ap.add_argument("--todos", action="store_true", help="gera todas as saídas obrigatórias da Parte 1")
    ap.add_argument("--viz", action="store_true", help="gera as figuras PNG da Parte 1")
    ap.add_argument("--dataset", help="Parte 2: CSV de arcos (ex.: data/dataset_parte2/arestas.csv)")
    ap.add_argument("--source", help="Parte 2: nó de origem, formato TIME|ano (ex.: ATL|2000)")
    ap.add_argument("--target", help="Parte 2: nó de destino, formato TIME|ano")
    ap.add_argument("--benchmark", action="store_true", help="Parte 2: tempos e escalabilidade (parte2_report.json)")
    ap.add_argument("--out", help="pasta de saída (padrão: out/parte1; com --dataset: out/parte2)")
    args = ap.parse_args(argv)

    out = Path(args.out or ("out/parte2" if args.dataset else "out/parte1"))
    out.mkdir(parents=True, exist_ok=True)

    if args.dataset:
        return _dataset(ap, args, out)
    if args.alg == "DFS" or args.source or args.target or args.benchmark:
        ap.error("--alg DFS, --source, --target e --benchmark exigem --dataset")

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
