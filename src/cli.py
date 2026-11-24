# [IA] Claude – interface de linha de comando (revisar e explicar em grupo)
"""Uso:
  python -m src.cli --todos --out ./out/parte1/
  python -m src.cli --mapa ./data/mapas/m03_tres_chaves.txt --alg DIJKSTRA --out ./out/parte1/
  python -m src.cli --mapa ./data/mapas/m06_fonte.txt --alg BELLMAN_FORD --fonte-consumivel
  python -m src.cli --mapa ./data/mapas/m04_esteiras.txt --armadilhas --out ./out/parte1/
  python -m src.cli --mapa ./data/mapas/m03_tres_chaves.txt --interactive --out ./out/parte1/
  python -m src.cli --dataset ./data/dataset_parte2/ --alg DIJKSTRA --source "Brook Lopez|MIL|2022" --out ./out/parte2/
  python -m src.cli --dataset ./data/dataset_parte2/ --benchmark --out ./out/parte2/
  python -m src.cli --dataset ./data/dataset_parte2/ --grafo partidas --alg BFS --source "ATL|2000"
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


# [IA] Claude – escolha do grafo da Parte 2: rotação por padrão (quando existe), partidas com --grafo partidas
def _arquivo_dataset(caminho: Path, grafo: str | None) -> tuple[str, Path]:
    if caminho.is_file():
        return (grafo or ("rotacao" if caminho.name == "arestas_rotacao.csv" else "partidas")), caminho
    rotacao = caminho / "rotacao" / "arestas_rotacao.csv"
    if caminho.name == "rotacao":
        rotacao = caminho / "arestas_rotacao.csv"
    if grafo == "rotacao" or (grafo is None and rotacao.is_file()):
        return "rotacao", rotacao
    return "partidas", caminho / "arestas.csv"


def _dataset(ap: argparse.ArgumentParser, args: argparse.Namespace, out: Path | None) -> int:
    caminho = Path(args.dataset)
    grafo, caminho = _arquivo_dataset(caminho, args.grafo)
    if not caminho.is_file():
        print(f"Erro: arquivo não encontrado: {caminho}", file=sys.stderr)
        return 1
    if grafo == "rotacao":
        return _dataset_rotacao(ap, args, caminho, out or Path("out/parte2"))
    return _dataset_partidas(ap, args, caminho, out or Path("out/parte2/partidas"))


# [IA] Claude – --alg/--source/--target/--benchmark no grafo de rotação (algoritmos do grupo)
def _dataset_rotacao(ap: argparse.ArgumentParser, args: argparse.Namespace, caminho: Path, out: Path) -> int:
    from .graphs.algorithms import PesoNegativoError, bellman_ford, bfs, custo_ciclo, dfs, dijkstra
    from .parte2 import rotacao_desempenho
    from .parte2.rotacao_casos import (TRANSFORMACAO, carregar, carregar_minutos, componente, descendente, johnson,
                                       subgrafo_componente)

    out.mkdir(parents=True, exist_ok=True)
    jogadores = caminho.with_name("jogadores.csv")
    if args.benchmark:
        rotacao_desempenho.main(caminho, jogadores, out)
        return 0
    g = carregar(caminho)
    print(f"{caminho.name} (grafo de rotação): |V|={g.ordem} |E|={g.tamanho}")
    if not args.alg:
        return 0
    if not args.source:
        ap.error('--alg com o grafo de rotação exige --source (ex.: --source "Brook Lopez|MIL|2022")')
    for no in filter(None, (args.source, args.target)):
        if no not in g:
            print(f"Erro: nó {no!r} não está no grafo (formato Nome|TIM|ano, ex.: Brook Lopez|MIL|2022)", file=sys.stderr)
            return 1
    s, alvo = args.source, args.target
    if alvo and componente(alvo) != componente(s):
        print(f"Aviso: {alvo} é de outro time-temporada; não há arcos entre componentes", file=sys.stderr)
    res: dict = {"grafo": "rotacao", "algoritmo": args.alg, "fonte": s, "destino": alvo}
    base = g
    if args.alg == "BFS":
        r = bfs(g, s)
        res.update(ordem=r.ordem, camadas=r.niveis())
        print(f"BFS: visitados={len(r.ordem)} nós por camada={[len(c) for c in res['camadas']]}")
    elif args.alg == "DFS":
        r = dfs(g, s)
        res.update(ordem=r.ordem, classes=r.classes, tem_ciclo=r.tem_ciclo)
        print(f"DFS: visitados={len(r.ordem)} classes={r.classes} tem_ciclo={r.tem_ciclo}")
    elif args.alg == "DIJKSTRA":
        sub = subgrafo_componente(g, *componente(s))
        try:
            dijkstra(sub, s)
        except PesoNegativoError as e:
            res["recusa_pesos_originais"] = str(e)
            print(f"Dijkstra nos pesos originais: {e}")
        if jogadores.is_file():
            minutos = carregar_minutos(jogadores)
        else:
            print(f"Aviso: {jogadores} não encontrado; recorte ordenado só pelo rótulo", file=sys.stderr)
            minutos = {}
        base = descendente(sub, minutos)
        h, t = johnson(base)
        r = dijkstra(t, s)
        res.update(transformacao=TRANSFORMACAO, nos_recorte=base.ordem, arcos_recorte=base.tamanho)
        print(f"DIJKSTRA no recorte sem ciclo com Johnson (|V|={base.ordem} |E|={base.tamanho}); alcançados={len(r.dist)}")
    else:
        base = subgrafo_componente(g, *componente(s))
        r = bellman_ford(base, s)
        res.update(status=r.status, ciclo_negativo=r.ciclo_negativo)
        print(f"BELLMAN_FORD ({'|'.join(map(str, componente(s)))}, |V|={base.ordem} |E|={base.tamanho}): status={r.status}")
        if r.ciclo_negativo:
            res["custo_ciclo"] = custo_ciclo(base, r.ciclo_negativo)
            print(f"ciclo negativo (custo {res['custo_ciclo']:.4f}): {' -> '.join(r.ciclo_negativo)}")
    if alvo and not res.get("ciclo_negativo"):
        cam = r.caminho_ate(alvo)
        res.update(caminho=cam, n_arcos=max(len(cam) - 1, 0), custo_original=custo_ciclo(base, cam) if cam else None)
        if args.alg == "DIJKSTRA" and cam:
            res.update(custo_transformado=r.dist[alvo], custo_reconvertido=r.dist[alvo] - h[s] + h[alvo])
        print(f"caminho ({res['n_arcos']} arcos, custo original {res['custo_original']}): {' -> '.join(cam)}"
              if cam else f"{alvo} inalcançável a partir de {s}")
    nome = "".join(c if c.isalnum() else "_" for c in s)
    destino = out / f"resultado_rotacao_{args.alg}_{nome}.json"
    destino.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"gravado: {destino}")
    return 0


def _dataset_partidas(ap: argparse.ArgumentParser, args: argparse.Namespace, caminho: Path, out: Path) -> int:
    from .graphs.algorithms import bellman_ford, bfs, custo_ciclo, dfs, dijkstra
    from .parte2 import desempenho
    from .parte2.bellman import subgrafo_temporada
    from .parte2.buscas import carregar, temporada
    from .parte2.caminhos import TRANSFORMACAO, transformar

    out.mkdir(parents=True, exist_ok=True)
    if args.benchmark:
        desempenho.main(caminho, out)
        return 0
    g = carregar(caminho)
    print(f"{caminho.name}: |V|={g.ordem} |E|={g.tamanho}")
    if not args.alg:
        return 0
    if not args.source:
        ap.error("--alg com o grafo de partidas exige --source (ex.: --source \"ATL|2000\")")
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
        h = transformar(g)
        r = dijkstra(h, s)
        res["transformacao"] = TRANSFORMACAO
        print(f"DIJKSTRA: {TRANSFORMACAO}; alcançados={len(r.dist)}")
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
    ap.add_argument("--dataset", help="Parte 2: pasta do dataset (rotacao/arestas_rotacao.csv ou arestas.csv) ou CSV de arcos")
    ap.add_argument("--grafo", choices=["rotacao", "partidas"],
                    help="Parte 2: grafo a usar (padrão: rotação, se existir; partidas grava em out/parte2/partidas)")
    ap.add_argument("--source", help="Parte 2: nó de origem (rotação: Nome|TIM|ano; partidas: TIME|ano)")
    ap.add_argument("--target", help="Parte 2: nó de destino (mesmo formato do --source)")
    ap.add_argument("--benchmark", action="store_true", help="Parte 2: tempos e escalabilidade (rotação: parte2_report.json; partidas: partidas_report.json)")
    ap.add_argument("--out", help="pasta de saída (padrão: out/parte1; rotação: out/parte2; partidas: out/parte2/partidas)")
    args = ap.parse_args(argv)

    if args.dataset:
        return _dataset(ap, args, Path(args.out) if args.out else None)
    if args.alg == "DFS" or args.source or args.target or args.benchmark or args.grafo:
        ap.error("--alg DFS, --grafo, --source, --target e --benchmark exigem --dataset")
    out = Path(args.out or "out/parte1")
    out.mkdir(parents=True, exist_ok=True)

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
