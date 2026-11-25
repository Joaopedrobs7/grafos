# [IA] Claude – código de desenho (matplotlib) e montagem do HTML interativo
"""Visualizações da Parte 1 e dados para o labirinto interativo (HTML/web)."""
from __future__ import annotations

import base64
import html as html_lib
import json
import mimetypes
import re
from collections import Counter, defaultdict
from pathlib import Path

from .graphs.algorithms import bfs
from .graphs.estados import ALVO, grafo_estados, rotulo
from .graphs.io import ESTEIRAS, PORTAS, Mapa, ler_mapa, listar_mapas
from .solve import ALGORITMOS, armadilhas, comparacao_modelagem, metricas, resolver
from .traco import ALGORITMOS_TRACO, traco_json

CORES_CASA = {
    "#": "#3a3a3a", ".": "#ffffff", "S": "#7fc97f", "G": "#fdbf6f", ",": "#c8a26b", "~": "#7fb2d9",
    "+": "#a5e3a5", "*": "#ffd54f", **{k: "#fff0a0" for k in "abcd"}, **{p: "#b39ddb" for p in "ABCD"},
    **{e: "#d9d9d9" for e in ESTEIRAS},
}
CORES_CAMADA = ["#d62728", "#1f77b4", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#e377c2"]
TEMPLATE = Path(__file__).parent / "web" / "templates" / "labirinto.html"


# ---------------------------------------------------------------- dados (HTML e API web)
def dados_mapa(mapa: Mapa) -> dict:
    ge = grafo_estados(mapa)
    algs = {}
    for alg in ALGORITMOS:
        r = resolver(ge, alg)
        algs[alg] = {k: r[k] for k in ("status", "passos", "custo", "mensagem", "percurso")}
    if mapa.fontes:
        r = resolver(grafo_estados(mapa, fonte_consumivel=True), "BELLMAN_FORD")
        algs["BELLMAN_FORD_FONTE_CONSUMIVEL"] = {k: r[k] for k in ("status", "passos", "custo", "mensagem", "percurso")}
    camadas: dict[str, set] = defaultdict(set)
    for e in ge.estados():
        camadas[e[2] or "-"].add((e[0], e[1]))
    return {
        "nome": mapa.nome,
        "grade": mapa.grade,
        "estados": len(ge.estados()),
        "arcos": ge.sem_alvo.tamanho,
        "teto": ge.teto_teorico(),
        "algoritmos": algs,
        "armadilhas": [{"rotulo": rotulo(e), "linha": e[0], "coluna": e[1], "chaves": e[2] or "-"}
                       for e in armadilhas(ge)],
        "camadas": {k: sorted([list(p) for p in v]) for k, v in sorted(camadas.items(), key=lambda kv: (len(kv[0]), kv[0]))},
        # [IA] Claude – campos aditivos para o painel "Métricas" (mesmos números de metricas_global.json,
        # camadas.json e comparacao_modelagem.csv). A comparação de modelagens só faz sentido com portas.
        "metricas": dict(zip(("global", "camadas"), metricas(ge))),
        "comparacao_modelagem": comparacao_modelagem(mapa) if any(p in linha for linha in mapa.grade for p in PORTAS)
        else None,
    }


# [IA] Claude – traços de todos os algoritmos de um mapa, para o HTML standalone (sem API)
def tracos_mapa(mapa: Mapa) -> str:
    """JSON {"BFS": traço, "DFS": ..., "DIJKSTRA": ..., "BELLMAN_FORD": ...}; mapas com fonte '*' ganham
    também as chaves "<ALG>_FONTE_CONSUMIVEL" (ex.: "BELLMAN_FORD_FONTE_CONSUMIVEL"). Ver src/traco.py."""
    partes = [f'"{alg}":{traco_json(mapa, alg)}' for alg in ALGORITMOS_TRACO]
    if mapa.fontes:
        partes += [f'"{alg}_FONTE_CONSUMIVEL":{traco_json(mapa, alg, True)}' for alg in ALGORITMOS_TRACO]
    return "{" + ",".join(partes) + "}"


# [IA] Claude – exportação standalone: embute CSS, JS, fontes e favicon marcados com data-inline
MARCADOR_DADOS = "/*__DADOS_EMBUTIDOS__*/"
_MIME = {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
         ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}
_RE_TAG = re.compile(r"<script\b[^>]*>\s*</script\s*>|<link\b[^>]*>", re.I)
_RE_ATRIBUTO = re.compile(r"""([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?""")
_RE_URL_CSS = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)""", re.I)
_RE_RESTO_STATIC = re.compile(r"""\b(?:src|href)\s*=\s*["']?(?:\./)?static/""", re.I)
_SENTINELA = "\ue000"  # caractere de uso privado: marca onde cada recurso embutido entra


