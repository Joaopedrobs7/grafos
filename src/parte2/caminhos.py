from __future__ import annotations

import json
import math
from pathlib import Path

from ..graphs.algorithms import PesoNegativoError, Resultado, custo_ciclo, dijkstra
from ..graphs.graph import Grafo, No
from .buscas import RAIZ, SAIDA, carregar, maior_grau_saida, temporada


# [IA] Claude – custo = -log P(vitória), para somar custos equivaler a multiplicar probabilidades.
# O peso w do arco A -> B é o saldo médio de A contra B (+ se A venceu o confronto), então
# P(A vence B) = 1 / (1 + exp(-w / s)) e o custo é -log P = log(1 + exp(-w / s)) > 0:
# arco com saldo positivo grande custa perto de 0; saldo negativo grande custa caro.
# Um deslocamento constante por arco penalizava caminhos longos (86% dos caminhos ficavam com 1 arco).
RELATORIO = RAIZ / "data" / "dataset_parte2" / "processed" / "relatorio_preparacao.json"
DESVIO_REFERENCIA = 13.712  # usado só se o relatorio_preparacao.json não existir (valor de 2000-2025)


def desvio_margem(relatorio: Path = RELATORIO) -> float:
    """Desvio-padrão da margem por jogo, calculado pelo preparar.py no recorte do params.yaml."""
    if relatorio.is_file():
        valor = json.loads(relatorio.read_text(encoding="utf-8")).get("desvio_margem_jogo")
        if valor and math.isfinite(valor):
            return float(valor)
    return DESVIO_REFERENCIA


DESVIO_MARGEM = desvio_margem()
ESCALA = DESVIO_MARGEM * math.sqrt(3) / math.pi  # escala da logística com esse desvio-padrão
TRANSFORMACAO = (f"w' = -log P(vitória) = log(1 + exp(-w / s)), s = {DESVIO_MARGEM:.3f} · √3 / π ≈ {ESCALA:.2f}"
                 .replace(".", ","))


def custo_vitoria(peso: float) -> float:
    return math.log1p(math.exp(-peso / ESCALA))


def transformar(g: Grafo) -> Grafo:
    h = Grafo()
    for a in g.arcos():
        h.add_arco(a.origem, a.destino, custo_vitoria(a.peso))
    return h


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
    h = transformar(g)
    escolhidos = pares(g, h)
    try:
        dijkstra(g, escolhidos[0][1])
        recusa = None
    except PesoNegativoError as e:
        recusa = str(e)
    print(f"Dijkstra com pesos originais a partir de {escolhidos[0][1]}: {recusa}")
    saida = {"transformacao": TRANSFORMACAO, "desvio_margem_jogo": DESVIO_MARGEM, "recusa_pesos_originais": recusa, "pares": []}
    for t, s, alvo, r in escolhidos:
        cam = r.caminho_ate(alvo)
        item = {
            "temporada": t, "origem": s, "destino": alvo,
            "caminho": cam, "n_arcos": len(cam) - 1,
            "custo_transformado": r.dist[alvo], "probabilidade_cadeia": math.exp(-r.dist[alvo]),
            "custo_original": custo_ciclo(g, cam),
        }
        saida["pares"].append(item)
        print(f"{t}: {s} -> {alvo}  arcos={item['n_arcos']}  "
              f"custo transf.={item['custo_transformado']:.4f}  custo orig.={item['custo_original']:.4f}")
        print(f"      caminho: {' -> '.join(cam)}")
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / "dijkstra.json").write_text(json.dumps(saida, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"gravado: {SAIDA / 'dijkstra.json'}")


if __name__ == "__main__":
    main()
