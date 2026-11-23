from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

from ..graphs.graph import Grafo
from ..parte2.buscas import carregar, temporada

SAIDA = Path(__file__).resolve().parents[2] / "out" / "avd"


def descrever(g: Grafo) -> tuple[dict, list[dict]]:
    pesos = {(a.origem, a.destino): a.peso for a in g.arcos()}
    assimetricos = sum(pesos.get((v, u)) != w for (u, v), w in pesos.items())
    distintos = len(set(pesos.values()))
    graus = g.graus()
    entrada = Counter(e for e, _ in graus.values())
    saida = Counter(s for _, s in graus.values())
    resumo = {
        "tipo": ("dirigido" if assimetricos else "não dirigido") + (" e ponderado" if distintos > 1 else ""),
        "arcos_com_peso_diferente_do_inverso": assimetricos,
        "pesos_distintos": distintos,
        "V": g.ordem,
        "E": g.tamanho,
        "temporadas": len({temporada(v) for v in graus}),
        "pesos_negativos": sum(w < 0 for w in pesos.values()),
        "pesos_zero": sum(w == 0 for w in pesos.values()),
        "pesos_positivos": sum(w > 0 for w in pesos.values()),
        "peso_min": min(pesos.values()),
        "peso_max": max(pesos.values()),
    }
    tabela = [{"grau": k, "nos_com_grau_entrada": entrada[k], "nos_com_grau_saida": saida[k]}
              for k in sorted(entrada.keys() | saida.keys())]
    return resumo, tabela


def main() -> None:
    resumo, tabela = descrever(carregar())
    for k, v in resumo.items():
        print(f"{k}: {v}")
    print("grau | nós (entrada) | nós (saída)")
    for l in tabela:
        print(f"{l['grau']:4d} | {l['nos_com_grau_entrada']:13d} | {l['nos_com_grau_saida']:11d}")
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / "descricao.json").write_text(json.dumps(resumo, indent=2, ensure_ascii=False), encoding="utf-8")
    with (SAIDA / "distribuicao_graus.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(tabela[0]))
        w.writeheader()
        w.writerows(tabela)
    print(f"gravado: {SAIDA / 'descricao.json'} e {SAIDA / 'distribuicao_graus.csv'}")


if __name__ == "__main__":
    main()