def _atributos(tag: str) -> dict[str, str | None]:
    """Atributos de uma tag de abertura, na ordem em que aparecem (nomes em minúsculas)."""
    corpo = re.sub(r"^<\w+|/?>$", "", tag)
    attrs = {}
    for m in _RE_ATRIBUTO.finditer(corpo):
        valor = next((v for v in m.groups()[1:] if v is not None), None)
        attrs[m.group(1).lower()] = None if valor is None else html_lib.unescape(valor)
    return attrs


def _montar_tag(nome: str, attrs: dict[str, str | None]) -> str:
    partes = [k if v is None else f'{k}="{html_lib.escape(v, quote=True)}"' for k, v in attrs.items()]
    return "<" + " ".join([nome, *partes]) + ">"


def _arquivo(ref: str, base: Path, raiz: Path, origem: str) -> Path:
    """Resolve uma referência relativa (sem ?query/#hash) e garante que ela existe dentro de `raiz`."""
    alvo = (base / ref.split("?", 1)[0].split("#", 1)[0]).resolve()
    if raiz.resolve() not in alvo.parents:
        raise ValueError(f"{origem}: {ref!r} aponta para fora de {raiz}")
    if not alvo.is_file():
        raise ValueError(f"{origem}: {ref!r} deveria ser embutido, mas {alvo} não existe")
    return alvo


def _data_uri(arquivo: Path) -> str:
    mime = _MIME.get(arquivo.suffix.lower()) or mimetypes.guess_type(arquivo.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(arquivo.read_bytes()).decode('ascii')}"


def _css_embutido(arquivo: Path, estaticos: Path) -> str:
    """CSS com cada url(...) relativa (fontes, imagens) trocada por um data URI."""
    def troca(m: re.Match) -> str:
        ref = next(g for g in m.groups() if g is not None)
        if not ref or re.match(r"^(?:[a-z][a-z0-9+.-]*:|//|/|#)", ref, re.I):  # data:, http:, absoluta, #id
            return m.group(0)
        return f'url("{_data_uri(_arquivo(ref, arquivo.parent, estaticos, arquivo.name))}")'
    return re.sub(r"</(style)", r"<\\/\1", _RE_URL_CSS.sub(troca, arquivo.read_text(encoding="utf-8")), flags=re.I)


def _js_embutido(texto: str) -> str:
    """Escapa o que encerraria (`</script`) ou confundiria (`<!--`) o <script> inline no parser HTML."""
    texto = re.sub(r"</(script)", r"<\\/\1", texto, flags=re.I)
    return texto.replace("<!--", "\\x3C!--")


