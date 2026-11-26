/* [IA] Claude – app.js: casca da página do Labirinto com Chaves. Carrega os dados (API do Flask ou
   window.__DADOS__ no arquivo estático), cria os dois diorama LAB.Maze3D (hero em modo vitrine e player
   interativo), conduz a reprodução passo a passo, HUD, minimapa, linha do tempo, inspetor, histórico do RDS,
   manual ao vivo (tupla de estado, casas, camadas), algoritmos, CTA e rodapé. Sem WebGL, cai para um
   desenho 2D em canvas com a mesma API, para a página nunca quebrar.
   [IA] Claude – rodada 2: área de trabalho (janela 3D + coluna de informações), mapa de estados e tabela
   (LAB.EstadosView, alimentada pelos traços do Python), métricas, velocidade estilo YouTube (0,25× a 2×),
   "Ir para o fim", mapa surpresa (POST api/mapa), tema masmorra com o baú como objetivo.
   [IA] Claude – rodada 3 (enxuto): barra fina com seletor de mapa (popover) e algoritmo; HUD só com passo/custo e
   chaves; câmera, camada, armadilhas, rastro e minimapa num popover "Visualização"; doca de uma linha; linha do
   estado; métricas e histórico numa gaveta. */
(function () {
  "use strict";

  var LAB = (window.LAB = window.LAB || {});

  /* ================================================================ constantes */
  var REDUZIDO = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var MAPA_DESTAQUE = "m03_tres_chaves";
  var MAPA_GRANDE = "m08_grande";
  var ALG_FONTE = "BELLMAN_FORD_FONTE_CONSUMIVEL";
  var ALG_ORDEM = ["BFS", "DIJKSTRA", "BELLMAN_FORD", "BELLMAN_FORD_FONTE_CONSUMIVEL"];
  var ALG_INFO = {
    BFS: { nome: "BFS", sub: "menos passos", completo: "BFS" },
    DIJKSTRA: { nome: "Dijkstra", sub: "menor custo", completo: "Dijkstra" },
    BELLMAN_FORD: { nome: "Bellman-Ford", sub: "aceita bônus negativo", completo: "Bellman-Ford" },
    BELLMAN_FORD_FONTE_CONSUMIVEL: { nome: "Fonte consumível", sub: "Bellman-Ford com a fonte valendo uma vez", completo: "Bellman-Ford, fonte consumível" }
  };
  var TITULOS = {
    m01: "Terreno", m02: "Uma chave", m03: "Três chaves", m04: "Esteiras", m05: "Bônus",
    m06: "Fonte", m07: "Impossível", m08: "Grande", g01: "Catacumba", g02: "Miragem"
  };
  var STATUS_TXT = {
    OK: "Baú alcançado",
    SEM_SOLUCAO: "Nenhum caminho chega à saída",
    RECUSA: "Dijkstra recusou o mapa",
    CICLO_NEGATIVO: "Ciclo negativo: o custo cai sem limite"
  };
  var STATUS_CURTO = { OK: "Chega ao baú", SEM_SOLUCAO: "Sem caminho", RECUSA: "Recusou o mapa", CICLO_NEGATIVO: "Ciclo negativo" };
  var CASA_NOME = {
    ".": "chão", "S": "início", "G": "baú (saída)", ",": "lama", "~": "água", "+": "bônus", "*": "fonte",
    "^": "esteira para o norte", ">": "esteira para o leste", "v": "esteira para o sul", "<": "esteira para o oeste"
  };
  /* catálogo do manual: símbolo, nome, custo exibido, explicação */
  var CATALOGO = [
    [".", "Chão", "1", "Laje de pedra comum."],
    [",", "Lama", "3", "Atrasa: custa três passos de chão."],
    ["~", "Água", "5", "A casa mais cara de atravessar."],
    ["+", "Bônus", "−4", "−4 na primeira passagem e 1 depois."],
    ["*", "Fonte", "−2", "Devolve 2 toda vez que o aluno pisa nela."],
    [">", "Esteira", "1", "Só sai na direção da seta."],
    ["a", "Chave", "1", "Abre a porta da mesma letra."],
    ["A", "Porta", "1", "Porta com cadeado: só passa quem tem a chave."],
    ["S", "Início", "", "Placa de pressão onde o aluno começa, sem chaves."],
    ["G", "Baú (saída)", "1", "O tesouro. Chegar aqui encerra o percurso."]
  ];
  /* paleta de reserva, usada só se pixel.js não carregar (mesmos hexes do app.css) */
  var PALETA_RESERVA = {
    noite: "#1A1612", noite2: "#26201A", noite3: "#3A3028", luar: "#EFE6D8", luarFraco: "#B5A895",
    papel: "#F3F5FA", quadricula: "#DCE3F0", grafite: "#1C1B29", cesar: "#FF6002", cesarEscuro: "#DD4012",
    chave: { a: "#FFC23A", b: "#35C8F0", c: "#F45BC8", d: "#7DDB45" }, ok: "#3FCF8E", erro: "#FF5470",
    tiles: {
      chao: "#5A5048", chaoAlt: "#524840", parede: "#3C342D", paredeTopo: "#6E6358", lama: "#5E4630", agua: "#1F3F4A",
      aguaClara: "#4FA3B0", bonus: "#F2C14E", fonte: "#F2C14E", esteira: "#4A4440", inicio: "#FF6002", saida: "#C8902E"
    }
  };

  /* velocidade estilo YouTube: multiplicadores; 1× = 3 passos por segundo */
  var VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  var PASSOS_1X = 3;
  var NOME_PERSONALIZADO = "personalizado";

  /* ================================================================ utilidades */
  function $(id) { return document.getElementById(id); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function limitar(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function px() { return LAB.pixel || null; }
  function temPixel(fn) { return !!(LAB.pixel && typeof LAB.pixel[fn] === "function"); }
  function paleta() {
    var p = LAB.pixel && LAB.pixel.PALETTE;
    if (!p) return PALETA_RESERVA;
    // completa campos que faltarem sem alterar o objeto original
    var out = Object.assign({}, PALETA_RESERVA, p);
    out.chave = Object.assign({}, PALETA_RESERVA.chave, p.chave || {});
    out.tiles = Object.assign({}, PALETA_RESERVA.tiles, p.tiles || {});
    return out;
  }
  /** Chama um helper de LAB.pixel sem deixar exceção vazar; devolve null se falhar. */
  function pix(fn) {
    if (!temPixel(fn)) return null;
    try { return LAB.pixel[fn].apply(LAB.pixel, Array.prototype.slice.call(arguments, 1)); }
    catch (e) { return null; }
  }
  function corChave(letra) { return paleta().chave[String(letra || "").toLowerCase()] || paleta().luar; }
  /** Cor do rastro (regra do §3): sem chave = luar; senão a cor da chave mais recente. */
  function corCaminho(chaves, ultima) {
    var c = pix("pathColor", chaves || "", ultima || null);
    if (typeof c === "string" && c) return c;
    if (!chaves) return paleta().luar;
    return corChave(ultima || chaves.slice(-1));
  }
  /** Número em pt-BR com sinal de menos tipográfico; "–" para vazio. */
  function fmt(n) {
    if (n === null || n === undefined || n === "" || isNaN(n)) return "–";
    return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }).replace("-", "−");
  }
  function codigo(nome) {
    if (nome === NOME_PERSONALIZADO) return "seu";
    var m = /^([a-z]+\d+)/i.exec(nome || ""); return m ? m[1] : String(nome || "");
  }
  function titulo(nome) {
    if (nome === NOME_PERSONALIZADO) return "Personalizado";
    var c = codigo(nome);
    if (TITULOS[c]) return TITULOS[c];
    var resto = String(nome || "").replace(/^[a-z]+\d+_?/i, "").replace(/_/g, " ").trim() || String(nome || "");
    return resto.charAt(0).toUpperCase() + resto.slice(1);
  }
  function nomeCasa(ch) {
    if (/[a-d]/.test(ch)) return "chave " + ch;
    if (/[A-D]/.test(ch)) return "porta " + ch;
    return CASA_NOME[ch] || ch;
  }
  function listaPt(itens) {
    if (!itens.length) return "";
    if (itens.length === 1) return itens[0];
    return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
  }
  function rotuloCamada(k) {
    if (k === "todas") return "todas";
    if (k === "-" || !k) return "sem chave";
    return "com " + listaPt(k.split(""));
  }
  /** Promise que nunca trava a reprodução: resolve no fim ou após `ms`, e engole exceções. */
  function seguro(p, ms) {
    var prom;
    try { prom = Promise.resolve(p); } catch (e) { prom = Promise.resolve(); }
    prom = prom.catch(function () {});
    if (!ms) return prom;
    return new Promise(function (ok) {
      var t = setTimeout(ok, ms);
      prom.then(function () { clearTimeout(t); ok(); });
    });
  }
  function canvasNovo(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    var ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    return c;
  }
  /** Exibe um canvas de pixel art no tamanho CSS (w × h) em pixels inteiros. */
  function tamanhoCss(c, w, h) { c.style.width = w + "px"; c.style.height = (h || Math.round(w * c.height / c.width)) + "px"; return c; }

  /* ================================================================ estado */
  var S = {
    embutido: typeof window.__DADOS__ === "object" && window.__DADOS__ !== null,
    nomes: [],
    cache: {},
    pend: {},
    mapa: null,
    nome: null,
    alg: "DIJKSTRA",
    perc: [],
    status: "",
    idx: 0,
    ultChave: [],
    tocando: false,
    token: 0,
    carga: 0,
    camada: "todas",
    armadilhas: true,
    rastro: true,
    minimapa: false,
    vel: PASSOS_1X,
    mult: 1,
    cam: "seguir",
    textoPersonalizado: "",
    playerVisivel: false,
    voltas: 0,
    pendentes: {},
    servidor: undefined
  };
  var heroR = null, playerR = null;
  var heroTipo = "", playerTipo = "";

  /* ================================================================ dados */
  function listarMapas() {
    if (S.embutido) return Promise.resolve(Object.keys(window.__DADOS__));
    return fetch("api/mapas", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("api/mapas " + r.status);
      return r.json();
    }).then(function (d) {
      mostrarServidor(d.servidor || null);
      S.grades = d.grades || {};   // [IA] Claude – só a grade de cada mapa, para as miniaturas dos cartões
      return d.mapas || [];
    });
  }

  /** Busca um mapa uma única vez (o hero e o player compartilham o mesmo objeto). */
  function obterMapa(nome) {
    if (S.cache[nome]) return Promise.resolve(S.cache[nome]);
    if (S.pend[nome]) return S.pend[nome];
    var p;
    if (S.embutido) {
      var d = window.__DADOS__[nome];
      p = d ? Promise.resolve(d) : Promise.reject(new Error("mapa ausente: " + nome));
    } else {
      p = fetch("api/mapa/" + encodeURIComponent(nome)).then(function (r) {
        if (!r.ok) throw new Error("api/mapa " + r.status);
        return r.json();
      }).then(function (d) {
        if (d.servidor) mostrarServidor(d.servidor);
        // cada consulta grava no RDS: atualiza o histórico depois de carregar
        atualizarHistorico();
        return d;
      });
    }
    S.pend[nome] = p.then(function (d) {
      S.cache[nome] = d;
      delete S.pend[nome];
      revelarMiniatura(nome);
      return d;
    }, function (e) { delete S.pend[nome]; throw e; });
    return S.pend[nome];
  }

  /* [IA] Claude – traço de execução (eventos do Python) para o mapa de estados e a tabela.
     Servidor: GET api/traco/<nome>?alg=&fonte= (ou POST api/traco com o texto do mapa personalizado).
     Arquivo estático: window.__TRACOS__[nome][alg] ou window.__DADOS__[nome].tracos[alg]. */
  var cacheTraco = {};
  function normalizarAlgTraco(alg, fonte) {
    alg = String(alg || "").toUpperCase();
    if (alg === "BELLMAN_FORD_FONTE_CONSUMIVEL") return { alg: "BELLMAN_FORD", fonte: 1 };
    return { alg: alg, fonte: fonte ? 1 : 0 };
  }
  function tracoEmbutido(nome, alg, fonte) {
    var chaves = fonte ? ["BELLMAN_FORD_FONTE_CONSUMIVEL", alg + "_FONTE", alg + ":1", alg + "|1"] : [alg, alg + ":0", alg + "|0"];
    var fontes = [window.__TRACOS__ && window.__TRACOS__[nome], window.__DADOS__ && window.__DADOS__[nome] && window.__DADOS__[nome].tracos];
    for (var i = 0; i < fontes.length; i++) {
      var f = fontes[i];
      if (!f) continue;
      for (var j = 0; j < chaves.length; j++) if (f[chaves[j]]) return f[chaves[j]];
      // forma aninhada: { BELLMAN_FORD: { "0": {...}, "1": {...} } }
      if (f[alg] && typeof f[alg] === "object" && (f[alg][fonte] || f[alg][String(fonte)])) return f[alg][fonte] || f[alg][String(fonte)];
    }
    return null;
  }
  /** fetchTraco(nome, alg, fonte) ou fetchTraco({ nome, alg, fonte }) → Promise do traço (cache por mapa+alg). */
  function obterTraco(nome, alg, fonte) {
    if (nome && typeof nome === "object") { alg = nome.alg; fonte = nome.fonte; nome = nome.nome; }
    nome = nome || S.nome;
    var n = normalizarAlgTraco(alg, fonte);
    var k = nome + "|" + n.alg + "|" + n.fonte;
    if (nome === NOME_PERSONALIZADO) k += "|" + S.textoPersonalizado.length + ":" + S.textoPersonalizado.slice(0, 64);
    if (cacheTraco[k]) return cacheTraco[k];
    var p;
    if (S.embutido) {
      var t = tracoEmbutido(nome, n.alg, n.fonte);
      p = t ? Promise.resolve(t) : Promise.reject(new Error("traço ausente no arquivo estático: " + nome + " " + n.alg));
    } else {
      var q = "alg=" + encodeURIComponent(n.alg) + "&fonte=" + n.fonte;
      var req = nome === NOME_PERSONALIZADO
        ? fetch("api/traco?" + q, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: S.textoPersonalizado })
        : fetch("api/traco/" + encodeURIComponent(nome) + "?" + q);
      p = req.then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) { throw new Error(d.erro || ("api/traco " + r.status)); });
        return r.json();
      });
    }
    cacheTraco[k] = p.catch(function (e) { delete cacheTraco[k]; throw e; });
    return cacheTraco[k];
  }

  function melhorAlg(mapa) {
    var a = mapa.algoritmos || {};
    var ordem = ["DIJKSTRA", "BELLMAN_FORD", "BFS", "BELLMAN_FORD_FONTE_CONSUMIVEL"];
    for (var i = 0; i < ordem.length; i++) if (a[ordem[i]] && a[ordem[i]].status === "OK") return ordem[i];
    for (var j = 0; j < ordem.length; j++) if (a[ordem[j]]) return ordem[j];
    return Object.keys(a)[0];
  }
  function algsDoMapa(mapa) {
    var a = mapa.algoritmos || {};
    var lista = ALG_ORDEM.filter(function (k) { return a[k]; });
    Object.keys(a).forEach(function (k) { if (lista.indexOf(k) < 0) lista.push(k); });
    return lista;
  }
  function infoAlg(k) { return ALG_INFO[k] || { nome: k, sub: "", completo: k }; }
  /** Para cada passo, a chave pega mais recentemente (null antes da primeira). */
  function calcularUltimasChaves(perc) {
    var out = [], ult = null;
    for (var i = 0; i < perc.length; i++) {
      var ant = i ? perc[i - 1].chaves || "" : "";
      var cur = perc[i].chaves || "";
      for (var k = 0; k < cur.length; k++) if (ant.indexOf(cur[k]) < 0) ult = cur[k];
      if (!cur) ult = null;
      out.push(ult);
    }
    return out;
  }
  function chavesDoMapa(mapa) {
    var s = (mapa.grade || []).join("");
    return "abcd".split("").filter(function (l) { return s.indexOf(l) >= 0; });
  }
  function posInicio(mapa) {
    var g = mapa.grade || [];
    for (var r = 0; r < g.length; r++) { var c = g[r].indexOf("S"); if (c >= 0) return [r, c]; }
    return [1, 1];
  }

  /* ================================================================ fallback 2D (mesma API do Maze3D) */
  function Mapa2D(container, opts) {
    this.el = container;
    this.opts = opts || {};
    this.ev = {};
    this.mapa = null; this.perc = []; this.idx = 0; this.status = "";
    this.vel = PASSOS_1X; this.camada = "todas"; this.trap = true; this.rastro = true; this.pausado = false;
    this.texturas = {};
    this.caixa = el("div", "mapa2d");
    this.cv = document.createElement("canvas");
    this.caixa.appendChild(this.cv);
    container.appendChild(this.caixa);
    var self = this;
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(function () { self.desenhar(); });
      this.ro.observe(container);
    }
    if (this.opts.attract && !this.opts.reducedMotion) {
      this.timer = setInterval(function () {
        if (self.pausado || document.hidden || !self.perc.length) return;
        self.idx = self.idx >= self.perc.length - 1 ? 0 : self.idx + 1;
        self.desenhar();
      }, 260);
    }
  }
  Mapa2D.prototype.on = function (evt, fn) { (this.ev[evt] = this.ev[evt] || []).push(fn); return this; };
  Mapa2D.prototype.emit = function (evt, dado) { (this.ev[evt] || []).forEach(function (fn) { try { fn(dado); } catch (e) { /* ouvinte com erro não para o mapa */ } }); };
  Mapa2D.prototype.load = function (mapa) { this.mapa = mapa; this.perc = []; this.idx = 0; this.desenhar(); this.emit("ready"); return Promise.resolve(); };
  Mapa2D.prototype.setPath = function (perc, o) {
    this.perc = perc || []; this.status = (o && o.status) || "";
    this.idx = this.opts.attract && this.opts.reducedMotion ? Math.max(0, this.perc.length - 1) : 0;
    this.desenhar();
    // [IA] Claude – sem caminho até o baú (SEM_SOLUCAO / RECUSA): avisa como o motor 3D
    if (!this.opts.attract && this.status && this.status !== "OK" && this.status !== "CICLO_NEGATIVO") {
      var self = this;
      setTimeout(function () { self.emit("fail", { status: self.status }); }, 0);
    }
  };
  Mapa2D.prototype.goTo = function (i, o) {
    var alvo = limitar(i | 0, 0, Math.max(0, this.perc.length - 1));
    var anima = o && o.animate && alvo === this.idx + 1;
    var ant = this.perc[this.idx], cur = this.perc[alvo];
    this.idx = alvo;
    this.desenhar();
    this.emit("step", { idx: alvo });
    if (!anima || !ant || !cur) return Promise.resolve();
    var ms = REDUZIDO ? 0 : Math.round(1000 / this.vel);
    var self = this;
    var nova = (cur.chaves || "").split("").filter(function (l) { return (ant.chaves || "").indexOf(l) < 0; })[0];
    if (nova) setTimeout(function () { self.emit("key", { letter: nova }); }, ms * 0.6);
    if (/[A-D]/.test(cur.casa)) this.emit("door", { letter: cur.casa });
    if (cur.casa === "G" && alvo === this.perc.length - 1 && this.status === "OK") setTimeout(function () { self.emit("goal", { idx: alvo }); }, ms);
    return esperar(ms);
  };
  Mapa2D.prototype.setSpeed = function (v) { this.vel = limitar(+v || PASSOS_1X, 0.25, 30); };
  Mapa2D.prototype.setLayer = function (k) { this.camada = k || "todas"; this.desenhar(); };
  Mapa2D.prototype.setTrapsVisible = function (b) { this.trap = !!b; this.desenhar(); };
  Mapa2D.prototype.setTrailVisible = function (b) { this.rastro = !!b; this.desenhar(); };
  Mapa2D.prototype.setCamera = function () {};
  Mapa2D.prototype.resetCamera = function () {};
  Mapa2D.prototype.setPaused = function (b) { this.pausado = !!b; };
  Mapa2D.prototype.resize = function () { this.desenhar(); };
  Mapa2D.prototype.dispose = function () {
    clearInterval(this.timer);
    if (this.ro) this.ro.disconnect();
    if (this.caixa.parentNode) this.caixa.parentNode.removeChild(this.caixa);
    this.ev = {};
  };
  Mapa2D.prototype.textura = function (ch, variante) {
    var k = ch + variante;
    if (!(k in this.texturas)) {
      this.texturas[k] = ch === "#" ? (pix("wallTexture", "top", variante) || null) : (pix("tileTexture", ch, variante) || null);
    }
    return this.texturas[k];
  };
  Mapa2D.prototype.desenhar = function () {
    var m = this.mapa;
    if (!m || !m.grade || !m.grade.length) return;
    var P = paleta(), T = P.tiles;
    var L = m.grade.length, C = m.grade[0].length;
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    // no player o HUD ocupa as faixas de cima (passo, status) e de baixo (inventário): o mapa fica entre elas
    var padX = this.opts.attract ? 32 : 20, padY = this.opts.attract ? 32 : Math.min(64, Math.round(h * 0.12));
    var t = Math.max(3, Math.floor(Math.min((w - padX * 2) / C, (h - padY * 2) / L)));
    var u = t * DPR;
    var cv = this.cv;
    if (cv.width !== C * u || cv.height !== L * u) { cv.width = C * u; cv.height = L * u; }
    cv.style.width = C * t + "px"; cv.style.height = L * t + "px";
    var ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    var naCamada = null;
    if (this.camada !== "todas" && m.camadas && m.camadas[this.camada]) {
      naCamada = {};
      m.camadas[this.camada].forEach(function (p) { naCamada[p[0] + "," + p[1]] = 1; });
    }
    var plano = { "#": T.parede, ".": T.chao, "S": T.inicio, "G": T.saida, ",": T.lama, "~": T.agua, "+": T.bonus, "*": T.fonte };
    for (var r = 0; r < L; r++) {
      for (var c = 0; c < C; c++) {
        var ch = m.grade[r][c];
        var tex = this.textura(ch, (r * 7 + c * 13) % 4);
        if (tex) ctx.drawImage(tex, 0, 0, tex.width, Math.min(tex.width, tex.height), c * u, r * u, u, u);
        else {
          ctx.fillStyle = plano[ch] || (/[a-d]/.test(ch) ? T.chao : /[A-D]/.test(ch) ? corChave(ch) : /[\^>v<]/.test(ch) ? T.esteira : T.chao);
          ctx.fillRect(c * u, r * u, u, u);
          if (/[a-d]/.test(ch)) { ctx.fillStyle = corChave(ch); ctx.fillRect(c * u + u * 0.3, r * u + u * 0.3, u * 0.4, u * 0.4); }
        }
        if (ch === "#") { ctx.fillStyle = "rgba(10,8,24,.35)"; ctx.fillRect(c * u, r * u + u - Math.max(1, u / 8), u, Math.max(1, u / 8)); }
        if (naCamada && ch !== "#" && !naCamada[r + "," + c]) { ctx.fillStyle = "rgba(14,11,30,.68)"; ctx.fillRect(c * u, r * u, u, u); }
      }
    }
    var self = this;
    // chaves ainda no chão (as já coletadas no passo atual somem, como no 3D)
    var naMao = this.perc.length ? (this.perc[Math.min(this.idx, this.perc.length - 1)].chaves || "") : "";
    for (var rr = 0; rr < L; rr++) for (var cc = 0; cc < C; cc++) {
      var kc = m.grade[rr][cc];
      if (!/[a-d]/.test(kc) || naMao.indexOf(kc) >= 0) continue;
      var ic = pix("keyIcon", kc, Math.max(1, Math.floor(u * 0.8 / 12)));
      if (ic) ctx.drawImage(ic, Math.round(cc * u + (u - ic.width) / 2), Math.round(rr * u + (u - ic.height) / 2));
    }
    if (this.trap && m.armadilhas) {
      m.armadilhas.forEach(function (a) {
        if (self.camada !== "todas" && a.chaves !== self.camada) return;
        var q = Math.max(2, Math.round(u * 0.28));
        ctx.fillStyle = P.erro;
        ctx.fillRect(a.coluna * u + q, a.linha * u + q, u - 2 * q, u - 2 * q);
        ctx.fillStyle = "rgba(60,8,20,.55)";
        ctx.fillRect(a.coluna * u + q + DPR, a.linha * u + q + DPR, u - 2 * q - 2 * DPR, u - 2 * q - 2 * DPR);
      });
    }
    var perc = this.perc;
    if (perc.length) {
      var fim = this.idx;
      if (this.rastro) {
        var ult = calcularUltimasChaves(perc);
        var lw = Math.max(2 * DPR, Math.round(u / 5));
        for (var i = 1; i <= fim && i < perc.length; i++) {
          var a0 = perc[i - 1], b0 = perc[i];
          ctx.fillStyle = corCaminho(b0.chaves, ult[i]);
          var x0 = Math.min(a0.coluna, b0.coluna) * u + u / 2 - lw / 2, y0 = Math.min(a0.linha, b0.linha) * u + u / 2 - lw / 2;
          ctx.fillRect(x0, y0, Math.abs(a0.coluna - b0.coluna) * u + lw, Math.abs(a0.linha - b0.linha) * u + lw);
        }
      }
      var p = perc[Math.min(this.idx, perc.length - 1)];
      desenharAluno(ctx, p.coluna * u, p.linha * u, u, perc[Math.min(this.idx + 1, perc.length - 1)].movimento || p.movimento);
    } else {
      var s0 = posInicio(m);
      desenharAluno(ctx, s0[1] * u, s0[0] * u, u, "");
    }
  };
  /** Aluno no canvas 2D: sprite de pixel.js ou um marcador laranja com contorno. */
  function desenharAluno(ctx, x, y, u, mov) {
    var vista = mov === "N" ? "back" : (mov === "L" || mov === "O") ? "side" : "front";
    var spr = pix("studentSprite", vista, 0, 1);
    if (spr) {
      var hh = Math.round(u * 1.5), ww = Math.round(hh * spr.width / spr.height);
      ctx.save();
      if (mov === "O") { ctx.translate(x + u / 2, 0); ctx.scale(-1, 1); ctx.translate(-(x + u / 2), 0); }
      ctx.drawImage(spr, Math.round(x + u / 2 - ww / 2), Math.round(y + u - hh - u * 0.08), ww, hh);
      ctx.restore();
      return;
    }
    var q = Math.round(u * 0.18);
    ctx.fillStyle = "#fff"; ctx.fillRect(x + q - DPR, y + q - DPR, u - 2 * q + 2 * DPR, u - 2 * q + 2 * DPR);
    ctx.fillStyle = paleta().cesar; ctx.fillRect(x + q, y + q, u - 2 * q, u - 2 * q);
  }

  /* ================================================================ renderizadores (3D com reserva 2D) */
  function suporta3D() {
    try { return !!(window.THREE && LAB.Maze3D && typeof LAB.Maze3D === "function" && LAB.Maze3D.supported && LAB.Maze3D.supported()); }
    catch (e) { return false; }
  }
  function criarRenderer(container, opts) {
    if (suporta3D()) {
      try { return { r: new LAB.Maze3D(container, opts), tipo: "3d" }; }
      catch (e) { $$("canvas", container).forEach(function (c) { c.remove(); }); }
    }
    return { r: new Mapa2D(container, opts), tipo: "2d" };
  }
  /** Chamada protegida: um erro no motor nunca derruba a página. */
  function chamar(r, metodo) {
    if (!r || typeof r[metodo] !== "function") return undefined;
    try { return r[metodo].apply(r, Array.prototype.slice.call(arguments, 2)); }
    catch (e) { return undefined; }
  }

  /* ================================================================ sprites da interface */
  var animados = [];
  /** Recorta a cabeça do sprite do aluno (para o ícone da navbar e o selo do hero). */
  function rostoAluno(cssLargura) {
    var escala = Math.max(1, Math.round(cssLargura / 16 * DPR));
    var spr = pix("studentSprite", "front", "idle", escala) || pix("studentSprite", "front", 0, escala);
    if (!spr) return null;
    var linhas = 13 * escala;
    var c = canvasNovo(spr.width, Math.min(spr.height, linhas));
    c.getContext("2d").drawImage(spr, 0, 0);
    return tamanhoCss(c, cssLargura);
  }
  /** Anima um sprite do aluno andando dentro de `alvo` (4 quadros a ~8 fps). */
  function spriteAndando(alvo, vista, cssLargura) {
    if (!alvo || alvo.firstChild) return;
    var escala = Math.max(1, Math.round(cssLargura / 16 * DPR));
    var quadros = [0, 1, 2, 3].map(function (f) { return pix("studentSprite", vista, f, escala); }).filter(Boolean);
    if (!quadros.length) return;
    var c = canvasNovo(quadros[0].width, quadros[0].height);
    tamanhoCss(c, cssLargura);
    c.getContext("2d").drawImage(quadros[0], 0, 0);
    alvo.appendChild(c);
    if (!REDUZIDO && quadros.length > 1) animados.push({ c: c, q: quadros, i: 0 });
  }
  var ultimoQuadro = 0;
  function tickSprites(t) {
    if (t - ultimoQuadro > 125) {
      ultimoQuadro = t;
      for (var i = 0; i < animados.length; i++) {
        var a = animados[i];
        if (!a.c.isConnected || !a.c.offsetParent) continue;
        a.i = (a.i + 1) % a.q.length;
        var ctx = a.c.getContext("2d");
        ctx.clearRect(0, 0, a.c.width, a.c.height);
        ctx.drawImage(a.q[a.i], 0, 0);
      }
    }
    if (animados.length) requestAnimationFrame(tickSprites);
  }
  function montarSprites() {
    var rosto = rostoAluno(28);
    if (rosto) { var ic = $("navIcone"); ic.textContent = ""; ic.appendChild(rosto); }
    var selo = $$("[data-sprite-rosto]")[0];
    var r2 = rostoAluno(24);
    if (selo && r2) selo.appendChild(r2);
    $$("[data-sprite-andando]").forEach(function (a) { spriteAndando(a, "front", 48); });
    spriteAndando($("andarilho"), "side", 48);
    var cta = $("ctaAluno");
    var spr = pix("studentSprite", "front", "idle", 6 * DPR) || pix("studentSprite", "front", 0, 6 * DPR);
    if (cta && spr) cta.appendChild(tamanhoCss(spr, 96));
    var logo = desenharLogo(4);
    if (logo) $("rodapeLogo").appendChild(logo);
    if (animados.length) requestAnimationFrame(tickSprites);
  }
  /** Marca CESAR em pixel art (LAB.pixel.LOGO) com a palavra ao lado. */
  function desenharLogo(escala) {
    var lg = px() && px().LOGO;
    if (!lg || !temPixel("draw")) return null;
    var marca = lg.mark23 || lg.mark15 || lg.mark11, palavra = lg.word;
    if (!marca || !marca.length) return null;
    var P = paleta(), cores = { O: P.cesar, w: "#ffffff" };
    var mw = marca[0].length, mh = marca.length;
    var pw = palavra && palavra.length ? palavra[0].length : 0, ph = palavra ? palavra.length : 0;
    var u = escala * DPR, vao = pw ? 4 : 0;
    var c = canvasNovo((mw + vao + pw) * u, Math.max(mh, ph) * u);
    var ctx = c.getContext("2d");
    try {
      LAB.pixel.draw(ctx, marca, cores, 0, 0, u);
      if (pw) LAB.pixel.draw(ctx, palavra, cores, (mw + vao) * u, (Math.max(mh, ph) - ph) * u, u);
    } catch (e) { return null; }
    return tamanhoCss(c, (mw + vao + pw) * escala, Math.max(mh, ph) * escala);
  }

  /* ================================================================ servidor (navbar e rodapé) */
  function mostrarServidor(s) {
    var pills = $$("[data-servidor-pill]");
    if (s === null) {
      S.servidor = null;
      pills.forEach(function (p) { p.setAttribute("data-estado", "estatico"); p.title = "Arquivo HTML gerado com os dados embutidos"; });
      $$("[data-servidor-inst]").forEach(function (e) { e.textContent = "arquivo estático, sem servidor"; });
      $$("[data-servidor-zona]").forEach(function (e) { e.textContent = ""; });
      $("rodapeServidor").hidden = true;
      $("rodapeEstatico").hidden = false;
      $$("[data-so-servidor]").forEach(function (e) { e.hidden = true; });
      return;
    }
    if (s === "erro") {
      pills.forEach(function (p) { p.setAttribute("data-estado", "erro"); });
      $$("[data-servidor-inst]").forEach(function (e) { e.textContent = "servidor fora do ar"; });
      $$("[data-servidor-zona]").forEach(function (e) { e.textContent = ""; });
      return;
    }
    if (!s) return;
    var trocou = S.servidor && S.servidor.instancia !== s.instancia;
    S.servidor = s;
    pills.forEach(function (p) {
      p.setAttribute("data-estado", "ok");
      p.title = "Respondido por " + s.instancia + (s.zona ? " em " + s.zona : "") + (s.ip ? ", IP " + s.ip : "");
      if (trocou) { p.classList.remove("is-trocou"); void p.offsetWidth; p.classList.add("is-trocou"); }
    });
    $$("[data-servidor-inst]").forEach(function (e) { e.textContent = s.instancia || "–"; });
    $$("[data-servidor-zona]").forEach(function (e) { e.textContent = s.zona || ""; });
    $$("[data-srv]").forEach(function (e) { var v = s[e.getAttribute("data-srv")]; e.textContent = v == null || v === "" ? "–" : v; });
  }

  /* ================================================================ histórico (RDS) */
  var histPedido = 0, histDesligado = false;
  function atualizarHistorico() {
    if (S.embutido || histDesligado || !window.fetch) return;
    var meu = ++histPedido;
    fetch("api/historico", { cache: "no-store" }).then(function (r) {
      // 404 = servidor sem banco configurado: não muda até o próximo deploy, então não pergunta de novo
      // (503 = banco fora do ar agora: tenta outra vez na próxima consulta)
      if (r.status === 404) histDesligado = true;
      if (!r.ok) throw new Error("sem histórico");
      return r.json();
    }).then(function (d) {
      if (meu !== histPedido) return;
      var tb = $("tbHist");
      tb.textContent = "";
      (d.consultas || []).forEach(function (c) {
        var tr = el("tr");
        var custo = c.custo === null || c.custo === undefined ? (STATUS_CURTO[c.status] || c.status || "–") : fmt(c.custo);
        [String(c.criado_em || "").slice(11, 19), codigo(c.mapa), c.algoritmo || "", custo, c.instancia || ""].forEach(function (v, i) {
          var td = el("td", null, v);
          if (i === 4) td.title = v;
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      $("cardHist").hidden = !(d.consultas && d.consultas.length);
    }).catch(function () { if (meu === histPedido) $("cardHist").hidden = true; });
  }

  /* ================================================================ anúncios (aria-live) */
  var anuncioTimer = 0;
  function anunciar(txt) {
    var a = $("anuncio");
    clearTimeout(anuncioTimer);
    a.textContent = "";
    anuncioTimer = setTimeout(function () { a.textContent = txt; }, 40);
  }

  /* ================================================================ níveis (cartões de mapa) */
  function montarNiveis(nomes) {
    var box = $("niveis");
    box.textContent = "";
    nomes.forEach(function (nome, i) {
      var b = el("button", "nivel" + (nome === NOME_PERSONALIZADO ? " nivel--seu" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", "false");
      b.tabIndex = i === 0 ? 0 : -1;
      b.dataset.nome = nome;
      var mini = el("span", "nivel__mini");
      mini.appendChild(el("span", "nivel__nevoa"));
      var txt = el("span", "nivel__txt");
      txt.appendChild(el("span", "nivel__codigo", codigo(nome)));
      txt.appendChild(el("span", "nivel__titulo", titulo(nome)));
      b.appendChild(mini);
      b.appendChild(txt);
      b.setAttribute("aria-label", codigo(nome) + ", " + titulo(nome));
      b.title = codigo(nome) + " " + titulo(nome);
      b.addEventListener("click", function () { fecharPops(); selecionarMapa(nome); });
      box.appendChild(b);
      if (S.cache[nome] || (S.grades && S.grades[nome])) revelarMiniatura(nome, true);
    });
    if (!box.dataset.teclado) {
      box.dataset.teclado = "1";
      radiogroupTeclado(box, ".nivel", function (b) { agendarMapa(b.dataset.nome); });
    }
    if (S.nome) marcarNivel(S.nome);
  }
  var agendaMapa = 0;
  function agendarMapa(nome) {
    marcarNivel(nome);
    clearTimeout(agendaMapa);
    agendaMapa = setTimeout(function () { selecionarMapa(nome); }, 320);
  }
  function marcarNivel(nome) {
    $$(".nivel").forEach(function (b) {
      var sel = b.dataset.nome === nome;
      b.setAttribute("aria-checked", sel ? "true" : "false");
      b.tabIndex = sel ? 0 : -1;
    });
    atualizarSeletorMapa(nome);
  }
  /** Botão do seletor de mapa na barra: miniatura + código + título do mapa escolhido. */
  function atualizarSeletorMapa(nome) {
    if (!nome) return;
    var btn = $("btnMapa");
    $("mapaSelCodigo").textContent = codigo(nome);
    $("mapaSelTitulo").textContent = titulo(nome);
    btn.setAttribute("aria-label", "Mapa: " + codigo(nome) + ", " + titulo(nome) + ". Trocar de mapa");
    var mini = $("mapaSelMini"), grade = S.cache[nome] ? S.cache[nome].grade : (S.grades && S.grades[nome]);
    if (mini.dataset.nome === nome || !grade || !grade.length) return;
    var cel = Math.max(1, Math.floor(Math.min(30 / grade[0].length, 20 / grade.length)));
    var c = miniatura(grade, cel);
    if (!c) return;
    mini.dataset.nome = nome;
    mini.textContent = "";
    mini.appendChild(c);
  }
  /** Mostra a miniatura do mapa no cartão assim que os dados dele existirem. */
  function revelarMiniatura(nome, semAnimacao) {
    var b = $$(".nivel").filter(function (x) { return x.dataset.nome === nome; })[0];
    var grade = S.cache[nome] ? S.cache[nome].grade : (S.grades && S.grades[nome]);
    if (!b || !grade || !grade.length || b.dataset.revelado) return;
    var mini = b.querySelector(".nivel__mini");
    var C = grade[0].length, L = grade.length;
    // o cartão pode estar num popover fechado (clientWidth 0): usa o tamanho do CSS (48 × 30)
    var w = mini.clientWidth || 48, h = mini.clientHeight || 30;
    var cel = Math.max(1, Math.floor(Math.min((w - 4) / C, (h - 4) / L)));
    var c = miniatura(grade, cel);
    if (!c) return;
    b.dataset.revelado = "1";
    mini.textContent = "";
    mini.appendChild(c);
    if (!semAnimacao && !REDUZIDO) mini.classList.add("is-revelado");
    if (nome === S.nome) atualizarSeletorMapa(nome);
  }
  /** Miniatura do mapa em `cel` px CSS por casa (LAB.pixel.mapThumb ou desenho próprio). */
  function miniatura(grade, cel) {
    var u = Math.max(1, Math.round(cel * DPR));
    var c = pix("mapThumb", grade, u);
    if (!c) {
      var P = paleta(), T = P.tiles;
      var C = grade[0].length, L = grade.length;
      c = canvasNovo(C * u, L * u);
      var ctx = c.getContext("2d");
      for (var r = 0; r < L; r++) for (var k = 0; k < C; k++) {
        var ch = grade[r][k];
        ctx.fillStyle = ch === "#" ? T.parede : ch === "S" ? T.inicio : ch === "G" ? T.saida : ch === "," ? T.lama :
          ch === "~" ? T.agua : ch === "+" ? T.bonus : ch === "*" ? T.fonte : /[a-dA-D]/.test(ch) ? corChave(ch) :
          /[\^>v<]/.test(ch) ? T.esteira : T.chao;
        ctx.fillRect(k * u, r * u, u, u);
      }
    }
    return tamanhoCss(c, c.width / DPR, c.height / DPR);
  }

  /** Teclado de radiogroup (setas movem foco e seleção; Home/End nas pontas). */
  function radiogroupTeclado(box, sel, aoEscolher) {
    box.addEventListener("keydown", function (e) {
      var itens = $$(sel, box).filter(function (b) { return !b.disabled && !b.hidden; });
      var i = itens.indexOf(document.activeElement);
      if (i < 0) return;
      var n = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % itens.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + itens.length) % itens.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = itens.length - 1;
      if (n < 0) return;
      e.preventDefault();
      itens[n].focus();
      aoEscolher(itens[n]);
    });
  }

  /* ================================================================ algoritmos (controle segmentado) */
  function montarAlgs() {
    var box = $("algs"), mapa = S.mapa;
    box.textContent = "";
    // [IA] Claude – a fonte consumível é uma variante do Bellman-Ford: vira interruptor (#tgFonte), não aba
    algsDoMapa(mapa).filter(function (k) { return k !== ALG_FONTE; }).forEach(function (k) {
      var r = mapa.algoritmos[k], inf = infoAlg(k);
      var b = el("button", "alg", inf.nome);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.alg = k;
      // o resultado de cada algoritmo fica na dica (title) e no rótulo acessível, não dentro do botão
      b.title = inf.completo + ": " + inf.sub + ". " + resumoAlg(r);
      b.setAttribute("aria-label", inf.completo + ", " + inf.sub + ". " + resumoAlg(r));
      b.addEventListener("click", function () { selecionarAlg(k, { anunciar: true }); });
      box.appendChild(b);
    });
    var tg = $("tgFonte"), v = mapa.algoritmos[ALG_FONTE];
    tg.hidden = !v;
    if (v) tg.setAttribute("aria-label", "Fonte consumível no Bellman-Ford. " + resumoAlg(v));
    marcarAlg();
  }
  function resumoAlg(r) {
    if (!r) return "–";
    if (r.status === "OK") return r.passos + " passos, custo " + fmt(r.custo);
    if (r.status === "CICLO_NEGATIVO") return "ciclo, " + fmt(r.custo) + " por volta";
    return STATUS_CURTO[r.status] || r.status;
  }
  function marcarAlg() {
    $$(".alg").forEach(function (b) {
      var sel = b.dataset.alg === S.alg || (b.dataset.alg === "BELLMAN_FORD" && S.alg === ALG_FONTE);
      b.setAttribute("aria-checked", sel ? "true" : "false");
      b.tabIndex = sel ? 0 : -1;
    });
    $("tgFonte").setAttribute("aria-checked", S.alg === ALG_FONTE ? "true" : "false");
    $$(".algo").forEach(function (a) {
      var k = a.getAttribute("data-alg");
      a.classList.toggle("is-atual", S.alg === k || (k === "BELLMAN_FORD" && S.alg === "BELLMAN_FORD_FONTE_CONSUMIVEL"));
    });
  }

  /* ================================================================ seleção de mapa e de algoritmo */
  function selecionarMapa(nome, o) {
    o = o || {};
    clearTimeout(agendaMapa);
    var meu = ++S.carga;
    pararTudo();
    marcarNivel(nome);
    var jaTem = !!S.cache[nome];
    if (!jaTem) carregando(true, "Carregando " + codigo(nome) + ", " + titulo(nome).toLowerCase());
    return obterMapa(nome).then(function (mapa) {
      if (meu !== S.carga) return;
      S.mapa = mapa; S.nome = nome;
      if (o.alg && mapa.algoritmos[o.alg]) S.alg = o.alg;
      if (!mapa.algoritmos[S.alg]) S.alg = mapa.algoritmos.DIJKSTRA ? "DIJKSTRA" : algsDoMapa(mapa)[0];
      S.camada = "todas";
      montarAlgs();
      montarCamadas();
      montarInventario();
      atualizarCatalogo();
      montarPilha();
      atualizarSecaoAlgoritmos();
      atualizarResultadoMapa();
      montarMetricas();
      atualizarCta();
      estadosCarregar(mapa, nome);
      carregando(true, "Montando " + codigo(nome));
      return seguro(chamar(playerR, "load", mapa, { intro: false }), 15000).then(function () {
        if (meu !== S.carga) return;
        aplicarOpcoesPlayer();
        selecionarAlg(S.alg, { anunciar: false });
        carregando(false);
        if (o.anunciar !== false) anunciar("Mapa " + codigo(nome) + ", " + titulo(nome) + ". " + (STATUS_TXT[S.status] || ""));
      });
    }).catch(function () {
      if (meu !== S.carga) return;
      carregando(false);
      dialogo({
        status: "SEM_SOLUCAO",
        titulo: "O mapa " + codigo(nome) + " não carregou",
        texto: "A consulta ao servidor falhou. Confira se o servidor está rodando e tente de novo.",
        acoes: [["Tentar de novo", function () { selecionarMapa(nome); }]]
      });
      mostrarServidor("erro");
    });
  }
  function aplicarOpcoesPlayer() {
    chamar(playerR, "setSpeed", S.vel);
    chamar(playerR, "setLayer", S.camada);
    chamar(playerR, "setTrapsVisible", S.armadilhas);
    chamar(playerR, "setTrailVisible", S.rastro);
    chamar(playerR, "setCamera", S.cam);
  }
  function selecionarAlg(alg, o) {
    o = o || {};
    if (!S.mapa || !S.mapa.algoritmos[alg]) return;
    pararTudo();
    S.voltas = 0;                 // [IA] Claude – voltas do ciclo negativo só zeram ao trocar de mapa/algoritmo
    S.alg = alg;
    var r = S.mapa.algoritmos[alg];
    S.perc = r.percurso || [];
    S.status = r.status;
    S.idx = 0;
    S.ultChave = calcularUltimasChaves(S.perc);
    S.pendentes = {};
    marcarAlg();
    chamar(playerR, "setPath", S.perc, { status: r.status });
    chamar(playerR, "setLayer", S.camada);
    chamar(playerR, "setTrapsVisible", S.armadilhas);
    chamar(playerR, "setTrailVisible", S.rastro);
    montarLinhaTempo();
    atualizarResultado(r);
    chip(null);
    dialogoStatus(r);
    desenharMinimapaBase();
    estadosChamar("setAlgoritmo", alg);
    render();
    if (o.anunciar) anunciar(infoAlg(alg).completo + ". " + (STATUS_TXT[r.status] || r.status) + (r.status === "OK" ? ", " + r.passos + " passos, custo " + fmt(r.custo) : ". " + msgFinal()));
  }

  /* ================================================================ reprodução */
  function ultimo() { return Math.max(0, S.perc.length - 1); }
  function eCiclo() { return S.status === "CICLO_NEGATIVO"; }
  /** Para a reprodução e invalida qualquer passo animado em andamento. */
  function pararTudo() {
    S.token++;
    S.tocando = false;
    S.pendentes = {};
    uiPlay();
  }
  function pausar() { S.tocando = false; uiPlay(); }
  function alternarPlay() { if (S.tocando) pausar(); else tocar(); }
  var LIMITE_PASSO = 6000; // ms: um passo nunca trava a reprodução, mesmo se o motor falhar

  function tocar() {
    if (!S.perc.length || ultimo() === 0 || !playerR) return;
    var meu = ++S.token;
    S.tocando = true;
    uiPlay();
    chamar(playerR, "setPaused", false);
    var inicio = Promise.resolve();
    if (S.idx >= ultimo() && !eCiclo()) {
      S.idx = 0;
      inicio = seguro(chamar(playerR, "goTo", 0, { animate: false }), 1000);
      render();
    }
    inicio.then(function laco() {
      if (meu !== S.token || !S.tocando) return fimDoLaco(meu);
      if (S.idx >= ultimo()) {
        if (!eCiclo()) return fimDoLaco(meu);
        // ciclo negativo: o último estado é igual ao primeiro, então volta ao 0 sem salto visível
        S.idx = 0;
        S.voltas++;
        render();
        return seguro(chamar(playerR, "goTo", 0, { animate: false }), 1000).then(laco);
      }
      var antes = S.idx, alvo = antes + 1;
      S.idx = alvo;
      prepararPasso(antes, alvo);
      render();
      var msgs = eventosDoPasso(antes, alvo);
      if (msgs) anunciar(msgs);
      var t0 = performance.now();
      return seguro(chamar(playerR, "goTo", alvo, { animate: true }), LIMITE_PASSO).then(function () {
        if (meu !== S.token) return;
        concluirPasso();
        var falta = 1000 / S.vel - (performance.now() - t0);
        return falta > 4 ? esperar(falta).then(laco) : laco();
      });
    });
  }
  function fimDoLaco(meu) {
    if (meu !== S.token) return;
    S.tocando = false;
    uiPlay();
    if (!S.playerVisivel) chamar(playerR, "setPaused", true);
  }
  /** Ir direto para um passo (linha do tempo, minimapa, início). */
  function irPara(i, o) {
    o = o || {};
    if (!S.perc.length) return;
    pararTudo();
    S.idx = limitar(i | 0, 0, ultimo());
    chamar(playerR, "goTo", S.idx, { animate: false });
    render();
    if (o.anunciar) anunciar("Passo " + S.idx + " de " + ultimo() + (S.idx === ultimo() ? ". " + msgFinal() : ""));
  }
  /** Um passo manual (botões e setas). Para frente anima; para trás salta. */
  function passo(d) {
    if (!S.perc.length) return;
    pararTudo();
    var antes = S.idx, alvo = antes + d;
    if (d > 0 && antes >= ultimo()) {
      if (!eCiclo()) return;
      // ciclo negativo: o último estado é o primeiro, então recomeça do 0 e anda para o 1
      chamar(playerR, "goTo", 0, { animate: false });
      S.voltas++;                 // passo manual também completa uma volta (igual ao play)
      antes = 0; alvo = 1;
    }
    alvo = limitar(alvo, 0, ultimo());
    if (alvo === S.idx) return;
    S.idx = alvo;
    var meu = S.token;
    if (alvo === antes + 1) {
      prepararPasso(antes, alvo);
      render();
      seguro(chamar(playerR, "goTo", alvo, { animate: true }), LIMITE_PASSO).then(function () { if (meu === S.token) concluirPasso(); });
    } else {
      chamar(playerR, "goTo", alvo, { animate: false });
      render();
    }
    var evs = alvo === antes + 1 ? eventosDoPasso(antes, alvo) : "";
    if (alvo === ultimo() && S.status === "OK" && alvo !== antes + 1) evs = (evs ? evs + ". " : "") + msgFinal();
    anunciar("Passo " + alvo + " de " + ultimo() + (evs ? ". " + evs : ""));
  }
  /** Chaves novas ficam "pendentes" até o aluno de fato pegá-las (evento 'key' do motor). */
  function prepararPasso(antes, alvo) {
    S.pendentes = {};
    var a = S.perc[antes].chaves || "", b = S.perc[alvo].chaves || "";
    for (var i = 0; i < b.length; i++) if (a.indexOf(b[i]) < 0) S.pendentes[b[i]] = true;
  }
  function concluirPasso() {
    Object.keys(S.pendentes).forEach(encherSlot);
  }
  /** Mensagens do passo para o leitor de tela (chave, porta, saída). */
  function eventosDoPasso(antes, alvo) {
    var a = S.perc[antes], b = S.perc[alvo], msgs = [];
    var novas = (b.chaves || "").split("").filter(function (l) { return (a.chaves || "").indexOf(l) < 0; });
    novas.forEach(function (l) { msgs.push("Chave " + l + " coletada"); });
    if (/[A-D]/.test(b.casa) && primeiraVisita(alvo)) msgs.push("Porta " + b.casa + " aberta");
    return msgs.join(". ");
  }
  /** [IA] Claude – frase do final: baú aberto (OK) ou o aluno sem caminho até o baú. */
  function msgFinal() {
    if (!S.mapa) return "";
    var r = S.mapa.algoritmos[S.alg] || {};
    if (S.status === "OK") return "Baú aberto! Saída alcançada em " + fmt(r.passos) + " passos, custo " + fmt(r.custo);
    if (S.status === "CICLO_NEGATIVO") return STATUS_TXT.CICLO_NEGATIVO;
    return "O algoritmo não leva o aluno até o baú";
  }
  function primeiraVisita(i) {
    var p = S.perc[i];
    for (var j = 0; j < i; j++) if (S.perc[j].linha === p.linha && S.perc[j].coluna === p.coluna) return false;
    return true;
  }
  function uiPlay() {
    var b = $("btnPlay");
    b.classList.toggle("is-tocando", S.tocando);
    b.setAttribute("aria-label", S.tocando ? "Pausar" : "Animar o percurso");
    b.title = S.tocando ? "Pausar (espaço)" : "Animar o percurso (espaço)";
  }

  /* ================================================================ render por passo */
  function passoAtual() { return S.perc.length ? S.perc[Math.min(S.idx, S.perc.length - 1)] : null; }
  /** Custo acumulado exibido: no ciclo negativo soma o custo de cada volta já dada. */
  function custoMostrado(p) {
    if (!p) return null;
    var volta = eCiclo() && S.mapa ? (S.mapa.algoritmos[S.alg].custo || 0) : 0;
    return p.custo_acumulado + S.voltas * volta;
  }
  function render() {
    var p = passoAtual(), n = ultimo(), temPerc = S.perc.length > 0;
    // HUD: passo e custo acumulado (cada número aparece uma vez na tela)
    $("hudPasso").textContent = temPerc ? S.idx : "–";
    $("hudTotal").textContent = temPerc ? "de " + n + (eCiclo() && S.voltas ? ", volta " + (S.voltas + 1) : "") : "";
    $("hudCusto").textContent = p ? fmt(custoMostrado(p)) : "–";
    $("hudStats").hidden = !temPerc;
    atualizarInventario(p);
    // linha do tempo
    var tr = $("tempoRange");
    tr.value = S.idx;
    tr.style.setProperty("--pct", n ? (S.idx / n) * 100 + "%" : "0%");
    tr.setAttribute("aria-valuetext", temPerc ? "Passo " + S.idx + " de " + n : "Sem percurso");
    $("btnVoltar").disabled = !temPerc || S.idx === 0;
    $("btnInicio").disabled = !temPerc || S.idx === 0;
    $("btnAvancar").disabled = !temPerc || (S.idx >= n && !eCiclo());
    $("btnPlay").disabled = !temPerc || n === 0;
    $("btnFim").disabled = !temPerc || S.idx >= n;
    // linha do estado: rótulo, chaves na mão e bônus consumidos
    var rot = $("dRotulo");
    // sem percurso (recusa, sem caminho): mostra o estado inicial, que é onde o aluno fica
    var ini = !p && S.mapa ? posInicio(S.mapa) : null;
    rotuloEstado(rot, p ? p.estado : ini ? "(" + ini[0] + "," + ini[1] + ")|-|{}" : "");
    var pos = p ? "linha " + p.linha + ", coluna " + p.coluna + ", " + nomeCasa(p.casa) : "";
    rot.title = pos;
    rot.setAttribute("aria-label", p ? "Estado " + p.estado + ": " + pos : "Sem estado");
    // [IA] Claude – rodada 4: as chaves e os bônus já estão no rótulo (e as chaves no inventário do HUD); o resultado
    // só aparece no fim do percurso (ou quando não há percurso), à direita do rótulo, sem repetir passos e custo do HUD
    $("dStatus").hidden = temPerc && S.status === "OK" && S.idx < n;
    renderTupla(p);
    desenharMinimapa();
    if (temPerc) estadosChamar("setPasso", S.perc, S.idx);
  }

  /** Chip do HUD só para os finais (baú aberto ou sem caminho); some sozinho. */
  var chipTimer = 0;
  function chip(status, txt) {
    var c = $("hudStatus");
    clearTimeout(chipTimer);
    if (!status) { c.hidden = true; return; }
    c.setAttribute("data-status", status);
    $("hudStatusTxt").textContent = txt;
    c.hidden = false;
    chipTimer = setTimeout(function () { c.hidden = true; }, REDUZIDO ? 4000 : 2800);
  }

  /** Rótulo do estado com as barras separadoras destacadas (na Pixelify Sans "|" lembra um "l"). */
  function rotuloEstado(alvo, txt) {
    if (alvo.dataset.v === txt) return;
    alvo.dataset.v = txt;
    alvo.textContent = "";
    if (!txt) { alvo.textContent = "–"; return; }
    txt.split("|").forEach(function (parte, i) {
      if (i) alvo.appendChild(el("span", "rotulo-estado__sep", "|"));
      alvo.appendChild(document.createTextNode(parte));
    });
  }

  /* ---------------------------------------------------------------- inventário do HUD */
  var cacheIcones = {};
  /** Cópia do ícone de chave de LAB.pixel em `escala` px CSS por pixel de arte (com cache). */
  function iconeChave(l, escala, vazio) {
    var k = l + escala + (vazio ? "v" : "");
    if (!(k in cacheIcones)) cacheIcones[k] = pix("keyIcon", l, escala * DPR, vazio ? { empty: true } : undefined);
    var base = cacheIcones[k];
    if (!base) return null;
    var c = canvasNovo(base.width, base.height);
    c.getContext("2d").drawImage(base, 0, 0);
    c.className = "ico-chave";
    return tamanhoCss(c, base.width / DPR, base.height / DPR);
  }
  function montarInventario() {
    var box = $("hudInv"), letras = chavesDoMapa(S.mapa);
    box.textContent = "";
    box.hidden = !letras.length;
    letras.forEach(function (l) {
      var s = el("span", "slot");
      s.dataset.letra = l;
      s.style.setProperty("--cor-chave", corChave(l));
      s.setAttribute("aria-label", "Chave " + l);
      s.setAttribute("role", "img");
      var ic = iconeChave(l, 3), vazio = iconeChave(l, 3, true);
      if (vazio) { vazio.classList.add("slot__vazio"); s.appendChild(vazio); }
      if (ic) { ic.classList.add("slot__cheio"); s.appendChild(ic); }
      else { var q = el("span"); q.style.cssText = "width:18px;height:10px;background:" + corChave(l); s.appendChild(q); }
      box.appendChild(s);
    });
  }
  function atualizarInventario(p) {
    var tem = (p && p.chaves) || "";
    $$(".slot").forEach(function (s) {
      var l = s.dataset.letra;
      var cheio = tem.indexOf(l) >= 0 && !S.pendentes[l];
      s.classList.toggle("is-cheio", cheio);
      s.setAttribute("aria-label", "Chave " + l + (cheio ? ", coletada" : ", ainda não"));
    });
  }
  /** Enche o slot de uma chave pendente com um "pop" (evento 'key' do motor ou fim do passo). */
  function encherSlot(l) {
    if (!S.pendentes[l]) return;
    delete S.pendentes[l];
    var s = $$(".slot").filter(function (x) { return x.dataset.letra === l; })[0];
    if (!s) return;
    s.classList.add("is-cheio");
    s.setAttribute("aria-label", "Chave " + l + ", coletada");
    if (!REDUZIDO) { s.classList.remove("is-pop"); void s.offsetWidth; s.classList.add("is-pop"); }
  }

  /* ---------------------------------------------------------------- minimapa */
  var miniBase = null, miniCel = 0;
  function desenharMinimapaBase() {
    miniBase = null;
    $("hudMini").hidden = !S.minimapa;
    if (!S.mapa || !S.minimapa) return;
    var g = S.mapa.grade, C = g[0].length, L = g.length;
    var largo = window.innerWidth < 900 ? 108 : 160, alto = window.innerWidth < 900 ? 84 : 100;
    miniCel = Math.max(1, Math.floor(Math.min(largo / C, alto / L)));
    miniBase = miniatura(g, miniCel);
    var cv = $("minimapa");
    cv.width = C * miniCel * DPR; cv.height = L * miniCel * DPR;
    cv.style.width = C * miniCel + "px"; cv.style.height = L * miniCel + "px";
  }
  function desenharMinimapa() {
    var cv = $("minimapa");
    if (!miniBase || !S.mapa) return;
    var ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(miniBase, 0, 0, cv.width, cv.height);
    var u = miniCel * DPR;
    if (S.rastro && S.perc.length) {
      var q = u >= 6 ? Math.round(u * 0.3) : 0;
      for (var i = 0; i <= S.idx && i < S.perc.length; i++) {
        var p = S.perc[i];
        ctx.fillStyle = corCaminho(p.chaves, S.ultChave[i]);
        ctx.fillRect(p.coluna * u + q, p.linha * u + q, u - 2 * q, u - 2 * q);
      }
    }
    var at = passoAtual(), pos = at ? [at.linha, at.coluna] : posInicio(S.mapa);
    var m = Math.max(2 * DPR, Math.round(u * 0.6)), cx = pos[1] * u + u / 2, cy = pos[0] * u + u / 2;
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.round(cx - m / 2 - DPR), Math.round(cy - m / 2 - DPR), m + 2 * DPR, m + 2 * DPR);
    ctx.fillStyle = paleta().cesar;
    ctx.fillRect(Math.round(cx - m / 2), Math.round(cy - m / 2), m, m);
  }
  function cliqueMinimapa(e) {
    if (!S.perc.length || !miniCel) return;
    var rc = e.currentTarget.getBoundingClientRect();
    var c = Math.floor((e.clientX - rc.left) / miniCel), r = Math.floor((e.clientY - rc.top) / miniCel);
    var melhor = -1, dist = Infinity;
    S.perc.forEach(function (p, i) {
      if (p.linha === r && p.coluna === c && Math.abs(i - S.idx) < dist) { dist = Math.abs(i - S.idx); melhor = i; }
    });
    if (melhor >= 0) irPara(melhor, { anunciar: true });
  }

  /* ---------------------------------------------------------------- linha do tempo */
  function montarLinhaTempo() {
    var tr = $("tempoRange"), n = ultimo(), marcas = $("tempoMarcas");
    tr.max = n;
    tr.value = 0;
    tr.disabled = !S.perc.length || n === 0;
    marcas.textContent = "";
    if (!S.perc.length || n === 0) { tr.style.setProperty("--trilho", "var(--noite-3)"); return; }
    // trilho colorido pela camada de cada trecho (paradas duras)
    var partes = [], corAnt = null, ini = 0;
    for (var i = 1; i <= n; i++) {
      var cor = corCaminho(S.perc[i].chaves, S.ultChave[i]);
      if (cor !== corAnt) {
        if (corAnt) partes.push(corAnt + " " + (ini / n * 100).toFixed(3) + "% " + ((i - 1) / n * 100).toFixed(3) + "%");
        corAnt = cor; ini = i - 1;
      }
    }
    partes.push(corAnt + " " + (ini / n * 100).toFixed(3) + "% 100%");
    tr.style.setProperty("--trilho", "linear-gradient(90deg, " + partes.join(", ") + ")");
    // marcadores: chaves, portas, bônus e saída
    var vistas = {};
    for (var j = 0; j <= n; j++) {
      var p = S.perc[j], ant = j ? S.perc[j - 1] : null, k = p.linha + "," + p.coluna;
      var novas = ant ? (p.chaves || "").split("").filter(function (l) { return (ant.chaves || "").indexOf(l) < 0; }) : [];
      novas.forEach(function (l) { marca(j, "chave", corChave(l), "Chave " + l + " no passo " + j); });
      if (/[A-D]/.test(p.casa) && !vistas[k]) marca(j, "porta", corChave(p.casa), "Porta " + p.casa + " no passo " + j);
      if (ant && (p.bonus || []).length > (ant.bonus || []).length) marca(j, "bonus", p.casa === "*" ? paleta().tiles.fonte : paleta().ok, "Bônus no passo " + j);
      vistas[k] = 1;
    }
    if (S.status === "OK") marca(n, "saida", null, "Saída no passo " + n);
    function marca(i, tipo, cor, titulo) {
      var m = el("span", "marca marca--" + tipo);
      m.style.left = (i / n * 100) + "%";
      if (cor) m.style.setProperty("--cor", cor);
      m.title = titulo;
      marcas.appendChild(m);
    }
  }

  /* ---------------------------------------------------------------- inspetor: resultado e camada */
  function atualizarResultadoMapa() {
    var m = S.mapa;
    $("cEstados").textContent = fmt(m.estados);
    $("cArcos").textContent = fmt(m.arcos);
    $("cTeto").textContent = fmt(m.teto);
  }
  /** Resultado do Python numa linha só: status e, quando há, passos e custo (sem repetir o que o HUD mostra). */
  function atualizarResultado(r) {
    var d = $("dStatus");
    d.textContent = "";
    d.setAttribute("data-status", r.status);
    // forma curta: a frase longa já está na faixa da janela 3D (e no title)
    d.appendChild(el("span", "resultado__status", r.status === "OK" ? STATUS_TXT.OK : (STATUS_CURTO[r.status] || r.status)));
    var extras = [];
    if (r.status === "CICLO_NEGATIVO") {
      // o Python manda passos = null no ciclo; o tamanho do ciclo é o do percurso devolvido (estados − 1)
      var nCiclo = r.passos != null ? r.passos : (r.percurso && r.percurso.length > 1 ? r.percurso.length - 1 : null);
      extras.push((nCiclo != null ? fmt(nCiclo) + " arcos, " : "") + fmt(r.custo) + " por volta");
    }
    extras.forEach(function (t) { d.appendChild(el("span", "resultado__dado", t)); });
    d.title = (STATUS_TXT[r.status] || r.status) + ". Resultado do Python (src/solve.py)" + (r.mensagem ? ": " + r.mensagem : "");
  }
  function montarCamadas() {
    var sel = $("selCamada");
    sel.textContent = "";
    ["todas"].concat(Object.keys(S.mapa.camadas || {})).forEach(function (k) {
      var o = el("option", null, rotuloCamada(k));
      o.value = k;
      sel.appendChild(o);
    });
    sel.value = S.camada;
  }
  function definirCamada(k) {
    S.camada = k;
    $("selCamada").value = k;
    $("btnVis").classList.toggle("is-marcado", k !== "todas");
    chamar(playerR, "setLayer", k);
    $$(".camada").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.camada === k ? "true" : "false"); });
  }

  /* ---------------------------------------------------------------- diálogo do HUD */
  function dialogo(o) {
    var d = $("hudDialogo");
    if (!o) { d.hidden = true; enquadrarPlayer(); return; }
    d.hidden = false;
    d.setAttribute("data-status", o.status || "");
    d.classList.toggle("is-faixa", !!o.faixa);
    $("dialogoTitulo").textContent = o.titulo;
    $("dialogoTexto").textContent = o.texto;
    var ac = $("dialogoAcoes");
    ac.textContent = "";
    (o.acoes || []).forEach(function (a) {
      var b = el("button", "btn btn--mini px" + (a[2] ? " btn--cesar" : ""), a[0]);
      b.type = "button";
      b.addEventListener("click", a[1]);
      ac.appendChild(b);
    });
    enquadrarPlayer();
  }
  /** Os avisos de status ficam numa faixa (embaixo no desktop, no alto no celular); no celular o aluno desce
      no quadro para o "?" de quem não achou caminho não ficar coberto pelo aviso. */
  function enquadrarPlayer() {
    if (!playerR || typeof playerR.setFraming !== "function") return;
    var d = $("hudDialogo"), comFaixa = !d.hidden && d.classList.contains("is-faixa");
    // [IA] Claude – integração: no desktop a faixa fica embaixo, então o aluno sobe no quadro (o aluno triste não fica coberto)
    chamar(playerR, "setFraming", !comFaixa ? { x: 0, y: 0 } : window.innerWidth <= 900 ? { x: 0, y: -0.55 } : { x: 0, y: 0.42 });
  }
  function dialogoStatus(r) {
    var algs = S.mapa.algoritmos;
    if (r.status === "RECUSA") {
      var acoes = [];
      if (algs.BFS) acoes.push(["Usar BFS", function () { selecionarAlg("BFS", { anunciar: true }); }]);
      if (algs.BELLMAN_FORD) acoes.push(["Usar Bellman-Ford", function () { selecionarAlg("BELLMAN_FORD", { anunciar: true }); }, true]);
      dialogo({ status: r.status, faixa: true, titulo: STATUS_TXT.RECUSA, texto: "Este mapa tem arcos de custo negativo (bônus ou fonte), e o Dijkstra não trabalha com eles. Troque para BFS ou Bellman-Ford.", acoes: acoes });
    } else if (r.status === "SEM_SOLUCAO") {
      dialogo({ status: r.status, faixa: true, titulo: STATUS_TXT.SEM_SOLUCAO, texto: "Nenhuma sequência de chaves e portas leva até a saída deste mapa." + ((S.mapa.armadilhas || []).length ? " As casas vermelhas são armadilhas: estados de onde a saída não é mais alcançável." : "") });
    } else if (r.status === "CICLO_NEGATIVO") {
      var ac2 = algs.BELLMAN_FORD_FONTE_CONSUMIVEL ? [["Usar a fonte consumível", function () { selecionarAlg("BELLMAN_FORD_FONTE_CONSUMIVEL", { anunciar: true }); }]] : [];
      dialogo({ status: r.status, faixa: true, titulo: STATUS_TXT.CICLO_NEGATIVO, texto: "O aluno repete um ciclo de " + Math.max(1, S.perc.length - 1) + " passos e cada volta custa " + fmt(r.custo) + ".", acoes: ac2 });
    } else dialogo(null);
  }
  function carregando(on, txt) {
    $("hudCarregando").hidden = !on;
    if (txt) $("hudCarregandoTxt").textContent = txt;
    if (on) dialogo(null);
  }

  /* ---------------------------------------------------------------- legenda compacta (não usada no player desde a rodada 4: o manual "Casas e custos" cobre) */
  function montarLegenda() {
    if (!$("legenda")) return;
    var ul = $("legenda"), s = S.mapa.grade.join(""), itens = [];
    var tem = function (re) { var m = s.match(re); return m ? m[0] : null; };
    [[/\./, "chão", "1"], [/,/, "lama", "3"], [/~/, "água", "5"], [/\+/, "bônus", "−4"], [/\*/, "fonte", "−2"],
      [/[\^>v<]/, "esteira", ""], [/[a-d]/, "chave", ""], [/[A-D]/, "porta", ""], [/S/, "início", ""], [/G/, "baú (saída)", ""]]
      .forEach(function (x) { var ch = tem(x[0]); if (ch) itens.push([ch, x[1], x[2]]); });
    ul.textContent = "";
    itens.forEach(function (it) {
      var li = el("li");
      var tex = pix("tileTexture", it[0], 0);
      if (tex) { var c = canvasNovo(tex.width, tex.height); c.getContext("2d").drawImage(tex, 0, 0); li.appendChild(tamanhoCss(c, 16, 16)); }
      li.appendChild(document.createTextNode(it[1]));
      if (it[2]) li.appendChild(el("b", null, it[2]));
      ul.appendChild(li);
    });
    if ((S.mapa.armadilhas || []).length) {
      var li = el("li");
      li.appendChild(el("span", "legenda__trap"));
      li.appendChild(document.createTextNode("armadilha"));
      ul.appendChild(li);
    }
  }

  /* ================================================================ manual: como funciona */
  function montarCatalogo() {
    var ul = $("catalogo");
    ul.textContent = "";
    CATALOGO.forEach(function (c) {
      var li = el("li", "casa");
      li.dataset.simbolo = c[0];
      var tex = pix("legendIcon", c[0]) || pix("tileTexture", c[0], 0);
      var cv;
      if (tex) { cv = canvasNovo(tex.width, tex.height); cv.getContext("2d").drawImage(tex, 0, 0); }
      else { cv = canvasNovo(16, 16); var ctx = cv.getContext("2d"); ctx.fillStyle = PALETA_RESERVA.tiles.chao; ctx.fillRect(0, 0, 16, 16); }
      li.appendChild(tamanhoCss(cv, 64, 64));
      var txt = el("div");
      var nome = el("p", "casa__nome", c[1]);
      if (c[2]) nome.appendChild(el("span", "casa__custo", c[2]));
      txt.appendChild(nome);
      txt.appendChild(el("p", "casa__texto", c[3]));
      li.appendChild(txt);
      ul.appendChild(li);
    });
  }
  function atualizarCatalogo() {
    var s = S.mapa ? S.mapa.grade.join("") : "";
    $$(".casa").forEach(function (li) {
      var sim = li.dataset.simbolo, re = sim === ">" ? /[\^>v<]/ : sim === "a" ? /[a-d]/ : sim === "A" ? /[A-D]/ : null;
      li.classList.toggle("is-no-mapa", re ? re.test(s) : s.indexOf(sim) >= 0);
    });
  }

  /** Tupla de estado ao vivo, com linhas de chamada desenhadas em SVG. */
  var tuplaAnterior = "";
  function renderTupla(p) {
    var pos, chaves, bonus;
    if (p) { pos = [p.linha, p.coluna]; chaves = p.chaves || ""; bonus = p.bonus || []; }
    else if (S.mapa) { pos = posInicio(S.mapa); chaves = ""; bonus = []; }
    else return;
    $("tPos").textContent = "(" + pos[0] + "," + pos[1] + ")";
    $("tChaves").textContent = chaves || "-";
    $("tBonus").textContent = "{" + bonus.join(",") + "}";
    var casa = p ? p.casa : "S";
    $("nPos").textContent = "linha " + pos[0] + ", coluna " + pos[1] + ", " + nomeCasa(casa);
    $("nChaves").textContent = chaves ? listaPt(chaves.split("")) : "nenhuma";
    $("nBonus").textContent = bonus.length ? "bônus número " + listaPt(bonus.map(String)) : "nenhum";
    var algNome = infoAlg(S.alg).completo;
    $("tuplaNota").textContent = S.perc.length
      ? codigo(S.nome) + ", " + algNome + ", passo " + S.idx
      : codigo(S.nome) + ", " + algNome + ": sem percurso, a tupla fica no início";
    var chave = $("tPos").textContent + chaves + bonus.join();
    if (chave !== tuplaAnterior) { tuplaAnterior = chave; agendarGuias(); }
  }
  var guiasRaf = 0, tuplaVisivel = false, guiasSujas = true;
  function agendarGuias() {
    guiasSujas = true;
    if (!tuplaVisivel) return;
    cancelAnimationFrame(guiasRaf);
    guiasRaf = requestAnimationFrame(desenharGuias);
  }
  function desenharGuias() {
    var svg = $("tuplaGuias"), box = $("tupla");
    guiasSujas = false;
    if (!svg || !box.offsetParent || getComputedStyle(svg).display === "none") return;
    var b = box.getBoundingClientRect(), ns = "http://www.w3.org/2000/svg";
    svg.setAttribute("viewBox", "0 0 " + b.width + " " + b.height);
    svg.textContent = "";
    $$("#tuplaNotas li").forEach(function (li, i) {
      var tok = $(li.getAttribute("data-alvo"));
      if (!tok) return;
      var t = tok.getBoundingClientRect(), l = li.getBoundingClientRect();
      var x0 = Math.round(t.left + t.width / 2 - b.left) + 0.5, y0 = Math.round(t.bottom - b.top) + 6;
      var x1 = Math.round(l.left - b.left) + 1, y1 = Math.round(l.top - b.top);
      var ym = Math.round(y0 + 12 + i * 9) + 0.5;
      var path = document.createElementNS(ns, "path");
      path.setAttribute("d", "M" + x0 + " " + y0 + " V" + ym + " H" + x1 + " V" + y1);
      svg.appendChild(path);
      var ponto = document.createElementNS(ns, "circle");
      ponto.setAttribute("cx", x0); ponto.setAttribute("cy", y0); ponto.setAttribute("r", 2.5);
      svg.appendChild(ponto);
    });
  }

  /** Pilha de camadas: uma miniatura por conjunto de chaves, empilhadas como folhas. */
  function montarPilha() {
    var box = $("pilha"), m = S.mapa;
    box.textContent = "";
    var ks = Object.keys(m.camadas || {});
    var C = m.grade[0].length, L = m.grade.length;
    // a miniatura cabe ao lado dos rótulos (≈ 130 px) na largura disponível
    var livre = Math.min(210, Math.max(90, (box.clientWidth || 320) - 140));
    var cel = limitar(Math.floor(livre / C), 1, 11);
    box.dataset.largura = String(box.clientWidth);
    var P = paleta();
    ks.slice().reverse().forEach(function (k, i) {
      var cv = canvasNovo(C * cel * DPR, L * cel * DPR), ctx = cv.getContext("2d"), u = cel * DPR;
      var dentro = {};
      m.camadas[k].forEach(function (p) { dentro[p[0] + "," + p[1]] = 1; });
      var cor = k === "-" ? "#B9B4DE" : corChave(k.slice(-1));
      for (var r = 0; r < L; r++) for (var c = 0; c < C; c++) {
        var ch = m.grade[r][c];
        ctx.fillStyle = ch === "#" ? P.grafite : dentro[r + "," + c] ? cor : "#E7EBF4";
        ctx.fillRect(c * u, r * u, u, u);
      }
      tamanhoCss(cv, C * cel, L * cel);
      var b = el("button", "camada");
      b.type = "button";
      b.dataset.camada = k;
      b.setAttribute("aria-pressed", S.camada === k ? "true" : "false");
      b.title = "Ver a camada " + rotuloCamada(k) + " no player";
      if (i) b.style.setProperty("--sobe", -Math.round(L * cel * 0.55) + "px");
      b.style.zIndex = String(ks.length - i);
      var placa = el("span", "camada__placa");
      placa.appendChild(cv);
      var rot = el("span", "camada__rotulo");
      rot.appendChild(el("b", null, k === "-" ? "sem chave" : k));
      rot.appendChild(document.createTextNode(m.camadas[k].length + " casas"));
      b.appendChild(placa);
      b.appendChild(rot);
      b.setAttribute("aria-label", "Camada " + rotuloCamada(k) + ", " + m.camadas[k].length + " casas. Mostrar no player.");
      b.addEventListener("click", function () { definirCamada(S.camada === k ? "todas" : k); });
      box.appendChild(b);
    });
  }

  /* ================================================================ manual: algoritmos */
  function atualizarSecaoAlgoritmos() {
    var m = S.mapa;
    $("algIntro").textContent = "Os três rodam sobre o mesmo grafo de estados. O que muda é o que cada um minimiza e o que ele aceita. Resultados do mapa " + codigo(S.nome) + ", " + titulo(S.nome) + ":";
    $$(".algo").forEach(function (art) {
      preencherRes(art.querySelector(".algo__res"), m.algoritmos[art.getAttribute("data-alg")]);
    });
    var v = m.algoritmos.BELLMAN_FORD_FONTE_CONSUMIVEL;
    $("algoVariante").hidden = !v;
    if (v) preencherRes($("algoVariante").querySelector(".algo__res"), v);
    $$("[data-ver]").forEach(function (b) { b.disabled = !m.algoritmos[b.getAttribute("data-ver")]; });
    marcarAlg();
  }
  function preencherRes(dl, r) {
    if (!dl) return;
    var st = dl.querySelector('[data-campo="status"]');
    st.textContent = r ? (STATUS_CURTO[r.status] || r.status) : "–";
    st.setAttribute("data-status", r ? r.status : "");
    dl.querySelector('[data-campo="passos"]').textContent = r && r.passos != null ? fmt(r.passos) : "–";
    dl.querySelector('[data-campo="custo"]').textContent = r ? fmt(r.custo) : "–";
  }
  function irParaPlayer() {
    var alvo = $("jogar");
    alvo.scrollIntoView({ behavior: REDUZIDO ? "auto" : "smooth", block: "start" });
    $("btnPlay").focus({ preventScroll: true });
  }

  /* ================================================================ CTA */
  function atualizarCta() {
    var faixa = $("desafio");
    faixa.hidden = S.nomes.indexOf(MAPA_GRANDE) < 0;
    var m = S.cache[MAPA_GRANDE];
    if (m && m.grade) {
      var r = m.algoritmos[melhorAlg(m)];
      $("ctaLinha").textContent = m.grade[0].length + " colunas, " + m.grade.length + " linhas" +
        (r && r.passos ? " e um caminho de " + r.passos + " passos." : ".");
    }
  }

  /* ================================================================ hero */
  function iniciarHero(mapa) {
    var palco = $("heroPalco");
    var alg = melhorAlg(mapa), r = mapa.algoritmos[alg];
    palco.setAttribute("aria-label", "Diorama 3D do mapa " + codigo(mapa.nome) + ": o aluno da CESAR School percorre a masmorra até o baú pelo caminho do " + infoAlg(alg).nome + ".");
    var criado = criarRenderer(palco, { interactive: false, attract: true, pixelScale: "auto", reducedMotion: REDUZIDO });
    heroR = criado.r; heroTipo = criado.tipo;
    palco.classList.toggle("is-2d", heroTipo === "2d");
    chamar(heroR, "on", "contextlost", function () { trocarPara2D("hero"); });
    var loader = palco.querySelector("[data-carregando]");
    seguro(chamar(heroR, "load", mapa, { intro: !REDUZIDO }), 20000).then(function () {
      chamar(heroR, "setPath", (r && r.percurso) || [], { status: r && r.status });
    });
    // o "build" do diorama é o momento orquestrado da página: tira o loader assim que a cena existe
    if (loader) loader.remove();
    observarVisibilidade(palco, function (vis) { chamar(heroR, "setPaused", !vis); });
    enquadrarHero();
  }
  /** [IA] Claude – o diorama agora fica numa janela emoldurada ao lado do título: centralizado na moldura. */
  function enquadrarHero() {
    if (!heroR || typeof heroR.setFraming !== "function") return;
    chamar(heroR, "setFraming", { x: 0, y: 0 });
  }

  /** Se o contexto WebGL se perder, troca o viewport para o desenho 2D sem recarregar a página. */
  function trocarPara2D(qual) {
    if (qual === "hero") {
      var palco = $("heroPalco"), mapa = S.cache[MAPA_DESTAQUE] || S.mapa;
      chamar(heroR, "dispose");
      $$("canvas", palco).forEach(function (c) { c.remove(); });
      palco.classList.add("is-2d");
      heroR = new Mapa2D(palco, { attract: true, reducedMotion: REDUZIDO }); heroTipo = "2d";
      if (mapa) { var a = melhorAlg(mapa); heroR.load(mapa); heroR.setPath(mapa.algoritmos[a].percurso || [], { status: mapa.algoritmos[a].status }); }
      return;
    }
    var p = $("playerPalco");
    chamar(playerR, "dispose");
    $$("canvas", p).forEach(function (c) { c.remove(); });
    playerR = new Mapa2D(p, { interactive: true }); playerTipo = "2d";
    $("tela3d").classList.add("is-2d");
    $("visCam").hidden = true;
    ligarEventosPlayer();
    if (S.mapa) {
      playerR.load(S.mapa);
      aplicarOpcoesPlayer();
      chamar(playerR, "setPath", S.perc, { status: S.status });
      chamar(playerR, "goTo", S.idx, { animate: false });
    }
  }

  /* ================================================================ player: criação e eventos */
  function iniciarPlayer() {
    var criado = criarRenderer($("playerPalco"), { interactive: true, attract: false, pixelScale: "auto", reducedMotion: REDUZIDO });
    playerR = criado.r; playerTipo = criado.tipo;
    $("tela3d").classList.toggle("is-2d", playerTipo === "2d");
    $("visCam").hidden = playerTipo === "2d";   // o desenho 2D não tem câmera
    ligarEventosPlayer();
    observarVisibilidade($("tela3d"), function (vis) {
      S.playerVisivel = vis;
      chamar(playerR, "setPaused", !vis && !S.tocando);
    }, 0.01);
  }
  function ligarEventosPlayer() {
    chamar(playerR, "on", "key", function (d) { if (d && d.letter) encherSlot(d.letter); });
    // arrastar com o botão direito (ou pinça) no "Seguir" solta a câmera: o HUD mostra o modo real
    chamar(playerR, "on", "camera", function (d) {
      if (!d || !d.mode) return;
      $$("#hudCam button").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-cam") === d.mode ? "true" : "false"); });
    });
    chamar(playerR, "on", "contextlost", function () { trocarPara2D("player"); });
    // [IA] Claude – finais: baú aberto (joinha) ou aluno triste de mãos para cima
    chamar(playerR, "on", "goal", function () {
      if (!S.mapa || S.status !== "OK") return;
      render();
      chip("OK", "Baú aberto!");
      anunciar(msgFinal());
    });
    chamar(playerR, "on", "fail", function () {
      if (!S.mapa) return;
      // o aviso do status já está na faixa do HUD: o chip só aparece quando não há faixa
      if ($("hudDialogo").hidden) chip(S.status || "SEM_SOLUCAO", "Não chega ao baú");
      anunciar("O algoritmo não leva o aluno até o baú. " + (STATUS_TXT[S.status] || ""));
    });
  }
  function observarVisibilidade(alvo, fn, limiar) {
    if (!window.IntersectionObserver) { fn(true); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { fn(e.isIntersecting); }); }, { threshold: limiar || 0 }).observe(alvo);
  }

  /* ================================================================ controles fixos */
  function ligarControles() {
    $("btnPlay").addEventListener("click", alternarPlay);
    $("btnAvancar").addEventListener("click", function () { passo(1); });
    $("btnVoltar").addEventListener("click", function () { passo(-1); });
    $("btnInicio").addEventListener("click", function () { S.voltas = 0; irPara(0, { anunciar: true }); });
    $("btnFim").addEventListener("click", function () {
      irPara(ultimo(), { anunciar: true });
      // [IA] Claude – fix: no ciclo negativo o salto até o fim (sem animar) também mostra o final triste
      if (eCiclo() && S.perc.length) chamar(playerR, "showEnding", { animate: !REDUZIDO });
    });
    $("tempoRange").addEventListener("input", function (e) { irPara(+e.target.value); });
    ligarPop($("btnMapa"), $("painelMapa"), function () {
      var sel = $$('.nivel[aria-checked="true"]')[0] || $$(".nivel")[0];
      if (sel) sel.focus({ preventScroll: true });
    });
    ligarPop($("btnVis"), $("painelVis"));
    ligarVelocidade();
    ligarAbas();
    ligarDialogoMapa();
    ligarGaveta();
    $("chkTrap").addEventListener("change", function (e) { S.armadilhas = e.target.checked; chamar(playerR, "setTrapsVisible", S.armadilhas); });
    $("chkRastro").addEventListener("change", function (e) { S.rastro = e.target.checked; chamar(playerR, "setTrailVisible", S.rastro); desenharMinimapa(); });
    $("chkMini").addEventListener("change", function (e) { S.minimapa = e.target.checked; desenharMinimapaBase(); desenharMinimapa(); });
    $("selCamada").addEventListener("change", function (e) { definirCamada(e.target.value); });
    $$("#hudCam button").forEach(function (b) {
      b.addEventListener("click", function () {
        $("btnVis").classList.toggle("is-marcado", b.getAttribute("data-cam") !== "seguir");
        S.cam = b.getAttribute("data-cam");
        $$("#hudCam button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        chamar(playerR, "setCamera", S.cam);
      });
    });
    $("minimapa").addEventListener("click", cliqueMinimapa);
    radiogroupTeclado($("algs"), ".alg", function (b) { selecionarAlg(b.dataset.alg, { anunciar: true }); });
    // ligado: Bellman-Ford com a fonte consumível; desligado: Bellman-Ford normal (de qualquer aba, liga já no Bellman-Ford)
    $("tgFonte").addEventListener("click", function () {
      selecionarAlg(S.alg === ALG_FONTE ? "BELLMAN_FORD" : ALG_FONTE, { anunciar: true });
    });
    $$("[data-ver]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-ver");
        if (S.mapa && S.mapa.algoritmos[k]) selecionarAlg(k, { anunciar: true });
        irParaPlayer();
      });
    });
    $("btnM08").addEventListener("click", function () {
      S.alg = "DIJKSTRA";
      irParaPlayer();
      selecionarMapa(MAPA_GRANDE, { alg: "DIJKSTRA" });
    });

    // atalhos: ←/→ passo, espaço play/pausa — só com o player na tela e fora de campos de formulário
    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      if (t && t.closest && t.closest('[role="radiogroup"]')) return;
      var noPlayer = t && t.closest && t.closest("#jogar");
      if (!S.playerVisivel && !noPlayer) return;
      if (e.key === "ArrowRight") { e.preventDefault(); passo(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); passo(-1); }
      else if (e.key === "+" || e.key === "=" || e.key === "Add") { e.preventDefault(); mudarVelocidade(1, true); }
      else if (e.key === "-" || e.key === "_" || e.key === "Subtract") { e.preventDefault(); mudarVelocidade(-1, true); }
      else if (e.key === " " || e.key === "Spacebar") {
        if (tag === "BUTTON" || tag === "A") return; // espaço já ativa o botão focado
        e.preventDefault();
        alternarPlay();
      }
    });

    var redim = 0;
    window.addEventListener("resize", function () {
      clearTimeout(redim);
      redim = setTimeout(function () {
        desenharMinimapaBase(); desenharMinimapa(); agendarGuias(); enquadrarHero(); enquadrarPlayer();
        var pilha = $("pilha");
        if (S.mapa && Math.abs((+pilha.dataset.largura || 0) - pilha.clientWidth) > 40) montarPilha();
      }, 150);
    });
  }

  /* ================================================================ [IA] Claude – rodada 2: janela, velocidade,
     mapa de estados + tabela (LAB.EstadosView), métricas, abas Tabela/Mapa e mapa surpresa */

  /* ---------------------------------------------------------------- popovers (seletor de mapa, Visualização) */
  var pops = [];
  /** Popover simples: botão com aria-expanded, fecha com Esc, clique fora ou foco saindo. */
  function ligarPop(btn, painel, aoAbrir) {
    var caixa = btn.parentNode;
    function abrir() {
      fecharPops();
      painel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      if (aoAbrir) aoAbrir();
    }
    function fechar(focarBotao) {
      if (painel.hidden) return;
      painel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (focarBotao) btn.focus({ preventScroll: true });
    }
    btn.addEventListener("click", function () { if (painel.hidden) abrir(); else fechar(false); });
    caixa.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !painel.hidden) { e.preventDefault(); e.stopPropagation(); fechar(true); }
    });
    caixa.addEventListener("focusout", function (e) {
      if (e.relatedTarget && !caixa.contains(e.relatedTarget)) fechar(false);
    });
    document.addEventListener("pointerdown", function (e) { if (!caixa.contains(e.target)) fechar(false); });
    pops.push(fechar);
  }
  function fecharPops() { pops.forEach(function (f) { f(false); }); }

  /* ---------------------------------------------------------------- gaveta de métricas */
  function ligarGaveta() {
    var dlg = $("dlgMetricas"), btn = $("btnMetricas");
    function fechar() {
      if (typeof dlg.close === "function" && dlg.open) dlg.close();
      else { dlg.removeAttribute("open"); btn.focus({ preventScroll: true }); }
    }
    btn.addEventListener("click", function () {
      fecharPops();
      if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); }
      else dlg.setAttribute("open", "");
      $("btnFecharMetricas").focus();
    });
    $("btnFecharMetricas").addEventListener("click", fechar);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) fechar(); });
    dlg.addEventListener("close", function () { btn.focus({ preventScroll: true }); });
  }

  /* ---------------------------------------------------------------- velocidade estilo YouTube */
  function decimalPt(n) { return String(n).replace(".", ","); }
  function rotuloVel(m) { return m === 1 ? "Normal" : decimalPt(m) + "×"; }
  function notaVel(m) {
    var pps = PASSOS_1X * m;
    if (pps < 1) return "1 passo a cada " + fmt(Math.round(100 / pps) / 100) + " s";
    return fmt(pps) + (pps === 1 ? " passo/s" : " passos/s");
  }
  function definirVelocidade(m, o) {
    o = o || {};
    if (VELOCIDADES.indexOf(m) < 0) m = 1;
    S.mult = m;
    S.vel = PASSOS_1X * m;
    chamar(playerR, "setSpeed", S.vel);
    $("velTxt").textContent = decimalPt(m) + "×";
    $("btnVel").setAttribute("aria-label", "Velocidade: " + rotuloVel(m) + ", " + notaVel(m));
    $("btnVel").title = "Velocidade: " + notaVel(m) + " (teclas + e −)";
    $$("#velMenu [role=option]").forEach(function (li) {
      li.setAttribute("aria-selected", +li.dataset.mult === m ? "true" : "false");
    });
    // o replay da tabela (quando não está sincronizado com o aluno) usa a mesma velocidade
    estadosChamar("setVelocidade", m);
    if (o.anunciar) anunciar("Velocidade " + (m === 1 ? "normal" : decimalPt(m) + " vezes") + ", " + notaVel(m));
  }
  function mudarVelocidade(d, anunciarMudanca) {
    var i = VELOCIDADES.indexOf(S.mult);
    var n = limitar(i + d, 0, VELOCIDADES.length - 1);
    if (n !== i) definirVelocidade(VELOCIDADES[n], { anunciar: anunciarMudanca });
  }
  function ligarVelocidade() {
    var btn = $("btnVel"), menu = $("velMenu"), ativo = 3;
    VELOCIDADES.forEach(function (m, i) {
      var li = el("li", "vel__opcao");
      li.id = "velOpt" + i;
      li.setAttribute("role", "option");
      li.dataset.mult = String(m);
      li.dataset.i = String(i);
      li.appendChild(el("span", "vel__check"));
      li.appendChild(el("span", null, rotuloVel(m)));
      li.title = notaVel(m);
      li.addEventListener("click", function () { definirVelocidade(m, { anunciar: true }); fechar(true); });
      li.addEventListener("pointermove", function () { marcarAtivo(i); });
      menu.appendChild(li);
    });
    function marcarAtivo(i) {
      ativo = limitar(i, 0, VELOCIDADES.length - 1);
      menu.setAttribute("aria-activedescendant", "velOpt" + ativo);
      $$("[role=option]", menu).forEach(function (li, j) { li.classList.toggle("is-ativo", j === ativo); });
    }
    function abrir() {
      fecharPops();
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      marcarAtivo(VELOCIDADES.indexOf(S.mult));
      menu.focus({ preventScroll: true });
    }
    function fechar(focarBotao) {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (focarBotao) btn.focus({ preventScroll: true });
    }
    btn.addEventListener("click", function () { if (menu.hidden) abrir(); else fechar(true); });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); abrir(); }
    });
    menu.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowDown") marcarAtivo(ativo + 1);
      else if (k === "ArrowUp") marcarAtivo(ativo - 1);
      else if (k === "Home") marcarAtivo(0);
      else if (k === "End") marcarAtivo(VELOCIDADES.length - 1);
      else if (k === "Enter" || k === " ") { definirVelocidade(VELOCIDADES[ativo], { anunciar: true }); fechar(true); }
      else if (k === "Escape") { fechar(true); }
      else if (k === "Tab") { fechar(false); return; }
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener("pointerdown", function (e) {
      if (!menu.hidden && !$("vel").contains(e.target)) fechar(false);
    });
    definirVelocidade(1);
  }

  /* ---------------------------------------------------------------- mapa de estados + tabela */
  var ev = null, evFalhou = false, evNome = null, versaoPersonalizado = 0;
  function estadosCriar() {
    if (ev || evFalhou) return ev;
    if (typeof LAB.EstadosView !== "function") {
      evFalhou = true;
      $$(".estados__vazio").forEach(function (p) { p.textContent = "O módulo do mapa de estados não carregou nesta página."; });
      return null;
    }
    $$(".estados__vazio").forEach(function (p) { p.remove(); });
    try {
      // contrato da VIEW: new LAB.EstadosView({ mapaEl, tabelaEl, fetchTraco(alg, fonte), reducedMotion })
      ev = new LAB.EstadosView({
        mapaEl: $("estadosMapa"),
        tabelaEl: $("estadosTabela"),
        reducedMotion: REDUZIDO,
        fetchTraco: function (alg, fonte) { return obterTraco(evNome || S.nome, alg, fonte); }
      });
      // aba trocada na tabela: o player acompanha quando o algoritmo tem percurso (a DFS não tem)
      if (ev && typeof ev.on === "function") ev.on("alg", function (k) {
        if (S.mapa && S.mapa.algoritmos[k] && k !== S.alg) selecionarAlg(k, { anunciar: true });
      });
    } catch (e) {
      evFalhou = true;
      ev = null;
      if (window.console) console.warn("EstadosView falhou ao iniciar", e);
    }
    return ev;
  }
  /** Chamada protegida na EstadosView (método ausente ou com erro nunca derruba o player). */
  function estadosChamar(metodo) {
    if (!ev || typeof ev[metodo] !== "function") return undefined;
    try {
      var r = ev[metodo].apply(ev, Array.prototype.slice.call(arguments, 1));
      if (r && typeof r.then === "function") r.then(null, function (e) { if (window.console) console.warn("EstadosView." + metodo, e); });
      return r;
    } catch (e) {
      if (window.console) console.warn("EstadosView." + metodo, e);
      return undefined;
    }
  }
  function estadosCarregar(mapa, nome) {
    if (!estadosCriar()) return;
    evNome = nome;
    // a view guarda traços por mapa.nome: cada envio de mapa personalizado ganha um nome próprio
    var m = nome === NOME_PERSONALIZADO ? Object.assign({}, mapa, { nome: NOME_PERSONALIZADO + "-" + versaoPersonalizado }) : mapa;
    estadosChamar("load", m);
  }

  /** [IA] Claude – abas Tabela / Mapa de estados (substituem o divisor: cada painel usa a coluna inteira).
   *  Clique ou setas esquerda/direita; a última aba escolhida fica guardada no navegador. */
  function ligarAbas() {
    var abas = [$("abaTabela"), $("abaMapa")];
    if (!abas[0] || !abas[1]) return;
    function mostrar(i, foca) {
      abas.forEach(function (b, j) {
        var sel = j === i;
        b.setAttribute("aria-selected", String(sel));
        b.tabIndex = sel ? 0 : -1;
        $(b.getAttribute("aria-controls")).hidden = !sel;
      });
      if (foca) abas[i].focus();
      try { localStorage.setItem("lab.painel", i ? "mapa" : "tabela"); } catch (e) { /* sem storage */ }
      estadosChamar("resize");
    }
    var ini = 0;
    try { ini = localStorage.getItem("lab.painel") === "mapa" ? 1 : 0; } catch (e) { /* sem storage */ }
    mostrar(ini, false);
    abas.forEach(function (b, i) {
      b.addEventListener("click", function () { mostrar(i, false); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); mostrar(1 - i, true); }
      });
    });
  }

  /* ---------------------------------------------------------------- métricas (solve.metricas, do Python) */
  function dens(v) {
    if (v == null || isNaN(v)) return "–";
    return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  function pct(v) {
    if (v == null || isNaN(v)) return "–";
    return (Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  }
  /** Aceita [glob, cam], { global, camadas } ou um objeto achatado. */
  function normalizarMetricas(x) {
    if (!x || typeof x !== "object") return null;
    var glob, cam;
    if (Array.isArray(x)) { glob = x[0] || {}; cam = x[1] || {}; }
    else {
      glob = x.global || x.glob || x.geral || x;
      cam = x.camadas && !Array.isArray(x.camadas) ? x.camadas : (x.por_camada && !Array.isArray(x.por_camada) ? x.por_camada : x);
    }
    var lista = Array.isArray(cam.camadas) ? cam.camadas : Array.isArray(x.camadas) ? x.camadas : [];
    return {
      g: glob,
      camadas: lista,
      entre: cam.arcos_entre_camadas != null ? cam.arcos_entre_camadas : x.arcos_entre_camadas,
      casas: cam.casas_que_mudam_camada || x.casas_que_mudam_camada || []
    };
  }
  function tabela(cabecalho, linhas, cls) {
    var t = el("table", "mtab" + (cls ? " " + cls : ""));
    var th = el("thead"), tr = el("tr");
    cabecalho.forEach(function (c, i) { var h = el("th", null, c); h.scope = "col"; if (i && cls !== "mtab--texto") h.className = "num"; tr.appendChild(h); });
    th.appendChild(tr); t.appendChild(th);
    var tb = el("tbody");
    linhas.forEach(function (l) {
      var r = el("tr");
      l.forEach(function (v, i) {
        var c = el(i ? "td" : "th", i && cls !== "mtab--texto" ? "num" : null);
        if (!i) c.scope = "row";
        if (v instanceof Node) c.appendChild(v); else c.textContent = v;
        r.appendChild(c);
      });
      tb.appendChild(r);
    });
    t.appendChild(tb);
    return t;
  }
  function montarMetricas() {
    var box = $("metricas");
    var m = normalizarMetricas(S.mapa && S.mapa.metricas);
    box.textContent = "";
    $("metricasSub").textContent = S.nome === NOME_PERSONALIZADO ? "Mapa personalizado" : codigo(S.nome) + " " + titulo(S.nome);
    if (!m || !m.g) {
      // sem solve.metricas: ao menos o tamanho do grafo de estados
      box.appendChild(tabela(["Grafo", "Vértices", "Arestas"], [["G_est (estados)", fmt(S.mapa.estados), fmt(S.mapa.arcos)]]));
      return;
    }
    var g = m.g;
    var gp = g.G_pos || g.g_pos || {}, ge = g.G_est || g.g_est || {};
    box.appendChild(tabela(["Grafo", "Vértices", "Arestas", "Densidade"], [
      ["G_pos (casas)", fmt(gp.ordem), fmt(gp.tamanho), dens(gp.densidade)],
      ["G_est (estados)", fmt(ge.ordem), fmt(ge.tamanho), dens(ge.densidade)]
    ]));
    var dl = el("dl", "dados dados--duplo metricas__dados");
    function item(rot, val, titulo) {
      var d = el("div"); d.appendChild(el("dt", null, rot));
      var dd = el("dd", null, val); if (titulo) dd.title = titulo;
      d.appendChild(dd); dl.appendChild(d);
    }
    item("Teto teórico", fmt(g.teto_teorico != null ? g.teto_teorico : S.mapa.teto));
    item("Ocupação", pct(g.taxa_ocupacao));
    var mult = g.multiplicidade_maxima;
    var casasMult = g.casas_com_multiplicidade_maxima || [];
    item("Multiplicidade", mult == null ? "–" : fmt(mult) + (casasMult.length ? " em " + casasMult.length + (casasMult.length === 1 ? " casa" : " casas") : ""),
      casasMult.map(function (p) { return "(" + p[0] + "," + p[1] + ")"; }).join(" "));
    var becos = g.becos || [];
    item("Becos", fmt(becos.length), becos.slice(0, 40).join("  "));
    if (g.maior_grau_saida) item("Maior grau de saída", fmt(g.maior_grau_saida.grau), g.maior_grau_saida.estado);
    if (g.maior_grau_entrada) item("Maior grau de entrada", fmt(g.maior_grau_entrada.grau), g.maior_grau_entrada.estado);
    item("Armadilhas", g.n_armadilhas != null ? fmt(g.n_armadilhas) + (g.pct_armadilhas != null ? " (" + pct(g.pct_armadilhas) + ")" : "") : fmt((S.mapa.armadilhas || []).length));
    box.appendChild(dl);

    if (m.camadas.length) {
      box.appendChild(el("h4", "metricas__sub", "Camadas"));
      box.appendChild(tabela(["Chaves", "Vértices", "Arestas", "Densidade"], m.camadas.map(function (c) {
        return [c.chaves === "-" || !c.chaves ? "sem chave" : c.chaves, fmt(c.ordem), fmt(c.tamanho), dens(c.densidade)];
      })));
    }
    if (m.entre != null) {
      var p = el("p", "metricas__entre");
      p.appendChild(el("b", null, fmt(m.entre)));
      p.appendChild(document.createTextNode(m.entre === 1 ? " arco muda de camada" : " arcos mudam de camada"));
      box.appendChild(p);
      if (m.casas.length) {
        // [IA] Claude – rodada 4: lista corrida em vez de chips ("b em (1,12), c em (6,6): 1 arco cada")
        var arcosIguais = m.casas.every(function (c) { return c.arcos === m.casas[0].arcos; });
        var q = el("p", "metricas__casas");
        m.casas.forEach(function (c, i) {
          var casa = c.casa || [], sim = c.simbolo || "";
          if (i) q.appendChild(document.createTextNode(i === m.casas.length - 1 ? " e " : ", "));
          var b = el("b", null, sim);
          if (/[a-d]/.test(sim)) b.style.color = corChave(sim);
          q.appendChild(b);
          q.appendChild(document.createTextNode(" em (" + casa[0] + "," + casa[1] + ")" + (arcosIguais ? "" : " (" + fmt(c.arcos) + (c.arcos === 1 ? " arco)" : " arcos)"))));
        });
        if (arcosIguais && m.casas.length) q.appendChild(document.createTextNode(": " + fmt(m.casas[0].arcos) + (m.casas[0].arcos === 1 ? " arco" : " arcos") + (m.casas.length > 1 ? " cada" : "")));
        box.appendChild(q);
      }
    }
    var comp = S.mapa.comparacao_modelagem || S.mapa.comparacao || (S.mapa.metricas && S.mapa.metricas.comparacao_modelagem);
    if (Array.isArray(comp) && comp.length) {
      box.appendChild(el("h4", "metricas__sub", "Comparação de modelagem"));
      var NOMES = { G_pos_porta_chao: "G_pos, porta como chão", G_pos_porta_parede: "G_pos, porta como parede", G_est: "G_est (estados)" };
      box.appendChild(tabela(["Abordagem", "Passos", "Válido", "Observação"], comp.map(function (c) {
        return [NOMES[c.abordagem] || c.abordagem, c.passos == null ? "–" : fmt(c.passos), c.caminho_valido ? "sim" : "não", c.observacao || ""];
      }), "mtab--texto"));
    }
  }

  /* ---------------------------------------------------------------- mapa surpresa (POST api/mapa) */
  var LIMITE_MAPA = 64 * 1024;
  function ligarDialogoMapa() {
    var dlg = $("dlgMapa"), form = $("formMapa"), txt = $("txtMapa"), erro = $("dlgErro"), btn = $("btnResolver");
    function mostrarErro(m) { erro.textContent = m || ""; erro.hidden = !m; }
    function abrir() {
      var estatico = S.embutido;
      $$("[data-so-estatico]", dlg).forEach(function (e) { e.hidden = !estatico; });
      $$("[data-so-servidor]", dlg).forEach(function (e) { e.hidden = estatico; });
      mostrarErro("");
      if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); }
      else dlg.setAttribute("open", "");
      setTimeout(function () { (estatico ? dlg.querySelector("[data-fechar]") : txt).focus(); }, 30);
    }
    function fechar() {
      if (typeof dlg.close === "function" && dlg.open) dlg.close();
      else dlg.removeAttribute("open");
      $("btnMapa").focus({ preventScroll: true });
    }
    $("btnCarregar").addEventListener("click", function () { fecharPops(); abrir(); });
    $("btnDlgCancelar").addEventListener("click", fechar);
    $$("[data-fechar]", dlg).forEach(function (b) { b.addEventListener("click", fechar); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) fechar(); });
    $("arqMapa").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      $("arqNome").textContent = f.name;
      if (f.size > LIMITE_MAPA) { mostrarErro("O arquivo tem mais de 64 KB. Um mapa do projeto cabe em bem menos que isso."); return; }
      var leitor = new FileReader();
      leitor.onload = function () { txt.value = String(leitor.result || ""); mostrarErro(""); };
      leitor.onerror = function () { mostrarErro("Não foi possível ler o arquivo."); };
      leitor.readAsText(f, "utf-8");
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (S.embutido) { fechar(); return; }
      var texto = txt.value.replace(/\r\n?/g, "\n");
      if (!texto.trim()) { mostrarErro("Cole o texto do mapa ou escolha um arquivo .txt."); txt.focus(); return; }
      if (texto.length > LIMITE_MAPA) { mostrarErro("O mapa tem mais de 64 KB."); return; }
      mostrarErro("");
      btn.disabled = true;
      btn.textContent = "Resolvendo";
      fetch("api/mapa", { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: texto })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok) throw new Error(d.erro || (r.status === 404 || r.status === 405
              ? "Este servidor ainda não aceita mapas novos."
              : "O servidor respondeu com erro " + r.status + "."));
            return d;
          });
        })
        .then(function (d) {
          if (d.servidor) mostrarServidor(d.servidor);
          d.nome = NOME_PERSONALIZADO;
          S.textoPersonalizado = texto;
          versaoPersonalizado++;
          Object.keys(cacheTraco).forEach(function (k) { if (k.indexOf(NOME_PERSONALIZADO + "|") === 0) delete cacheTraco[k]; });
          S.cache[NOME_PERSONALIZADO] = d;
          if (S.nomes.indexOf(NOME_PERSONALIZADO) < 0) S.nomes.push(NOME_PERSONALIZADO);
          montarNiveis(S.nomes);
          fechar();
          atualizarHistorico();
          selecionarMapa(NOME_PERSONALIZADO, { alg: melhorAlg(d) });
        })
        .catch(function (err) {
          mostrarErro(err && err.message && !/Failed to fetch|NetworkError/i.test(err.message) ? err.message : "Sem conexão com o servidor. Tente de novo.");
        })
        .then(function () { btn.disabled = false; btn.textContent = "Resolver no servidor"; });
    });
  }

  /* ================================================================ navbar */
  function ligarNav() {
    var nav = $("nav"), menu = $("btnMenu");
    function fecharMenu() { nav.classList.remove("is-aberta"); menu.setAttribute("aria-expanded", "false"); }
    menu.addEventListener("click", function () {
      var abre = !nav.classList.contains("is-aberta");
      nav.classList.toggle("is-aberta", abre);
      menu.setAttribute("aria-expanded", abre ? "true" : "false");
    });
    $$("#navLinks a").forEach(function (a) { a.addEventListener("click", fecharMenu); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("is-aberta")) { fecharMenu(); menu.focus(); } });
    var agendado = false;
    function aoRolar() {
      agendado = false;
      // transparente só no topo do hero; ao rolar, o conteúdo do hero passaria por baixo dela
      nav.classList.toggle("is-solida", window.scrollY > 24);
    }
    window.addEventListener("scroll", function () { if (!agendado) { agendado = true; requestAnimationFrame(aoRolar); } }, { passive: true });
    aoRolar();
    if (window.IntersectionObserver) {
      var links = $$("#navLinks a");
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (a) { a.setAttribute("aria-current", a.getAttribute("href") === "#" + e.target.id ? "true" : "false"); });
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      ["inicio", "jogar", "como-funciona", "algoritmos"].forEach(function (id) { if ($(id)) io.observe($(id)); });
    }
  }

  /* ================================================================ erro global (sem lista de mapas) */
  function falhaLista() {
    mostrarServidor("erro");
    $("heroMapa").textContent = "Os mapas não carregaram";
    $("heroDado").textContent = "Confira se o servidor está rodando.";
    var l = $("heroPalco").querySelector("[data-carregando]");
    if (l) l.querySelector(".carregando__texto").textContent = "Sem conexão com o servidor";
    carregando(false);
    dialogo({
      status: "SEM_SOLUCAO",
      titulo: "Sem conexão com o servidor",
      texto: "A lista de mapas não carregou. Confira se o servidor está rodando e tente de novo.",
      acoes: [["Tentar de novo", function () { location.reload(); }, true]]
    });
  }

  /* ================================================================ início */
  function iniciar() {
    observarVisibilidade($("tupla"), function (vis) { tuplaVisivel = vis; if (vis && guiasSujas) agendarGuias(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { agendarGuias(); });
    montarSprites();
    montarCatalogo();
    ligarNav();
    ligarControles();
    iniciarPlayer();
    uiPlay();
    if (S.embutido) {
      mostrarServidor(null);
      Object.keys(window.__DADOS__).forEach(function (k) { S.cache[k] = window.__DADOS__[k]; });
    }
    carregando(true, "Carregando os mapas");
    listarMapas().then(function (nomes) {
      S.nomes = nomes;
      montarNiveis(nomes);
      atualizarCta();
      if (!nomes.length) { falhaLista(); return; }
      var destaque = nomes.indexOf(MAPA_DESTAQUE) >= 0 ? MAPA_DESTAQUE : nomes[0];
      // uma única busca do mapa em destaque alimenta o hero e o player
      obterMapa(destaque).then(function (mapa) { iniciarHero(mapa); }).catch(function () {
        var l = $("heroPalco").querySelector("[data-carregando] .carregando__texto");
        if (l) l.textContent = "O mapa " + codigo(destaque) + " não carregou";
      });
      selecionarMapa(destaque, { anunciar: false });
    }).catch(falhaLista);
  }

  /* ganchos de inspeção (QA e console): leitura do estado e dos dois renderizadores */
  LAB.app = {
    estado: S,
    hero: function () { return heroR; },
    player: function () { return playerR; },
    estados: function () { return ev; },
    tipos: function () { return { hero: heroTipo, player: playerTipo }; },
    selecionarMapa: selecionarMapa,
    selecionarAlg: selecionarAlg,
    tocar: tocar,
    pausar: pausar,
    irPara: irPara
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
