/* [IA] Claude – página da Parte 2: carrega os JSON pré-calculados (api/parte2/*) e desenha o grafo de rotação de um
   time-temporada num canvas 2D (nós em círculo por minutos, arcos curvos com seta e cor pelo sinal do peso),
   os destaques do ciclo negativo / caminho sem ciclo / par do Dijkstra, a tabela de jogadores e as tabelas do
   benchmark. Nenhum algoritmo roda aqui. Script clássico, sem dependências. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var NEG = [255, 84, 112], POS = [53, 200, 240], NEUTRO = [181, 168, 149];
  var TOCHA = "#FFB347", CESAR = "#FF6002", LUAR = "#EFE6D8", LUAR_FRACO = "#B5A895";
  var LIMITE_COR = 20; // |peso| a partir do qual a cor fica saturada (a legenda mostra −20 e +20)

  var estado = {
    indice: null, dados: null, modo: null, selecionado: null, sobre: null,
    ordem: { chave: "minutos", desc: true }, layout: null, bench: null
  };

  /* ------------------------------------------------------------ formatação (pt-BR) */
  function fmt(n, casas) {
    if (n === null || n === undefined || isNaN(n)) return "–";
    var s = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
    return (n < 0 && Number(s.replace(/\./g, "").replace(",", ".")) !== 0 ? "−" : "") + s;
  }
  function fmtSinal(n, casas) {
    var s = fmt(n, casas);
    return n > 0 && s !== fmt(0, casas) ? "+" + s : s;
  }
  function fmtMs(ms) {
    if (ms >= 100) return fmt(ms, 0) + " ms";
    if (ms >= 1) return fmt(ms, 2) + " ms";
    var casas = Math.min(6, Math.max(2, 2 - Math.floor(Math.log10(ms))));
    return fmt(ms, casas) + " ms";
  }
  function fmtInt(n) { return Number(n).toLocaleString("pt-BR"); }
  function rotuloTemporada(ano) { return ano + "-" + String((ano + 1) % 100).padStart(2, "0"); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function classeSinal(n) { return n < 0 ? "neg" : n > 0 ? "pos" : ""; }

  function corPeso(p, alfa) {
    var t = Math.min(Math.abs(p) / LIMITE_COR, 1), alvo = p < 0 ? NEG : POS;
    var c = NEUTRO.map(function (v, i) { return Math.round(v + (alvo[i] - v) * (0.35 + 0.65 * t)); });
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alfa + ")";
  }

  function json(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (e) { throw new Error(e.erro || r.status); });
      return r.json();
    });
  }

  /* ------------------------------------------------------------ servidor (pill) */
  (function servidor() {
    var pill = document.querySelector("[data-servidor-pill]");
    if (!pill) return;
    var inst = pill.querySelector("[data-servidor-inst]"), zona = pill.querySelector("[data-servidor-zona]");
    json("api/info").then(function (s) {
      pill.setAttribute("data-estado", "ok");
      inst.textContent = s.instancia || "servidor";
      zona.textContent = s.zona || "";
    }).catch(function () {
      pill.setAttribute("data-estado", "erro");
      inst.textContent = "servidor fora do ar";
    });
  })();

  /* ------------------------------------------------------------ abas */
  var abas = [$("abaGrafo"), $("abaGraf"), $("abaAlg")], paineis = [$("painelGrafo"), $("painelGraf"), $("painelAlg")];
  function abrirAba(i, focar) {
    abas.forEach(function (a, k) {
      var sel = k === i;
      a.setAttribute("aria-selected", sel ? "true" : "false");
      a.tabIndex = sel ? 0 : -1;
      paineis[k].hidden = !sel;
    });
    if (focar) abas[i].focus();
    var hash = i === 2 ? "#algoritmos" : i === 1 ? "#graficos" : "";
    if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
    if (i === 2) carregarBench(); else if (i === 1) carregarGraficos(); else desenhar();
  }
  abas.forEach(function (a, i) {
    a.addEventListener("click", function () { abrirAba(i, false); });
    a.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        abrirAba((i + (ev.key === "ArrowRight" ? 1 : abas.length - 1)) % abas.length, true);
      }
    });
  });

  /* ------------------------------------------------------------ seleção de time-temporada */
  var selTemp = $("selTemporada"), selTime = $("selTime");

  function preencherTimes(ano, preferido) {
    var t = estado.indice.temporadas.filter(function (x) { return x.ano === ano; })[0];
    selTime.innerHTML = t.times.map(function (x) {
      return '<option value="' + esc(x.time) + '">' + esc(x.time) + "</option>";
    }).join("");
    var tem = t.times.some(function (x) { return x.time === preferido; });
    selTime.value = tem ? preferido : t.times[0].time;
  }

  function lerUrl() {
    var q = new URLSearchParams(location.search);
    return { time: (q.get("time") || "").toUpperCase(), ano: parseInt(q.get("temporada"), 10) };
  }
  function gravarUrl() {
    var q = new URLSearchParams();
    q.set("temporada", selTemp.value);
    q.set("time", selTime.value);
    history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash);
  }

  json("api/parte2/indice").then(function (ind) {
    estado.indice = ind;
    $("notaImpacto").textContent = ind.descricao_impacto.charAt(0).toUpperCase() + ind.descricao_impacto.slice(1) + ".";
    selTemp.innerHTML = ind.temporadas.map(function (t) {
      return '<option value="' + t.ano + '">' + rotuloTemporada(t.ano) + "</option>";
    }).join("");
    var url = lerUrl(), anos = ind.temporadas.map(function (t) { return t.ano; });
    var ano = anos.indexOf(url.ano) >= 0 ? url.ano : anos[anos.length - 1];
    selTemp.value = String(ano);
    preencherTimes(ano, url.time);
    carregarTime();
  }).catch(function (e) {
    $("carregando").textContent = "não foi possível carregar os dados: " + e.message;
  });

  selTemp.addEventListener("change", function () {
    preencherTimes(parseInt(selTemp.value, 10), selTime.value);
    carregarTime();
  });
  selTime.addEventListener("change", carregarTime);

  var pedido = 0;
  function carregarTime() {
    var n = ++pedido;
    gravarUrl();
    $("carregando").hidden = false;
    $("carregando").textContent = "carregando…";
    json("api/parte2/rotacao/" + encodeURIComponent(selTime.value) + "/" + selTemp.value).then(function (d) {
      if (n !== pedido) return;
      $("carregando").hidden = true;
      prepararDados(d);
    }).catch(function (e) {
      if (n !== pedido) return;
      $("carregando").textContent = "não foi possível carregar: " + e.message;
    });
  }

  function prepararDados(d) {
    d.saidas = d.nos.map(function () { return []; });
    d.chegadas = d.nos.map(function () { return []; });
    d.arcos.forEach(function (a, k) { d.saidas[a[0]].push(k); d.chegadas[a[1]].push(k); });
    d.chaveArco = {};
    d.arcos.forEach(function (a, k) { d.chaveArco[a[0] + ">" + a[1]] = k; });
    estado.dados = d;
    estado.selecionado = null;
    estado.sobre = null;
    $("contagem").innerHTML = "<b>" + d.nos.length + "</b> jogadores, <b>" + fmtInt(d.arcos.length) +
      "</b> trocas diferentes (arcos), <b>" + fmtInt(d.arcos_negativos) + "</b> delas com peso negativo";
    var btnDij = document.querySelector('[data-modo="dijkstra"]');
    btnDij.hidden = !d.dijkstra;
    if (estado.modo === "dijkstra" && !d.dijkstra) estado.modo = null;
    $("tela").setAttribute("aria-label", "Grafo de rotação de " + d.time + " na temporada " + rotuloTemporada(d.temporada) +
      ": " + d.nos.length + " jogadores e " + d.arcos.length + " arcos. Os mesmos dados estão na tabela de jogadores.");
    atualizarModos();
    montarTabela();
    medir();
    desenhar();
  }

  /* ------------------------------------------------------------ destaques */
  var botoesModo = Array.prototype.slice.call(document.querySelectorAll("[data-modo]"));
  botoesModo.forEach(function (b) {
    b.addEventListener("click", function () {
      var m = b.getAttribute("data-modo");
      estado.modo = estado.modo === m ? null : m;
      atualizarModos();
      desenhar();
    });
  });

  function destaqueAtual() {
    var d = estado.dados;
    if (!d || !estado.modo) return null;
    if (estado.modo === "ciclo") return d.bellman_ford && d.bellman_ford.ciclo ? d.bellman_ford : null;
    if (estado.modo === "sem_ciclo") return d.sem_ciclo || null;
    if (estado.modo === "dijkstra") return d.dijkstra || null;
    return null;
  }

  function nomeNo(i) { return estado.dados.nos[i].nome; }

  function atualizarModos() {
    botoesModo.forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-modo") === estado.modo ? "true" : "false");
    });
    var d = estado.dados, caixa = $("detalhe");
    if (!d) { caixa.innerHTML = ""; return; }
    var html = "";
    if (estado.selecionado !== null) {
      html += '<div class="p2-selecionado"><span>Jogador: <b>' + esc(nomeNo(estado.selecionado)) +
        '</b></span><button type="button" id="limparSel">limpar</button></div>';
    }
    var h = destaqueAtual();
    if (estado.modo === "ciclo") {
      if (h) {
        html += '<p class="p2-detalhe__texto">Ciclo negativo devolvido pelo Bellman-Ford do grupo a partir de <b>' +
          esc(nomeNo(h.fonte)) + "</b> (jogador com mais minutos), no subgrafo do time-temporada. " +
          (h.passos.length) + " arcos.</p>";
        html += listaPassos(h.passos) + total("Custo do ciclo", h.custo);
      } else {
        html += '<p class="p2-detalhe__texto">O Bellman-Ford não encontrou ciclo negativo a partir da fonte neste time-temporada.</p>';
      }
    } else if (estado.modo === "sem_ciclo" && h) {
      html += '<p class="p2-detalhe__texto">Recorte só com arcos de quem tem mais minutos para quem tem menos (' +
        fmtInt(h.arcos_recorte) + " arcos, sem ciclo). Caminho do Bellman-Ford de <b>" + esc(nomeNo(h.fonte)) +
        "</b> até o nó de menor distância, <b>" + esc(nomeNo(h.destino)) + "</b>.</p>";
      html += listaPassos(h.passos) + total("Custo do caminho", h.custo);
    } else if (estado.modo === "dijkstra" && h) {
      html += '<p class="p2-detalhe__texto">Dijkstra do grupo no recorte sem ciclo com pesos reponderados (Johnson): ' +
        "custo transformado " + fmt(h.custo_transformado, 2) + ", reconvertido " + fmt(h.custo_reconvertido, 2) +
        ", Bellman-Ford " + fmt(h.custo_bellman_ford, 2) + ". Caminho igual ao do Bellman-Ford: " +
        (h.caminho_igual ? "sim" : "não") + ".</p>";
      html += listaPassos(h.passos) + total("Custo original", h.custo_reconvertido);
    } else if (!estado.modo && estado.selecionado === null) {
      html += '<p class="p2-detalhe__texto">Escolha um destaque acima ou clique num jogador (no grafo ou na tabela) para ver só os arcos dele.</p>';
    }
    caixa.innerHTML = html;
    var limpar = $("limparSel");
    if (limpar) limpar.addEventListener("click", function () { selecionar(null); });
  }

  function listaPassos(passos) {
    return '<ol class="p2-passos">' + passos.map(function (p, k) {
      return '<li class="p2-passo"><span class="p2-passo__n">' + (k + 1) + '</span>' +
        '<span class="p2-passo__arco">' + esc(nomeNo(p.de)) + " <span>→</span> " + esc(nomeNo(p.para)) + "</span>" +
        '<span class="p2-passo__peso ' + classeSinal(p.peso) + '">' + fmtSinal(p.peso, 2) + " pts</span>" +
        '<span class="p2-passo__acum">acumulado ' + fmtSinal(p.acumulado, 2) + " pts</span></li>";
    }).join("") + "</ol>";
  }
  function total(rotulo, v) {
    return '<p class="p2-total"><span>' + rotulo + "</span><span>" + fmtSinal(v, 2) + " pts por 12 min</span></p>";
  }

  function selecionar(i) {
    estado.selecionado = estado.selecionado === i ? null : i;
    atualizarModos();
    marcarLinha();
    desenhar();
  }

  /* ------------------------------------------------------------ tabela de jogadores */
  var tabela = $("tabelaJogadores");
  Array.prototype.forEach.call(tabela.querySelectorAll("[data-ordem]"), function (b) {
    b.addEventListener("click", function () {
      var k = b.getAttribute("data-ordem");
      if (estado.ordem.chave === k) estado.ordem.desc = !estado.ordem.desc;
      else estado.ordem = { chave: k, desc: k !== "nome" };
      montarTabela();
    });
  });

  function montarTabela() {
    var d = estado.dados;
    if (!d) return;
    var o = estado.ordem;
    var idx = d.nos.map(function (_, i) { return i; });
    idx.sort(function (a, b) {
      var x = d.nos[a][o.chave], y = d.nos[b][o.chave];
      if (o.chave === "nome") return (o.desc ? -1 : 1) * String(x).localeCompare(String(y), "pt-BR");
      if (x === null) return 1;
      if (y === null) return -1;
      return o.desc ? y - x : x - y;
    });
    Array.prototype.forEach.call(tabela.querySelectorAll("th[aria-sort]"), function (th) {
      var k = th.querySelector("button").getAttribute("data-ordem");
      th.setAttribute("aria-sort", k === o.chave ? (o.desc ? "descending" : "ascending") : "none");
    });
    tabela.tBodies[0].innerHTML = idx.map(function (i) {
      var n = d.nos[i];
      var imp = n.impacto_medio === null ? '<td class="num vazio">–</td>'
        : '<td class="num ' + classeSinal(n.impacto_medio) + '">' + fmtSinal(n.impacto_medio, 2) + "</td>";
      return '<tr data-i="' + i + '"><th scope="row"><button type="button" data-no="' + i + '">' + esc(n.nome) +
        "</button></th>" + '<td class="num">' + fmt(n.minutos, 1) + "</td>" +
        '<td class="num">' + fmtInt(n.entradas) + "</td>" + imp + "</tr>";
    }).join("");
    marcarLinha();
  }
  tabela.tBodies[0].addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-no]");
    if (!b) return;
    selecionar(parseInt(b.getAttribute("data-no"), 10));
    if (window.innerWidth <= 1000) $("area").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  function marcarLinha() {
    Array.prototype.forEach.call(tabela.tBodies[0].rows, function (tr) {
      var sel = parseInt(tr.getAttribute("data-i"), 10) === estado.selecionado;
      tr.classList.toggle("is-selecionado", sel);
      var b = tr.querySelector("button");
      if (b) b.setAttribute("aria-pressed", sel ? "true" : "false");
    });
  }

  /* ------------------------------------------------------------ canvas: layout */
  var tela = $("tela"), area = $("area"), ctx = tela.getContext("2d"), dica = $("dica");

  function medir() {
    var w = area.clientWidth;
    if (!w) return;
    var h = Math.round(w < 560 ? Math.max(340, w * 1.05) : Math.max(340, Math.min(w * 0.78, 640)));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    tela.width = Math.round(w * dpr);
    tela.height = Math.round(h * dpr);
    tela.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var d = estado.dados;
    if (!d) return;
    var estreito = w < 560;
    var margem = estreito ? 70 : 140; // espaço dos nomes fora do círculo
    var Rx = Math.max(60, w / 2 - margem), Ry = Math.max(80, h / 2 - (estreito ? 40 : 48));
    // tela larga: círculo; tela estreita: elipse em pé, para usar a altura
    var R = Math.min(Rx, Ry);
    if (!estreito) { Rx = R; Ry = R; }
    var cx = w / 2, cy = h / 2, n = d.nos.length;
    var maxMin = d.nos.reduce(function (m, x) { return Math.max(m, x.minutos); }, 1);
    estado.layout = {
      w: w, h: h, cx: cx, cy: cy, R: R, estreito: estreito,
      pos: d.nos.map(function (no, i) {
        var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
        return {
          x: cx + Rx * Math.cos(ang), y: cy + Ry * Math.sin(ang), ang: ang,
          r: 3.5 + Math.sqrt(no.minutos / maxMin) * (estreito ? 7 : 10)
        };
      })
    };
  }

  // curva do arco u -> v: controle puxado para o centro e deslocado para um lado (u->v e v->u não se sobrepõem)
  function curva(u, v) {
    var L = estado.layout, a = L.pos[u], b = L.pos[v];
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    var px = -dy / len, py = dx / len;
    var desvio = Math.min(16, len * 0.12);
    var cxp = mx + (L.cx - mx) * 0.35 + px * desvio, cyp = my + (L.cy - my) * 0.35 + py * desvio;
    // ponta da seta na borda do nó de destino
    var tx = b.x - cxp, ty = b.y - cyp, tl = Math.hypot(tx, ty) || 1;
    var ex = b.x - (tx / tl) * (b.r + 2), ey = b.y - (ty / tl) * (b.r + 2);
    var sx0 = a.x - cxp, sy0 = a.y - cyp, sl = Math.hypot(sx0, sy0) || 1;
    var sx = a.x - (sx0 / sl) * a.r, sy = a.y - (sy0 / sl) * a.r;
    return { sx: sx, sy: sy, cx: cxp, cy: cyp, ex: ex, ey: ey, ux: tx / tl, uy: ty / tl };
  }

  function tracarArco(u, v, cor, larg, seta) {
    var c = curva(u, v);
    ctx.strokeStyle = cor;
    ctx.lineWidth = larg;
    ctx.beginPath();
    ctx.moveTo(c.sx, c.sy);
    ctx.quadraticCurveTo(c.cx, c.cy, c.ex - c.ux * seta * 0.6, c.ey - c.uy * seta * 0.6);
    ctx.stroke();
    if (seta > 0) {
      ctx.fillStyle = cor;
      ctx.beginPath();
      ctx.moveTo(c.ex, c.ey);
      ctx.lineTo(c.ex - c.ux * seta - c.uy * seta * 0.55, c.ey - c.uy * seta + c.ux * seta * 0.55);
      ctx.lineTo(c.ex - c.ux * seta + c.uy * seta * 0.55, c.ey - c.uy * seta - c.ux * seta * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    return c;
  }

  /* ------------------------------------------------------------ canvas: desenho */
  function desenhar() {
    var d = estado.dados, L = estado.layout;
    if (!d || !L || paineis[0].hidden) return;
    ctx.clearRect(0, 0, L.w, L.h);
    var h = destaqueAtual();
    var foco = estado.selecionado !== null ? estado.selecionado : estado.sobre;
    var emCaminho = {}, arcosCaminho = [];
    if (h) {
      var seq = h.ciclo || h.caminho;
      seq.forEach(function (i) { emCaminho[i] = true; });
      h.passos.forEach(function (p) { arcosCaminho.push(p); });
    }
    var apagado = !!h || foco !== null && foco !== undefined;

    // arcos de fundo (do mais fraco para o mais forte, para os fortes ficarem por cima)
    var ordem = d.arcos.map(function (_, k) { return k; });
    ordem.sort(function (a, b) { return Math.abs(d.arcos[a][2]) - Math.abs(d.arcos[b][2]); });
    ordem.forEach(function (k) {
      var a = d.arcos[k], t = Math.min(Math.abs(a[2]) / LIMITE_COR, 1);
      var ligado = foco !== null && foco !== undefined && (a[0] === foco || a[1] === foco);
      if (ligado && !h) return; // desenhados depois, por cima
      var alfa = apagado ? 0.05 : 0.16 + 0.42 * t;
      tracarArco(a[0], a[1], corPeso(a[2], alfa), apagado ? 1 : 0.8 + 1.2 * t, apagado ? 0 : 4 + 2 * t);
    });

    // arcos do jogador em foco (sem destaque de algoritmo)
    if (!h && foco !== null && foco !== undefined) {
      d.saidas[foco].concat(d.chegadas[foco]).forEach(function (k) {
        var a = d.arcos[k], t = Math.min(Math.abs(a[2]) / LIMITE_COR, 1);
        tracarArco(a[0], a[1], corPeso(a[2], 0.55 + 0.45 * t), 1.4 + 1.6 * t, 6 + 2 * t);
      });
    }

    // arcos do destaque, numerados
    var rotulosPasso = [];
    arcosCaminho.forEach(function (p, k) {
      ctx.save();
      tracarArco(p.de, p.para, "rgba(18,15,12,0.9)", 7, 0);
      ctx.restore();
      var c = tracarArco(p.de, p.para, corPeso(p.peso, 1), 3, 11);
      // ponto médio da curva quadrática (t = 0,5)
      rotulosPasso.push({ n: k + 1, x: 0.25 * c.sx + 0.5 * c.cx + 0.25 * c.ex, y: 0.25 * c.sy + 0.5 * c.cy + 0.25 * c.ey });
    });

    // nós
    d.nos.forEach(function (no, i) {
      var p = L.pos[i];
      var vizinho = foco !== null && foco !== undefined &&
        (i === foco || d.chaveArco[foco + ">" + i] !== undefined || d.chaveArco[i + ">" + foco] !== undefined);
      var aceso = h ? emCaminho[i] : (foco === null || foco === undefined) ? true : vizinho;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
      ctx.fillStyle = aceso ? "#D9CCB8" : "#4A3E33";
      ctx.fill();
      if (h && (i === (h.fonte !== undefined ? h.fonte : h.origem))) {
        ctx.lineWidth = 3; ctx.strokeStyle = CESAR; ctx.stroke();
      } else if (h && emCaminho[i]) {
        ctx.lineWidth = 2.5; ctx.strokeStyle = TOCHA; ctx.stroke();
      } else if (i === foco) {
        ctx.lineWidth = 3; ctx.strokeStyle = CESAR; ctx.stroke();
      }
    });

    // nomes fora do círculo: os acesos primeiro; quem colide sobe um degrau para fora, depois vira abreviação,
    // e por último some (só nomes apagados somem; os do destaque sempre aparecem)
    var alturaTexto = L.estreito ? 13 : 15;
    ctx.font = (L.estreito ? 11 : 12.5) + "px 'DM Sans', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    var postos = [];
    function caixa(texto, x, y, alinh) {
      var w = ctx.measureText(texto).width;
      var x0 = alinh === "center" ? x - w / 2 : alinh === "left" ? x : x - w;
      return { x0: x0 - 3, x1: x0 + w + 3, y0: y - alturaTexto / 2, y1: y + alturaTexto / 2 };
    }
    function bate(c) {
      if (c.x0 < 2 || c.x1 > L.w - 2 || c.y0 < 2 || c.y1 > L.h - 2) return true;
      return postos.some(function (o) { return c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0; });
    }
    var ordemNomes = d.nos.map(function (_, i) { return i; });
    var acesoNo = function (i) {
      var vizinho = foco !== null && foco !== undefined &&
        (i === foco || d.chaveArco[foco + ">" + i] !== undefined || d.chaveArco[i + ">" + foco] !== undefined);
      return h ? !!emCaminho[i] : (foco === null || foco === undefined) ? true : vizinho;
    };
    ordemNomes.sort(function (a, b) { return (acesoNo(b) ? 1 : 0) - (acesoNo(a) ? 1 : 0) || a - b; });
    ordemNomes.forEach(function (i) {
      var no = d.nos[i], p = L.pos[i], aceso = acesoNo(i);
      var cos = Math.cos(p.ang), sin = Math.sin(p.ang);
      var lado = cos >= 0 ? "left" : "right";
      var alinhs = Math.abs(cos) < 0.3 ? ["center", lado] : [lado];
      var alinh = alinhs[0];
      var textos = L.estreito ? [abreviar(no.nome)] : [no.nome, abreviar(no.nome)];
      var escolha = null;
      textos.some(function (t) {
        alinhs.some(function (al) {
          for (var k = 0; k < 6 && !escolha; k++) {
            var dist = p.r + 7 + k * (al === "center" ? alturaTexto : 6);
            var x = p.x + cos * dist, y = p.y + sin * dist;
            if (al === "center") y += sin * 6;
            var c = caixa(t, x, y, al);
            if (!bate(c)) { escolha = { t: t, x: x, y: y, c: c }; alinh = al; }
          }
          return !!escolha;
        });
        return !!escolha;
      });
      if (!escolha) {
        if (!aceso || (h && !emCaminho[i])) return;
        var dist0 = p.r + 7, t0 = textos[textos.length - 1];
        escolha = { t: t0, x: p.x + cos * dist0, y: p.y + sin * dist0 + (alinh === "center" ? sin * 6 : 0) };
        escolha.c = caixa(t0, escolha.x, escolha.y, alinh);
      }
      postos.push(escolha.c);
      ctx.textAlign = alinh;
      ctx.fillStyle = i === foco ? LUAR : aceso ? (apagado ? LUAR : LUAR_FRACO) : "rgba(181,168,149,0.35)";
      ctx.fillText(escolha.t, escolha.x, escolha.y);
    });

    // números dos passos
    ctx.font = "600 12px 'Pixelify Sans', 'DM Sans', sans-serif";
    ctx.textAlign = "center";
    rotulosPasso.forEach(function (r) {
      ctx.fillStyle = TOCHA;
      ctx.fillRect(r.x - 9, r.y - 9, 18, 18);
      ctx.fillStyle = "#1A1612";
      ctx.fillText(String(r.n), r.x, r.y + 1);
    });
  }

  function abreviar(nome) {
    var partes = nome.split(" ");
    if (partes.length < 2) return nome;
    return partes[0].charAt(0) + ". " + partes.slice(1).join(" ");
  }

  /* ------------------------------------------------------------ canvas: interação */
  function noEm(ev) {
    var L = estado.layout, d = estado.dados;
    if (!L || !d) return null;
    var r = tela.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top, melhor = null, md = Infinity;
    L.pos.forEach(function (p, i) {
      var dd = Math.hypot(p.x - x, p.y - y);
      if (dd < Math.max(p.r + 6, 12) && dd < md) { md = dd; melhor = i; }
    });
    return melhor;
  }

  function mostrarDica(i, ev) {
    if (i === null) { dica.hidden = true; return; }
    var d = estado.dados, n = d.nos[i];
    dica.innerHTML = "<strong>" + esc(n.nome) + "</strong><dl>" +
      "<dt>Minutos em quadra</dt><dd>" + fmt(n.minutos, 1) + "</dd>" +
      "<dt>Entradas (trocas)</dt><dd>" + fmtInt(n.entradas) + "</dd>" +
      "<dt>Impacto médio</dt><dd>" + (n.impacto_medio === null ? "–" : fmtSinal(n.impacto_medio, 2) + " pts/12 min") + "</dd>" +
      "<dt>Arcos que saem</dt><dd>" + d.saidas[i].length + "</dd>" +
      "<dt>Arcos que chegam</dt><dd>" + d.chegadas[i].length + "</dd></dl>";
    dica.hidden = false;
    var r = area.getBoundingClientRect();
    var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
    if (x + dica.offsetWidth > r.width - 8) x = ev.clientX - r.left - dica.offsetWidth - 14;
    if (y + dica.offsetHeight > r.height - 8) y = ev.clientY - r.top - dica.offsetHeight - 14;
    dica.style.left = Math.max(8, x) + "px";
    dica.style.top = Math.max(8, y) + "px";
  }

  tela.addEventListener("mousemove", function (ev) {
    var i = noEm(ev);
    tela.classList.toggle("is-sobre", i !== null);
    mostrarDica(i, ev);
    if (i !== estado.sobre) { estado.sobre = i; desenhar(); }
  });
  tela.addEventListener("mouseleave", function () {
    dica.hidden = true;
    if (estado.sobre !== null) { estado.sobre = null; desenhar(); }
  });
  tela.addEventListener("click", function (ev) {
    var i = noEm(ev);
    if (i === null) { if (estado.selecionado !== null) selecionar(null); return; }
    selecionar(i);
  });

  var tMedir;
  window.addEventListener("resize", function () {
    clearTimeout(tMedir);
    tMedir = setTimeout(function () { medir(); desenhar(); }, 120);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { desenhar(); });

  /* ------------------------------------------------------------ aba Algoritmos */
  var NOME_GRAFO = {
    completo: "grafo completo",
    componente: "um time-temporada",
    recorte_sem_ciclo: "recorte sem ciclo"
  };

  function carregarBench() {
    if (estado.bench) return;
    estado.bench = "carregando";
    json("api/parte2/benchmark").then(function (b) {
      estado.bench = b;
      $("fatosBench").textContent = "Grafo de rotação: |V| = " + fmtInt(b.V) + ", |E| = " + fmtInt(b.E) +
        ". Média de " + b.repeticoes + " execuções por tarefa (time.perf_counter). Amostras de " +
        b.fracoes.map(function (f) { return Math.round(f * 100) + "%"; }).join(", ") +
        " dos time-temporadas, semente " + b.semente + ".";
      $("tabelaTempos").tBodies[0].innerHTML = b.tempos.map(function (t) {
        return "<tr><th scope=\"row\">" + esc(t.algoritmo) + "</th><td>" + esc(NOME_GRAFO[t.grafo] || t.grafo) +
          '</td><td class="num">' + fmtInt(t.tarefas) + '</td><td class="num">' + fmtMs(t.media_ms) +
          '</td><td class="num">' + fmtMs(t.min_ms) + '</td><td class="num">' + fmtMs(t.max_ms) + "</td></tr>";
      }).join("");
      montarEscalas(b);
    }).catch(function (e) {
      estado.bench = null;
      $("fatosBench").textContent = "não foi possível carregar o benchmark: " + e.message;
    });
  }

  function montarEscalas(b) {
    var grafos = [];
    b.escalabilidade.forEach(function (e) { if (grafos.indexOf(e.grafo) < 0) grafos.push(e.grafo); });
    var fr = b.fracoes;
    $("escalas").innerHTML = grafos.map(function (g) {
      var linhas = b.escalabilidade.filter(function (e) { return e.grafo === g; });
      var algs = [];
      linhas.forEach(function (e) { if (algs.indexOf(e.algoritmo) < 0) algs.push(e.algoritmo); });
      var cab = fr.map(function (f) {
        var e = linhas.filter(function (x) { return x.amostra === f; })[0];
        return '<th scope="col" class="num">' + Math.round(f * 100) + "%<small>V " + fmtInt(e.V) + " · E " +
          fmtInt(e.E) + "</small></th>";
      }).join("");
      var corpo = algs.map(function (a) {
        var da = linhas.filter(function (x) { return x.algoritmo === a; });
        var ult = da[da.length - 1];
        return "<tr><th scope=\"row\">" + esc(a) + "</th><td>" + esc(da[0].complexidade) + "</td>" +
          fr.map(function (f) {
            var e = da.filter(function (x) { return x.amostra === f; })[0];
            return '<td class="num">' + (e ? fmtMs(e.media_ms) : "–") + "</td>";
          }).join("") +
          '<td class="num">' + fmt(ult.crescimento_tempo, 1) + "×</td>" +
          '<td class="num">' + fmt(ult.crescimento_teorico, 1) + "×</td></tr>";
      }).join("");
      return '<div class="p2-escala-grafo"><h3>' + esc((NOME_GRAFO[g] || g).replace(/^./, function (c) { return c.toUpperCase(); })) +
        '</h3><div class="p2-rolagem"><table class="p2-tabela"><thead><tr><th scope="col">Algoritmo</th>' +
        '<th scope="col">Complexidade</th>' + cab +
        '<th scope="col" class="num">Crescimento<small>' + Math.round(fr[0] * 100) + "% → " +
        Math.round(fr[fr.length - 1] * 100) + "%, medido</small></th>" +
        '<th scope="col" class="num">Crescimento<small>teórico</small></th></tr></thead><tbody>' + corpo +
        "</tbody></table></div></div>";
    }).join("");
  }

  /* ------------------------------------------------------------ aba Gráficos */
  /* [IA] Claude – versões interativas dos gráficos escolhidos pelo grupo: dispersão impacto × minutos (cor por time,
     nome nas bolinhas, quadrante impacto > 0 e minutos < mediana da temporada) e barras do impacto médio por time
     (5 maiores e 5 menores destacados). Os números vêm prontos de api/parte2/graficos. */
  var PALETA = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F",
    "#BAB0AC", "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22",
    "#17BECF", "#AEC7E8", "#FFBB78", "#98DF8A", "#FF9896", "#C5B0D5", "#C49C94", "#F7B6D2", "#DBDB8D", "#9EDAE5", "#393B79"];
  var graf = { dados: null, cor: {}, pontos: [], layout: null, sobre: null };
  var gTemp = $("gTemporada"), gTime = $("gTime");

  function carregarGraficos() {
    if (graf.dados) { desenharBolinhas(); return; }
    if (graf.dados === false) return;
    graf.dados = false;
    json("api/parte2/graficos").then(function (d) {
      var times = {};
      d.jogadores.forEach(function (p) { times[p[1]] = 1; });
      Object.keys(times).sort().forEach(function (t, i) { graf.cor[t] = PALETA[i % PALETA.length]; });
      var anos = {};
      d.jogadores.forEach(function (p) { anos[p[2]] = 1; });
      var lista = Object.keys(anos).map(Number).sort();
      gTemp.innerHTML = '<option value="todas">todas (2020-21 a 2025-26)</option>' + lista.slice().reverse().map(function (a) {
        return '<option value="' + a + '">' + rotuloTemporada(a) + "</option>";
      }).join("");
      gTemp.value = String(lista[lista.length - 1]);
      gTime.innerHTML = '<option value="">todos</option>' + Object.keys(times).sort().map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
      }).join("");
      $("gMin").textContent = d.min_entradas;
      graf.dados = d;
      atualizarGraficos();
    }).catch(function (e) {
      graf.dados = null;
      $("gContagem").textContent = "não foi possível carregar os gráficos: " + e.message;
    });
  }

  function mediana(v) {
    if (!v.length) return 0;
    var s = v.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function atualizarGraficos() {
    var d = graf.dados, temp = gTemp.value, time = gTime.value;
    var daTemp = d.jogadores.filter(function (p) { return temp === "todas" || String(p[2]) === temp; });
    // a mediana de minutos é a da temporada (ou de todas), não muda com o filtro de time
    graf.mediana = mediana(daTemp.map(function (p) { return p[3]; }));
    graf.pontos = daTemp.filter(function (p) { return !time || p[1] === time; });
    var quad = graf.pontos.filter(function (p) { return p[4] > 0 && p[3] < graf.mediana; }).length;
    $("gContagem").innerHTML = "<b>" + fmtInt(graf.pontos.length) + "</b> jogadores, <b>" + fmtInt(quad) +
      "</b> no quadrante, mediana de minutos <b>" + fmt(graf.mediana, 0) + "</b>";
    var ex = graf.pontos.filter(function (p) { return p[4] > 0 && p[3] < graf.mediana; })
      .sort(function (x, y) { return y[4] - x[4]; })[0] || graf.pontos.slice().sort(function (x, y) { return y[4] - x[4]; })[0];
    $("gComoLer").innerHTML = ex ? "<b>Como ler:</b> cada bolinha é um jogador numa temporada. No eixo vertical, o <b>impacto</b>: " +
      "quantos pontos de saldo o time ganhou (+) ou perdeu (−) a cada 12 minutos depois que o jogador entrou, comparado ao trecho " +
      "anterior com quem ele substituiu. Exemplo: <b>" + esc(ex[0]) + "</b> (" + esc(ex[1]) + " " + rotuloTemporada(ex[2]) + ") está em <b>" +
      fmtSinal(ex[4], 2) + "</b>: quando entrou, o saldo do time ficou, em média, " + fmt(Math.abs(ex[4]), 2) + " pontos " +
      (ex[4] >= 0 ? "melhor" : "pior") + " a cada 12 minutos; ele somou " + fmt(ex[3], 0) + " minutos em quadra em " + fmtInt(ex[5]) + " entradas." : "";
    desenharBolinhas();
    montarBarras();
  }
  gTemp.addEventListener("change", atualizarGraficos);
  gTime.addEventListener("change", atualizarGraficos);

  function desenharBolinhas() {
    var tela = $("gTela"), area = $("gArea");
    if (!graf.dados || paineis[1].hidden) return;
    var dpr = window.devicePixelRatio || 1, larg = area.clientWidth, alt = Math.max(360, Math.min(620, Math.round(larg * 0.58)));
    tela.width = larg * dpr; tela.height = alt * dpr; tela.style.height = alt + "px";
    var ctx = tela.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, larg, alt);
    var todos = graf.dados.jogadores.filter(function (p) { return gTemp.value === "todas" || String(p[2]) === gTemp.value; });
    var mx = { e: 56, d: 16, t: 16, b: 44 };
    var xs = todos.map(function (p) { return p[3]; }), ys = todos.map(function (p) { return p[4]; });
    var x0 = Math.min.apply(null, xs) * 0.95, x1 = Math.max.apply(null, xs) * 1.03;
    var y0 = Math.min(Math.min.apply(null, ys), -1) - 0.5, y1 = Math.max(Math.max.apply(null, ys), 1) + 0.5;
    var X = function (v) { return mx.e + (v - x0) / (x1 - x0) * (larg - mx.e - mx.d); };
    var Y = function (v) { return mx.t + (y1 - v) / (y1 - y0) * (alt - mx.t - mx.b); };
    graf.layout = { X: X, Y: Y };
    // quadrante destacado e linhas de referência
    ctx.fillStyle = "rgba(255,179,71,.10)";
    ctx.fillRect(X(x0), Y(y1), X(graf.mediana) - X(x0), Y(0) - Y(y1));
    ctx.strokeStyle = LUAR_FRACO; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(x0), Y(0)); ctx.lineTo(X(x1), Y(0)); ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(graf.mediana), Y(y1)); ctx.lineTo(X(graf.mediana), Y(y0)); ctx.stroke();
    ctx.setLineDash([]);
    // eixos (marcas simples)
    ctx.fillStyle = LUAR_FRACO; ctx.font = "12px 'DM Sans', sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (var yv = Math.ceil(y0 / 2.5) * 2.5; yv <= y1; yv += 2.5) ctx.fillText(fmtSinal(yv, 1), mx.e - 8, Y(yv));
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    var passoX = (x1 - x0) > 1500 ? 500 : 200;
    for (var xv = Math.ceil(x0 / passoX) * passoX; xv <= x1; xv += passoX) ctx.fillText(fmtInt(xv), X(xv), alt - mx.b + 8);
    ctx.fillText("minutos em quadra medidos nas trocas (tracejado = mediana " + fmt(graf.mediana, 0) + " min)", (mx.e + larg) / 2, alt - 18);
    ctx.save(); ctx.translate(14, (mx.t + alt - mx.b) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle"; ctx.fillText("impacto: mudança no saldo do time a cada 12 min ao entrar (pts)", 0, 0); ctx.restore();
    // bolinhas
    var r = graf.pontos.length > 400 ? 3.5 : 5;
    graf.pontos.forEach(function (p) {
      ctx.beginPath(); ctx.arc(X(p[3]), Y(p[4]), r, 0, Math.PI * 2);
      ctx.fillStyle = graf.cor[p[1]]; ctx.fill();
      if (graf.sobre === p) { ctx.lineWidth = 2; ctx.strokeStyle = LUAR; ctx.stroke(); }
    });
    // nomes: primeiro os do quadrante (maior impacto antes), depois os demais por |impacto|; pula o que colidir
    var noQuad = function (p) { return p[4] > 0 && p[3] < graf.mediana; };
    var ordem = graf.pontos.slice().sort(function (a, b) {
      var qa = noQuad(a), qb = noQuad(b);
      if (qa !== qb) return qa ? -1 : 1;
      return qa ? b[4] - a[4] : Math.abs(b[4]) - Math.abs(a[4]);
    });
    // o rótulo do quadrante entra primeiro na lista de áreas ocupadas
    ctx.font = "600 12px 'DM Sans', sans-serif";
    var rq = "impacto > 0 e minutos < mediana", xq = X(x0) + 8, yq = Y(y1) + 6;
    var caixas = [[xq, yq, xq + ctx.measureText(rq).width, yq + 14]];
    var todasTemp = gTemp.value === "todas";
    ordem.forEach(function (p) {
      var q = noQuad(p);
      ctx.font = (q ? "600 12px" : "11px") + " 'DM Sans', sans-serif";
      var nome = todasTemp ? p[0] + " " + String(p[2] % 100).padStart(2, "0") + "-" + String((p[2] + 1) % 100).padStart(2, "0") : p[0];
      var w = ctx.measureText(nome).width, x = X(p[3]) + r + 2, y = Y(p[4]) - r - 12;
      if (x + w > larg - 4) x = X(p[3]) - r - 2 - w;
      var c = [x, y, x + w, y + 13];
      for (var k = 0; k < caixas.length; k++) {
        var o = caixas[k];
        if (!(c[2] < o[0] || c[0] > o[2] || c[3] < o[1] || c[1] > o[3])) return;
      }
      caixas.push(c);
      ctx.fillStyle = q ? LUAR : "rgba(181,168,149,.8)";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(nome, x, y);
    });
    ctx.fillStyle = TOCHA; ctx.font = "600 12px 'DM Sans', sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(rq, xq, yq);
  }

  function pontoEm(ev) {
    if (!graf.layout) return null;
    var b = $("gTela").getBoundingClientRect(), mxp = ev.clientX - b.left, myp = ev.clientY - b.top, melhor = null, dist = 64;
    graf.pontos.forEach(function (p) {
      var dx = graf.layout.X(p[3]) - mxp, dy = graf.layout.Y(p[4]) - myp, d2 = dx * dx + dy * dy;
      if (d2 < dist) { dist = d2; melhor = p; }
    });
    return melhor;
  }
  $("gTela").addEventListener("mousemove", function (ev) {
    var p = pontoEm(ev), dica = $("gDica");
    if (p !== graf.sobre) { graf.sobre = p; desenharBolinhas(); }
    if (!p) { dica.hidden = true; return; }
    dica.innerHTML = "<strong>" + esc(p[0]) + "</strong><dl><dt>time</dt><dd>" + esc(p[1]) + " " + rotuloTemporada(p[2]) +
      "</dd><dt>impacto</dt><dd>" + fmtSinal(p[4], 2) + " pts/12 min</dd><dt>minutos em quadra</dt><dd>" + fmt(p[3], 0) +
      "</dd><dt>entradas</dt><dd>" + fmtInt(p[5]) + "</dd></dl><p class=\"g-dica-texto\">Quando " + esc(p[0].split(" ")[0]) +
      " entrou, o saldo do time a cada 12 min ficou, em média, " + fmt(Math.abs(p[4]), 2) + " pontos " +
      (p[4] >= 0 ? "melhor" : "pior") + " do que antes da troca.</p>";
    var b = $("gArea").getBoundingClientRect();
    dica.style.left = Math.min(ev.clientX - b.left + 14, b.width - 200) + "px";
    dica.style.top = (ev.clientY - b.top + 14) + "px";
    dica.hidden = false;
  });
  $("gTela").addEventListener("mouseleave", function () { $("gDica").hidden = true; graf.sobre = null; desenharBolinhas(); });

  function montarBarras() {
    var chave = gTemp.value === "todas" ? "todas" : gTemp.value, lin = graf.dados.times[chave] || [];
    var n = lin.length, maxAbs = Math.max.apply(null, lin.map(function (t) { return Math.abs(t[1]); }).concat([0.1]));
    var periodo = chave === "todas" ? "de 2020-21 a 2025-26" : "em " + rotuloTemporada(+chave);
    var topo = lin[lin.length - 1];
    $("gTimesNota").innerHTML = "<b>Como ler:</b> para cada time, a média do peso de todas as substituições " + periodo +
      " (ponderada por quantas vezes cada troca aconteceu). O valor é a <b>mudança no saldo de pontos do time a cada 12 minutos</b>: " +
      "positivo = depois das trocas o time passou a ter saldo melhor do que antes; negativo = pior. " +
      (topo ? "Exemplo: <b>" + esc(topo[0]) + " " + fmtSinal(topo[1], 2) + "</b> = nas " + fmtInt(topo[2]) + " substituições do " +
        esc(topo[0]) + " " + periodo + ", o time passou a ter, em média, " + fmt(Math.abs(topo[1]), 2) + " pontos " +
        (topo[1] >= 0 ? "a mais" : "a menos") + " de saldo a cada 12 minutos depois da troca. " : "") +
      "Os 5 maiores e os 5 menores estão destacados.";
    $("gBarras").innerHTML = '<li class="g-barra g-barra--cab" aria-hidden="true"><span></span><span class="g-barra__eixo">' +
      '<span>← piora depois da troca</span><span>0</span><span>melhora depois da troca →</span></span>' +
      '<span class="g-barra__num">pts / 12 min</span></li>' + lin.slice().reverse().map(function (t, i) {
      var classe = i < 5 ? " is-maior" : i >= n - 5 ? " is-menor" : "";
      var larg = Math.abs(t[1]) / maxAbs * 50, esq = t[1] >= 0 ? 50 : 50 - larg;
      var sel = gTime.value === t[0] ? ' style="outline:2px solid ' + CESAR + ';outline-offset:2px"' : "";
      var dica = esc(t[0]) + ": " + fmtSinal(t[1], 2) + " pontos de saldo a cada 12 minutos depois da troca (média de " + fmtInt(t[2]) + " substituições)";
      return '<li class="g-barra' + classe + '"' + sel + ' title="' + dica + '"><span class="g-barra__time">' + esc(t[0]) +
        '</span><span class="g-barra__trilho"><span class="g-barra__zero"></span><span class="g-barra__valor" style="left:' +
        esq + "%;width:" + larg + '%"></span></span><span class="g-barra__num">' + fmtSinal(t[1], 2) + "</span></li>";
    }).join("");
  }

  window.addEventListener("resize", function () { if (graf.dados) desenharBolinhas(); });

  /* ------------------------------------------------------------ início */
  if (location.hash === "#algoritmos") abrirAba(2, false);
  else if (location.hash === "#graficos") abrirAba(1, false);
})();