def _embutir_recursos(html: str, estaticos: Path, dados_js: str) -> str:
    """Troca cada tag `data-inline` do template pelo conteúdo do arquivo e o marcador pelos dados.

    - `<link rel="stylesheet" href="static/X" data-inline>` vira `<style>` com as fontes em base64;
    - `<script src="static/X" data-inline></script>` vira `<script>` inline;
    - outros `<link ... data-inline>` (favicon) ganham `href` em data URI; preload/prefetch saem,
      porque as fontes já vão dentro do CSS.
    Os recursos entram por sentinelas numa única passada, então o conteúdo embutido nunca é
    reprocessado (um comentário em app.js que cite o marcador ou uma tag não é tocado).
    """
    if _SENTINELA in html:
        raise ValueError("o template contém o caractere reservado U+E000")
    partes: list[str] = []

    def guardar(conteudo: str) -> str:
        partes.append(conteudo)
        return f"{_SENTINELA}{len(partes) - 1}{_SENTINELA}"

    def trocar_tag(m: re.Match) -> str:
        tag = m.group(0)
        abertura = tag.split(">", 1)[0] + ">"
        attrs = _atributos(abertura)
        if "data-inline" not in attrs:
            return tag
        nome = abertura[1:].split(None, 1)[0].rstrip(">").lower()
        ref = (attrs.get("src") if nome == "script" else attrs.get("href")) or ""
        ref = ref[2:] if ref.startswith("./") else ref
        if not ref.startswith("static/"):
            raise ValueError(f"{abertura}: data-inline só vale para caminhos relativos em static/")
        arquivo = _arquivo(ref[len("static/"):], estaticos, estaticos, abertura)
        if nome == "script":
            resto = {k: v for k, v in attrs.items() if k not in ("src", "data-inline", "defer", "async",
                                                                     "integrity", "crossorigin")}
            return guardar(_montar_tag("script", resto) + _js_embutido(arquivo.read_text(encoding="utf-8"))
                           + "</script>")
        rel = (attrs.get("rel") or "").lower().split()
        if "stylesheet" in rel:
            resto = {k: v for k, v in attrs.items() if k not in ("rel", "href", "data-inline", "type", "as",
                                                                     "integrity", "crossorigin")}
            return guardar(_montar_tag("style", resto) + _css_embutido(arquivo, estaticos) + "</style>")
        if {"preload", "prefetch", "modulepreload"} & set(rel):
            return ""
        resto = {k: (_data_uri(arquivo) if k == "href" else v) for k, v in attrs.items() if k != "data-inline"}
        return guardar(_montar_tag("link", resto))

    html = _RE_TAG.sub(trocar_tag, html)
    restos = sorted({html[max(0, m.start() - 40):m.end() + 40].strip() for m in _RE_RESTO_STATIC.finditer(html)})
    if restos:
        raise ValueError("o template ainda referencia static/ sem data-inline: " + " | ".join(restos))
    if html.count(MARCADOR_DADOS) != 1:
        raise ValueError(f"o template deve ter exatamente um {MARCADOR_DADOS} (achei {html.count(MARCADOR_DADOS)})")
    html = html.replace(MARCADOR_DADOS, guardar(dados_js))
    return re.sub(f"{_SENTINELA}(\\d+){_SENTINELA}", lambda m: partes[int(m.group(1))], html)


def gerar_html_interativo(out: str | Path, pastas: list[str], extras: list[str] | None = None,
                          *, template: str | Path | None = None) -> Path:
    """Gera `labirinto_interativo.html`: a página do Flask num único arquivo, sem servidor.

    `template` (opcional, padrão `src/web/templates/labirinto.html`) resolve `static/...` como o
    Flask: na pasta `static/` irmã de `templates/`. Falta de arquivo marcado com data-inline gera
    ValueError com o caminho esperado.
    """
    template = Path(template) if template else TEMPLATE
    arquivos = listar_mapas(*pastas) + [Path(p) for p in (extras or [])]
    dados, tracos = {}, []
    for p in arquivos:
        m = ler_mapa(p)
        dados[m.nome] = dados_mapa(m)
        tracos.append(f"{json.dumps(m.nome, ensure_ascii=False)}:{tracos_mapa(m)}")
    # "<" vira \u003c (mesmo valor em JSON/JS), então nenhum texto dos mapas fecha o <script>
    json_dados = json.dumps(dados, ensure_ascii=False).replace("<", "\\u003c")
    # [IA] Claude – traços (eventos dos algoritmos do grupo) para o replay offline: o mesmo JSON de api/traco
    json_tracos = ("{" + ",".join(tracos) + "}").replace("<", "\\u003c")
    dados_js = f"window.__DADOS__ = {json_dados};\nwindow.__TRACOS__ = {json_tracos};"
    html = _embutir_recursos(template.read_text(encoding="utf-8"), template.resolve().parent.parent / "static",
                             dados_js)
    destino = Path(out) / "labirinto_interativo.html"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(html, encoding="utf-8")
    return destino


# ---------------------------------------------------------------- figuras
def _plt():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    return plt


def _desenhar_grade(ax, mapa: Mapa, rotulos: bool = True) -> None:
    from matplotlib.patches import Rectangle
    for r, linha in enumerate(mapa.grade):
        for c, ch in enumerate(linha):
            ax.add_patch(Rectangle((c, r), 1, 1, facecolor=CORES_CASA[ch], edgecolor="#bbbbbb", linewidth=0.3))
            if rotulos and ch not in "#.":
                ax.text(c + 0.5, r + 0.5, ch, ha="center", va="center", fontsize=6, fontweight="bold")
    ax.set_xlim(0, mapa.colunas)
    ax.set_ylim(mapa.linhas, 0)
    ax.set_aspect("equal")
    ax.set_xlabel("coluna")
    ax.set_ylabel("linha")


