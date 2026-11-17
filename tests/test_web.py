# [IA] Claude – testes da aplicação web (rotas, página 404) e da exportação standalone do labirinto
import json
import re

import pytest

from conftest import RAIZ
from src.viz import gerar_html_interativo
from src.web.app import app

ESTATICOS = RAIZ / "src" / "web" / "static"
TEMPLATE = RAIZ / "src" / "web" / "templates" / "labirinto.html"
PASTAS = [str(RAIZ / "data" / "mapas"), str(RAIZ / "data" / "mapas_grupo")]
M01 = str(RAIZ / "data" / "mapas" / "m01_terreno.txt")
FRONT = ["vendor/three.min.js", "js/pixel.js", "js/voxel.js", "js/maze3d.js", "js/app.js", "css/app.css", "favicon.svg"]


@pytest.fixture()
def cliente():
    app.config["TESTING"] = True
    return app.test_client()


# ---------------------------------------------------------------- rotas
# [IA] Claude – "/" é o menu de projetos; a Parte 1 mora em /parte1 e a Parte 2 (provisória) em /parte2
def test_raiz_e_o_menu_de_projetos(cliente):
    r = cliente.get("/")
    assert r.status_code == 200 and r.mimetype == "text/html"
    html = r.get_data(as_text=True)
    assert "Escolha o projeto" in html
    assert 'href="parte1"' in html                       # relativo: funciona atrás de um prefixo de caminho
    assert 'aria-disabled="true"' in html and "Parte 2" in html
    assert "static/js/menu.js" in html and "static/js/app.js" not in html


def test_parte1_carrega_o_labirinto(cliente):
    r = cliente.get("/parte1")
    assert r.status_code == 200 and r.mimetype == "text/html"
    html = r.get_data(as_text=True)
    assert "static/js/app.js" in html
    assert 'class="nav__voltar" href="./"' in html        # volta ao menu
    # caminhos relativos a partir de /parte1 resolvem na raiz do site
    assert cliente.get("/static/js/app.js").status_code == 200


def test_parte2_e_a_pagina_provisoria(cliente):
    r = cliente.get("/parte2")
    assert r.status_code == 200 and r.mimetype == "text/html"
    html = r.get_data(as_text=True)
    assert "Parte 2 em construção" in html and 'href="./"' in html


@pytest.mark.parametrize("antigo, destino", [
    ("/labirinto", "/parte1"), ("/labirinto/", "/parte1"), ("/parte1/", "/parte1"), ("/parte2/", "/parte2"),
])
def test_enderecos_antigos_redirecionam(cliente, antigo, destino):
    r = cliente.get(antigo)
    assert r.status_code == 302
    assert r.headers["Location"].endswith(destino)


def test_redirecionamento_mantem_a_query(cliente):
    r = cliente.get("/labirinto?mapa=m05")
    assert r.status_code == 302
    assert r.headers["Location"].endswith("/parte1?mapa=m05")


@pytest.mark.parametrize("arquivo", ["js/app.js", "vendor/three.min.js", "css/app.css"])
def test_arquivos_estaticos(cliente, arquivo):
    r = cliente.get(f"/static/{arquivo}")
    assert r.status_code == 200
    assert len(r.data) > 0


def test_health(cliente):
    r = cliente.get("/health")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"


def test_api_mapas_lista_o_m03(cliente):
    assert "m03_tres_chaves" in cliente.get("/api/mapas").get_json()["mapas"]


