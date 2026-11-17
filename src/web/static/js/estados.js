/* [IA] Claude – LAB.EstadosView: mapa de estados (canvas) + tabelas no formato dos slides, lidos do traço do Python.
   Nada aqui calcula grafo ou algoritmo: os eventos vêm de src/graphs/algorithms.py (ganchos `observador`) via
   src/traco.py; LAB.traco (grafo.js) só os reproduz. Duas áreas, montadas nos contêineres que o app.js entrega:
   (1) mapaEl  → o grafo de estados desenhado em camadas (uma por conjunto de chaves), com o aluno por cima;
   (2) tabelaEl → abas BFS / DFS / Dijkstra / Bellman-Ford com replay e as tabelas na orientação da Profª Laura.
   API: new LAB.EstadosView({ mapaEl, tabelaEl, fetchTraco: async (alg, fonte) => json, reducedMotion })
        .load(mapa) .setAlgoritmo(key) .setPasso(percurso, idx) .setVelocidade(mult) .on('alg', fn) .dispose() */
(function (raiz) {
  'use strict';
  var LAB = (raiz.LAB = raiz.LAB || {});

  // ------------------------------------------------------------------ constantes
  var ALGS = [
    { key: 'BFS', nome: 'BFS', alg: 'BFS', fonte: false },
    { key: 'DFS', nome: 'DFS', alg: 'DFS', fonte: false },
    { key: 'DIJKSTRA', nome: 'Dijkstra', alg: 'DIJKSTRA', fonte: false },
    { key: 'BELLMAN_FORD', nome: 'Bellman-Ford', alg: 'BELLMAN_FORD', fonte: false },
    { key: 'BELLMAN_FORD_FONTE_CONSUMIVEL', nome: 'Bellman-Ford, fonte consumível', curto: 'BF fonte', alg: 'BELLMAN_FORD', fonte: true }
  ];
  var VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  var EVENTOS_POR_S = 3; // 1× = 3 eventos por segundo
  var COR = {
    naoVisitado: '#D9DCE8', visitado: '#8C90A8', encerrado: '#1C1B29',
    tinta: '#1C1B29', tintaFraca: '#5B5F7A', arco: '#B7BDD0', arcoForte: '#1C1B29', papel: '#F3F5FA',
    quadricula: '#DCE3F0', cesar: '#FF6002', erro: '#E0334F', ok: '#2E9E6B',
    arvore: '#1C1B29', retorno: '#D64560', avanco: '#1F9C8A', cruzamento: '#7B61D9',
    chave: { a: '#FFC23A', b: '#35C8F0', c: '#F45BC8', d: '#7DDB45' }, semChave: '#6E7391'
  };
  var NOME_ESTADO = { BFS: ['não visitado', 'visitado (na fila)', 'encerrado'], DFS: ['não visitado', 'visitado (na pilha)', 'encerrado'],
    DIJKSTRA: ['não visitado', 'aberto', 'fechado'], BELLMAN_FORD: ['não visitado', 'com estimativa', 'final'] };

  // ------------------------------------------------------------------ utilidades
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var ZOOM_W = 44; // largura reservada para os botões de zoom no canto do palco
  function num(x) {
    if (x === Infinity || x === null || x === undefined) return '∞';
    if (x === -Infinity) return '−∞';
    return Number(x).toLocaleString('pt-BR', { maximumFractionDigits: 2 }).replace('-', '−');
  }
  function mult(m) { return m === 1 ? 'Normal' : String(m).replace('.', ',') + '×'; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mistura(h1, h2, t) { var a = hexRgb(h1), b = hexRgb(h2); return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' + Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t)) + ')'; }
  function suave(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function nomeCamada(k) {
    if (!k || k === '-') return 'sem chave';
    var l = k.split('');
    if (l.length === 1) return 'chave ' + l[0];
    return 'chaves ' + l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
  }
  // cor do rastro (SPEC §3): sem chave → neutro (no papel o "luar" sumiria: usa grafite claro); senão a última chave pega
  function corRastro(chaves, ultima) {
    if (!chaves) return COR.semChave;
    return COR.chave[ultima] || COR.chave[chaves[chaves.length - 1]] || COR.semChave;
  }
  function svgIco(p) { return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' + p + '</svg>'; }
  var ICO = {
    inicio: svgIco('<rect x="2" y="3" width="2" height="10"/><path d="M14 3 6 8l8 5z"/>'),
    voltar: svgIco('<path d="M12 3 4 8l8 5z"/>'),
    play: svgIco('<path d="M4 2.5 13.5 8 4 13.5z"/>'),
    pausa: svgIco('<rect x="3.5" y="3" width="3" height="10"/><rect x="9.5" y="3" width="3" height="10"/>'),
    avancar: svgIco('<path d="M4 3l8 5-8 5z"/>'),
    fim: svgIco('<path d="M2 3l8 5-8 5z"/><rect x="12" y="3" width="2" height="10"/>'),
    mais: svgIco('<rect x="7" y="3" width="2" height="10"/><rect x="3" y="7" width="10" height="2"/>'),
    menos: svgIco('<rect x="3" y="7" width="10" height="2"/>'),
    tudo: svgIco('<path d="M2 2h5v2H4v3H2zM14 2v5h-2V4H9V2zM2 14V9h2v3h3v2zM14 14H9v-2h3V9h2z"/>'),
    alvo: svgIco('<path d="M7 1h2v3H7zM7 12h2v3H7zM1 7h3v2H1zM12 7h3v2h-3z"/><path d="M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>')
  };

  // ------------------------------------------------------------------ a view
  function EstadosView(opts) {
    if (!(this instanceof EstadosView)) return new EstadosView(opts);
    opts = opts || {};
    this.mapaEl = opts.mapaEl; this.tabelaEl = opts.tabelaEl;
    this.fetchTraco = opts.fetchTraco || null;
    this.reduzido = opts.reducedMotion != null ? !!opts.reducedMotion
      : !!(raiz.matchMedia && raiz.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.ouvintes = {};
    this.cache = {};             // key → Promise<T>
    this.mapa = null; this.key = 'BFS'; this.T = null; this.k = 0;
    this.vel = 1; this.tocando = false; this.sincronizar = true; this.seguir = true;
    this.percurso = null; this.idx = 0; this.alunoNo = -1;
    this.expandeCaminho = false;
    this._timer = 0; this._raf = 0; this._rafOverlay = 0; this._dispose = [];
    this.view = { s: 1, x: 0, y: 0 }; this._usuarioMexeu = false;
    this.anim = null;            // easing de cores dos nós
    this._monta();
  }
  var P = EstadosView.prototype;

  P.on = function (ev, fn) { (this.ouvintes[ev] = this.ouvintes[ev] || []).push(fn); return this; };
  P._emite = function (ev, x) { (this.ouvintes[ev] || []).forEach(function (f) { try { f(x); } catch (e) { console.error(e); } }); };
  P._escuta = function (alvo, tipo, fn, o) { alvo.addEventListener(tipo, fn, o); this._dispose.push(function () { alvo.removeEventListener(tipo, fn, o); }); };

  // ------------------------------------------------------------------ montagem do DOM
  P._monta = function () {
    var self = this;
    // ---- mapa
    var m = this.mapaEl;
    m.classList.add('ev-raiz');
    m.innerHTML = '';
    var card = this.cardMapa = el('div', 'ev-card ev-mapa');
    card.innerHTML =
      '<div class="ev-cab"><h3 class="ev-titulo">Mapa de estados</h3><p class="ev-sub" data-r="sub">Carregando…</p></div>' +
      '<div class="ev-palco" data-r="palco" tabindex="0" role="img" aria-label="Grafo de estados">' +
        '<canvas class="ev-cv" data-r="cv"></canvas><canvas class="ev-cv ev-cv--sobre" data-r="cv2"></canvas>' +
        '<div class="ev-dica" data-r="dica" role="tooltip" hidden></div>' +
        '<div class="ev-zoom"><button type="button" class="ev-bt ev-bt--ico" data-a="mais" aria-label="Aproximar">' + ICO.mais + '</button>' +
        '<button type="button" class="ev-bt ev-bt--ico" data-a="menos" aria-label="Afastar">' + ICO.menos + '</button>' +
        '<button type="button" class="ev-bt ev-bt--ico" data-a="tudo" aria-label="Ver o mapa inteiro">' + ICO.tudo + '</button></div>' +
        '<div class="ev-aviso" data-r="aviso" hidden></div>' +
      '</div>' +
      '<div class="ev-mapa-pe">' +
        '<div class="ev-acoes"><button type="button" class="ev-bt" data-a="centralizar" aria-label="Centralizar no aluno">' + ICO.alvo + '<span>Centralizar no aluno</span></button>' +
        '<label class="ev-chk"><input type="checkbox" data-r="seguir" checked> Seguir o aluno</label></div>' +
        '<ul class="ev-legenda" data-r="legenda"></ul>' +
      '</div>';
    m.appendChild(card);
    this.r = {};
    card.querySelectorAll('[data-r]').forEach(function (e) { self.r[e.getAttribute('data-r')] = e; });
    this.cv = this.r.cv; this.cv2 = this.r.cv2;
    this.ctx = this.cv.getContext('2d'); this.ctx2 = this.cv2.getContext('2d');
    this._escuta(card, 'click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'mais') self._zoomEm(1.4); else if (a === 'menos') self._zoomEm(1 / 1.4);
      else if (a === 'tudo') { self._usuarioMexeu = false; self._ajusta(true); }
      else if (a === 'centralizar') self._centraAluno(true, true);
    });
    this._escuta(this.r.seguir, 'change', function () { self.seguir = self.r.seguir.checked; if (self.seguir) self._centraAluno(false, true); });
    this._interacaoCanvas();

    // ---- tabela
    var t = this.tabelaEl;
    t.classList.add('ev-raiz');
    t.innerHTML = '';
    var ct = this.cardTab = el('div', 'ev-card ev-tab');
    ct.innerHTML =
      '<div class="ev-abas" role="tablist" aria-label="Algoritmo da tabela" data-t="abas"></div>' +
      '<div class="ev-ctl" data-t="ctl">' +
        '<div class="ev-botoes" role="group" aria-label="Replay do algoritmo">' +
          '<button type="button" class="ev-bt ev-bt--ico" data-c="inicio" aria-label="Voltar ao início">' + ICO.inicio + '</button>' +
          '<button type="button" class="ev-bt ev-bt--ico" data-c="voltar" aria-label="Passo anterior">' + ICO.voltar + '</button>' +
          '<button type="button" class="ev-bt ev-bt--ico ev-bt--play" data-c="play" aria-label="Reproduzir">' + ICO.play + '</button>' +
          '<button type="button" class="ev-bt ev-bt--ico" data-c="avancar" aria-label="Próximo passo">' + ICO.avancar + '</button>' +
          '<button type="button" class="ev-bt" data-c="fim" aria-label="Ir para o fim">' + ICO.fim + '<span>Ir para o fim</span></button>' +
        '</div>' +
        '<div class="ev-vel"><button type="button" class="ev-bt" data-c="vel" aria-haspopup="listbox" aria-expanded="false">Velocidade: <b data-t="velrot">Normal</b></button>' +
          '<ul class="ev-menu" role="listbox" tabindex="-1" aria-label="Velocidade do replay" data-t="menu" hidden></ul></div>' +
        '<label class="ev-chk"><input type="checkbox" data-t="sinc" checked> Sincronizar com o aluno</label>' +
        '<div class="ev-linha-tempo"><input type="range" min="0" max="0" value="0" step="1" data-t="scrub" aria-label="Evento do traço">' +
          '<span class="ev-cont" data-t="cont" aria-live="off">Evento 0 de 0</span></div>' +
        '<p class="ev-frase" data-t="frase" aria-live="polite"></p>' +
      '</div>' +
      '<div class="ev-corpo" data-t="corpo"></div>' +
      '<div class="ev-pe" data-t="pe"></div>';
    t.appendChild(ct);
    this.t = {};
    ct.querySelectorAll('[data-t]').forEach(function (e) { self.t[e.getAttribute('data-t')] = e; });
    // menu de velocidade (tipo YouTube)
    this.t.menu.innerHTML = VELOCIDADES.map(function (v) {
      return '<li role="option" data-v="' + v + '" aria-selected="' + (v === 1) + '">' + mult(v) + '</li>';
    }).join('');
    this._escuta(ct, 'click', function (e) {
      var ab = e.target.closest('[data-aba]');
      if (ab) { self._trocaAba(ab.getAttribute('data-aba'), true); return; }
      var op = e.target.closest('[data-v]');
      if (op) { self.setVelocidade(+op.getAttribute('data-v')); self._menu(false); self.t.ctl.querySelector('[data-c="vel"]').focus(); return; }
      var b = e.target.closest('[data-c]');
      if (b) { self._controle(b.getAttribute('data-c')); return; }
      var x = e.target.closest('[data-x]');
      if (x) { self._acaoExtra(x.getAttribute('data-x'), x); }
    });
    this._escuta(ct, 'keydown', function (e) { self._teclado(e); });
    this._escuta(this.t.menu, 'keydown', function (e) {
      var i = VELOCIDADES.indexOf(self.vel);
      if (e.key === 'ArrowDown') { e.preventDefault(); self.setVelocidade(VELOCIDADES[Math.min(VELOCIDADES.length - 1, i + 1)]); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); self.setVelocidade(VELOCIDADES[Math.max(0, i - 1)]); }
      else if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); self._menu(false); self.t.ctl.querySelector('[data-c="vel"]').focus(); }
    });
    this._escuta(document, 'pointerdown', function (e) { if (!self.t.menu.hidden && !e.target.closest('.ev-vel')) self._menu(false); });
    this._escuta(this.t.sinc, 'change', function () { self.sincronizar = self.t.sinc.checked; if (self.sincronizar) { self._pausa(); self._sincroniza(); } });
    var scrubRaf = 0;
    this._escuta(this.t.scrub, 'input', function () {
      var v = +self.t.scrub.value;
      self._largaSinc();
      if (scrubRaf) return;
      scrubRaf = requestAnimationFrame(function () { scrubRaf = 0; self._vaiPara(+self.t.scrub.value); });
      void v;
    });
    this._escuta(this.t.corpo, 'scroll', function () { if (self._virtual) self._virtual(); }, { passive: true, capture: true });

    // redimensionamento
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(function () { self._redimensiona(); });
      this._ro.observe(this.r.palco);
    } else this._escuta(raiz, 'resize', function () { self._redimensiona(); });
    this._redimensiona();
    this._abas();
    this._legenda();
  };

  // ------------------------------------------------------------------ API pública
  P.load = function (mapa) {
    var mudou = !this.mapa || !mapa || this.mapa.nome !== mapa.nome || mapa.nome === 'personalizado' || this.mapa !== mapa;
    this.mapa = mapa;
    if (mudou) { this.cache = {}; this.T = null; this.layout = null; this._usuarioMexeu = false; }
    if (!this._temAlg(this.key)) this.key = 'BFS';
    this._abas();
    return this._carregaAlg(this.key);
  };
  P.setAlgoritmo = function (key) {
    key = String(key || '').toUpperCase();
    if (!ALGS.some(function (a) { return a.key === key; })) return Promise.resolve();
    if (key === this.key && this.T) return Promise.resolve();
    return this._trocaAba(key, false);
  };
  P.setPasso = function (percurso, idx) {
    this.percurso = percurso || null;
    this.idx = Math.max(0, Math.min((percurso ? percurso.length : 1) - 1, idx | 0));
    this._calculaAluno();
    if (this.sincronizar && !this.tocando) this._sincroniza();
    else this._pede();
    if (this.seguir) this._centraAluno(false, false);
    this._renderTabela();
  };
  P.setVelocidade = function (m) {
    m = +m;
    if (VELOCIDADES.indexOf(m) < 0) m = VELOCIDADES.reduce(function (a, b) { return Math.abs(b - m) < Math.abs(a - m) ? b : a; }, 1);
    this.vel = m;
    this.t.velrot.textContent = mult(m);
    var self = this;
    this.t.menu.querySelectorAll('[data-v]').forEach(function (li) { li.setAttribute('aria-selected', String(+li.getAttribute('data-v') === self.vel)); });
    if (this.tocando) { this._pausa(); this._toca(); }
  };
  P.dispose = function () {
    this._pausa();
    cancelAnimationFrame(this._raf); cancelAnimationFrame(this._rafOverlay); cancelAnimationFrame(this._rafPan);
    if (this._ro) this._ro.disconnect();
    this._dispose.forEach(function (f) { f(); });
    this._dispose = [];
    this.mapaEl.innerHTML = ''; this.tabelaEl.innerHTML = '';
    this.mapaEl.classList.remove('ev-raiz'); this.tabelaEl.classList.remove('ev-raiz');
    this.ouvintes = {}; this.T = null; this._mort = true;
  };

  // ------------------------------------------------------------------ algoritmo / traço
  P._temAlg = function (key) {
    if (key !== 'BELLMAN_FORD_FONTE_CONSUMIVEL') return true;
    return !!(this.mapa && this.mapa.algoritmos && this.mapa.algoritmos.BELLMAN_FORD_FONTE_CONSUMIVEL);
  };
  P._abas = function () {
    var self = this;
    this.t.abas.innerHTML = ALGS.filter(function (a) { return self._temAlg(a.key); }).map(function (a) {
      var sel = a.key === self.key;
      return '<button type="button" role="tab" class="ev-aba" data-aba="' + a.key + '" aria-selected="' + sel + '" tabindex="' + (sel ? 0 : -1) + '"' +
        (a.curto ? ' title="' + a.nome + '"' : '') + '>' + (a.curto ? '<span class="ev-so-largo">' + a.nome + '</span><span class="ev-so-estreito">' + a.curto + '</span>' : a.nome) + '</button>';
    }).join('');
  };
  P._trocaAba = function (key, doUsuario) {
    if (!this._temAlg(key)) key = 'BFS';
    var antes = this.key;
    this.key = key;
    this._abas();
    if (doUsuario && key !== antes) this._emite('alg', key);
    if (doUsuario) { var b = this.t.abas.querySelector('[aria-selected="true"]'); if (b) b.focus(); }
    return this._carregaAlg(key);
  };
  P._carregaAlg = function (key) {
    var self = this, def = ALGS.filter(function (a) { return a.key === key; })[0];
    if (!this.mapa) return Promise.resolve();
    this._pausa();
    var ck = (this.mapa.nome || '') + '|' + key;
    if (!this.cache[ck]) {
      if (!this.fetchTraco || !LAB.traco) {
        this._erro('Traço indisponível: falta fetchTraco ou LAB.traco.');
        return Promise.resolve();
      }
      this.cache[ck] = Promise.resolve().then(function () { return self.fetchTraco(def.alg, def.fonte); })
        .then(function (json) { return LAB.traco.carregar(json, { algoritmo: def.alg, fonte: def.fonte }); });
      this.cache[ck].catch(function () { delete self.cache[ck]; });
    }
    this._carregando(true);
    var pedido = this._pedido = {};
    return this.cache[ck].then(function (T) {
      if (self._mort || pedido !== self._pedido) return;
      self._carregando(false);
      var mesmoGrafo = self.layout && self.layout.T && self.layout.T.n === T.n && self.layout.mapa === self.mapa && self.layout.T.rotulos.join('\n') === T.rotulos.join('\n');
      self.T = T;
      if (!mesmoGrafo) self._fazLayout();
      self._calculaAluno();
      self.anim = null;
      self.k = -1;
      self.t.scrub.max = String(T.eventos.length);
      if (self.sincronizar && self.percurso) self._sincroniza(true);
      else self._vaiPara(T.eventos.length, true);
      self._legenda();
      self._sub();
      if (!self._usuarioMexeu) self._ajusta(false);
      if (self.seguir && self.percurso) self._centraAluno(false, true);
    }, function (e) {
      if (self._mort || pedido !== self._pedido) return;
      self._carregando(false);
      self._erro('Não foi possível carregar o traço do Python (' + esc(e && e.message || e) + ').');
    });
  };
  P._carregando = function (sim) {
    this.cardMapa.classList.toggle('ev--carregando', sim);
    this.cardTab.classList.toggle('ev--carregando', sim);
    if (sim) { this.r.aviso.hidden = false; this.r.aviso.textContent = 'Carregando o traço do Python…'; }
    else this.r.aviso.hidden = true;
  };
  P._erro = function (msg) {
    this.r.aviso.hidden = false; this.r.aviso.innerHTML = msg;
    this.t.corpo.innerHTML = '<p class="ev-nota ev-nota--erro">' + msg + '</p>';
  };
  P._sub = function () {
    var T = this.T; if (!T) return;
    var def = ALGS.filter(function (a) { return a.key === this.key; }, this)[0];
    // [IA] Claude – curto para caber numa linha (mapa e algoritmo já aparecem na janela e nas abas); o completo vai no title
    var nCam = this.layout ? this.layout.camadas.length : 0;
    this.r.sub.textContent = T.nEstados.toLocaleString('pt-BR') + ' estados, ' + T.nArcos.toLocaleString('pt-BR') + ' arcos' +
      (nCam > 1 ? ', ' + nCam + ' camadas' : '');
    this.r.sub.title = def.nome + ' em ' + (this.mapa.nome || 'mapa') + ': ' + this.r.sub.textContent;
    this.r.palco.setAttribute('aria-label', 'Grafo de estados de ' + (this.mapa.nome || 'mapa') + ' com ' + T.nEstados + ' estados, desenhado em camadas por conjunto de chaves.');
  };

  // ------------------------------------------------------------------ replay
  P._vaiPara = function (k, forca) {
    var T = this.T; if (!T) return;
    k = Math.max(0, Math.min(T.eventos.length, k | 0));
    if (k === this.k && !forca) return;
    var antes = this.st ? this.st.estado.slice() : null;
    this.k = k;
    this.st = LAB.traco.replay(T, k);
    this.tab = LAB.traco.tabela(T);
    // easing das cores: só quando poucos nós mudam (passo a passo), não em saltos grandes
    if (antes && antes.length === this.st.estado.length && !this.reduzido) {
      var mud = [], e = this.st.estado;
      for (var i = 0; i < e.length && mud.length <= 40; i++) if (antes[i] !== e[i]) mud.push(i);
      if (mud.length && mud.length <= 40) {
        var t0 = performance.now(), de = {};
        mud.forEach(function (v) { de[v] = antes[v]; });
        this.anim = { t0: t0, de: de, dur: Math.min(260, 900 / (EVENTOS_POR_S * this.vel)) };
      } else this.anim = null;
    } else this.anim = null;
    this.t.scrub.value = String(k);
    this.t.cont.textContent = 'Evento ' + k.toLocaleString('pt-BR') + ' de ' + T.eventos.length.toLocaleString('pt-BR');
    this.t.frase.textContent = T.eventos.length ? LAB.traco.fraseEvento(T, this.st.evento) : 'O traço não tem eventos: veja o resultado abaixo.';
    this._renderTabela();
    this._pede();
  };
  P._controle = function (c) {
    var T = this.T; if (!T && c !== 'vel') return;
    if (c === 'vel') { this._menu(this.t.menu.hidden); return; }
    if (c === 'play') { if (this.tocando) this._pausa(); else { this._largaSinc(); if (this.k >= T.eventos.length) this._vaiPara(0); this._toca(); } return; }
    this._largaSinc(); this._pausa();
    if (c === 'inicio') this._vaiPara(0);
    else if (c === 'voltar') this._vaiPara(this._proximo(-1));
    else if (c === 'avancar') this._vaiPara(this._proximo(1));
    else if (c === 'fim') this._vaiPara(T.eventos.length);
  };
  // [IA] Claude – próximo evento do replay; no Bellman-Ford um bloco de passadas sem mudança é pulado de uma vez
  P._proximo = function (dir) {
    var tab = this.T ? LAB.traco.tabela(this.T) : null;
    return tab && tab.salto ? tab.salto(this.k, dir) : this.k + dir;
  };
  P._menu = function (abre) {
    var b = this.t.ctl.querySelector('[data-c="vel"]');
    this.t.menu.hidden = !abre; b.setAttribute('aria-expanded', String(!!abre));
    if (abre) this.t.menu.focus();
  };
  P._toca = function () {
    var self = this;
    if (!this.T) return;
    this.tocando = true;
    this._botaoPlay();
    var passo = function () {
      if (!self.tocando) return;
      if (self.k >= self.T.eventos.length) { self._pausa(); return; }
      self._vaiPara(self._proximo(1));
      self._timer = setTimeout(passo, 1000 / (EVENTOS_POR_S * self.vel));
    };
    this._timer = setTimeout(passo, 1000 / (EVENTOS_POR_S * this.vel));
  };
  P._pausa = function () { this.tocando = false; clearTimeout(this._timer); this._botaoPlay(); };
  P._botaoPlay = function () {
    var b = this.t && this.t.ctl.querySelector('[data-c="play"]'); if (!b) return;
    b.innerHTML = this.tocando ? ICO.pausa : ICO.play;
    b.setAttribute('aria-label', this.tocando ? 'Pausar' : 'Reproduzir');
    b.classList.toggle('ev-bt--ativo', this.tocando);
  };
  P._largaSinc = function () { if (this.sincronizar) { this.sincronizar = false; this.t.sinc.checked = false; } };
  // sincronizar: o replay vai até o evento em que o algoritmo fixou o estado onde o aluno está
  P._sincroniza = function (forca) {
    var T = this.T; if (!T) return;
    var k = this.k;
    if (this.percurso && this.percurso.length) {
      var ultimo = this.idx >= this.percurso.length - 1;
      if (this.alunoNo >= 0 && T.marco[this.alunoNo] >= 0) k = T.marco[this.alunoNo];
      else if (this.alunoNo < 0) k = T.eventos.length;
      if (ultimo && T.final.status === 'OK') k = Math.max(k, T.marco[T.alvo] >= 0 ? T.marco[T.alvo] : T.eventos.length);
    } else k = T.eventos.length;
    this._vaiPara(k, forca);
  };
  P._teclado = function (e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.target.closest && e.target.closest('.ev-menu')) return;
    var i = VELOCIDADES.indexOf(this.vel);
    if (e.target.getAttribute && e.target.getAttribute('role') === 'tab' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var abas = Array.prototype.slice.call(this.t.abas.querySelectorAll('[role="tab"]'));
      var j = abas.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1);
      j = (j + abas.length) % abas.length;
      e.preventDefault(); this._trocaAba(abas[j].getAttribute('data-aba'), true); return;
    }
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); this._controle('play'); }
    else if (e.key === 'ArrowRight' && e.target.type !== 'range') { e.preventDefault(); this._controle('avancar'); }
    else if (e.key === 'ArrowLeft' && e.target.type !== 'range') { e.preventDefault(); this._controle('voltar'); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); this.setVelocidade(VELOCIDADES[Math.min(VELOCIDADES.length - 1, i + 1)]); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.setVelocidade(VELOCIDADES[Math.max(0, i - 1)]); }
    else if (e.key === 'End') { e.preventDefault(); this._controle('fim'); }
    else if (e.key === 'Home') { e.preventDefault(); this._controle('inicio'); }
  };

  // ------------------------------------------------------------------ aluno
  P._calculaAluno = function () {
    var T = this.T;
    this.alunoNo = -1; this.trilha = null;
    if (!T || !this.percurso || !this.percurso.length) return;
    var p = this.percurso[this.idx];
    this.alunoNo = p ? T.indice(p.estado) : -1;
    // rastro até idx: segmentos [nó, cor] (cor = última chave coletada)
    var nos = [], ult = '', ant = '';
    for (var i = 0; i <= this.idx && i < this.percurso.length; i++) {
      var q = this.percurso[i], ch = q.chaves || '';
      if (ch.length > ant.length) { for (var c = 0; c < ch.length; c++) if (ant.indexOf(ch[c]) < 0) ult = ch[c]; }
      ant = ch;
      nos.push([T.indice(q.estado), corRastro(ch, ult)]);
    }
    this.trilha = nos;
    this.alunoChaves = ant;
  };

  // ------------------------------------------------------------------ layout em camadas
  P._fazLayout = function () {
    var T = this.T, mapa = this.mapa, grade = mapa.grade || [], R = grade.length, C = R ? grade[0].length : 0;
    var cel = 32, camadas = [], idxCamada = {}, i;
    var ordemCam = mapa.camadas ? Object.keys(mapa.camadas) : [];
    ordemCam.forEach(function (k) { idxCamada[k] = camadas.length; camadas.push(k); });
    for (i = 0; i < T.n; i++) {
      var e = T.estados[i]; if (!e) continue;
      var k = e.chaves || '-';
      if (idxCamada[k] === undefined) { idxCamada[k] = camadas.length; camadas.push(k); }
    }
    if (!camadas.length) camadas.push('-');
    // grupos (camada, casa) → variantes de bônus
    var grupos = {};
    for (i = 0; i < T.n; i++) {
      var s = T.estados[i]; if (!s) continue;
      var g = (s.chaves || '-') + '|' + s.linha + ',' + s.coluna;
      (grupos[g] = grupos[g] || []).push(i);
    }
    var x = new Float32Array(T.n), y = new Float32Array(T.n), raio = new Float32Array(T.n), cam = new Int16Array(T.n).fill(-1);
    var painel = { w: C * cel, h: R * cel };
    this.layout = { T: T, mapa: mapa, cel: cel, R: R, C: C, camadas: camadas, idxCamada: idxCamada, x: x, y: y, raio: raio, cam: cam, painel: painel, grupos: grupos };
    this._arranjo();
  };
  // escolhe quantas colunas de painéis cabem melhor no palco e posiciona nós
  P._arranjo = function () {
    var L = this.layout, T = this.T; if (!L) return;
    var cel = L.cel, nL = L.camadas.length, pw = L.painel.w, ph = L.painel.h;
    var W = this.W || 600, H = this.H || 400, melhor = 1, melhorS = 0, melhorGY = cel * 1.9, melhorTopo = cel * 1.2;
    var gapX = cel * 1.6;
    for (var nc = 1; nc <= nL; nc++) {
      // a etiqueta da camada tem tamanho fixo na tela: o espaço entre linhas de painéis cresce quando o zoom é pequeno
      var nr = Math.ceil(nL / nc), gy = cel * 1.9, topo = cel * 1.2, s = 1;
      for (var it = 0; it < 3; it++) {
        var tw = nc * pw + (nc - 1) * gapX + cel * 3.2, th = nr * ph + (nr - 1) * gy + topo + cel * 0.3;
        s = Math.min((W - 28 - ZOOM_W) / tw, (H - 28) / th);
        gy = Math.max(cel * 1.9, 24 / s); topo = Math.max(cel * 1.2, 20 / s);
      }
      if (s > melhorS * 1.02) { melhorS = s; melhor = nc; melhorGY = gy; melhorTopo = topo; }
    }
    var gapY = melhorGY;
    L.nc = melhor; L.nr = Math.ceil(nL / melhor);
    L.origem = [];
    for (var q = 0; q < nL; q++) L.origem.push([(q % melhor) * (pw + gapX), Math.floor(q / melhor) * (ph + gapY) + melhorTopo]);
    var gx = 0, gy = 0, gn = 0;
    for (var g in L.grupos) {
      var lista = L.grupos[g];
      lista.sort(function (a, b) { return String(T.estados[a].bonus) < String(T.estados[b].bonus) ? -1 : 1; });
      for (var j = 0; j < lista.length; j++) {
        var v = lista[j], e = T.estados[v], ci = L.idxCamada[e.chaves || '-'], o = L.origem[ci];
        var cx = o[0] + (e.coluna + 0.5) * cel, cy = o[1] + (e.linha + 0.5) * cel;
        if (lista.length > 1) {
          var ang = -Math.PI / 2 + j * 2 * Math.PI / lista.length, rr = cel * (lista.length > 4 ? 0.3 : 0.24);
          cx += Math.cos(ang) * rr; cy += Math.sin(ang) * rr;
          L.raio[v] = cel * (lista.length > 4 ? 0.15 : 0.2);
        } else L.raio[v] = cel * 0.36;
        L.x[v] = cx; L.y[v] = cy; L.cam[v] = ci;
        var casa = this.mapa.grade[e.linha] && this.mapa.grade[e.linha][e.coluna];
        if (casa === 'G') { gx += cx; gy += cy; gn++; }
      }
    }
    var larg = L.nc * pw + (L.nc - 1) * gapX, alt = L.nr * ph + (L.nr - 1) * gapY + melhorTopo;
    if (T.alvo >= 0) {
      L.x[T.alvo] = larg + cel * 1.9; L.y[T.alvo] = gn ? gy / gn : alt / 2; L.raio[T.alvo] = cel * 0.48; L.cam[T.alvo] = -1;
    }
    L.mundo = { x0: -cel * 0.4, y0: 0, x1: larg + (T.alvo >= 0 ? cel * 3 : cel * 0.4), y1: alt + cel * 0.3 };
    // índice espacial para o hover
    var hash = {};
    for (var v2 = 0; v2 < T.n; v2++) { var hk = Math.floor(L.x[v2] / cel) + ',' + Math.floor(L.y[v2] / cel); (hash[hk] = hash[hk] || []).push(v2); }
    L.hash = hash;
  };

  // ------------------------------------------------------------------ câmera
  P._redimensiona = function () {
    var p = this.r.palco, dpr = Math.min(2.5, raiz.devicePixelRatio || 1);
    var W = Math.max(50, p.clientWidth), H = Math.max(50, p.clientHeight);
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    var mudouAspecto = this.W && Math.abs(W / H - this.W / this.H) > 0.25;
    this.W = W; this.H = H; this.dpr = dpr;
    [this.cv, this.cv2].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; });
    if (this.layout && (mudouAspecto || !this._usuarioMexeu)) { this._arranjo(); }
    if (!this._usuarioMexeu) this._ajusta(false);
    this._pede();
  };
  P._ajusta = function (anima) {
    var L = this.layout; if (!L) return;
    // [IA] Claude – a barra de zoom (canto direito) não cobre o grafo: o "ajustar" desconta a largura dela
    var m = L.mundo, pad = 14, zw = ZOOM_W, s = Math.min((this.W - pad * 2 - zw) / (m.x1 - m.x0), (this.H - pad * 2) / (m.y1 - m.y0));
    var alvo = { s: s, x: (this.W - zw) / 2 - s * (m.x0 + m.x1) / 2, y: this.H / 2 - s * (m.y0 + m.y1) / 2 };
    this._panPara(alvo, anima);
    this.sFit = s;
  };
  P._panPara = function (alvo, anima) {
    var self = this;
    cancelAnimationFrame(this._rafPan);
    if (!anima || this.reduzido) { this.view = alvo; this._pede(); return; }
    var de = { s: this.view.s, x: this.view.x, y: this.view.y }, t0 = performance.now(), dur = 420;
    var f = function (t) {
      var u = suave((t - t0) / dur);
      // interpola no espaço do mundo (centro da tela) para não "escorregar" ao mudar o zoom
      var s = Math.exp(lerp(Math.log(de.s), Math.log(alvo.s), u));
      var c0x = (self.W / 2 - de.x) / de.s, c0y = (self.H / 2 - de.y) / de.s, c1x = (self.W / 2 - alvo.x) / alvo.s, c1y = (self.H / 2 - alvo.y) / alvo.s;
      var cx = lerp(c0x, c1x, u), cy = lerp(c0y, c1y, u);
      self.view = { s: s, x: self.W / 2 - cx * s, y: self.H / 2 - cy * s };
      self._pede();
      if (u < 1) self._rafPan = requestAnimationFrame(f);
    };
    this._rafPan = requestAnimationFrame(f);
  };
  P._zoomEm = function (f, px, py) {
    if (px === undefined) { px = this.W / 2; py = this.H / 2; }
    var v = this.view, s = Math.max((this.sFit || 0.1) * 0.6, Math.min(8, v.s * f));
    var wx = (px - v.x) / v.s, wy = (py - v.y) / v.s;
    this.view = { s: s, x: px - wx * s, y: py - wy * s };
    this._usuarioMexeu = true;
    this._pede();
  };
  P._centraAluno = function (aproxima, anima) {
    var L = this.layout, v = this.alunoNo; if (!L || v < 0) return;
    var s = this.view.s;
    // zoom mínimo para ler os valores dentro dos círculos (raio ≥ 11 px)
    if (aproxima && L.raio[v] * s < 11) s = Math.min(8, 11 / (L.raio[v] || 10));
    var alvo = { s: s, x: this.W / 2 - L.x[v] * s, y: this.H / 2 - L.y[v] * s };
    if (!aproxima) {
      // seguindo: só move se o aluno sair da área central (evita tremer a cada passo)
      var sx = L.x[v] * s + this.view.x, sy = L.y[v] * s + this.view.y;
      if (sx > this.W * 0.22 && sx < this.W * 0.78 && sy > this.H * 0.22 && sy < this.H * 0.78) return;
      // no zoom "ver tudo" o aluno já está à vista
      if (!this._usuarioMexeu) return;
    }
    if (aproxima) this._usuarioMexeu = true;
    this._panPara(alvo, anima);
  };

  // ------------------------------------------------------------------ interação com o canvas
  P._interacaoCanvas = function () {
    var self = this, palco = this.r.palco, ponteiros = {}, arrasto = null, pinca = null;
    this._escuta(palco, 'wheel', function (e) {
      e.preventDefault();
      var r = palco.getBoundingClientRect();
      self._zoomEm(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    this._escuta(palco, 'pointerdown', function (e) {
      if (e.target.closest('button')) return;
      palco.setPointerCapture(e.pointerId);
      ponteiros[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(ponteiros);
      if (ids.length === 1) arrasto = { x: e.clientX, y: e.clientY, vx: self.view.x, vy: self.view.y, moveu: false };
      else if (ids.length === 2) {
        var a = ponteiros[ids[0]], b = ponteiros[ids[1]];
        pinca = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: self.view.s }; arrasto = null;
      }
    });
    this._escuta(palco, 'pointermove', function (e) {
      var r = palco.getBoundingClientRect();
      if (ponteiros[e.pointerId]) ponteiros[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(ponteiros);
      if (pinca && ids.length === 2) {
        var a = ponteiros[ids[0]], b = ponteiros[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        self._zoomEm((pinca.s * d / pinca.d) / self.view.s, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        return;
      }
      if (arrasto) {
        var dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) arrasto.moveu = true;
        if (arrasto.moveu) {
          cancelAnimationFrame(self._rafPan);
          self.view = { s: self.view.s, x: arrasto.vx + dx, y: arrasto.vy + dy };
          self._usuarioMexeu = true; palco.classList.add('ev-arrastando');
          self._pede(); self._dica(-1);
        }
        return;
      }
      self._hover(e.clientX - r.left, e.clientY - r.top);
    });
    var solta = function (e) {
      delete ponteiros[e.pointerId];
      if (Object.keys(ponteiros).length < 2) pinca = null;
      if (arrasto && !arrasto.moveu && e.type === 'pointerup') { var r = palco.getBoundingClientRect(); self._hover(e.clientX - r.left, e.clientY - r.top, true); }
      arrasto = null; palco.classList.remove('ev-arrastando');
    };
    this._escuta(palco, 'pointerup', solta);
    this._escuta(palco, 'pointercancel', solta);
    this._escuta(palco, 'pointerleave', function () { if (!arrasto) self._dica(-1); });
    this._escuta(palco, 'keydown', function (e) {
      var passo = 40;
      if (e.key === '+' || e.key === '=') self._zoomEm(1.25);
      else if (e.key === '-') self._zoomEm(0.8);
      else if (e.key === 'ArrowLeft') self.view.x += passo;
      else if (e.key === 'ArrowRight') self.view.x -= passo;
      else if (e.key === 'ArrowUp') self.view.y += passo;
      else if (e.key === 'ArrowDown') self.view.y -= passo;
      else if (e.key === '0') { self._usuarioMexeu = false; self._ajusta(true); return; }
      else if (e.key === 'c' || e.key === 'C') { self._centraAluno(true, true); return; }
      else return;
      e.preventDefault(); self._usuarioMexeu = true; self._pede();
    });
  };
  P._noEm = function (sx, sy) {
    var L = this.layout; if (!L) return -1;
    var v = this.view, wx = (sx - v.x) / v.s, wy = (sy - v.y) / v.s, cel = L.cel;
    var cx = Math.floor(wx / cel), cy = Math.floor(wy / cel), melhor = -1, md = Infinity;
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
      var l = L.hash[(cx + dx) + ',' + (cy + dy)]; if (!l) continue;
      for (var i = 0; i < l.length; i++) {
        var n = l[i], d = Math.hypot(L.x[n] - wx, L.y[n] - wy), lim = Math.max(L.raio[n], 6 / v.s) * 1.15;
        if (d < lim && d < md) { md = d; melhor = n; }
      }
    }
    return melhor;
  };
  P._hover = function (sx, sy, clique) {
    var n = this._noEm(sx, sy);
    this._dica(n, sx, sy);
    void clique;
  };
  P._dica = function (n, sx, sy) {
    var d = this.r.dica;
    if (this._hoverNo !== n) { this._hoverNo = n; this._pedeOverlay(); }
    if (n < 0 || !this.T || !this.st) { d.hidden = true; return; }
    var T = this.T, st = this.st, a = T.algoritmo, e = st.estado[n], html = [];
    html.push('<b class="ev-dica-rot">' + esc(T.rotulos[n]) + '</b>');
    html.push('<span>' + (NOME_ESTADO[a] || NOME_ESTADO.BFS)[e] + (n === T.inicio ? ', origem' : '') + (n === this.alunoNo ? ', o aluno está aqui' : '') + '</span>');
    if (a === 'DFS') html.push('<span>d/f = ' + (st.d[n] >= 0 ? st.d[n] : '–') + '/' + (st.f[n] >= 0 ? st.f[n] : '–') + '</span>');
    else if (a === 'BFS') html.push('<span>d(v) = ' + (st.d[n] >= 0 && st.estado[n] ? st.d[n] : '∞') + '</span>');
    else html.push('<span>d[v] = ' + num(st.d[n]) + '</span>');
    html.push('<span>p(v) = ' + (st.p[n] >= 0 ? esc(T.curto(st.p[n])) : '–') + '</span>');
    var cam = T.estados[n] ? nomeCamada(T.estados[n].chaves) : 'nó virtual de chegada';
    html.push('<span class="ev-dica-cam">' + cam + '</span>');
    d.innerHTML = html.join('');
    d.hidden = false;
    var w = d.offsetWidth, h = d.offsetHeight;
    d.style.left = Math.max(4, Math.min(this.W - w - 4, sx + 14)) + 'px';
    d.style.top = Math.max(4, Math.min(this.H - h - 4, sy - h - 10)) + 'px';
  };

  // ------------------------------------------------------------------ desenho
  P._pede = function () {
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () { self._raf = 0; self._desenha(); });
    this._pedeOverlay();
  };
  P._pedeOverlay = function () {
    var self = this;
    if (this._rafOverlay) return;
    this._rafOverlay = requestAnimationFrame(function f(t) {
      self._rafOverlay = 0;
      self._desenhaOverlay(t);
      // pulso contínuo do anel do aluno (não com movimento reduzido)
      if (!self.reduzido && self.alunoNo >= 0 && !self._mort) self._rafOverlay = requestAnimationFrame(f);
    });
  };

  P._corDoEstado = function (e) { return e === 2 ? COR.encerrado : e === 1 ? COR.visitado : COR.naoVisitado; };

  P._desenha = function () {
    var ctx = this.ctx, dpr = this.dpr, W = this.W, H = this.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var L = this.layout, T = this.T, st = this.st;
    if (!L || !T || !st) return;
    var v = this.view, s = v.s, i, n, u;
    var vis = { x0: -v.x / s - L.cel, y0: -v.y / s - L.cel, x1: (W - v.x) / s + L.cel, y1: (H - v.y) / s + L.cel };
    var dentro = function (k) { return L.x[k] >= vis.x0 && L.x[k] <= vis.x1 && L.y[k] >= vis.y0 && L.y[k] <= vis.y1; };
    ctx.save();
    ctx.translate(v.x, v.y); ctx.scale(s, s);
    this._desenhaPaineis(ctx, vis);

    var px = 1 / s, rTela = L.cel * 0.36 * s;
    var mostraSeta = rTela >= 5, mostraPeso = rTela >= 7;
    // ---- arcos base (um path só)
    var curva = function (a, b, k) { // ponto de controle: arco levemente curvado para a direita
      var x1 = L.x[a], y1 = L.y[a], x2 = L.x[b], y2 = L.y[b], dx = x2 - x1, dy = y2 - y1;
      return [x1, y1, (x1 + x2) / 2 - dy * k, (y1 + y2) / 2 + dx * k, x2, y2];
    };
    var arcosVisiveis = [];
    for (u = 0; u < T.n; u++) {
      var lu = T.adj[u], du = dentro(u);
      for (i = 0; i < lu.length; i++) {
        n = lu[i].para;
        if (!du && !dentro(n)) {
          // arco longo (camadas/ALVO) pode cruzar a tela: confere a caixa
          var bx0 = Math.min(L.x[u], L.x[n]), bx1 = Math.max(L.x[u], L.x[n]), by0 = Math.min(L.y[u], L.y[n]), by1 = Math.max(L.y[u], L.y[n]);
          if (bx1 < vis.x0 || bx0 > vis.x1 || by1 < vis.y0 || by0 > vis.y1) continue;
        }
        arcosVisiveis.push(u, i);
      }
    }
    var tipoArco = function (a, b) { // 0 = mesma camada; 1 = troca de camada (pegou chave); 2 = para o ALVO
      if (b === T.alvo) return 2;
      return L.cam[a] !== L.cam[b] ? 1 : 0;
    };
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (i = 0; i < arcosVisiveis.length; i += 2) {
      u = arcosVisiveis[i]; n = T.adj[u][arcosVisiveis[i + 1]].para;
      if (tipoArco(u, n) !== 0) continue;
      var c = curva(u, n, 0.14); ctx.moveTo(c[0], c[1]); ctx.quadraticCurveTo(c[2], c[3], c[4], c[5]);
    }
    ctx.strokeStyle = COR.arco; ctx.lineWidth = Math.max(0.6 * px, Math.min(1.4, 1.1 * px)); ctx.stroke();
    // troca de camada: conectores curvos na cor da chave pega
    for (i = 0; i < arcosVisiveis.length; i += 2) {
      u = arcosVisiveis[i]; var arc = T.adj[u][arcosVisiveis[i + 1]]; n = arc.para;
      var tp = tipoArco(u, n); if (!tp) continue;
      ctx.beginPath();
      var cc = curva(u, n, tp === 1 ? 0.22 : 0.08);
      ctx.moveTo(cc[0], cc[1]); ctx.quadraticCurveTo(cc[2], cc[3], cc[4], cc[5]);
      if (tp === 1) { ctx.strokeStyle = COR.chave[arc.casa] || COR.visitado; ctx.globalAlpha = 0.75; ctx.setLineDash([]); ctx.lineWidth = Math.max(1.2 * px, 1.6); }
      else { ctx.strokeStyle = COR.tintaFraca; ctx.globalAlpha = 0.6; ctx.setLineDash([4 * px, 4 * px]); ctx.lineWidth = Math.max(1 * px, 1); }
      ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
    // pontas de seta (só com zoom)
    if (mostraSeta) {
      ctx.beginPath();
      for (i = 0; i < arcosVisiveis.length; i += 2) {
        u = arcosVisiveis[i]; n = T.adj[u][arcosVisiveis[i + 1]].para;
        if (tipoArco(u, n)) continue;
        this._seta(ctx, curva(u, n, 0.14), L.raio[n], 4.2 * Math.max(px, 0.55));
      }
      ctx.fillStyle = COR.arco; ctx.fill();
    }

    // ---- destaques do algoritmo
    var a = T.algoritmo, self = this;
    var traca = function (lista, cor, larg, tracejado, comSeta) {
      if (!lista.length) return;
      ctx.beginPath();
      for (var q = 0; q < lista.length; q += 2) { var cv = curva(lista[q], lista[q + 1], 0.14); ctx.moveTo(cv[0], cv[1]); ctx.quadraticCurveTo(cv[2], cv[3], cv[4], cv[5]); }
      ctx.strokeStyle = cor; ctx.lineWidth = larg; ctx.setLineDash(tracejado ? [5 * px, 4 * px] : []); ctx.stroke(); ctx.setLineDash([]);
      if (comSeta && mostraSeta) {
        ctx.beginPath();
        for (q = 0; q < lista.length; q += 2) self._seta(ctx, curva(lista[q], lista[q + 1], 0.14), L.raio[lista[q + 1]], 5 * Math.max(px, 0.55));
        ctx.fillStyle = cor; ctx.fill();
      }
    };
    var largForte = Math.max(2.2 * px, Math.min(3.2, 2.6 * px));
    if (a === 'DFS') {
      // arcos classificados até o evento k, coloridos por classe
      var porTipo = { arvore: [], retorno: [], avanco: [], cruzamento: [] }, arcos = T.res.arcos, nOlha = this._nOlhaAte(st.k);
      for (i = 0; i < nOlha; i++) { var ar = arcos[i]; if (dentro(ar[0]) || dentro(ar[1])) porTipo[ar[2]].push(ar[0], ar[1]); }
      traca(porTipo.cruzamento, COR.cruzamento, largForte * 0.8, true, true);
      traca(porTipo.avanco, COR.avanco, largForte * 0.8, true, true);
      traca(porTipo.retorno, COR.retorno, largForte * 0.8, true, true);
      traca(porTipo.arvore, COR.arvore, largForte, false, true);
    } else if (!(T.res.recusa)) {
      var arvore = [];
      for (n = 0; n < T.n; n++) { var pn = st.p[n]; if (pn >= 0 && (dentro(n) || dentro(pn))) arvore.push(pn, n); }
      traca(arvore, COR.arcoForte, largForte, false, true);
    }
    if (T.res.recusa) { // arcos negativos que fazem o Dijkstra recusar
      var neg = [];
      T.res.recusa.negativos.forEach(function (x) { neg.push(x[0], x[1]); });
      traca(neg, COR.erro, largForte * 1.2, false, true);
    }
    if (st.ciclo) {
      var cic = [];
      for (i = 0; i + 1 < st.ciclo.length; i++) cic.push(st.ciclo[i], st.ciclo[i + 1]);
      traca(cic, COR.erro, largForte * 1.5, false, true);
    }
    if (st.olhando) traca([st.olhando[0], st.olhando[1]], COR.cesar, largForte * 1.25, false, true);

    // ---- rastro do aluno (cores das chaves)
    if (this.trilha && this.trilha.length > 1) {
      ctx.lineJoin = 'round';
      for (i = 1; i < this.trilha.length; i++) {
        var p0 = this.trilha[i - 1][0], p1 = this.trilha[i][0]; if (p0 < 0 || p1 < 0) continue;
        ctx.beginPath(); ctx.moveTo(L.x[p0], L.y[p0]); ctx.lineTo(L.x[p1], L.y[p1]);
        ctx.strokeStyle = this.trilha[i][1]; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(5 * px, L.cel * 0.22); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // pesos ≠ 1 (só com zoom)
    if (mostraPeso) {
      ctx.font = '600 ' + (10.5 * Math.max(px, 0.45)) + 'px ' + this._fonte('texto');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (i = 0; i < arcosVisiveis.length; i += 2) {
        u = arcosVisiveis[i]; var aa = T.adj[u][arcosVisiveis[i + 1]]; n = aa.para;
        if (aa.peso === 1) continue;
        var cp = curva(u, n, n === T.alvo ? 0.08 : (L.cam[u] !== L.cam[n] ? 0.22 : 0.14));
        var mx = 0.25 * cp[0] + 0.5 * cp[2] + 0.25 * cp[4], my = 0.25 * cp[1] + 0.5 * cp[3] + 0.25 * cp[5];
        var txt = num(aa.peso), tw = ctx.measureText(txt).width + 4 * Math.max(px, 0.45);
        ctx.fillStyle = 'rgba(243,245,250,0.92)'; ctx.fillRect(mx - tw / 2, my - 6.5 * Math.max(px, 0.45), tw, 13 * Math.max(px, 0.45));
        ctx.fillStyle = aa.peso < 0 ? COR.erro : COR.tintaFraca; ctx.fillText(txt, mx, my);
      }
    }

    // ---- nós (agrupados por cor; os que estão em transição pintados um a um)
    var agora = performance.now(), an = this.anim, animando = false;
    if (an && agora - an.t0 > an.dur) { this.anim = an = null; }
    var lotes = [[], [], []], soltos = [];
    for (n = 0; n < T.n; n++) {
      if (!dentro(n)) continue;
      if (an && an.de[n] !== undefined) soltos.push(n); else lotes[st.estado[n]].push(n);
    }
    var bolinha = function (k) { ctx.moveTo(L.x[k] + L.raio[k], L.y[k]); ctx.arc(L.x[k], L.y[k], L.raio[k], 0, Math.PI * 2); };
    var borda = Math.max(0.8 * px, Math.min(1.5, 1.2 * px));
    for (var e = 0; e < 3; e++) {
      if (!lotes[e].length) continue;
      ctx.beginPath(); lotes[e].forEach(bolinha);
      ctx.fillStyle = this._corDoEstado(e); ctx.fill();
      ctx.strokeStyle = e === 0 ? '#AEB3C6' : COR.tinta; ctx.lineWidth = borda; ctx.stroke();
    }
    if (soltos.length) {
      animando = true;
      var tt = suave((agora - an.t0) / an.dur);
      soltos.forEach(function (k) {
        ctx.beginPath(); bolinha(k);
        ctx.fillStyle = mistura(self._corDoEstado(an.de[k]), self._corDoEstado(st.estado[k]), tt); ctx.fill();
        ctx.strokeStyle = COR.tinta; ctx.lineWidth = borda; ctx.stroke();
      });
    }
    // anel do vértice "atual" do algoritmo
    if (st.atual >= 0 && st.atual < T.n) {
      ctx.beginPath(); ctx.arc(L.x[st.atual], L.y[st.atual], L.raio[st.atual] + 3.5 * Math.max(px, 0.5), 0, Math.PI * 2);
      ctx.strokeStyle = COR.cesar; ctx.lineWidth = 2 * Math.max(px, 0.5); ctx.setLineDash([3 * Math.max(px, 0.5), 2.5 * Math.max(px, 0.5)]); ctx.stroke(); ctx.setLineDash([]);
    }
    // ciclo negativo: anel vermelho
    if (st.ciclo) {
      ctx.beginPath(); st.ciclo.forEach(function (k) { ctx.moveTo(L.x[k] + L.raio[k] + 3 * px, L.y[k]); ctx.arc(L.x[k], L.y[k], L.raio[k] + 3 * px, 0, Math.PI * 2); });
      ctx.strokeStyle = COR.erro; ctx.lineWidth = 2.2 * px; ctx.stroke();
    }

    // ---- rótulos (LOD: só quando o raio na tela ≥ 9 px)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var fPix = this._fonte('pixel');
    var colTab = this.tab && this.tab.celula ? (st.coluna || 0) : -1;
    for (n = 0; n < T.n; n++) {
      if (!dentro(n)) continue;
      var rt = L.raio[n] * s; if (rt < 9) continue;
      var est = st.estado[n], txtIn = '';
      if (a === 'DFS') txtIn = st.d[n] >= 0 ? String(st.d[n]) : '';
      else if (a === 'BFS') txtIn = est ? String(st.d[n]) : '∞';
      else txtIn = num(st.d[n]);
      if (n === T.alvo && rt < 14) txtIn = '';
      ctx.font = '600 ' + Math.min(L.raio[n] * 0.95, (txtIn.length > 3 ? 0.62 : 0.85) * L.raio[n]) + 'px ' + fPix;
      ctx.fillStyle = est === 0 ? COR.tintaFraca : '#FFFFFF';
      if (txtIn) ctx.fillText(txtIn, L.x[n], L.y[n] + L.raio[n] * 0.04);
      // DFS: d/f ao lado (acima) do nó, como no slide
      if (a === 'DFS' && est > 0 && rt >= 15) {
        ctx.font = '600 ' + (L.raio[n] * 0.62) + 'px ' + fPix; ctx.fillStyle = COR.tinta;
        ctx.fillText(st.d[n] + '/' + (st.f[n] >= 0 ? st.f[n] : ''), L.x[n], L.y[n] - L.raio[n] * 1.55);
      }
      // Bellman-Ford: valor antigo riscado ao lado do novo, na passada em que melhorou
      if (a === 'BELLMAN_FORD' && colTab > 0 && rt >= 11) {
        var cel = this.tab.celula(n, colTab, st.k);
        if (cel && cel.riscados && cel.riscados.length) {
          var velho = num(cel.riscados[cel.riscados.length - 1]);
          ctx.font = '500 ' + (L.raio[n] * 0.6) + 'px ' + fPix; ctx.fillStyle = COR.tintaFraca;
          var ox = L.x[n] + L.raio[n] * 1.05, oy = L.y[n] - L.raio[n] * 1.05, w2 = ctx.measureText(velho).width;
          ctx.textAlign = 'left'; ctx.fillText(velho, ox, oy);
          ctx.beginPath(); ctx.moveTo(ox - 1 * px, oy + L.raio[n] * 0.18); ctx.lineTo(ox + w2 + 1 * px, oy - L.raio[n] * 0.18);
          ctx.strokeStyle = COR.erro; ctx.lineWidth = 1.4 * px; ctx.stroke(); ctx.textAlign = 'center';
        }
      }
    }
    // ALVO: rótulo sempre que couber
    if (T.alvo >= 0 && dentro(T.alvo)) {
      ctx.font = '700 ' + Math.max(11 * px, L.cel * 0.34) + 'px ' + fPix; ctx.fillStyle = COR.tinta;
      ctx.fillText('ALVO', L.x[T.alvo], L.y[T.alvo] + L.raio[T.alvo] + Math.max(10 * px, L.cel * 0.3));
    }
    ctx.restore();
    if (animando) this._pede();
  };

  // nº de arcos olhados pela DFS até o evento k (busca binária nos índices dos eventos 'olha')
  P._nOlhaAte = function (k) {
    var T = this.T;
    if (!T._olhaIdx) { var l = []; T.eventos.forEach(function (e, i) { if (e.t === 'olha') l.push(i); }); T._olhaIdx = l; }
    var a = 0, b = T._olhaIdx.length; while (a < b) { var m = (a + b) >> 1; if (T._olhaIdx[m] < k) a = m + 1; else b = m; }
    return a;
  };

  P._seta = function (ctx, c, raioDestino, tam) {
    // tangente no fim da quadrática: (P2 - P1); recua até a borda do círculo
    var tx = c[4] - c[2], ty = c[5] - c[3], l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    var bx = c[4] - tx * raioDestino, by = c[5] - ty * raioDestino;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - tx * tam * 1.6 - ty * tam * 0.75, by - ty * tam * 1.6 + tx * tam * 0.75);
    ctx.lineTo(bx - tx * tam * 1.6 + ty * tam * 0.75, by - ty * tam * 1.6 - tx * tam * 0.75);
    ctx.closePath();
  };

  P._fonte = function (q) {
    if (!this._fontes) {
      var cs = raiz.getComputedStyle ? raiz.getComputedStyle(this.cardMapa) : null;
      var fp = cs && cs.getPropertyValue('--f-pixel').trim(), ft = cs && cs.getPropertyValue('--f-texto').trim();
      this._fontes = { pixel: fp || '"Pixelify Sans", "DM Sans", sans-serif', texto: ft || '"DM Sans", system-ui, sans-serif' };
    }
    return this._fontes[q];
  };

  // painéis: um "fantasma" do labirinto por camada, com o nome da camada
  P._desenhaPaineis = function (ctx, vis) {
    var L = this.layout, grade = this.mapa.grade, cel = L.cel, s = this.view.s, px = 1 / s;
    var camCasas = this._casasPorCamada();
    for (var q = 0; q < L.camadas.length; q++) {
      var o = L.origem[q], ox = o[0], oy = o[1];
      if (ox > vis.x1 || oy > vis.y1 || ox + L.painel.w < vis.x0 || oy + L.painel.h < vis.y0) continue;
      // folha
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillRect(ox, oy, L.painel.w, L.painel.h);
      var existe = camCasas[L.camadas[q]] || {};
      for (var r = 0; r < L.R; r++) {
        var y = oy + r * cel; if (y > vis.y1 || y + cel < vis.y0) continue;
        for (var c = 0; c < L.C; c++) {
          var x = ox + c * cel, ch = grade[r][c];
          if (ch === '#') { ctx.fillStyle = 'rgba(28,27,41,0.10)'; ctx.fillRect(x, y, cel, cel); continue; }
          var tint = null;
          if (ch === '~') tint = 'rgba(53,150,240,0.13)';
          else if (ch === ',') tint = 'rgba(140,95,60,0.13)';
          else if ('^>v<'.indexOf(ch) >= 0) tint = 'rgba(28,27,41,0.05)';
          if (!existe[r * L.C + c]) tint = 'rgba(28,27,41,0.035)';
          if (tint) { ctx.fillStyle = tint; ctx.fillRect(x, y, cel, cel); }
          if (s * cel < 6) continue;
          if ('ABCD'.indexOf(ch) >= 0) { ctx.fillStyle = COR.chave[ch.toLowerCase()]; ctx.globalAlpha = 0.55; ctx.fillRect(x + cel * 0.08, y + cel * 0.08, cel * 0.84, cel * 0.84); ctx.globalAlpha = 1; }
          else if ('abcd'.indexOf(ch) >= 0) { ctx.fillStyle = COR.chave[ch]; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x + cel / 2, y + cel * 0.1); ctx.lineTo(x + cel * 0.9, y + cel / 2); ctx.lineTo(x + cel / 2, y + cel * 0.9); ctx.lineTo(x + cel * 0.1, y + cel / 2); ctx.fill(); ctx.globalAlpha = 1; }
          else if (ch === 'G') { ctx.fillStyle = 'rgba(233,174,60,0.45)'; ctx.fillRect(x + cel * 0.1, y + cel * 0.22, cel * 0.8, cel * 0.6); }
          else if (ch === 'S') { ctx.strokeStyle = 'rgba(255,96,2,0.6)'; ctx.lineWidth = cel * 0.08; ctx.strokeRect(x + cel * 0.1, y + cel * 0.1, cel * 0.8, cel * 0.8); }
          else if (ch === '+' || ch === '*') { ctx.fillStyle = ch === '+' ? 'rgba(46,158,107,0.28)' : 'rgba(233,174,60,0.32)'; ctx.fillRect(x + cel * 0.12, y + cel * 0.12, cel * 0.76, cel * 0.76); }
        }
      }
      ctx.strokeStyle = 'rgba(28,27,41,0.28)'; ctx.lineWidth = px; ctx.strokeRect(ox, oy, L.painel.w, L.painel.h);
      // etiqueta da camada
      var fs = Math.max(11 * px, Math.min(cel * 0.62, 15 * px));
      ctx.font = '600 ' + fs + 'px ' + this._fonte('texto'); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      var k = L.camadas[q], cor = k === '-' ? COR.tintaFraca : COR.chave[k[k.length - 1]];
      ctx.fillStyle = cor; ctx.fillRect(ox, oy - fs * 1.15, fs * 0.6, fs * 0.6);
      ctx.fillStyle = COR.tinta; ctx.fillText(nomeCamada(k), ox + fs * 0.95, oy - fs * 0.55);
    }
  };
  P._casasPorCamada = function () {
    if (this._ccMapa === this.mapa && this._cc) return this._cc;
    var out = {}, C = (this.mapa.grade[0] || '').length, cams = this.mapa.camadas || {};
    for (var k in cams) { var o = out[k] = {}; cams[k].forEach(function (rc) { o[rc[0] * C + rc[1]] = 1; }); }
    if (!this.mapa.camadas && this.T) { // sem camadas na API: deduz dos estados do traço
      var T = this.T;
      for (var i = 0; i < T.n; i++) { var e = T.estados[i]; if (!e) continue; var kk = e.chaves || '-'; (out[kk] = out[kk] || {})[e.linha * C + e.coluna] = 1; }
    }
    this._cc = out; this._ccMapa = this.mapa;
    return out;
  };

  // overlay: anel pulsante + cabeça do aluno + nó em foco
  P._desenhaOverlay = function (t) {
    var ctx = this.ctx2, dpr = this.dpr, L = this.layout;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (!L || !this.T) return;
    var v = this.view;
    var tela = function (k) { return [L.x[k] * v.s + v.x, L.y[k] * v.s + v.y, L.raio[k] * v.s]; };
    if (this._hoverNo >= 0 && this._hoverNo < this.T.n) {
      var h = tela(this._hoverNo);
      ctx.beginPath(); ctx.arc(h[0], h[1], Math.max(h[2], 3) + 3, 0, Math.PI * 2); ctx.strokeStyle = COR.tinta; ctx.lineWidth = 1.5; ctx.stroke();
    }
    var a = this.alunoNo; if (a < 0) return;
    var p = tela(a), r = Math.max(p[2], 4);
    var pulso = this.reduzido ? 0 : (Math.sin((t || 0) / 260) + 1) / 2;
    ctx.beginPath(); ctx.arc(p[0], p[1], r + 3 + pulso * 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,96,2,' + (0.35 + 0.35 * (1 - pulso)) + ')'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(p[0], p[1], r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = COR.cesar; ctx.lineWidth = 2.5; ctx.stroke();
    // cabeça do aluno (sprite do LAB.pixel, se existir)
    if (!this._cabeca) {
      try { this._cabeca = LAB.pixel && LAB.pixel.studentHead ? LAB.pixel.studentHead(2) : null; } catch (e) { this._cabeca = null; }
      if (!this._cabeca) this._cabeca = 'nada';
    }
    var hs = Math.max(16, Math.min(28, r * 1.6));
    var hx = p[0] - hs / 2, hy = p[1] - r - 6 - hs * 0.82;
    // [IA] Claude – a cabeça não cobre a etiqueta da camada ("sem chave"…): vai para o lado ou para baixo do anel
    var et = this._retEtiqueta(L.cam[a], ctx), bate = function (x, y) { return et && x < et[2] && x + hs > et[0] && y < et[3] && y + hs > et[1]; };
    if (bate(hx, hy)) {
      if (!bate(p[0] + r + 5, p[1] - hs / 2)) { hx = p[0] + r + 5; hy = p[1] - hs / 2; }
      else { hy = p[1] + r + 5; }
    }
    if (this._cabeca !== 'nada') {
      ctx.imageSmoothingEnabled = false;
      var img = this._cabeca, w = hs, hh = hs * img.height / img.width;
      ctx.fillStyle = 'rgba(28,27,41,0.18)'; ctx.fillRect(hx + 1, hy + 2, w, hh);
      ctx.drawImage(img, hx, hy, w, hh);
    } else {
      ctx.beginPath(); ctx.arc(p[0], hy + hs / 2, hs / 2.4, 0, Math.PI * 2); ctx.fillStyle = COR.cesar; ctx.fill();
    }
  };

  // retângulo (tela) da etiqueta da camada q, igual ao desenho em _desenhaGrade
  P._retEtiqueta = function (q, ctx) {
    var L = this.layout, v = this.view; if (!L || q === undefined || q < 0 || !L.origem || !L.origem[q]) return null;
    var fs = Math.max(11, Math.min(L.cel * v.s * 0.62, 15));
    ctx.font = '600 ' + fs + 'px ' + this._fonte('texto');
    var x0 = L.origem[q][0] * v.s + v.x, y1 = L.origem[q][1] * v.s + v.y;
    return [x0 - 2, y1 - fs * 1.3, x0 + fs * 0.95 + ctx.measureText(nomeCamada(L.camadas[q])).width + 2, y1];
  };

  // ------------------------------------------------------------------ legenda do mapa
  P._legenda = function () {
    var a = this.T ? this.T.algoritmo : 'BFS', nomes = NOME_ESTADO[a] || NOME_ESTADO.BFS, itens = [];
    var bola = function (cor, borda) { return '<i class="ev-bola" style="background:' + cor + (borda ? ';box-shadow:inset 0 0 0 1px ' + borda : '') + '"></i>'; };
    var linha = function (cor, trac) { return '<i class="ev-traco' + (trac ? ' ev-traco--trac' : '') + '" style="--c:' + cor + '"></i>'; };
    itens.push(bola(COR.naoVisitado, '#AEB3C6') + nomes[0]);
    itens.push(bola(COR.visitado) + nomes[1]);
    itens.push(bola(COR.encerrado) + nomes[2]);
    if (a === 'DFS') {
      itens.push(linha(COR.arvore) + 'árvore'); itens.push(linha(COR.retorno, 1) + 'retorno');
      itens.push(linha(COR.avanco, 1) + 'avanço'); itens.push(linha(COR.cruzamento, 1) + 'cruzamento');
    } else itens.push(linha(COR.arcoForte) + 'p(v)');
    itens.push(linha(COR.cesar) + 'arco examinado');
    itens.push('<i class="ev-anel"></i>aluno');
    if (this.T && this.T.res.recusa) itens.push(linha(COR.erro) + 'peso negativo');
    if (this.T && this.T.res.cicloNegativo) itens.push(linha(COR.erro) + 'ciclo negativo');
    this.r.legenda.innerHTML = itens.map(function (h) { return '<li>' + h + '</li>'; }).join('');
  };

  // ------------------------------------------------------------------ tabelas
  // nome compacto do vértice: (3,4) com chaves em sobrescrito e bônus em subscrito; ALVO como "ALVO"
  P._nome = function (i, extra) {
    var T = this.T;
    if (i < 0 || i === undefined) return '<span class="ev-v">–</span>';
    var e = T.estados[i];
    var cls = 'ev-v' + (i === this.alunoNo ? ' ev-v--aluno' : '') + (extra ? ' ' + extra : '');
    if (!e) return '<span class="' + cls + ' ev-v--alvo">ALVO</span>';
    return '<span class="' + cls + '" title="' + esc(T.rotulos[i]) + '">(' + e.linha + ',' + e.coluna + ')' +
      (e.chaves ? '<sup>' + e.chaves + '</sup>' : '') + (e.bonus.length ? '<sub>' + e.bonus.join(',') + '</sub>' : '') + '</span>';
  };
  P._lista = function (ids, max, sep) {
    var self = this; sep = sep || ' ';
    if (ids.length <= max) return ids.map(function (i) { return self._nome(i); }).join(sep);
    return ids.slice(0, max).map(function (i) { return self._nome(i); }).join(sep) + sep + '<span class="ev-mais">+' + (ids.length - max).toLocaleString('pt-BR') + '</span>';
  };

  P._renderTabela = function () {
    var T = this.T, st = this.st;
    this._virtual = null;
    if (!T || !st) return;
    var corpo = this.t.corpo, a = T.algoritmo, html;
    if (a === 'BFS') html = this._tabBFS();
    else if (a === 'DFS') html = this._tabDFS();
    else if (T.res.recusa) html = this._tabRecusa();
    else html = this._tabColunas();
    corpo.innerHTML = html;
    if (this._depois) { var f = this._depois; this._depois = null; f.call(this); }
    this._rodape();
  };

  P._tabBFS = function () {
    var T = this.T, st = this.st, tab = this.tab, ordem = T.res.ordem.slice(), nD = st.nDescobertos || 0, self = this;
    if (T.alvo >= 0 && tab.posicao[T.alvo] < 0) ordem.push(T.alvo);
    // vetor horizontal (como no slide: colunas = vértices; linhas D e P)
    var N = ordem.length, JAN = 36, i0 = 0, i1 = N;
    if (N > JAN + 8) { i0 = Math.max(0, Math.min(N - JAN, nD - JAN + 8)); i1 = Math.min(N, i0 + JAN); }
    var cab = '<th scope="row" class="ev-canto">v</th>', lD = '<th scope="row">D</th>', lP = '<th scope="row">P</th>';
    var novo = st.evento && st.evento.t === 'entra' ? st.evento.v : (st.evento && st.evento.t === 'inicio' ? st.evento.v : -1);
    for (var i = i0; i < i1; i++) {
      var v = ordem[i], desc = i < nD && tab.posicao[v] >= 0;
      var cls = (v === novo ? ' ev-novo' : '') + (v === this.alunoNo ? ' ev-col-aluno' : '') + (v === st.atual ? ' ev-col-atual' : '');
      cab += '<th scope="col" class="' + cls + '">' + this._nome(v) + '</th>';
      lD += '<td class="' + cls + '">' + (desc ? st.d[v] : '') + '</td>';
      lP += '<td class="' + cls + '">' + (desc ? (st.p[v] >= 0 ? this._nome(st.p[v]) : '-') : '') + '</td>';
    }
    var nota = N > i1 - i0 ? '<p class="ev-nota">Colunas ' + (i0 + 1).toLocaleString('pt-BR') + ' a ' + i1.toLocaleString('pt-BR') + ' de ' + N.toLocaleString('pt-BR') + ' vértices (em ordem de descoberta), em volta dos mais recentes.</p>' : '';
    var fila = st.fila || [];
    var h = '<section class="ev-bloco"><h4 class="ev-h4">Vetor de distâncias e predecessores</h4>' + nota +
      '<div class="ev-rola-x"><table class="ev-t ev-t--vetor"><thead><tr>' + cab + '</tr></thead><tbody><tr class="ev-faixa">' + lD + '</tr><tr>' + lP + '</tr></tbody></table></div>' +
      '<p class="ev-fila"><span class="ev-fila-rot">Fila F</span><span class="ev-fila-itens">' + (fila.length ? this._lista(fila, 12) : '<em>vazia</em>') +
      '</span><span class="ev-fila-dir">início → fim</span></p></section>';
    // revisão: Passo | Sai da fila | Entra na fila | Fila (início → fim) — linhas até o passo atual
    var ln = st.linha, MAX = 40, j0 = Math.max(0, ln - MAX + 1), linhas = '';
    for (var j = j0; j <= ln && j < tab.linhas.length; j++) {
      var l = j === ln && tab.linhaAte ? tab.linhaAte(tab.linhas[j], st.k) : tab.linhas[j];
      linhas += '<tr' + (j === ln ? ' class="ev-atual"' : '') + '><td class="ev-num">' + l.passo + '</td><td>' + (l.sai >= 0 ? this._nome(l.sai) : '–') +
        '</td><td>' + (l.entram.length ? this._lista(l.entram, 4, ', ') : '–') + '</td><td>' + this._lista(tab.fila(l), 5) + '</td></tr>';
    }
    if (ln < 0) linhas = '<tr><td colspan="4" class="ev-vazio">A tabela começa quando a origem entra na fila.</td></tr>';
    var visitados = T.res.ordem.slice(0, nD);
    h += '<section class="ev-bloco"><h4 class="ev-h4">Passo a passo</h4>' + this._ocultas(j0) +
      '<div class="ev-rola" data-auto="fim"><table class="ev-t ev-t--passos"><thead><tr><th>Passo</th><th>Sai da fila</th><th>Entra na fila</th><th>Fila (início → fim)</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '<p class="ev-ordem"><b>Ordem de visita:</b> ' + this._condensa(visitados, 8, 3) + '</p></section>';
    this._depois = function () { self._rolaFim(); self._rolaColunaAtual(); };
    return h;
  };

  P._ocultas = function (n) {
    if (n <= 0) return '';
    return '<p class="ev-nota">' + (n === 1 ? '1 linha anterior oculta' : n.toLocaleString('pt-BR') + ' linhas anteriores ocultas') + ' (volte o replay para vê-las).</p>';
  };
  P._condensa = function (ids, ini, fim) {
    var self = this, f = function (i) { return self._nome(i); };
    if (!ids.length) return '–';
    if (ids.length <= ini + fim + 1) return ids.map(f).join(' ');
    return ids.slice(0, ini).map(f).join(' ') + ' <span class="ev-mais">… ' + (ids.length - ini - fim).toLocaleString('pt-BR') + ' …</span> ' + ids.slice(-fim).map(f).join(' ');
  };
  P._rolaFim = function () {
    var r = this.t.corpo.querySelectorAll('[data-auto="fim"]');
    r.forEach(function (x) { x.scrollTop = x.scrollHeight; });
  };
  P._rolaColunaAtual = function () {
    var box = this.t.corpo.querySelector('.ev-rola-x'); if (!box) return;
    var c = box.querySelector('.ev-novo') || box.querySelector('.ev-col-atual');
    if (!c) return;
    var x = c.offsetLeft - box.clientWidth / 2 + c.offsetWidth / 2;
    box.scrollLeft = Math.max(0, x);
  };

  P._tabDFS = function () {
    var T = this.T, st = this.st, tab = this.tab, self = this;
    var pilha = (st.pilha || []).slice().reverse(); // topo primeiro (como no slide: F / C / B)
    var MAXP = 9, pl = '';
    pilha.slice(0, MAXP).forEach(function (v, i) { pl += '<li' + (i === 0 ? ' class="ev-topo"' : '') + '>' + self._nome(v) + '<span class="ev-df">' + st.d[v] + '/</span></li>'; });
    if (pilha.length > MAXP) pl += '<li class="ev-mais">+' + (pilha.length - MAXP).toLocaleString('pt-BR') + ' abaixo</li>';
    if (!pilha.length) pl = '<li class="ev-vazio">vazia</li>';
    var cont = { arvore: 0, retorno: 0, avanco: 0, cruzamento: 0 }, nO = this._nOlhaAte(st.k);
    for (var i = 0; i < nO; i++) cont[T.res.arcos[i][2]]++;
    var h = '<section class="ev-bloco ev-dfs-topo"><div class="ev-pilha"><h4 class="ev-h4">Pilha de chamadas</h4><ol class="ev-pilha-l" aria-label="Pilha, topo primeiro">' + pl + '</ol>' +
      '<p class="ev-nota">topo = vértice atual; tempo = ' + (st.tempo === null || st.tempo === undefined ? '–' : num(st.tempo)) + '</p></div>' +
      '<ul class="ev-classes">' + ['arvore', 'retorno', 'avanco', 'cruzamento'].map(function (c) {
        return '<li><i class="ev-traco' + (c === 'arvore' ? '' : ' ev-traco--trac') + '" style="--c:' + COR[c] + '"></i>' + LAB.traco.NOME_CLASSE[c] + '<b>' + cont[c].toLocaleString('pt-BR') + '</b></li>';
      }).join('') + '<li class="ev-ciclo-li">' + (cont.retorno ? 'Tem ciclo: sim (há arco de retorno)' : 'Tem ciclo: nenhum arco de retorno até aqui') + '</li></ul>' +
      '<p class="ev-nota ev-dfs-nota">A DFS não minimiza custo: ela explora e classifica os arcos, por isso não há percurso para o aluno.</p></section>';
    var ln = st.linha, MAX = 40, j0 = Math.max(0, ln - MAX + 1), linhas = '';
    for (var j = j0; j <= ln && j < tab.linhas.length; j++) {
      var l = j === ln && tab.linhaAte ? tab.linhaAte(tab.linhas[j], st.k) : tab.linhas[j], pil = tab.pilha(l).reverse();
      var tipoCls = l.tipo === 'arvore' || l.tipo === 'retorno' || l.tipo === 'avanco' || l.tipo === 'cruzamento' ? ' ev-cl-' + l.tipo : '';
      linhas += '<tr' + (j === ln ? ' class="ev-atual"' : '') + '><td class="ev-num">' + l.passo + '</td><td>' + this._nome(l.em) + '</td><td>' + (l.olha >= 0 ? this._nome(l.olha) : '–') +
        '</td><td class="ev-frase-c' + tipoCls + '">' + this._fraseHTML(l) + '</td><td class="ev-pilha-c">' + (pil.length ? this._lista(pil, 3) : '<em>vazia</em>') + '</td></tr>';
    }
    if (ln < 0) linhas = '<tr><td colspan="5" class="ev-vazio">A tabela começa quando a origem é descoberta (tempo −1 → d = 0).</td></tr>';
    h += '<section class="ev-bloco"><h4 class="ev-h4">Exercício guiado</h4>' + this._ocultas(j0) +
      '<div class="ev-rola" data-auto="fim"><table class="ev-t ev-t--passos"><thead><tr><th>Passo</th><th>Em</th><th>Olha</th><th>O que acontece</th><th>Pilha de chamadas</th></tr></thead><tbody>' + linhas + '</tbody></table></div></section>';
    // resolução (slide 31)
    var seq = T.res.ordem.slice(0, this._nDescAte(st.k));
    var arestas = function (tipo) {
      var l2 = []; for (var q = 0; q < nO; q++) if (T.res.arcos[q][2] === tipo) l2.push(T.res.arcos[q]);
      if (!l2.length) return '<span class="ev-vazio">nenhuma</span>';
      var mostra = l2.slice(0, 3).map(function (x) { return self._nome(x[0]) + ' → ' + self._nome(x[1]); }).join(', ');
      return mostra + (l2.length > 3 ? ' <span class="ev-mais">+' + (l2.length - 3).toLocaleString('pt-BR') + '</span>' : '');
    };
    h += '<section class="ev-bloco ev-resolucao"><h4 class="ev-h4">Resolução</h4><dl>' +
      '<dt>Sequência DFS</dt><dd class="ev-seq">' + this._condensa(seq, 8, 3) + '</dd>' +
      '<dt><i class="ev-traco" style="--c:' + COR.arvore + '"></i>Arestas de árvore (' + cont.arvore.toLocaleString('pt-BR') + ')</dt><dd>' + arestas('arvore') + '</dd>' +
      '<dt><i class="ev-traco ev-traco--trac" style="--c:' + COR.retorno + '"></i>Arestas de retorno (' + cont.retorno.toLocaleString('pt-BR') + ')</dt><dd>' + arestas('retorno') + '</dd>' +
      '<dt><i class="ev-traco ev-traco--trac" style="--c:' + COR.avanco + '"></i>Arestas de avanço (' + cont.avanco.toLocaleString('pt-BR') + ')</dt><dd>' + arestas('avanco') + '</dd>' +
      '<dt><i class="ev-traco ev-traco--trac" style="--c:' + COR.cruzamento + '"></i>Arestas de cruzamento (' + cont.cruzamento.toLocaleString('pt-BR') + ')</dt><dd>' + arestas('cruzamento') + '</dd>' +
      '</dl></section>';
    this._depois = function () { self._rolaFim(); };
    return h;
  };
  P._nDescAte = function (k) {
    var T = this.T;
    if (!T._descIdx) { var l = []; T.eventos.forEach(function (e, i) { if (e.t === 'descobre') l.push(i); }); T._descIdx = l; }
    var a = 0, b = T._descIdx.length; while (a < b) { var m = (a + b) >> 1; if (T._descIdx[m] < k) a = m + 1; else b = m; }
    return a;
  };
  P._fraseHTML = function (l) {
    var self = this, c = function (i) { return self._nome(i); };
    if (l.tipo === 'raiz') return 'início em ' + c(l.em) + ', d = ' + l.d;
    if (l.tipo === 'encerra') return c(l.em) + ' encerra, f = ' + l.f;
    if (l.tipo === 'arvore') return l.d >= 0 ? 'novo → desce, d = ' + l.d : 'novo → desce';
    if (l.tipo === 'retorno') return c(l.olha) + ' ainda aberto → retorno';
    return c(l.olha) + ' já encerrado → ' + (LAB.traco.NOME_CLASSE[l.tipo] || l.tipo);
  };

  P._tabRecusa = function () {
    var T = this.T, self = this, neg = T.res.recusa.negativos;
    var itens = neg.slice(0, 30).map(function (x, i) {
      return '<li><button type="button" class="ev-link" data-x="foca" data-u="' + x[0] + '" data-v="' + x[1] + '">' + self._nome(x[0]) + ' → ' + self._nome(x[1]) +
        '</button> <span class="ev-peso-neg">peso ' + num(x[2]) + '</span>' + (i === 0 ? '' : '') + '</li>';
    }).join('');
    return '<section class="ev-bloco ev-recusa"><h4 class="ev-h4">Dijkstra recusou este grafo</h4>' +
      '<blockquote class="ev-regra">Os pesos das arestas devem ser não-negativos.</blockquote>' +
      '<p>Dijkstra fecha um vértice de vez quando ele sai da fila de prioridade; um arco negativo poderia baratear depois um vértice já fechado. ' +
      'Este grafo tem <b>' + neg.length.toLocaleString('pt-BR') + '</b> arco' + (neg.length === 1 ? '' : 's') + ' de peso negativo (bônus −4 ou fonte −2), marcados em vermelho no mapa. Use Bellman-Ford.</p>' +
      '<ul class="ev-neg">' + itens + (neg.length > 30 ? '<li class="ev-mais">+' + (neg.length - 30) + ' arcos</li>' : '') + '</ul></section>';
  };

  // Dijkstra / Bellman-Ford: linhas = vértices, colunas = Passo 1…k, células (d, p) / * / –
  P._tabColunas = function () {
    var T = this.T, st = this.st, tab = this.tab, dij = T.algoritmo === 'DIJKSTRA', self = this;
    var col = st.coluna || 0, nLin = tab.linhasAte(col, st.k), JC = dij ? 6 : 4;
    // colunas = blocos da tabela (Bellman-Ford: passadas seguidas sem mudança numa coluna só, cortada no passo atual)
    var bAgora = tab.blocoDaColuna(col), b1 = tab.blocos.indexOf(bAgora), b0 = Math.max(0, b1 - JC + 1), cols = [];
    for (var q = b0; q <= b1; q++) {
      var bl = tab.blocos[q], fimV = Math.min(bl.fim, col);
      cols.push({ j: fimV, rot: bl.ini === 0 ? 'Início' : bl.vazio ? (fimV > bl.ini ? 'Passos ' + bl.ini + '–' + fimV : 'Passo ' + bl.ini) + '<span class="ev-th-nota">nada mudou</span>' : 'Passo ' + bl.ini,
        vazio: bl.vazio });
    }
    var c0 = b0;
    var foco = st.olhando ? st.olhando[1] : st.atual;
    var cab = '<th scope="col" class="ev-canto">v</th>' + cols.map(function (c, i) {
      var cls = (i === cols.length - 1 ? 'ev-col-agora' : '') + (c.vazio ? ' ev-col-vazia' : '');
      return '<th scope="col"' + (cls ? ' class="' + cls.trim() + '"' : '') + '>' + c.rot + '</th>';
    }).join('');
    // [IA] Claude – cabeçalho de uma linha (título + onde estamos); a regra da tabela fica no title/aria do título
    var regra = dij ? 'Cada coluna é um passo: o vértice aberto de menor d é fechado (*) e seus arcos são relaxados.'
      : 'Cada coluna é uma passada completa por todos os arcos. O código do grupo faz sempre as |V|−1 = ' + (T.n - 1).toLocaleString('pt-BR') +
        ' passadas; passadas seguidas em que nada mudou aparecem juntas numa coluna só, e o replay as pula de uma vez.';
    var onde;
    if (dij) onde = col ? 'Passo ' + col + (tab.colunas ? ' de ' + tab.colunas.toLocaleString('pt-BR') : '') : 'Antes do primeiro passo';
    else if (st.fim) onde = T.res.cicloNegativo ? 'Depois de ' + T.res.passadas.toLocaleString('pt-BR') + ' passadas, a passada extra ainda relaxou: ciclo negativo'
      : T.res.passadas.toLocaleString('pt-BR') + ' passadas (|V|−1); a última mudança foi na passada ' + tab.ultimaMudanca.toLocaleString('pt-BR');
    else onde = 'Passada ' + (st.passada || 0).toLocaleString('pt-BR') + ' de ' + T.res.passadas.toLocaleString('pt-BR') +
      (bAgora.vazio && col > bAgora.ini ? ', nada mudou desde a passada ' + (bAgora.ini - 1).toLocaleString('pt-BR') : ', ' + (st.relaxadosNaPassada || 0) + ' relaxamento(s)');
    if (c0 > 0) onde += '; mostrando os últimos ' + cols.length;
    var h = '<section class="ev-bloco"><h4 class="ev-h4 ev-h4--linha" title="' + esc(regra) + '">' + (dij ? 'Tabela do Dijkstra' : 'Tabela do Bellman-Ford') +
      '<span class="ev-h4-nota">' + esc(onde) + '.</span></h4><p class="sr-only">' + esc(regra) + '</p>' +
      '<div class="ev-rola ev-rola--xy" data-virtual="1"><table class="ev-t ev-t--dp"><thead><tr>' + cab + '</tr></thead><tbody data-vbody></tbody></table></div></section>';
    var celHTML = function (v, cc) {
      var j = cc.j, c = tab.celula(v, j, st.k);
      if (c === null) return '<td class="ev-desc">–</td>';
      if (c.fechado) return '<td class="ev-fechado">*</td>';
      var risc = c.riscados && c.riscados.length ? c.riscados.map(function (x) { return '<s>' + num(x) + '</s> '; }).join('') : '';
      var cls = (c.fechaAqui ? 'ev-fecha' : '') + (c.mudou ? ' ev-mudou' : '') + (cc.vazio ? ' ev-vazia' : '') + (j === col && v === foco ? ' ev-foco' : '');
      return '<td class="' + cls + '">' + risc + '(' + num(c.d) + ', ' + (c.p >= 0 ? self._nome(c.p) : '–') + ')</td>';
    };
    var ROW = 26; // = altura da linha em estados.css (.ev-t--dp tbody tr)
    this._depois = function () {
      var box = self.t.corpo.querySelector('[data-virtual]'), tb = box.querySelector('[data-vbody]');
      var desenha = function () {
        var topo = box.scrollTop, alt = Math.max(box.clientHeight, 420), cabH = 32;
        var i0 = Math.max(0, Math.floor((topo - cabH) / ROW) - 6), i1 = Math.min(nLin, Math.ceil((topo + alt) / ROW) + 6);
        var out = '';
        if (i0 > 0) out += '<tr style="height:' + (i0 * ROW) + 'px" aria-hidden="true"><td colspan="' + (cols.length + 1) + '"></td></tr>';
        for (var i = i0; i < i1; i++) {
          var v = tab.vertices[i];
          out += '<tr class="' + (v === foco ? 'ev-atual' : '') + (v === self.alunoNo ? ' ev-lin-aluno' : '') + '"><th scope="row">' + self._nome(v) + '</th>' + cols.map(function (j) { return celHTML(v, j); }).join('') + '</tr>';
        }
        if (i1 < nLin) out += '<tr style="height:' + ((nLin - i1) * ROW) + 'px" aria-hidden="true"><td colspan="' + (cols.length + 1) + '"></td></tr>';
        tb.innerHTML = out;
      };
      self._virtual = function () { if (self._vraf) return; self._vraf = requestAnimationFrame(function () { self._vraf = 0; if (self._virtual === vf) desenha(); }); };
      var vf = self._virtual;
      // rola até o vértice em foco (ou o aluno, quando sincronizado)
      desenha(); // primeiro com os espaçadores, para a caixa já ter a altura toda
      var alvoV = self.sincronizar && self.alunoNo >= 0 ? self.alunoNo : foco, pos = alvoV >= 0 ? tab.vertices.indexOf(alvoV) : -1;
      if (pos >= 0 && pos < nLin) {
        var y = 32 + pos * ROW;
        if (y < box.scrollTop + 32 || y > box.scrollTop + box.clientHeight - ROW) box.scrollTop = Math.max(0, y - box.clientHeight / 2);
      }
      box.scrollLeft = box.scrollWidth;
      desenha();
    };
    return h;
  };

  // ------------------------------------------------------------------ rodapé: caminho, custo, Python
  P._rodape = function () {
    var T = this.T, f = T.final, pe = this.t.pe, self = this, h = '';
    var py = this.mapa && this.mapa.algoritmos ? this.mapa.algoritmos[this.key] : null;
    if (T.algoritmo === 'DFS') {
      var cl = T.res.classes;
      h += '<p class="ev-pe-l"><b>Tem ciclo:</b> ' + (T.res.temCiclo ? 'sim, ' + cl.retorno.toLocaleString('pt-BR') + ' arco(s) de retorno' : 'não') +
        '. Árvore ' + cl.arvore.toLocaleString('pt-BR') + ', retorno ' + cl.retorno.toLocaleString('pt-BR') + ', avanço ' + cl.avanco.toLocaleString('pt-BR') +
        ', cruzamento ' + cl.cruzamento.toLocaleString('pt-BR') + '.</p>';
    } else if (f.status === 'RECUSA') {
      h += '<p class="ev-pe-l ev-erro"><b>Recusa:</b> ' + esc(f.mensagem || 'há arcos de peso negativo.') + '</p>';
    } else if (f.status === 'CICLO_NEGATIVO') {
      h += '<p class="ev-pe-l ev-erro"><b>Ciclo negativo</b> de custo ' + num(f.custo) + ' (' + (f.caminho.length - 1) + ' arcos): ' + this._caminhoHTML(f.caminho) + '</p>';
    } else if (f.status === 'SEM_SOLUCAO') {
      h += '<p class="ev-pe-l"><b>Sem solução:</b> o ALVO não tem predecessor; nenhum caminho leva até a saída.</p>';
    } else {
      h += '<p class="ev-pe-l ev-caminho"><b>Caminho pelos predecessores:</b> ' + this._caminhoHTML(f.caminho) + '</p>' +
        '<p class="ev-pe-l"><b>' + f.passos.toLocaleString('pt-BR') + '</b> passos, custo <b>' + num(f.custo) + '</b>' + (T.algoritmo === 'BFS' ? ' (BFS minimiza passos, não custo)' : '') + '.</p>';
    }
    // concordância: o resultado final do traço × mapa.algoritmos (os dois vêm do Python)
    if (T.algoritmo === 'DFS') h += '<p class="ev-py">Resultado do Python: DFS sobre o grafo sem o ALVO, ' + T.nEstados.toLocaleString('pt-BR') + ' estados e ' + T.nArcos.toLocaleString('pt-BR') + ' arcos.</p>';
    else if (py) {
      var dif = [];
      if (py.status !== f.status) dif.push('status ' + f.status + ' no traço × ' + py.status + ' no resultado');
      if (f.status === 'OK' && py.passos !== f.passos) dif.push('passos ' + f.passos + ' × ' + py.passos);
      if ((f.status === 'OK' || f.status === 'CICLO_NEGATIVO') && py.custo !== f.custo) dif.push('custo ' + num(f.custo) + ' × ' + num(py.custo));
      if (this.mapa.estados !== undefined && T.nEstados !== this.mapa.estados && !T.fonteConsumivel) dif.push('estados ' + T.nEstados + ' × ' + this.mapa.estados);
      var desc = py.status === 'OK' ? 'OK, ' + py.passos + ' passos, custo ' + num(py.custo) : py.status === 'CICLO_NEGATIVO' ? 'ciclo negativo, custo ' + num(py.custo) : py.status === 'RECUSA' ? 'recusa' : 'sem solução';
      h += dif.length ? '<p class="ev-py ev-py--difere"><b>Resultado do Python:</b> ' + desc + '. Não confere com o traço: ' + esc(dif.join('; ')) + '.</p>'
        : '<p class="ev-py ev-py--ok"><b>Resultado do Python:</b> ' + desc + '. Confere com o traço.</p>';
    }
    h += '<p class="ev-origem">Os eventos vêm do código Python do grupo (src/graphs/algorithms.py); esta tela só os reproduz.</p>';
    pe.innerHTML = h;
    void self;
  };
  P._caminhoHTML = function (ids) {
    var self = this, sep = ' <span class="ev-seta">→</span> ';
    if (!ids || !ids.length) return '–';
    if (ids.length <= 9 || this.expandeCaminho) {
      return ids.map(function (i) { return self._nome(i); }).join(sep) + (ids.length > 9 ? ' <button type="button" class="ev-link" data-x="caminho">recolher</button>' : '');
    }
    return ids.slice(0, 4).map(function (i) { return self._nome(i); }).join(sep) + sep + '<button type="button" class="ev-link" data-x="caminho">… mais ' + (ids.length - 7) + ' …</button>' + sep +
      ids.slice(-3).map(function (i) { return self._nome(i); }).join(sep);
  };
  P._acaoExtra = function (x, b) {
    if (x === 'caminho') { this.expandeCaminho = !this.expandeCaminho; this._rodape(); }
    else if (x === 'foca') {
      var u = +b.getAttribute('data-u'), L = this.layout; if (!L) return;
      var s = Math.max(this.view.s, 11 / (L.raio[u] || 10));
      this._usuarioMexeu = true;
      this._panPara({ s: s, x: this.W / 2 - L.x[u] * s, y: this.H / 2 - L.y[u] * s }, true);
    }
  };

  EstadosView.ALGORITMOS = ALGS.map(function (a) { return a.key; });
  EstadosView.VELOCIDADES = VELOCIDADES.slice();
  EstadosView.EVENTOS_POR_SEGUNDO = EVENTOS_POR_S;
  LAB.EstadosView = EstadosView;
})(typeof window !== 'undefined' ? window : globalThis);