def figura_percurso(mapa: Mapa, destino: Path) -> None:
    from matplotlib.lines import Line2D
    plt = _plt()
    r = resolver(grafo_estados(mapa), "DIJKSTRA")
    if r["status"] != "OK":
        r = resolver(grafo_estados(mapa), "BELLMAN_FORD")
    perc = r["percurso"]
    fig, ax = plt.subplots(figsize=(max(9, mapa.colunas * 0.25), max(4.5, mapa.linhas * 0.28)))
    _desenhar_grade(ax, mapa, rotulos=mapa.colunas <= 40)
    vistos = {}
    for a, b in zip(perc, perc[1:]):
        cor = CORES_CAMADA[len(a["chaves"]) % len(CORES_CAMADA)]
        vistos.setdefault(a["chaves"] or "-", cor)
        d = 0.5 + (len(a["chaves"]) - 1.5) * 0.12  # desloca cada camada para trechos repetidos ficarem visíveis
        ax.plot([a["coluna"] + d, b["coluna"] + d], [a["linha"] + d, b["linha"] + d], color=cor, linewidth=2.2)
    ax.plot(perc[0]["coluna"] + .5, perc[0]["linha"] + .5, "o", color="black", markersize=5)
    handles = [Line2D([0], [0], color=c, lw=3, label=f"chaves: {k}") for k, c in vistos.items()]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=len(handles), fontsize=8)
    ax.set_title(f"{mapa.nome}: caminho de menor custo ({r['passos']} passos, custo {r['custo']:g})\n"
                 "a cor do caminho muda a cada chave coletada", fontsize=10)
    fig.tight_layout()
    # [IA] Claude – recorte "tight" para o título e a legenda (abaixo do eixo) não ficarem fora da imagem no m08
    fig.savefig(destino, dpi=150, bbox_inches="tight", pad_inches=0.2)
    plt.close(fig)


