from __future__ import annotations

import json

from ..graphs.algorithms import PesoNegativoError, Resultado, custo_ciclo, dijkstra
from ..graphs.graph import Grafo, No
from .buscas import SAIDA, carregar, maior_grau_saida, temporada


def transformar(g: Grafo) -> tuple[Grafo, dict[int, float]]:
    minimo: dict[int, float] = {}
    for a in g.arcos():
        t = temporada(a.origem)
        minimo[t] = min(minimo.get(t, a.peso), a.peso)
    h = Grafo()
    for a in g.arcos():
        h.add_arco(a.origem, a.destino, a.peso - minimo[temporada(a.origem)])
    return h, minimo


def pares(g: Grafo, h: Grafo) -> list[tuple[int, No, No, Resultado]]:
    graus = g.graus()
    temps = sorted({temporada(v) for v in graus})
    n = len(temps)
    res = []
    for t in dict.fromkeys(temps[i] for i in (0, n // 4, n // 2, 3 * n // 4, n - 1)):
        s = maior_grau_saida(graus, t)
        r = dijkstra(h, s)
        alvo = min((v for v in r.dist if v != s), key=lambda v: (-r.dist[v], v))
        res.append((t, s, alvo, r))
    return res


def main() -> None:
    g = carregar()
    h, minimo = transformar(g)
    escolhidos = pares(g, h)
    try:
        dijkstra(g, escolhidos[0][1])
        recusa = None
    except PesoNegativoError as e:
        recusa = str(e)
    print(f"Dijkstra com pesos originais a partir de {escolhidos[0][1]}: {recusa}")
    saida = {"transformacao": "w' = w - min(w da temporada do arco)", "recusa_pesos_originais": recusa, "pares": []}
    for t, s, alvo, r in escolhidos:
        cam = r.caminho_ate(alvo)
        item = {
            "temporada": t, "minimo_temporada": minimo[t], "origem": s, "destino": alvo,
            "caminho": cam, "n_arcos": len(cam) - 1,
            "custo_transformado": r.dist[alvo], "custo_original": custo_ciclo(g, cam),
        }
        saida["pares"].append(item)
        print(f"{t}: {s} -> {alvo}  min={minimo[t]}  arcos={item['n_arcos']}  "
              f"custo transf.={item['custo_transformado']:.4f}  custo orig.={item['custo_original']:.4f}")
        print(f"      caminho: {' -> '.join(cam)}")
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / "dijkstra.json").write_text(json.dumps(saida, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"gravado: {SAIDA / 'dijkstra.json'}")


if __name__ == "__main__":
    main()