def test_favicon_ico_serve_o_svg(cliente, tmp_path, monkeypatch):
    # pasta static/ de teste: a rota é verificada mesmo antes do favicon.svg do front existir
    (tmp_path / "favicon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    monkeypatch.setattr(app, "static_folder", str(tmp_path))
    r = cliente.get("/favicon.ico")
    assert r.status_code == 200
    assert r.mimetype == "image/svg+xml"
    assert r.data.startswith(b"<svg")


@pytest.mark.parametrize("caminho", ["/nao-existe", "/um/caminho/profundo", "/static/js/nao-existe.js",
                                     "/parte3", "/parte1/x"])
def test_404_do_site_usa_a_pagina_propria(cliente, caminho):
    r = cliente.get(caminho)
    assert r.status_code == 404
    assert r.mimetype == "text/html"
    assert "Esse estado não existe" in r.get_data(as_text=True)
    assert "X-Servido-Por" in r.headers


@pytest.mark.parametrize("caminho", ["/api/mapa/xyz", "/api/nada"])
def test_404_da_api_mantem_a_resposta_padrao(cliente, caminho):
    r = cliente.get(caminho)
    corpo = r.get_data(as_text=True)
    assert r.status_code == 404
    assert "Esse estado não existe" not in corpo
    assert "Not Found" in corpo


def test_404_da_api_preserva_a_mensagem(cliente):
    assert "mapa &#39;xyz&#39; não existe" in cliente.get("/api/mapa/xyz").get_data(as_text=True)


# ---------------------------------------------------------------- [IA] Claude – métricas, mapa surpresa e traços
MAPA_OK = "#####\n#S.G#\n#####\n"


def test_api_mapa_traz_metricas(cliente):
    d = cliente.get("/api/mapa/m03_tres_chaves").get_json()
    g = d["metricas"]["global"]
    assert g["G_est"]["ordem"] == d["estados"] and g["G_est"]["tamanho"] == d["arcos"]
    assert g["teto_teorico"] == d["teto"]
    assert {"G_pos", "taxa_ocupacao", "maior_grau_saida", "maior_grau_entrada", "becos",
            "multiplicidade_maxima"} <= g.keys()
    assert {"camadas", "arcos_entre_camadas", "casas_que_mudam_camada"} <= d["metricas"]["camadas"].keys()
    assert [l["abordagem"] for l in d["comparacao_modelagem"]] == ["G_pos_porta_chao", "G_pos_porta_parede", "G_est"]
    assert cliente.get("/api/mapa/m01_terreno").get_json()["comparacao_modelagem"] is None  # sem portas


@pytest.mark.parametrize("alg", ["BFS", "DFS", "DIJKSTRA", "BELLMAN_FORD"])
def test_get_traco(cliente, alg):
    r = cliente.get(f"/api/traco/m03_tres_chaves?alg={alg}")
    assert r.status_code == 200 and r.mimetype == "application/json"
    t = r.get_json()
    assert t["algoritmo"] == alg and t["fonteConsumivel"] is False
    assert t["grafo"]["nEstados"] == 213 and t["eventos"]


def test_get_traco_fonte_e_erros(cliente):
    t = cliente.get("/api/traco/m06_fonte?alg=BELLMAN_FORD&fonte=1").get_json()
    assert t["fonteConsumivel"] is True and t["resultado"]["cicloNegativo"] is None
    assert cliente.get("/api/traco/m06_fonte?alg=BELLMAN_FORD").get_json()["resultado"]["cicloNegativo"]
    r = cliente.get("/api/traco/m03_tres_chaves?alg=XYZ")
    assert r.status_code == 400 and "alg" in r.get_json()["erro"]
    r = cliente.get("/api/traco/nao_existe?alg=BFS")
    assert r.status_code == 404 and "não existe" in r.get_json()["erro"]


def test_post_mapa_personalizado(cliente):
    r = cliente.post("/api/mapa", data=MAPA_OK, content_type="text/plain")
    assert r.status_code == 200
    d = r.get_json()
    assert d["nome"] == "personalizado" and d["grade"] == ["#####", "#S.G#", "#####"]
    assert d["algoritmos"]["BFS"]["status"] == "OK" and d["algoritmos"]["BFS"]["passos"] == 2
    assert "metricas" in d and "servidor" in d


@pytest.mark.parametrize("corpo, trecho", [
    ("#####\n#S..#\n#####\n", "pelo menos um 'G'"),
    ("####\n#S.G#\n", "não retangular"),
    ("#S?G#\n", "símbolo desconhecido"),
    ("", "mapa vazio"),
])
def test_post_mapa_invalido_400_com_mensagem(cliente, corpo, trecho):
    r = cliente.post("/api/mapa", data=corpo, content_type="text/plain")
    assert r.status_code == 400
    assert trecho in r.get_json()["erro"]


def test_post_mapa_grande_demais(cliente):
    r = cliente.post("/api/mapa", data="#" * (64 * 1024 + 1), content_type="text/plain")
    assert r.status_code == 400 and "64 KB" in r.get_json()["erro"]
    explosivo = "#" * 24 + "\n#S" + "+" * 20 + "G#\n" + "#" * 24 + "\n"  # 2^20 combinações de bônus
    r = cliente.post("/api/mapa", data=explosivo, content_type="text/plain")
    assert r.status_code == 400 and "grande demais" in r.get_json()["erro"]


def test_post_traco(cliente):
    r = cliente.post("/api/traco?alg=BFS", data=MAPA_OK, content_type="text/plain")
    assert r.status_code == 200
    t = r.get_json()
    assert t["grafo"]["rotulos"] == ["(1,1)|-|{}", "(1,2)|-|{}", "(1,3)|-|{}", "ALVO"]
    assert t["resultado"]["dist"] == [0, 1, 2, 3]
    assert [e["t"] for e in t["eventos"][:3]] == ["inicio", "sai", "olha"]
    r = cliente.post("/api/traco?alg=DIJKSTRA&fonte=1", data="###\n#S#\n###\n", content_type="text/plain")
    assert r.status_code == 400 and "'G'" in r.get_json()["erro"]


def test_post_mapa_nao_grava_no_historico(cliente, monkeypatch):
    from src.web import app as modulo
    chamadas = []
    monkeypatch.setattr(modulo.db, "habilitado", lambda: True)
    monkeypatch.setattr(modulo.db, "registrar", lambda *a: chamadas.append(a))
    assert cliente.post("/api/mapa", data=MAPA_OK, content_type="text/plain").status_code == 200
    assert chamadas == []
    cliente.get("/api/mapa/m01_terreno")
    assert [c[0] for c in chamadas] == ["m01_terreno"]


# ---------------------------------------------------------------- exportação standalone (template real)
def test_html_standalone_embute_tudo(tmp_path):
    faltando = [f for f in FRONT if not (ESTATICOS / f).is_file()]
    if faltando:
        pytest.skip(f"front ainda incompleto: {', '.join(faltando)}")
    html = gerar_html_interativo(tmp_path, PASTAS).read_text(encoding="utf-8")
    assert len(html.encode("utf-8")) < 12_000_000  # [IA] Claude – inclui os traços de todos os mapas
    assert 'src="static/' not in html and 'href="static/' not in html
    assert "/*__DADOS_EMBUTIDOS__*/" not in html
    assert "THREE" in html and "LAB.Maze3D" in html
    assert "data:font/woff2;base64," in html
    inicio = html.index("window.__DADOS__ = ") + len("window.__DADOS__ = ")
    dados, _ = json.JSONDecoder().raw_decode(html, inicio)
    assert "m03_tres_chaves" in dados
    m03 = dados["m03_tres_chaves"]
    assert {"grade", "algoritmos", "camadas", "armadilhas"} <= m03.keys()
    assert m03["algoritmos"]["DIJKSTRA"]["status"] == "OK"
    assert {"metricas", "comparacao_modelagem"} <= m03.keys()
    # [IA] Claude – traços embutidos para o replay offline (mesmo JSON de api/traco)
    ini_t = html.index("window.__TRACOS__ = ") + len("window.__TRACOS__ = ")
    tracos, _ = json.JSONDecoder().raw_decode(html, ini_t)
    assert set(tracos) == set(dados)
    assert set(tracos["m03_tres_chaves"]) == {"BFS", "DFS", "DIJKSTRA", "BELLMAN_FORD"}
    assert "BELLMAN_FORD_FONTE_CONSUMIVEL" in tracos["m06_fonte"]
    assert tracos["m03_tres_chaves"]["BFS"]["eventos"][0]["t"] == "inicio"
    # os dados entram antes do app.js, que é quem os lê
    primeira_linha_app = (ESTATICOS / "js" / "app.js").read_text(encoding="utf-8").splitlines()[0]
    assert inicio < html.index(primeira_linha_app)


# ---------------------------------------------------------------- exportador com um template de teste
def _projeto(tmp_path, cabeca: str, corpo: str = "") -> tuple:
    """Monta templates/ + static/ como no Flask e devolve (template, pasta de saída)."""
    (tmp_path / "static" / "css").mkdir(parents=True)
    (tmp_path / "static" / "js").mkdir()
    (tmp_path / "static" / "fonts").mkdir()
    (tmp_path / "templates").mkdir()
    (tmp_path / "static" / "fonts" / "f.woff2").write_bytes(b"wOF2-fonte-de-teste")
    (tmp_path / "static" / "favicon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    (tmp_path / "static" / "css" / "app.css").write_text(
        '@font-face{src:url(../fonts/f.woff2)}\n@font-face{src:url("../fonts/f.woff2?v=2")}\n'
        "a{background:url(data:image/png;base64,AAAA)}\n/* </style> */\n")
    (tmp_path / "static" / "js" / "app.js").write_text(
        'var s = "</script><!--"; // cita /*__DADOS_EMBUTIDOS__*/ e <script src="static/js/x.js" data-inline>\n')
    template = tmp_path / "templates" / "pagina.html"
    template.write_text(f"<!doctype html><head>{cabeca}</head><body>{corpo}</body>", encoding="utf-8")
    return template, tmp_path / "saida"


CABECA = ('<link rel="icon" type="image/svg+xml" href="static/favicon.svg" data-inline>'
          '<link rel="preload" href="static/fonts/f.woff2" as="font" crossorigin data-inline>'
          '<link rel="stylesheet" href="static/css/app.css" data-inline>')
CORPO = '<script>/*__DADOS_EMBUTIDOS__*/</script><script src="static/js/app.js" data-inline defer></script>'


def test_exportador_embute_css_js_fontes_e_favicon(tmp_path):
    template, saida = _projeto(tmp_path, CABECA, CORPO)
    html = gerar_html_interativo(saida, [], extras=[M01], template=template).read_text(encoding="utf-8")
    assert "static/" not in html.replace('src="static/js/x.js"', "")     # só a citação no comentário do JS
    assert html.count("data:font/woff2;base64,") == 2                   # as duas url() da fonte
    assert "url(data:image/png;base64,AAAA)" in html                     # data URI existente fica intacto
    assert 'href="data:image/svg+xml;base64,' in html and 'rel="preload"' not in html
    assert "<\\/style>" in html and '"<\\/script>\\x3C!--"' in html
    assert html.count("window.__DADOS__ = ") == 1
    assert "cita /*__DADOS_EMBUTIDOS__*/" in html                        # conteúdo embutido não é reprocessado
    assert re.search(r'<script>var s = ', html)                          # defer/src/data-inline saem da tag
    inicio = html.index("window.__DADOS__ = ") + len("window.__DADOS__ = ")
    assert list(json.JSONDecoder().raw_decode(html, inicio)[0]) == ["m01_terreno"]


def test_exportador_falha_se_arquivo_marcado_nao_existe(tmp_path):
    template, saida = _projeto(tmp_path, CABECA + '<script src="static/js/sumiu.js" data-inline></script>', CORPO)
    with pytest.raises(ValueError, match="sumiu.js"):
        gerar_html_interativo(saida, [], extras=[M01], template=template)


def test_exportador_falha_se_fonte_do_css_nao_existe(tmp_path):
    template, saida = _projeto(tmp_path, CABECA, CORPO)
    (tmp_path / "static" / "fonts" / "f.woff2").unlink()
    with pytest.raises(ValueError, match="f.woff2"):
        gerar_html_interativo(saida, [], extras=[M01], template=template)


@pytest.mark.parametrize("cabeca, corpo, motivo", [
    ('<script src="static/js/app.js"></script>', CORPO, "sem data-inline"),
    ('<script src="static/../../fora.js" data-inline></script>', CORPO, "fora de"),
    (CABECA, "<p>sem marcador</p>", "exatamente um"),
])
def test_exportador_recusa_template_quebrado(tmp_path, cabeca, corpo, motivo):
    template, saida = _projeto(tmp_path, cabeca, corpo)
    with pytest.raises(ValueError, match=motivo):
        gerar_html_interativo(saida, [], extras=[M01], template=template)