def figura_camadas_m02(mapa: Mapa, destino: Path) -> None:
    from matplotlib.lines import Line2D
    plt = _plt()
    ge = grafo_estados(mapa)
    camadas = sorted({e[2] for e in ge.estados()}, key=lambda k: (len(k), k))
    deslocamento = {k: i * (mapa.linhas + 1) for i, k in enumerate(camadas)}

    def pos(e):
        return e[1], e[0] + deslocamento[e[2]]

    fig, ax = plt.subplots(figsize=(10, 2.2 * len(camadas) + 1))
    for a in ge.sem_alvo.arcos():
        (x1, y1), (x2, y2) = pos(a.origem), pos(a.destino)
        muda = a.origem[2] != a.destino[2]
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle="->", color="#d62728" if muda else "#999999",
                                    lw=2 if muda else 0.7, shrinkA=4, shrinkB=4))
    for e in ge.estados():
        x, y = pos(e)
        cor = CORES_CAMADA[camadas.index(e[2]) % len(CORES_CAMADA)]
        ax.plot(x, y, "o", color=cor, markersize=7, markeredgecolor="black", markeredgewidth=0.4)
    # [IA] Claude – nome legível de cada camada ("sem chaves", "chave a", "chaves ab") no lugar de "camada -"
    def nome_camada(k: str) -> str:
        return "sem chaves" if not k else (f"chave {k}" if len(k) == 1 else f"chaves {k}")

    linhas_usadas = {}
    for e in ge.estados():
        linhas_usadas.setdefault(e[2], set()).add(e[0])
    for k, d in deslocamento.items():
        ax.text(-0.8, d + mapa.linhas / 2, nome_camada(k), ha="right", va="center", fontsize=9, fontweight="bold",
                color=CORES_CAMADA[camadas.index(k) % len(CORES_CAMADA)])
    # [IA] Claude – o eixo y mostra a linha real do mapa em cada camada (antes mostrava a linha deslocada, ex.: 7 em vez de 1)
    ticks = sorted((r + deslocamento[k], r) for k, rs in linhas_usadas.items() for r in rs)
    ax.set_yticks([t for t, _ in ticks], [str(r) for _, r in ticks])
    ax.invert_yaxis()
    ax.set_xlabel("coluna")
    ax.set_ylabel("linha do mapa (uma faixa por camada)")
    handles = [Line2D([0], [0], marker="o", lw=0, color=CORES_CAMADA[i], label=f"estados {nome_camada(k)}")
               for i, k in enumerate(camadas)]
    handles += [Line2D([0], [0], color="#999999", label="arco na mesma camada"),
                Line2D([0], [0], color="#d62728", lw=2, label="arco que muda de camada")]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=4, fontsize=8)
    ax.set_title(f"Grafo de estados do {mapa.nome} em camadas ({len(ge.estados())} estados)")
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def figura_arvore_bfs(mapa: Mapa, destino: Path) -> None:
    plt = _plt()
    ge = grafo_estados(mapa)
    r = bfs(ge.grafo, ge.inicio)
    niveis = r.niveis()
    pos = {}
    for d, nivel in enumerate(niveis):
        for i, v in enumerate(nivel):
            pos[v] = (i - (len(nivel) - 1) / 2, d)
    fig, ax = plt.subplots(figsize=(10, max(6, len(niveis) * 0.32)))
    for v, p in r.pai.items():
        if p is not None:
            ax.plot([pos[p][0], pos[v][0]], [pos[p][1], pos[v][1]], color="#888888", lw=0.8)
    for v, (x, y) in pos.items():
        cor = "#fdbf6f" if v == ALVO else CORES_CAMADA[len(v[2]) % len(CORES_CAMADA)]
        ax.plot(x, y, "o", color=cor, markersize=6, markeredgecolor="black", markeredgewidth=0.4)
        # [IA] Claude – legibilidade: rótulo dos estados maior e perto do nó (antes fonte 5, quase ilegível)
        ax.text(x + 0.04, y, rotulo(v), fontsize=7.5, va="center")
    ax.invert_yaxis()
    # [IA] Claude – margem à direita para os rótulos do último ramo não encostarem na borda da figura
    xs = [x for x, _ in pos.values()]
    ax.set_xlim(min(xs) - 0.1, max(xs) + 0.35)
    ax.set_ylabel("nível BFS (passos desde o início)")
    # [IA] Claude – a posição horizontal só separa os ramos; os números do eixo x não têm significado
    ax.set_xticks([])
    ax.set_xlabel("ramos da árvore BFS")
    ax.set_title(f"Árvore BFS de estados do {mapa.nome} ({len(niveis)} níveis)")
    from matplotlib.lines import Line2D
    ax.legend(handles=[Line2D([0], [0], marker="o", lw=0, color=CORES_CAMADA[0], label="sem chave"),
                       Line2D([0], [0], marker="o", lw=0, color=CORES_CAMADA[1], label="com 1 chave"),
                       Line2D([0], [0], marker="o", lw=0, color="#fdbf6f", label="ALVO")], loc="lower right")
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def figura_heatmap(mapa: Mapa, destino: Path) -> None:
    import numpy as np
    plt = _plt()
    ge = grafo_estados(mapa)
    mult = Counter((e[0], e[1]) for e in ge.estados())
    m = np.full((mapa.linhas, mapa.colunas), np.nan)
    for (r, c), k in mult.items():
        m[r, c] = k
    fig, ax = plt.subplots(figsize=(14, 6.5))
    ax.set_facecolor("#3a3a3a")
    # [IA] Claude – multiplicidade é contagem: barra de cores em degraus inteiros (1, 2, …, máx), sem 1,5 / 2,5
    from matplotlib.colors import BoundaryNorm
    maximo = max(mult.values())
    cmap = plt.get_cmap("viridis", maximo)
    norm = BoundaryNorm([v + 0.5 for v in range(maximo + 1)], cmap.N)
    im = ax.imshow(m, cmap=cmap, norm=norm, interpolation="nearest")
    fig.colorbar(im, ax=ax, label="multiplicidade (nº de estados na casa)", shrink=0.8, ticks=range(1, maximo + 1))
    ax.set_xlabel("coluna")
    ax.set_ylabel("linha")
    ax.set_title(f"{mapa.nome}: multiplicidade das casas (máx = {max(mult.values())}; paredes em cinza)")
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def gerar_figuras(out: str | Path, pasta_mapas: str = "data/mapas") -> None:
    out = Path(out)
    mapas = {p.stem[:3]: ler_mapa(p) for p in listar_mapas(pasta_mapas)}
    figura_percurso(mapas["m03"], out / "percurso_m03.png")
    figura_percurso(mapas["m08"], out / "percurso_m08.png")
    figura_camadas_m02(mapas["m02"], out / "camadas_m02.png")
    figura_arvore_bfs(mapas["m02"], out / "arvore_bfs_m02.png")
    figura_heatmap(mapas["m08"], out / "heatmap_multiplicidade_m08.png")
