/* [IA] Claude – leitor de traços para a visualização "como na aula" (window.LAB.traco, alias LAB.grafo).
   ESTE ARQUIVO NÃO CONTÉM ALGORITMO: não constrói o grafo de estados e não roda BFS, DFS, Dijkstra nem
   Bellman-Ford. Ele só lê o traço JSON produzido pelo código Python do grupo (src/graphs/algorithms.py, via os
   ganchos `observador`, empacotado por src/traco.py → GET api/traco/<nome>?alg=...&fonte=0|1) e reconstrói, a
   partir desses eventos, o estado de cada passo (replay) e as tabelas no formato dos slides da Profª Laura.
   Sem DOM e sem THREE: roda no navegador e no Node (globalThis). */
(function (raiz) {
  'use strict';
  var LAB = (raiz.LAB = raiz.LAB || {});
  var ALVO = 'ALVO';
  var PASSO_CP = 256; // checkpoints do replay a cada 256 eventos

  // ------------------------------------------------------------------ normalização do JSON do Python
  function inf(x) { return x === null || x === undefined || x === 'inf' || x === 'Infinity' ? Infinity : +x; }
  function idx(x) { return x === null || x === undefined ? -1 : x | 0; }
  function nomeAlg(a) {
    a = String(a || '').toUpperCase().replace(/[-\s]/g, '_');
    if (a === 'BELLMANFORD') a = 'BELLMAN_FORD';
    if (a === 'BELLMAN_FORD_FONTE_CONSUMIVEL') a = 'BELLMAN_FORD';
    return a;
  }
  function camel(t) { return String(t).replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  // campos posicionais quando o Python manda eventos compactos como listas: ["sai", 3]
  var POS = {
    BFS: { inicio: ['v'], sai: ['v'], olha: ['u', 'v', 'novo'], entra: ['v', 'd', 'p'], encerra: ['v'] },
    DFS: { descobre: ['v', 'd', 'p'], olha: ['u', 'v', 'tipo'], encerra: ['v', 'f'] },
    DIJKSTRA: { fecha: ['u', 'd'], relaxa: ['u', 'v', 'antes', 'depois'], descarta: ['u', 'd'] },
    BELLMAN_FORD: { passada: ['k'], relaxa: ['u', 'v', 'antes', 'depois'], fimPassada: ['k', 'mudou', 'relaxados'],
      ciclo: ['ciclo', 'u', 'v'] }
  };
  var TIPO = { arvore: 'arvore', 'árvore': 'arvore', retorno: 'retorno', avanco: 'avanco', 'avanço': 'avanco',
    cruzamento: 'cruzamento' };

  function normEvento(alg, e) {
    var o;
    if (Array.isArray(e)) {
      o = { t: camel(e[0]) };
      var campos = (POS[alg] || {})[o.t] || [];
      for (var i = 0; i < campos.length; i++) if (e[i + 1] !== undefined) o[campos[i]] = e[i + 1];
    } else {
      o = {};
      for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) o[camel(k)] = e[k];
      o.t = camel(e.t || e.tipoEvento || e.evento || e.tipo_evento || '');
    }
    if ('u' in o) o.u = idx(o.u);
    if ('v' in o) o.v = idx(o.v);
    if ('p' in o) o.p = idx(o.p);
    if ('antes' in o) o.antes = inf(o.antes);
    if ('depois' in o) o.depois = inf(o.depois);
    if (alg === 'DIJKSTRA' && 'd' in o) o.d = inf(o.d);
    if (alg === 'DFS' && o.t === 'olha') o.tipo = TIPO[o.tipo] || o.tipo;
    if (o.t === 'fimPassada') o.mudou = !!o.mudou;
    if (o.t === 'ciclo' && o.ciclo) o.ciclo = o.ciclo.map(idx);
    return o;
  }

  function arcoObj(a) {
    if (Array.isArray(a)) return { para: a[0] | 0, peso: +a[1], mov: a[2] || '', casa: a[3] || '' };
    return { para: (a.para !== undefined ? a.para : a.destino) | 0, peso: +a.peso, mov: a.mov || a.movimento || '', casa: a.casa || '' };
  }
  function estadoObj(e) {
    if (e === null || e === undefined || e === ALVO) return null;
    if (Array.isArray(e)) return { linha: e[0] | 0, coluna: e[1] | 0, chaves: e[2] === '-' ? '' : (e[2] || ''), bonus: (e[3] || []).slice() };
    return { linha: e.linha | 0, coluna: e.coluna | 0, chaves: e.chaves === '-' ? '' : (e.chaves || ''), bonus: (e.bonus || []).slice() };
  }
  function estadoDoRotulo(r) { // "(3,4)|ab|{0,2}" → objeto (só se o traço não trouxer `estados`)
    if (r === ALVO) return null;
    var m = /^\((\d+),(\d+)\)\|([^|]*)\|\{([^}]*)\}$/.exec(r);
    if (!m) return null;
    return { linha: +m[1], coluna: +m[2], chaves: m[3] === '-' ? '' : m[3],
      bonus: m[4] ? m[4].split(',').map(Number) : [] };
  }

  function partesDe(e) {
    if (!e) return { casa: ALVO, chaves: '', bonus: '' };
    return { casa: '(' + e.linha + ',' + e.coluna + ')', chaves: e.chaves,
      bonus: e.bonus.length ? '{' + e.bonus.join(',') + '}' : '' };
  }

  function pilhaDe(pai, topo) {
    var p = [], v = topo, guarda = pai.length + 1;
    while (v !== -1 && guarda-- > 0) { p.push(v); v = pai[v]; }
    return p.reverse();
  }
  // leitura do caminho pelos predecessores, como no slide ("A → C → B → D → F")
  function caminho(pai, destino, origem) {
    if (destino < 0 || destino >= pai.length) return [];
    if (pai[destino] === -1 && destino !== origem) return [];
    var seq = [], v = destino, guarda = pai.length + 1;
    while (v !== -1 && guarda-- > 0) { seq.push(v); v = pai[v]; }
    return seq.reverse();
  }

  /**
   * carregar(json) → T: embrulha o traço do Python.
   * json (src/traco.py) = { algoritmo, fonteConsumivel, grafo: { rotulos, estados, adj, inicio, alvo, nEstados, nArcos },
   *                         resultado, eventos } — também aceita o grafo "plano" (campos de `grafo` no topo).
   */
  function carregar(json, opcoes) {
    if (!json) throw new Error('traço vazio');
    if (json.__traco) return json;
    opcoes = opcoes || {};
    var alg = nomeAlg(opcoes.algoritmo || json.algoritmo || json.alg || (json.resultado && json.resultado.algoritmo));
    if (!POS[alg]) throw new Error('Algoritmo desconhecido no traço: ' + alg);
    var g = json.grafo || json; // src/traco.py aninha o grafo em "grafo"; aceita também o formato plano
    var rotulos = (g.rotulos || []).map(String);
    var n = rotulos.length;
    var estados = new Array(n), indicePor = Object.create(null), i, j;
    for (i = 0; i < n; i++) {
      indicePor[rotulos[i]] = i;
      estados[i] = g.estados ? estadoObj(g.estados[i]) : estadoDoRotulo(rotulos[i]);
    }
    var alvo = g.alvo !== undefined && g.alvo !== null ? g.alvo | 0 : (indicePor[ALVO] !== undefined ? indicePor[ALVO] : -1);
    var inicio = g.inicio !== undefined && g.inicio !== null ? g.inicio | 0 : 0;
    var adj = new Array(n), m = 0, nArcosSemAlvo = 0, negativos = [];
    for (i = 0; i < n; i++) {
      var lista = (g.adj && g.adj[i]) || [];
      adj[i] = new Array(lista.length);
      for (j = 0; j < lista.length; j++) {
        var a = adj[i][j] = arcoObj(lista[j]);
        m++;
        if (a.para !== alvo) nArcosSemAlvo++;
        if (a.peso < 0) negativos.push([i, a.para, a.peso]);
      }
    }
    var evs = (json.eventos || []).map(function (e) { return normEvento(alg, e); });
    // BFS: se o Python não marcar 'inicio', o primeiro 'sai' implica a origem já na fila
    if (alg === 'BFS' && evs.length && evs[0].t !== 'inicio') evs.unshift({ t: 'inicio', v: inicio, d: 0 });

    var T = {
      __traco: true,
      algoritmo: alg,
      fonteConsumivel: !!(json.fonteConsumivel || json.fonte_consumivel || json.fonte || opcoes.fonte),
      mapa: json.mapa || json.nome || '',
      n: n, nEstados: g.nEstados !== undefined ? g.nEstados : (alvo >= 0 ? n - 1 : n),
      nArcos: g.nArcos !== undefined ? g.nArcos : nArcosSemAlvo, m: m,
      rotulos: rotulos, estados: estados, adj: adj, inicio: inicio, alvo: alvo,
      eventos: evs, resultado: json.resultado || {}, negativos: negativos,
      indice: function (r) { var k = indicePor[r]; return k === undefined ? -1 : k; },
      partes: function (k) { return partesDe(estados[k]); },
      curto: function (k) { var p = partesDe(estados[k]); return p.casa + (p.chaves ? ' ' + p.chaves : '') + (p.bonus ? ' ' + p.bonus : ''); },
      camada: function (k) { var e = estados[k]; return e ? (e.chaves || '-') : ALVO; },
      peso: function (u, v) { var l = adj[u] || []; for (var q = 0; q < l.length; q++) if (l[q].para === v) return l[q].peso; return NaN; }
    };
    T.res = derivar(T);
    T.marco = marcos(T);
    T.final = resumoFinal(T);
    return T;
  }

  // Lê dos eventos (e confere com o `resultado` do Python quando vier) o que a tela precisa no fim do traço.
  function derivar(T) {
    var alg = T.algoritmo, n = T.n, evs = T.eventos, R = T.resultado, i, ev;
    var res = { ordem: [], pai: new Int32Array(n).fill(-1), dist: null, recusa: null, arcos: null, classes: null,
      passadas: 0, parouCedo: false, cicloNegativo: null };
    if (alg === 'BFS') {
      res.dist = new Int32Array(n).fill(-1);
      for (i = 0; i < evs.length; i++) {
        ev = evs[i];
        if (ev.t === 'inicio') { res.ordem.push(ev.v); res.dist[ev.v] = 0; }
        else if (ev.t === 'entra') { res.ordem.push(ev.v); res.dist[ev.v] = ev.d !== undefined ? ev.d : -1; res.pai[ev.v] = ev.p; }
      }
    } else if (alg === 'DFS') {
      res.descoberta = new Int32Array(n).fill(-1); res.termino = new Int32Array(n).fill(-1);
      res.classes = { arvore: 0, retorno: 0, avanco: 0, cruzamento: 0 }; res.arcos = [];
      for (i = 0; i < evs.length; i++) {
        ev = evs[i];
        if (ev.t === 'descobre') { res.ordem.push(ev.v); res.descoberta[ev.v] = ev.d; if (ev.p !== undefined) res.pai[ev.v] = ev.p; }
        else if (ev.t === 'olha') { res.classes[ev.tipo] = (res.classes[ev.tipo] || 0) + 1; res.arcos.push([ev.u, ev.v, ev.tipo]); }
        else if (ev.t === 'encerra') res.termino[ev.v] = ev.f;
      }
      if (R.classes) for (var c in R.classes) res.classes[TIPO[c] || c] = R.classes[c];
      res.temCiclo = R.temCiclo !== undefined ? !!R.temCiclo : (R.tem_ciclo !== undefined ? !!R.tem_ciclo : res.classes.retorno > 0);
    } else {
      res.dist = new Float64Array(n).fill(Infinity);
      var rec = R.recusa;
      if (rec || (alg === 'DIJKSTRA' && R.status === 'RECUSA')) {
        var msg = typeof rec === 'string' ? rec : (rec && rec.mensagem) || R.mensagem || '';
        var neg = rec && rec.negativos ? rec.negativos.map(function (x) {
          return Array.isArray(x) ? [idx(x[0]), idx(x[1]), x.length > 2 ? +x[2] : T.peso(idx(x[0]), idx(x[1]))] : [idx(x.u), idx(x.v), +x.peso];
        }) : T.negativos.slice();
        res.recusa = { mensagem: msg, negativos: neg };
      } else {
        res.dist[T.inicio] = 0;
        for (i = 0; i < evs.length; i++) {
          ev = evs[i];
          if (ev.t === 'relaxa') { res.dist[ev.v] = ev.depois; res.pai[ev.v] = ev.u; }
          else if (ev.t === 'passada') res.passadas = Math.max(res.passadas, ev.k | 0);
          else if (ev.t === 'fimPassada' && !ev.mudou) res.parouCedo = true;
          else if (ev.t === 'ciclo') { res.cicloNegativo = ev.ciclo; if (ev.u !== undefined && ev.v !== undefined) res.pai[ev.v] = ev.u; }
        }
        if (R.passadas !== undefined) res.passadas = R.passadas;
        if (R.parouCedo !== undefined) res.parouCedo = !!R.parouCedo;
        var cn = R.cicloNegativo || R.ciclo_negativo;
        if (cn) res.cicloNegativo = cn.map(idx);
      }
    }
    // o `resultado` do Python manda nos valores finais (os eventos só servem para o passo a passo)
    if (R.pai && R.pai.length === n) for (i = 0; i < n; i++) res.pai[i] = idx(R.pai[i]);
    if (R.dist && R.dist.length === n && res.dist) for (i = 0; i < n; i++) res.dist[i] = alg === 'BFS' ? idx(R.dist[i]) : inf(R.dist[i]);
    return res;
  }

  // evento (prefixo k) em que cada vértice "fica pronto" — usado pelo "Sincronizar com o aluno"
  function marcos(T) {
    var alg = T.algoritmo, evs = T.eventos, mk = new Int32Array(T.n).fill(-1), i, ev;
    if (alg !== 'DFS' && alg !== 'BFS' && !T.res.recusa) mk[T.inicio] = 0;
    for (i = 0; i < evs.length; i++) {
      ev = evs[i];
      if (alg === 'BFS' && (ev.t === 'inicio' || ev.t === 'entra') && mk[ev.v] < 0) mk[ev.v] = i + 1;
      else if (alg === 'DFS' && ev.t === 'descobre' && mk[ev.v] < 0) mk[ev.v] = i + 1;
      else if (alg === 'DIJKSTRA' && ev.t === 'fecha' && (mk[ev.u] <= 0)) mk[ev.u] = i + 1;
      else if (alg === 'BELLMAN_FORD' && ev.t === 'relaxa') mk[ev.v] = i + 1; // último relaxamento = valor final
    }
    return mk;
  }

  // caminho lido pelos predecessores até o ALVO (ou o ciclo negativo), passos e custo (soma dos pesos dos arcos)
  function resumoFinal(T) {
    var r = T.res, out = { status: 'OK', caminho: [], passos: null, custo: null, mensagem: '' };
    if (T.algoritmo === 'DFS') {
      out.status = 'EXPLORA'; out.temCiclo = r.temCiclo; out.classes = r.classes; return out;
    }
    if (r.recusa) { out.status = 'RECUSA'; out.mensagem = r.recusa.mensagem; return out; }
    if (r.cicloNegativo) {
      var c = r.cicloNegativo, s = 0;
      for (var i = 0; i + 1 < c.length; i++) s += menorPeso(T, c[i], c[i + 1]);
      out.status = 'CICLO_NEGATIVO'; out.caminho = c.slice(); out.custo = s; out.passos = c.length - 1;
      return out;
    }
    var alc = T.alvo >= 0 && (T.algoritmo === 'BFS' ? r.dist[T.alvo] >= 0 : r.dist[T.alvo] < Infinity);
    var est = alc ? caminho(r.pai, T.alvo, T.inicio) : [];
    if (!est.length) { out.status = 'SEM_SOLUCAO'; return out; }
    var acc = 0, perc = [];
    for (var k = 0; k < est.length; k++) {
      if (est[k] === T.alvo) break;
      if (k > 0) acc += T.peso(est[k - 1], est[k]);
      perc.push(est[k]);
    }
    out.caminho = est; out.passos = perc.length - 1; out.custo = acc;
    return out;
  }
  function menorPeso(T, u, v) {
    var w = Infinity, l = T.adj[u] || [];
    for (var i = 0; i < l.length; i++) if (l[i].para === v && l[i].peso < w) w = l[i].peso;
    return w;
  }

  // ------------------------------------------------------------------ replay (estado depois de k eventos)
  function novoCursor(T) {
    var n = T.n, alg = T.algoritmo, dfs = alg === 'DFS';
    var c = { k: 0, n: n, estado: new Uint8Array(n), p: new Int32Array(n).fill(-1),
      d: dfs ? new Int32Array(n).fill(-1) : new Float64Array(n).fill(Infinity), f: dfs ? new Int32Array(n).fill(-1) : null,
      nSai: 0, nEntra: 0, topo: -1, tempo: -1, passo: 0, passada: 0, relaxados: 0, ciclo: null, atual: -1, olhando: null };
    if ((alg === 'DIJKSTRA' && !T.res.recusa) || alg === 'BELLMAN_FORD') { c.d[T.inicio] = 0; c.estado[T.inicio] = 1; }
    return c;
  }
  function copia(c) {
    return { k: c.k, n: c.n, estado: c.estado.slice(), p: c.p.slice(), d: c.d.slice(), f: c.f ? c.f.slice() : null,
      nSai: c.nSai, nEntra: c.nEntra, topo: c.topo, tempo: c.tempo, passo: c.passo, passada: c.passada, relaxados: c.relaxados,
      ciclo: c.ciclo, atual: c.atual, olhando: c.olhando };
  }
  function restaura(dst, src) {
    dst.k = src.k; dst.estado.set(src.estado); dst.p.set(src.p); dst.d.set(src.d); if (src.f) dst.f.set(src.f);
    dst.nSai = src.nSai; dst.nEntra = src.nEntra; dst.topo = src.topo; dst.tempo = src.tempo; dst.passo = src.passo; dst.passada = src.passada;
    dst.relaxados = src.relaxados; dst.ciclo = src.ciclo; dst.atual = src.atual; dst.olhando = src.olhando;
  }

  function aplica(c, T, ev) {
    c.olhando = null;
    switch (T.algoritmo) {
      case 'BFS':
        if (ev.t === 'inicio') { c.estado[ev.v] = 1; c.d[ev.v] = 0; c.nEntra = 1; c.atual = -1; }
        else if (ev.t === 'sai') { c.nSai++; c.atual = ev.v; }
        else if (ev.t === 'olha') c.olhando = [ev.u, ev.v];
        else if (ev.t === 'entra') { c.estado[ev.v] = 1; c.d[ev.v] = ev.d; c.p[ev.v] = ev.p; c.nEntra++; c.olhando = [ev.p, ev.v]; }
        else if (ev.t === 'encerra') { c.estado[ev.v] = 2; c.passo++; c.atual = -1; }
        break;
      case 'DFS':
        if (ev.t === 'descobre') { c.estado[ev.v] = 1; c.d[ev.v] = ev.d; c.p[ev.v] = ev.p === undefined ? -1 : ev.p; c.topo = ev.v; c.tempo = ev.d; }
        else if (ev.t === 'olha') c.olhando = [ev.u, ev.v];
        else if (ev.t === 'encerra') { c.estado[ev.v] = 2; c.f[ev.v] = ev.f; c.topo = c.p[ev.v]; c.tempo = ev.f; }
        c.atual = c.topo;
        break;
      case 'DIJKSTRA':
        if (ev.t === 'fecha') { c.estado[ev.u] = 2; c.passo++; c.atual = ev.u; }
        else if (ev.t === 'relaxa') { c.d[ev.v] = ev.depois; c.p[ev.v] = ev.u; if (c.estado[ev.v] === 0) c.estado[ev.v] = 1; c.olhando = [ev.u, ev.v]; }
        else if (ev.t === 'descarta') c.atual = ev.u;
        break;
      case 'BELLMAN_FORD':
        if (ev.t === 'passada') { c.passada = ev.k; c.relaxados = 0; }
        else if (ev.t === 'relaxa') { c.d[ev.v] = ev.depois; c.p[ev.v] = ev.u; c.estado[ev.v] = 1; c.relaxados++; c.olhando = [ev.u, ev.v]; c.atual = ev.v; }
        else if (ev.t === 'ciclo') { c.ciclo = ev.ciclo; if (ev.u !== undefined && ev.u >= 0) { c.p[ev.v] = ev.u; c.olhando = [ev.u, ev.v]; } }
        break;
    }
    c.k++;
    // Bellman-Ford não "fecha" vértices: no fim do traço toda estimativa finita vale como final
    if (T.algoritmo === 'BELLMAN_FORD' && c.k === T.eventos.length && !c.ciclo) for (var i = 0; i < c.n; i++) if (c.estado[i] === 1) c.estado[i] = 2;
  }

  function prepara(T) {
    if (T._cps) return;
    var evs = T.eventos, c = novoCursor(T), cps = [copia(c)];
    for (var i = 0; i < evs.length; i++) {
      aplica(c, T, evs[i]);
      if (c.k % PASSO_CP === 0) cps.push(copia(c));
    }
    T._cps = cps;
    T._cur = novoCursor(T);
  }

  /**
   * replay(T, k) → estado depois dos k primeiros eventos. Os arrays devolvidos são do cursor interno
   * (compartilhados): não altere e copie se precisar guardar depois da próxima chamada.
   */
  function replay(T, k) {
    if (arguments.length === 4) { T = arguments[1]; k = arguments[3]; } // assinatura antiga (G, res, alg, k)
    prepara(T);
    var evs = T.eventos, total = evs.length, alg = T.algoritmo;
    k = Math.max(0, Math.min(total, k | 0));
    var c = T._cur;
    if (k < c.k || k - c.k > PASSO_CP) restaura(c, T._cps[Math.floor(k / PASSO_CP)]);
    while (c.k < k) aplica(c, T, evs[c.k]);
    var out = { algoritmo: alg, k: k, total: total, fim: k === total, evento: k > 0 ? evs[k - 1] : null,
      estado: c.estado, d: c.d, p: c.p, atual: c.atual, olhando: c.olhando };
    var tab = tabela(T);
    if (alg === 'BFS') {
      out.fila = T.res.ordem.slice(c.nSai, c.nEntra);  // início → fim
      out.nDescobertos = c.nEntra;                     // vetor D/P = T.res.ordem.slice(0, nDescobertos)
      out.linha = k <= 0 ? -1 : tab.doEvento[k];
    } else if (alg === 'DFS') {
      out.f = c.f;
      out.pilha = pilhaDe(c.p, c.topo);                // base → topo
      out.tempo = c.tempo;                             // contador global: último d ou f atribuído (−1 antes do início)
      out.linha = k <= 0 ? -1 : tab.doEvento[k];
    } else if (alg === 'DIJKSTRA') {
      out.passo = c.passo; out.recusa = T.res.recusa; out.coluna = tab.colunaDoEvento ? tab.colunaDoEvento(k) : 0;
    } else {
      out.passada = c.passada; out.relaxadosNaPassada = c.relaxados; out.ciclo = c.ciclo;
      out.passadas = T.res.passadas; out.parouCedo = T.res.parouCedo; out.coluna = tab.colunaDoEvento(k);
    }
    return out;
  }

  // ------------------------------------------------------------------ tabelas no formato dos slides
  function tabela(T) {
    if (T._tab) return T._tab;
    var alg = T.algoritmo, evs = T.eventos, res = T.res, t, i, ev;
    if (alg === 'BFS') {
      // vetor horizontal (colunas = vértices na ordem de descoberta; linhas D e P) +
      // revisão "Passo | Sai da fila | Entra na fila | Fila (início → fim)"; fila = ordem[filaIni..filaFim)
      var linhas = [], doEv = new Int32Array(evs.length + 1).fill(-1), nSai = 0, nEntra = 0, atual = null;
      for (i = 0; i < evs.length; i++) {
        ev = evs[i];
        if (ev.t === 'inicio') { nEntra = 1; atual = { passo: 0, sai: -1, entram: [ev.v], entraEv: [i], filaIni: 0, filaFim0: 0, filaFim: 1, ev0: i, ev1: i + 1 }; linhas.push(atual); }
        else if (ev.t === 'sai') { nSai++; atual = { passo: linhas.length, sai: ev.v, entram: [], entraEv: [], filaIni: nSai, filaFim0: nEntra, filaFim: nEntra, ev0: i, ev1: i + 1 }; linhas.push(atual); }
        else if (ev.t === 'entra' && atual) { nEntra++; atual.entram.push(ev.v); atual.entraEv.push(i); atual.filaFim = nEntra; }
        if (atual) atual.ev1 = i + 1;
        doEv[i + 1] = linhas.length - 1;
      }
      var pos = new Int32Array(T.n).fill(-1);
      for (i = 0; i < res.ordem.length; i++) pos[res.ordem[i]] = i;
      t = { algoritmo: alg, linhas: linhas, doEvento: doEv, ordem: res.ordem, posicao: pos,
        fila: function (l) { return res.ordem.slice(l.filaIni, l.filaFim); },
        // a linha j como estava depois de k eventos (a linha corrente só mostra o que já aconteceu)
        linhaAte: function (l, k) {
          if (k === undefined || k >= l.ev1) return l;
          var q = 0; while (q < l.entraEv.length && l.entraEv[q] < k) q++;
          return { passo: l.passo, sai: l.sai, entram: l.entram.slice(0, q), entraEv: l.entraEv.slice(0, q), filaIni: l.filaIni,
            filaFim0: l.filaFim0, filaFim: l.filaFim0 + q, ev0: l.ev0, ev1: k };
        } };
    } else if (alg === 'DFS') {
      // "Passo | Em | Olha | O que acontece | Pilha de chamadas": uma linha por arco olhado ou vértice encerrado
      var ls = [], de = new Int32Array(evs.length + 1).fill(-1), topo = -1, paiAte = new Int32Array(T.n).fill(-1);
      for (i = 0; i < evs.length; i++) {
        ev = evs[i];
        if (ev.t === 'descobre') {
          var pv = ev.p === undefined ? -1 : ev.p;
          paiAte[ev.v] = pv;
          if (pv === -1 || !ls.length) ls.push({ passo: ls.length, em: ev.v, olha: -1, tipo: 'raiz', d: ev.d, f: -1, topo: ev.v, ev0: i, ev1: i + 1 });
          else { var la = ls[ls.length - 1]; la.evDesc = i; la.topoAntes = la.topo; la.d = ev.d; la.topo = ev.v; la.ev1 = i + 1; }
          topo = ev.v;
        } else if (ev.t === 'olha') {
          ls.push({ passo: ls.length, em: ev.u, olha: ev.v, tipo: ev.tipo, d: -1, f: -1, topo: topo, ev0: i, ev1: i + 1 });
        } else if (ev.t === 'encerra') {
          topo = paiAte[ev.v];
          ls.push({ passo: ls.length, em: ev.v, olha: -1, tipo: 'encerra', d: -1, f: ev.f, topo: topo, ev0: i, ev1: i + 1 });
        }
        de[i + 1] = ls.length - 1;
      }
      t = { algoritmo: alg, linhas: ls, doEvento: de,
        pilha: function (l) { return pilhaDe(paiAte, l.topo); },
        frase: function (l) { return frase(T, l); },
        // a linha como estava depois de k eventos: o 'descobre' fundido na linha do 'olha' só conta depois de aplicado
        linhaAte: function (l, k) {
          if (k === undefined || l.evDesc === undefined || l.evDesc < k) return l;
          return { passo: l.passo, em: l.em, olha: l.olha, tipo: l.tipo, d: -1, f: l.f, topo: l.topoAntes, ev0: l.ev0, ev1: k };
        },
        sequencia: res.ordem,
        arestas: function (tipo) { return res.arcos.filter(function (a) { return a[2] === tipo; }); } };
    } else {
      // linhas = vértices (na ordem do primeiro rótulo); colunas = Passo 1..k
      // (Dijkstra: um 'fecha' por coluna, como no slide da AULA 05; Bellman-Ford: uma passada completa por coluna)
      var dij = alg === 'DIJKSTRA', n = T.n;
      var hist = new Array(n), fechadoEm = new Int32Array(n), vertices = [], primeiro = new Int32Array(n).fill(-1), primeiroEv = new Int32Array(n).fill(-1);
      var col = 0, s = T.inicio, fimColuna = [0], colDoEv = new Int32Array(evs.length + 1);
      if (!(dij && res.recusa)) { hist[s] = [[0, 0, -1, -1]]; vertices.push(s); primeiro[s] = 0; }
      for (i = 0; i < evs.length; i++) {
        ev = evs[i];
        if (dij ? ev.t === 'fecha' : ev.t === 'passada') { col++; if (dij) fechadoEm[ev.u] = col; }
        else if (ev.t === 'relaxa') {
          if (!hist[ev.v]) { hist[ev.v] = []; vertices.push(ev.v); primeiro[ev.v] = col; primeiroEv[ev.v] = i; }
          hist[ev.v].push([col, ev.depois, ev.u, i]);
        }
        fimColuna[col] = i + 1;
        colDoEv[i + 1] = col;
      }
      t = { algoritmo: alg, colunas: col, vertices: vertices, primeiraColuna: primeiro, fimColuna: fimColuna,
        fechadoEm: fechadoEm, historico: hist, primeiroEvento: primeiroEv,
        // nº de linhas visíveis até a coluna j (vertices está em ordem de primeiro rótulo); com k, só os vértices
        // rotulados nos k primeiros eventos (a coluna corrente ainda está sendo preenchida)
        linhasAte: function (j, k) {
          var a = 0, b = vertices.length;
          while (a < b) {
            var mm = (a + b) >> 1, vv = vertices[mm];
            if (primeiro[vv] <= j && (k === undefined || primeiroEv[vv] < k)) a = mm + 1; else b = mm;
          }
          return a;
        },
        // célula (v, coluna j) — null = '–' (desconhecido); {fechado:true} = '*' (Dijkstra, fechado antes);
        // riscados = valores de d superados dentro desta coluna (inclui o valor que vinha da coluna anterior)
        // com k, ignora os relaxamentos que ainda não aconteceram (eventos de índice ≥ k)
        celula: function (v, j, k) {
          if (dij && fechadoEm[v] && fechadoEm[v] < j) return { fechado: true };
          var h = hist[v];
          if (!h || h[0][0] > j) return null;
          var a = 0, b = h.length; while (a < b) { var mm = (a + b) >> 1; if (h[mm][0] <= j) a = mm + 1; else b = mm; }
          if (k !== undefined) while (a > 0 && h[a - 1][3] >= k) a--;
          if (a === 0) return null;
          var x = h[a - 1], riscados = [];
          if (x[0] === j && j > 0) for (var q = a - 2; q >= 0; q--) { riscados.unshift(h[q][1]); if (h[q][0] < j) break; }
          return { d: x[1], p: x[2], fechado: false, fechaAqui: dij && fechadoEm[v] === j, mudou: x[0] === j && j > 0, riscados: riscados };
        },
        colunaDoEvento: function (k) { return colDoEv[Math.max(0, Math.min(colDoEv.length - 1, k | 0))]; } };
    }
    T._tab = t;
    return t;
  }

  // ------------------------------------------------------------------ vocabulário da aula
  var NOME_CLASSE = { arvore: 'árvore', retorno: 'retorno', avanco: 'avanço', cruzamento: 'cruzamento' };
  var NOME_ESTADO = ['não visitado', 'visitado', 'encerrado'];
  function frase(T, l) {
    var c = function (i) { return T.curto(i); };
    if (l.tipo === 'raiz') return 'início em ' + c(l.em) + ', d = ' + l.d;
    if (l.tipo === 'encerra') return c(l.em) + ' encerra, f = ' + l.f;
    if (l.tipo === 'arvore') return l.d >= 0 ? 'novo → desce, d = ' + l.d : 'novo → desce';
    if (l.tipo === 'retorno') return c(l.olha) + ' ainda aberto → retorno';
    return c(l.olha) + ' já encerrado → ' + (NOME_CLASSE[l.tipo] || l.tipo);
  }
  // frase curta do evento k (barra de status do replay)
  function fraseEvento(T, ev) {
    if (!ev) return 'Antes do primeiro passo.';
    var c = function (i) { return T.curto(i); }, num = function (x) { return x === Infinity ? '∞' : String(x); };
    switch (T.algoritmo + ':' + ev.t) {
      case 'BFS:inicio': return c(ev.v) + ' entra na fila com d = 0.';
      case 'BFS:sai': return c(ev.v) + ' sai da fila.';
      case 'BFS:olha': return 'Olha o arco ' + c(ev.u) + ' → ' + c(ev.v) + (ev.novo === false ? ': já visitado.' : '.');
      case 'BFS:entra': return c(ev.v) + ' entra na fila: d = ' + ev.d + ', p = ' + c(ev.p) + '.';
      case 'BFS:encerra': return c(ev.v) + ' encerrado.';
      case 'DFS:descobre': return 'Descobre ' + c(ev.v) + ', d = ' + ev.d + '.';
      case 'DFS:olha': return 'Olha ' + c(ev.u) + ' → ' + c(ev.v) + ': arco de ' + (NOME_CLASSE[ev.tipo] || ev.tipo) + '.';
      case 'DFS:encerra': return c(ev.v) + ' encerra, f = ' + ev.f + '.';
      case 'DIJKSTRA:fecha': return 'Fecha ' + c(ev.u) + ' com d = ' + num(ev.d) + '.';
      case 'DIJKSTRA:relaxa': return 'Relaxa o arco ' + c(ev.u) + ' → ' + c(ev.v) + ': d ' + num(ev.antes) + ' → ' + num(ev.depois) + '.';
      case 'DIJKSTRA:descarta': return c(ev.u) + ' já estava fechado: descarta.';
      case 'BELLMAN_FORD:passada': return 'Começa a passada ' + ev.k + ' por todos os arcos.';
      case 'BELLMAN_FORD:relaxa': return 'Relaxa o arco ' + c(ev.u) + ' → ' + c(ev.v) + ': d ' + num(ev.antes) + ' → ' + num(ev.depois) + '.';
      case 'BELLMAN_FORD:fimPassada': return 'Fim da passada ' + ev.k + ': ' + (ev.mudou ? (ev.relaxados != null ? ev.relaxados + ' relaxamento(s).' : 'algo mudou.') : 'nada mudou, para cedo.');
      case 'BELLMAN_FORD:ciclo': return 'A passada extra ainda relaxa: ciclo negativo.';
    }
    return ev.t;
  }

  var api = {
    ALVO: ALVO, PASSO_CHECKPOINT: PASSO_CP, NOME_CLASSE: NOME_CLASSE, NOME_ESTADO: NOME_ESTADO,
    carregar: carregar, replay: replay, tabela: tabela, caminho: caminho, pilhaDe: pilhaDe,
    frase: frase, fraseEvento: fraseEvento,
    frases: { dfs: frase, evento: fraseEvento },
    curto: function (T, i) { return T.curto(i); }, partes: function (T, i) { return T.partes(i); }
  };
  LAB.traco = api;
  LAB.grafo = api; // alias (nome antigo)
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
