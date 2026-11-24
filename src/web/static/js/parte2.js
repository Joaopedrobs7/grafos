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
    if (i === 2) carregarBench(); else if (i === 1) carregarGraficos(); else { medir(); desenhar(); }
    // [IA] Claude – o painel acabou de aparecer: mede de novo com a largura real e redesenha (fotos já carregadas ficam no cache)
    requestAnimationFrame(function () {
      if (i === 0) { medir(); desenhar(); }
      else if (i === 1 && graf.dados) { desenharBolinhas(); desenharTodasCaixas(); }
    });
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
    estado.realce = null;
    $("contagem").innerHTML = "<b>" + d.nos.length + "</b> jogadores, <b>" + fmtInt(d.arcos.length) +
      "</b> trocas diferentes (arcos), <b>" + fmtInt(d.arcos_negativos) + "</b> delas com peso negativo";
    var btnDij = document.querySelector('[data-modo="dijkstra"]');
    btnDij.hidden = !d.dijkstra;
    if (estado.modo === "dijkstra" && !d.dijkstra) estado.modo = null;
    $("tela").setAttribute("aria-label", "Grafo de rotação de " + d.time + " na temporada " + rotuloTemporada(d.temporada) +
      ": " + d.nos.length + " jogadores e " + d.arcos.length + " arcos. Os mesmos dados estão na tabela de jogadores.");
    renderizarLado();
    montarTabela();
    medir();
    desenhar();
  }

  /* ------------------------------------------------------------ fotos dos jogadores */
  /* [IA] Claude – fotos da CDN pública da NBA (headshots 260x190 por personId), carregadas pelo navegador e nunca
     gravadas no repositório. Sem foto (id desconhecido ou erro), fica um círculo com as iniciais. */
  var FOTO_URL = "https://cdn.nba.com/headshots/nba/latest/260x190/";
  var RECORTE = { x: 50, y: 2, s: 160 }; // quadrado da foto 260x190 em volta do rosto, usado no círculo do canvas
  var fotos = {}, quadroPendente = 0;

  function urlFoto(no) { return no && no.personId ? FOTO_URL + no.personId + ".png" : null; }
  function imgFoto(no) {
    if (!no.personId) return null;
    var f = fotos[no.personId];
    if (!f) {
      f = fotos[no.personId] = { ok: false, img: new Image() };
      f.img.referrerPolicy = "no-referrer";
      f.img.onload = function () { f.ok = f.img.naturalWidth > 0; pedirDesenho(); };
      f.img.src = urlFoto(no);
    }
    return f.ok ? f.img : null;
  }
  function pedirDesenho() {
    if (quadroPendente) return;
    quadroPendente = requestAnimationFrame(function () { quadroPendente = 0; desenhar(); });
  }
  function iniciais(nome) {
    var p = String(nome).replace(/\s+#\d+$/, "").split(/\s+/).filter(Boolean);
    return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase();
  }
  // decorativa = a foto fica ao lado do nome escrito (alt vazio para o leitor de tela não repetir o nome)
  function htmlFoto(no, classe, decorativa) {
    var url = urlFoto(no);
    return '<span class="p2-foto ' + (classe || "") + '"' + (decorativa ? ' aria-hidden="true"' : "") +
      '><span class="p2-foto__ini" aria-hidden="true">' + esc(iniciais(no.nome)) + "</span>" +
      (url ? '<img src="' + url + '" alt="' + (decorativa ? "" : esc(no.nome)) +
        '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : "") + "</span>";
  }
  document.addEventListener("error", function (ev) {
    var t = ev.target, pai = t && t.parentNode;
    if (t && t.tagName === "IMG" && pai && pai.classList && pai.classList.contains("p2-foto")) pai.removeChild(t);
  }, true);

  function corImpacto(no) {
    var v = no.impacto_medio;
    return v === null || v === undefined || v === 0 ? "#6B5D4F" : v < 0 ? "#FF5470" : "#35C8F0";
  }
  function vezes(n) { return fmtInt(n) + (n === 1 ? " vez" : " vezes"); }

  /* ------------------------------------------------------------ destaques */
  var botoesModo = Array.prototype.slice.call(document.querySelectorAll("[data-modo]"));
  botoesModo.forEach(function (b) {
    b.addEventListener("click", function () {
      var m = b.getAttribute("data-modo");
      estado.modo = estado.modo === m ? null : m;
      if (estado.modo) { estado.selecionado = null; estado.realce = null; marcarLinha(); }
      renderizarLado();
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

  /* [IA] Claude – coluna ao lado do grafo: ficha do jogador escolhido (ou o convite para escolher) em cima,
     botões de destaque e o detalhe do destaque embaixo; a legenda do grafo acompanha a seleção */
  function renderizarLado() {
    botoesModo.forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-modo") === estado.modo ? "true" : "false");
    });
    var d = estado.dados, sel = estado.selecionado;
    $("detalhe").innerHTML = !d ? "" : sel !== null ? htmlFicha(sel) : estado.modo ? "" : htmlConvite();
    $("detalheModo").innerHTML = d ? htmlModo() : "";
    $("lado").classList.toggle("tem-ficha", sel !== null);
  }

  function htmlConvite() {
    var d = estado.dados, sugest = d.nos.slice(0, 3).map(function (n, i) {
      return '<button type="button" class="p2-chip" data-no="' + i + '">' + htmlFoto(n, "p2-foto--p", true) +
        "<span>" + esc(n.nome) + "</span></button>";
    }).join("");
    return '<div class="p2-convite"><p class="p2-convite__titulo">Ficha do jogador</p>' +
      '<p class="p2-convite__texto">Clique num jogador para ver o impacto e as trocas dele.</p>' +
      '<p class="p2-convite__rotulo">Mais minutos em quadra:</p><div class="p2-chips">' + sugest + "</div>" +
      '</div>';
  }

  function htmlFicha(i) {
    var d = estado.dados, n = d.nos[i], imp = n.impacto_medio;
    var frase = imp === null
      ? "Ele não entrou no lugar de nenhum jogador nas trocas 1 por 1 medidas nesta temporada."
      : imp === 0 ? "Quando ele entra, o saldo do time a cada 12 min fica, em média, igual ao de antes da troca."
      : "Quando ele entra, o saldo do time a cada 12 min fica, em média, <b>" + fmt(Math.abs(imp), 2) + " pontos " +
        (imp > 0 ? "melhor" : "pior") + "</b> que antes da troca.";
    return '<article class="p2-ficha" aria-labelledby="fichaNome">' +
      '<header class="p2-ficha__topo">' + htmlFoto(n, "p2-foto--g") +
      '<div class="p2-ficha__quem"><h3 class="p2-ficha__nome" id="fichaNome" tabindex="-1">' + esc(n.nome) + "</h3>" +
      '<p class="p2-ficha__time">' + esc(d.time) + " " + rotuloTemporada(d.temporada) + "</p></div>" +
      '<button type="button" class="p2-ficha__fechar" id="limparSel" aria-label="Fechar a ficha de ' + esc(n.nome) +
      '" title="Fechar (Esc)"><span aria-hidden="true">×</span></button></header>' +
      '<div class="p2-ficha__impacto ' + (imp === null ? "" : classeSinal(imp)) + '">' +
      '<p class="p2-ficha__rotulo">Impacto médio</p>' +
      '<p class="p2-ficha__valor">' + (imp === null ? "–" : fmtSinal(imp, 2)) + "<small>pts/12 min</small></p>" +
      '<p class="p2-ficha__frase">' + frase + "</p></div>" +
      '<dl class="p2-ficha__nums"><div><dt>Minutos em quadra</dt><dd>' + fmt(n.minutos, 0) + "</dd></div>" +
      "<div><dt>Entradas</dt><dd>" + fmtInt(n.entradas) + "</dd></div></dl>" +
      htmlLista(i, "sai") + htmlLista(i, "chega") + "</article>";
  }

  var LIMITE_LISTA = 5;
  function htmlLista(i, lado) {
    var d = estado.dados, sai = lado === "sai";
    var ks = (sai ? d.saidas[i] : d.chegadas[i]).slice().sort(function (a, b) { return d.arcos[b][2] - d.arcos[a][2]; });
    var todos = estado.verTodos[lado], mostra = todos ? ks : ks.slice(0, LIMITE_LISTA);
    var titulo = sai ? "Entraram no lugar dele" : "Ele entrou no lugar de";
    var sub = sai ? "setas cheias no grafo" : "setas tracejadas no grafo";
    var traco = '<svg class="p2-traco' + (sai ? "" : " p2-traco--chega") + '" viewBox="0 0 36 10" aria-hidden="true">' +
      '<line x1="1" y1="5" x2="27" y2="5"/><path d="M27 1l8 4-8 4z"/></svg>';
    var corpo;
    if (!ks.length) {
      corpo = '<p class="p2-lista__vazio">' + (sai ? "Ninguém entrou no lugar dele" : "Ele não entrou no lugar de ninguém") +
        " nas trocas 1 por 1 medidas.</p>";
    } else {
      corpo = '<div class="p2-lista__cab" aria-hidden="true"><span>troca</span><span>efeito no saldo</span></div><ul>' +
        mostra.map(function (k) {
          var a = d.arcos[k], j = sai ? a[1] : a[0], nj = d.nos[j];
          var texto = sai ? "<b>" + esc(nj.nome) + "</b> entrou no lugar dele <span>" + vezes(a[3]) + "</span>"
            : "entrou no lugar de <b>" + esc(nj.nome) + "</b> <span>" + vezes(a[3]) + "</span>";
          var dica = "Depois dessa troca, o saldo do time a cada 12 min ficou " + fmt(Math.abs(a[2]), 2) + " pontos " +
            (a[2] >= 0 ? "melhor" : "pior") + ". Clique para abrir a ficha de " + nj.nome + ".";
          return '<li><button type="button" class="p2-viz" data-no="' + j + '" data-arco="' + k + '" title="' + esc(dica) + '">' +
            htmlFoto(nj, "p2-foto--p", true) + '<span class="p2-viz__txt">' + texto + "</span>" +
            '<span class="p2-viz__peso ' + classeSinal(a[2]) + '">' + fmtSinal(a[2], 2) + "</span></button></li>";
        }).join("") + "</ul>" +
        (ks.length > LIMITE_LISTA ? '<button type="button" class="p2-lista__mais" data-mais="' + lado + '" aria-expanded="' +
          (todos ? "true" : "false") + '">' + (todos ? "mostrar menos" : "ver todos os " + ks.length) + "</button>" : "");
    }
    return '<section class="p2-lista p2-lista--' + lado + '" aria-labelledby="lista_' + lado + '">' +
      '<h4 class="p2-lista__titulo" id="lista_' + lado + '">' + traco + "<span>" + titulo + "</span>" +
      '<span class="p2-lista__n">' + ks.length + "</span></h4>" +
      '<p class="p2-lista__sub">' + sub + "</p>" + corpo + "</section>";
  }

  function htmlModo() {
    var html = "", h = destaqueAtual();
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
    }
    return html;
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

  function selecionar(i, opc) {
    opc = opc || {};
    estado.selecionado = i;
    estado.realce = null;
    estado.verTodos = { sai: false, chega: false };
    if (i !== null && estado.modo) estado.modo = null;
    renderizarLado();
    marcarLinha();
    desenhar();
    var d = estado.dados;
    if (i !== null && d) {
      var n = d.nos[i];
      $("aviso").textContent = "Ficha de " + n.nome + ": impacto médio " +
        (n.impacto_medio === null ? "sem valor" : fmtSinal(n.impacto_medio, 2) + " pontos por 12 minutos") + ". " +
        d.saidas[i].length + " jogadores entraram no lugar dele; ele entrou no lugar de " + d.chegadas[i].length + ".";
      if (opc.focarFicha) $("fichaNome").focus({ preventScroll: true });
    } else {
      $("aviso").textContent = i === null && opc.avisarFechar ? "Ficha fechada." : "";
    }
  }
  estado.verTodos = { sai: false, chega: false };
  estado.realce = null;

  // cliques na ficha e no convite: escolher outro jogador, fechar, ver todos; passar o mouse realça o arco no grafo
  var lado = $("lado");
  lado.addEventListener("click", function (ev) {
    var fechar = ev.target.closest("#limparSel");
    if (fechar) { selecionar(null, { avisarFechar: true }); tela.focus({ preventScroll: true }); return; }
    var mais = ev.target.closest("[data-mais]");
    if (mais) {
      var l = mais.getAttribute("data-mais");
      estado.verTodos[l] = !estado.verTodos[l];
      renderizarLado();
      var novo = lado.querySelector('[data-mais="' + l + '"]');
      if (novo) novo.focus({ preventScroll: true });
      return;
    }
    var b = ev.target.closest("[data-no]");
    if (b) selecionar(parseInt(b.getAttribute("data-no"), 10), { focarFicha: true });
  });
  function realcar(ev) {
    var b = ev.target.closest && ev.target.closest("[data-arco]");
    var k = b && (ev.type === "mouseover" || ev.type === "focusin") ? parseInt(b.getAttribute("data-arco"), 10) : null;
    if (k !== estado.realce) { estado.realce = k; desenhar(); }
  }
  ["mouseover", "mouseout", "focusin", "focusout"].forEach(function (t) { lado.addEventListener(t, realcar); });

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
      return '<tr data-i="' + i + '"><th scope="row"><button type="button" class="p2-tabela__jog" data-no="' + i + '">' +
        htmlFoto(n, "p2-foto--p", true) + "<span>" + esc(n.nome) + "</span></button></th>" +
        '<td class="num">' + fmt(n.minutos, 1) + "</td>" +
        '<td class="num">' + fmtInt(n.entradas) + "</td>" + imp + "</tr>";
    }).join("");
    marcarLinha();
  }
  tabela.tBodies[0].addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-no]");
    if (!b) return;
    var i = parseInt(b.getAttribute("data-no"), 10);
    selecionar(estado.selecionado === i ? null : i);
    if (estado.selecionado !== null) document.querySelector(".p2-palco").scrollIntoView({ behavior: "smooth", block: "start" });
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
    var h = Math.round(w < 560 ? Math.max(360, w * 1.08) : Math.max(380, Math.min(w * 0.78, 660)));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    tela.width = Math.round(w * dpr);
    tela.height = Math.round(h * dpr);
    tela.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var d = estado.dados;
    if (!d) return;
    var estreito = w < 560;
    var margem = estreito ? 84 : 150; // espaço dos nomes fora do círculo
    var Rx = Math.max(60, w / 2 - margem), Ry = Math.max(80, h / 2 - (estreito ? 44 : 56));
    // tela larga: círculo; tela estreita: elipse em pé, para usar a altura
    var R = Math.min(Rx, Ry);
    if (!estreito) { Rx = R; Ry = R; }
    var cx = w / 2, cy = h / 2, n = d.nos.length;
    var maxMin = d.nos.reduce(function (m, x) { return Math.max(m, x.minutos); }, 1);
    // nó maior com menos jogadores (há espaço) e menor com muitos (não encostam)
    var cabe = Math.min(1, 22 / Math.max(n, 1));
    estado.layout = {
      w: w, h: h, cx: cx, cy: cy, R: R, estreito: estreito,
      pos: d.nos.map(function (no, i) {
        var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
        var base = estreito ? 5 + 6 * cabe : 8 + 6 * cabe, extra = estreito ? 5 : 8;
        return {
          x: cx + Rx * Math.cos(ang), y: cy + Ry * Math.sin(ang), ang: ang,
          r: base + Math.sqrt(no.minutos / maxMin) * extra
        };
      })
    };
    estado.layout.raio = estado.layout.pos.map(function (p) { return p.r; });
  }

  function raioDe(i) {
    var L = estado.layout;
    return L.raio && L.raio[i] !== undefined ? L.raio[i] : L.pos[i].r;
  }

  // curva do arco u -> v: controle puxado para o centro e deslocado para um lado (u->v e v->u não se sobrepõem)
  function curva(u, v) {
    var L = estado.layout, a = L.pos[u], b = L.pos[v], ra = raioDe(u), rb = raioDe(v);
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    var px = -dy / len, py = dx / len;
    var desvio = Math.min(18, len * 0.12);
    var cxp = mx + (L.cx - mx) * 0.35 + px * desvio, cyp = my + (L.cy - my) * 0.35 + py * desvio;
    // ponta da seta na borda do nó de destino
    var tx = b.x - cxp, ty = b.y - cyp, tl = Math.hypot(tx, ty) || 1;
    var ex = b.x - (tx / tl) * (rb + 3), ey = b.y - (ty / tl) * (rb + 3);
    var sx0 = a.x - cxp, sy0 = a.y - cyp, sl = Math.hypot(sx0, sy0) || 1;
    var sx = a.x - (sx0 / sl) * (ra + 1), sy = a.y - (sy0 / sl) * (ra + 1);
    return { sx: sx, sy: sy, cx: cxp, cy: cyp, ex: ex, ey: ey, ux: tx / tl, uy: ty / tl };
  }

  function tracarArco(u, v, cor, larg, seta, tracejado) {
    var c = curva(u, v);
    ctx.strokeStyle = cor;
    ctx.lineWidth = larg;
    ctx.lineCap = tracejado ? "butt" : "round";
    ctx.setLineDash(tracejado ? [7, 5] : []);
    ctx.beginPath();
    ctx.moveTo(c.sx, c.sy);
    ctx.quadraticCurveTo(c.cx, c.cy, c.ex - c.ux * seta * 0.6, c.ey - c.uy * seta * 0.6);
    ctx.stroke();
    ctx.setLineDash([]);
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

  /* [IA] Claude – nó como foto recortada num círculo (ou iniciais), com anel na cor do sinal do impacto médio */
  function desenharNo(i, r, o) {
    var no = estado.dados.nos[i], p = estado.layout.pos[i], img = imgFoto(no);
    ctx.save();
    ctx.globalAlpha = o.alfa;
    if (o.brilho) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 7, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255,96,2,0.16)"; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = "#3A3028"; ctx.fill();
    if (img) {
      ctx.save(); ctx.clip();
      ctx.drawImage(img, RECORTE.x, RECORTE.y, RECORTE.s, RECORTE.s, p.x - r, p.y - r, 2 * r, 2 * r);
      ctx.restore();
    } else if (r >= 8) {
      ctx.fillStyle = LUAR; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "600 " + Math.round(r * 0.8) + "px 'Pixelify Sans', 'DM Sans', sans-serif";
      ctx.fillText(iniciais(no.nome), p.x, p.y + 1);
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.lineWidth = o.anelLarg; ctx.strokeStyle = o.anel; ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------ canvas: desenho */
  function desenhar() {
    var d = estado.dados, L = estado.layout;
    if (!d || !L || paineis[0].hidden) return;
    ctx.clearRect(0, 0, L.w, L.h);
    var h = destaqueAtual();
    var fixo = !h && estado.selecionado !== null; // ficha aberta
    var foco = h ? null : (estado.selecionado !== null ? estado.selecionado : estado.sobre);
    var temFoco = foco !== null && foco !== undefined;
    var emCaminho = {}, arcosCaminho = [];
    if (h) {
      var seq = h.ciclo || h.caminho;
      seq.forEach(function (i) { emCaminho[i] = true; });
      h.passos.forEach(function (p) { arcosCaminho.push(p); });
    }
    var fonteH = h ? (h.fonte !== undefined ? h.fonte : h.origem) : null;
    // vizinhos do jogador em foco: saiDe[j] = arco foco -> j (j entrou no lugar dele); chegaDe[j] = arco j -> foco
    var saiDe = {}, chegaDe = {};
    if (temFoco) {
      d.saidas[foco].forEach(function (k) { saiDe[d.arcos[k][1]] = k; });
      d.chegadas[foco].forEach(function (k) { chegaDe[d.arcos[k][0]] = k; });
    }
    var vizinho = function (i) { return temFoco && (i === foco || saiDe[i] !== undefined || chegaDe[i] !== undefined); };
    var acesoNo = function (i) { return h ? !!emCaminho[i] : !temFoco || vizinho(i); };
    var grande = L.estreito ? 9 : 13;
    L.raio = L.pos.map(function (p, i) {
      if (fixo && i === foco) return L.estreito ? 21 : 30;
      if ((fixo && vizinho(i)) || (h && emCaminho[i])) return Math.max(p.r, grande);
      return p.r;
    });
    var apagado = !!h || temFoco;
    // legenda: com um jogador em foco (clicado ou sob o mouse) explica as duas direções dos arcos
    Array.prototype.forEach.call(document.querySelectorAll("[data-legenda]"), function (el) {
      el.hidden = (el.getAttribute("data-legenda") === "sel") !== temFoco;
    });

    // arcos de fundo (do mais fraco para o mais forte, para os fortes ficarem por cima)
    var ordem = d.arcos.map(function (_, k) { return k; });
    ordem.sort(function (a, b) { return Math.abs(d.arcos[a][2]) - Math.abs(d.arcos[b][2]); });
    ordem.forEach(function (k) {
      var a = d.arcos[k], t = Math.min(Math.abs(a[2]) / LIMITE_COR, 1);
      if (temFoco && (a[0] === foco || a[1] === foco)) return; // desenhados depois, por cima
      var alfa = apagado ? (fixo || h ? 0.035 : 0.06) : 0.09 + 0.33 * t;
      tracarArco(a[0], a[1], corPeso(a[2], alfa), apagado ? 1 : 0.7 + 1.1 * t, apagado ? 0 : 3.5 + 2 * t);
    });

    // arcos do jogador em foco: os que chegam nele tracejados, os que saem dele contínuos (por cima)
    if (temFoco) {
      [[d.chegadas[foco], true], [d.saidas[foco], false]].forEach(function (par) {
        par[0].forEach(function (k) {
          var a = d.arcos[k], t = Math.min(Math.abs(a[2]) / LIMITE_COR, 1);
          var realce = estado.realce === k, outro = estado.realce !== null && !realce;
          var larg = (realce ? 3.4 : fixo ? 1.7 : 1.4) + 1.5 * t;
          if (outro) larg = 1.2;
          tracarArco(a[0], a[1], "rgba(18,15,12," + (outro ? 0.4 : 0.85) + ")", larg + 3, 0);
          tracarArco(a[0], a[1], corPeso(a[2], outro ? 0.3 : realce ? 1 : 0.62 + 0.38 * t), larg,
            (outro ? 5 : 8) + 3 * t, par[1]);
        });
      });
    }

    // arcos do destaque, numerados
    var rotulosPasso = [];
    arcosCaminho.forEach(function (p, k) {
      tracarArco(p.de, p.para, "rgba(18,15,12,0.9)", 7, 0);
      var c = tracarArco(p.de, p.para, corPeso(p.peso, 1), 3, 11);
      // ponto médio da curva quadrática (t = 0,5)
      rotulosPasso.push({ n: k + 1, x: 0.25 * c.sx + 0.5 * c.cx + 0.25 * c.ex, y: 0.25 * c.sy + 0.5 * c.cy + 0.25 * c.ey });
    });

    // nós (o jogador em foco por último, por cima)
    var ordemNos = d.nos.map(function (_, i) { return i; });
    if (temFoco) ordemNos.sort(function (a, b) { return (a === foco) - (b === foco) || (vizinho(a) - vizinho(b)); });
    ordemNos.forEach(function (i) {
      var no = d.nos[i], anel = corImpacto(no), larg = 2;
      if (h && i === fonteH) { anel = CESAR; larg = 3.5; }
      else if (h && emCaminho[i]) { anel = TOCHA; larg = 3; }
      else if (i === foco) { anel = CESAR; larg = fixo ? 3.5 : 3; }
      else if (fixo && i === estado.sobre) { anel = LUAR; larg = 2.5; }
      desenharNo(i, L.raio[i], { alfa: acesoNo(i) ? 1 : 0.22, anel: anel, anelLarg: larg, brilho: fixo && i === foco });
    });

    // nomes fora do círculo: os acesos primeiro; quem colide sobe um degrau para fora, depois vira abreviação,
    // e por último some (só nomes apagados somem; os do destaque sempre aparecem)
    var alturaTexto = L.estreito ? 13 : 15;
    ctx.textBaseline = "middle";
    var fonteNome = function (i) {
      return (i === foco && fixo ? "600 " + (L.estreito ? 12 : 14) + "px" : (L.estreito ? 11 : 12.5) + "px") +
        " 'DM Sans', system-ui, sans-serif";
    };
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
    ordemNomes.sort(function (a, b) {
      return (b === foco) - (a === foco) || (acesoNo(b) ? 1 : 0) - (acesoNo(a) ? 1 : 0) || a - b;
    });
    ordemNomes.forEach(function (i) {
      var no = d.nos[i], p = L.pos[i], r = L.raio[i], aceso = acesoNo(i);
      ctx.font = fonteNome(i);
      var cos = Math.cos(p.ang), sin = Math.sin(p.ang);
      var ladoT = cos >= 0 ? "left" : "right";
      var alinhs = Math.abs(cos) < 0.3 ? ["center", ladoT] : [ladoT];
      var alinh = alinhs[0];
      var textos = L.estreito && i !== foco ? [abreviar(no.nome)] : [no.nome, abreviar(no.nome)];
      var escolha = null;
      textos.some(function (t) {
        alinhs.some(function (al) {
          for (var k = 0; k < 6 && !escolha; k++) {
            var dist = r + 7 + k * (al === "center" ? alturaTexto : 6);
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
        var dist0 = r + 7, t0 = textos[textos.length - 1];
        escolha = { t: t0, x: p.x + cos * dist0, y: p.y + sin * dist0 + (alinh === "center" ? sin * 6 : 0) };
        escolha.c = caixa(t0, escolha.x, escolha.y, alinh);
      }
      postos.push(escolha.c);
      ctx.textAlign = alinh;
      ctx.fillStyle = i === foco ? LUAR : aceso ? (apagado ? LUAR : LUAR_FRACO) : "rgba(181,168,149,0.3)";
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
      if (dd < Math.max(raioDe(i) + 5, 12) && dd < md) { md = dd; melhor = i; }
    });
    return melhor;
  }

  /* [IA] Claude – dica compacta ao passar o mouse: foto, nome e impacto médio */
  var dicaDe = null;
  function mostrarDica(i, ev) {
    if (i === null) { dica.hidden = true; dicaDe = null; return; }
    var d = estado.dados, n = d.nos[i];
    if (dicaDe !== i) {
      dicaDe = i;
      var imp = n.impacto_medio;
      dica.innerHTML = '<div class="p2-dica__cab">' + htmlFoto(n, "p2-foto--m", true) + "<div><strong>" + esc(n.nome) +
        '</strong><span class="p2-dica__imp">impacto médio <b class="' + (imp === null ? "" : classeSinal(imp)) + '">' +
        (imp === null ? "–" : fmtSinal(imp, 2)) + "</b> pts/12 min</span></div></div>" +
        '<p class="p2-dica__pe">' + fmt(n.minutos, 0) + " min em quadra · " + fmtInt(n.entradas) + (n.entradas === 1 ? " entrada" : " entradas") + "</p>" +
        (estado.selecionado === i ? "" : '<p class="p2-dica__acao">clique para abrir a ficha</p>');
    }
    dica.hidden = false;
    var r = area.getBoundingClientRect();
    var x = ev.clientX - r.left + 16, y = ev.clientY - r.top + 16;
    if (x + dica.offsetWidth > r.width - 8) x = ev.clientX - r.left - dica.offsetWidth - 16;
    if (y + dica.offsetHeight > r.height - 8) y = ev.clientY - r.top - dica.offsetHeight - 16;
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
    dica.hidden = true; dicaDe = null;
    if (estado.sobre !== null) { estado.sobre = null; desenhar(); }
  });
  tela.addEventListener("click", function (ev) {
    var i = noEm(ev);
    dicaDe = null;
    if (i === null) { if (estado.selecionado !== null) selecionar(null); return; }
    selecionar(estado.selecionado === i ? null : i);
    mostrarDica(i, ev);
  });
  // teclado: setas percorrem os jogadores na ordem do círculo; Esc fecha a ficha
  tela.addEventListener("keydown", function (ev) {
    var d = estado.dados;
    if (!d) return;
    var n = d.nos.length, i = estado.selecionado;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      ev.preventDefault(); selecionar(i === null ? 0 : (i + 1) % n);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      ev.preventDefault(); selecionar(i === null ? n - 1 : (i - 1 + n) % n);
    } else if (ev.key === "Escape" && i !== null) {
      ev.preventDefault(); selecionar(null, { avisarFechar: true });
    }
  });
  lado.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && estado.selecionado !== null) {
      selecionar(null, { avisarFechar: true }); tela.focus({ preventScroll: true });
    }
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
    if (graf.dados) { desenharBolinhas(); desenharTodasCaixas(); return; }
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
    $("gComoLer").innerHTML = ex ? "Cada bolinha é um jogador. Mais para cima, mais o saldo do time melhora quando ele entra " +
      "(pts a cada 12 min). Ex.: <b>" + esc(ex[0]) + "</b>, " + fmtSinal(ex[4], 2) + "." : "";
    desenharBolinhas();
    montarBarras();
    desenharTodasCaixas();
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

  /* [IA] Claude – dica flutuante única para os boxplots e as barras (mesmo estilo da dica das bolinhas) */
  var dicaG = document.createElement("div");
  dicaG.className = "p2-dica g-dica-flutuante"; dicaG.hidden = true; dicaG.setAttribute("role", "tooltip");
  document.body.appendChild(dicaG);
  function mostrarDicaG(html, ev) {
    dicaG.innerHTML = html; dicaG.hidden = false;
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + dicaG.offsetWidth > window.innerWidth - 8) x = ev.clientX - dicaG.offsetWidth - 14;
    if (y + dicaG.offsetHeight > window.innerHeight - 8) y = ev.clientY - dicaG.offsetHeight - 14;
    dicaG.style.left = x + "px"; dicaG.style.top = y + "px";
  }
  function esconderDicaG() { dicaG.hidden = true; }
  window.addEventListener("scroll", esconderDicaG, { passive: true });

  function montarBarras() {
    var chave = gTemp.value === "todas" ? "todas" : gTemp.value, lin = graf.dados.times[chave] || [];
    var n = lin.length, maxAbs = Math.max.apply(null, lin.map(function (t) { return Math.abs(t[1]); }).concat([0.1]));
    var periodo = chave === "todas" ? "de 2020-21 a 2025-26" : "em " + rotuloTemporada(+chave);
    var topo = lin[lin.length - 1];
    $("gTimesNota").innerHTML = "Média das trocas de cada time " + periodo + ": quanto o saldo muda a cada 12 min depois da troca." +
      (topo ? " Ex.: <b>" + esc(topo[0]) + " " + fmtSinal(topo[1], 2) + "</b>." : "");
    $("gBarras").innerHTML = '<li class="g-barra g-barra--cab" aria-hidden="true"><span></span><span class="g-barra__eixo">' +
      '<span>← piora depois da troca</span><span>0</span><span>melhora depois da troca →</span></span>' +
      '<span class="g-barra__num">pts / 12 min</span></li>' + lin.slice().reverse().map(function (t, i) {
      var classe = i < 5 ? " is-maior" : i >= n - 5 ? " is-menor" : "";
      var larg = Math.abs(t[1]) / maxAbs * 50, esq = t[1] >= 0 ? 50 : 50 - larg;
      var sel = gTime.value === t[0] ? ' style="outline:2px solid ' + CESAR + ';outline-offset:2px"' : "";
      return '<li class="g-barra' + classe + '"' + sel + ' data-time="' + esc(t[0]) + '" data-v="' + t[1] + '" data-n="' + t[2] +
        '" data-pos="' + (i + 1) + '" tabindex="0"><span class="g-barra__time">' + esc(t[0]) +
        '</span><span class="g-barra__trilho"><span class="g-barra__zero"></span><span class="g-barra__valor" style="left:' +
        esq + "%;width:" + larg + '%"></span></span><span class="g-barra__num">' + fmtSinal(t[1], 2) + "</span></li>";
    }).join("");
  }

  function dicaBarra(li, ev) {
    var v = +li.getAttribute("data-v");
    mostrarDicaG("<strong>" + esc(li.getAttribute("data-time")) + "</strong><dl><dt>impacto médio</dt><dd>" + fmtSinal(v, 2) +
      " pts/12 min</dd><dt>trocas</dt><dd>" + fmtInt(+li.getAttribute("data-n")) + "</dd><dt>posição</dt><dd>" +
      li.getAttribute("data-pos") + "º de 30</dd></dl><p class=\"g-dica-texto\">Depois das trocas, o saldo do time a cada 12 min ficou, em média, " +
      fmt(Math.abs(v), 2) + " pontos " + (v >= 0 ? "melhor" : "pior") + ".</p>", ev);
  }
  $("gBarras").addEventListener("mousemove", function (ev) {
    var li = ev.target.closest("li[data-time]"); if (li) dicaBarra(li, ev); else esconderDicaG();
  });
  $("gBarras").addEventListener("mouseleave", esconderDicaG);
  $("gBarras").addEventListener("focusin", function (ev) {
    var li = ev.target.closest("li[data-time]"); if (!li) return;
    var r = li.getBoundingClientRect(); dicaBarra(li, { clientX: r.left + r.width * 0.6, clientY: r.top });
  });
  $("gBarras").addEventListener("focusout", esconderDicaG);

  /* [IA] Claude – H3 e H1: boxplot do peso de cada troca por grupo (caixa = Q1 a Q3, traço = mediana,
     hastes = 1,5 × IIQ limitadas ao dado; trocas além das hastes não são desenhadas). Dados prontos em graficos.json. */
  var CAIXAS = { h3: { tela: "gH3", area: "gH3Area", sel: null, layout: null },
                 h1: { tela: "gH1", area: "gH1Area", sel: null, layout: null } };

  function desenharTodasCaixas() { desenharCaixas("h3"); desenharCaixas("h1"); }

  function desenharCaixas(qual) {
    var cfg = CAIXAS[qual], gs = graf.dados && graf.dados[qual] && graf.dados[qual][gTemp.value];
    if (!gs || paineis[1].hidden) return;
    var tela = $(cfg.tela), area = $(cfg.area), dpr = window.devicePixelRatio || 1;
    var larg = area.clientWidth, alt = Math.max(300, Math.min(400, Math.round(larg * 0.36)));
    tela.width = larg * dpr; tela.height = alt * dpr; tela.style.height = alt + "px";
    var ctx = tela.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, larg, alt);
    var mx = { e: 56, d: 12, t: 26, b: 52 };
    var y0 = Math.min.apply(null, gs.map(function (g) { return g.bigode_min; }));
    var y1 = Math.max.apply(null, gs.map(function (g) { return g.bigode_max; }));
    var passo = (y1 - y0) > 100 ? 25 : (y1 - y0) > 50 ? 20 : 10;
    // folga em cima para o texto "% além de ±30"
    y0 = Math.floor(y0 / passo) * passo; y1 = Math.ceil((y1 + (y1 - y0) * 0.08) / passo) * passo;
    var col = (larg - mx.e - mx.d) / gs.length;
    var Y = function (v) { return mx.t + (y1 - v) / (y1 - y0) * (alt - mx.t - mx.b); };
    cfg.layout = { mx: mx, col: col, n: gs.length, gs: gs };
    // grade e eixo y
    ctx.font = "12px 'DM Sans', sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (var v = y0; v <= y1 + 1e-9; v += passo) {
      ctx.strokeStyle = "rgba(181,168,149,.12)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx.e, Y(v)); ctx.lineTo(larg - mx.d, Y(v)); ctx.stroke();
      ctx.fillStyle = LUAR_FRACO; ctx.fillText(fmtSinal(v, 0), mx.e - 8, Y(v));
    }
    ctx.save(); ctx.translate(14, (mx.t + alt - mx.b) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.fillText("peso da troca (pts a cada 12 min)", 0, 0); ctx.restore();
    // linha do zero embaixo das caixas
    ctx.strokeStyle = LUAR; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(mx.e, Y(0)); ctx.lineTo(larg - mx.d, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    gs.forEach(function (g, i) {
      var cx = mx.e + col * (i + 0.5), w = Math.min(120, col * 0.42);
      if (cfg.sel === i) { ctx.fillStyle = "rgba(239,230,216,.06)"; ctx.fillRect(mx.e + col * i + 2, mx.t - 20, col - 4, alt - mx.t - mx.b + 20); }
      // hastes
      ctx.strokeStyle = LUAR_FRACO; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, Y(g.bigode_max)); ctx.lineTo(cx, Y(g.q3)); ctx.moveTo(cx, Y(g.q1)); ctx.lineTo(cx, Y(g.bigode_min));
      ctx.moveTo(cx - w * 0.25, Y(g.bigode_max)); ctx.lineTo(cx + w * 0.25, Y(g.bigode_max));
      ctx.moveTo(cx - w * 0.25, Y(g.bigode_min)); ctx.lineTo(cx + w * 0.25, Y(g.bigode_min));
      ctx.stroke();
      // caixa (tom de pedra) e mediana destacada
      ctx.fillStyle = cfg.sel === i ? "rgba(181,168,149,.45)" : "rgba(181,168,149,.30)";
      ctx.fillRect(cx - w / 2, Y(g.q3), w, Y(g.q1) - Y(g.q3));
      ctx.strokeStyle = cfg.sel === i ? LUAR : LUAR_FRACO;
      ctx.strokeRect(cx - w / 2 + 0.5, Y(g.q3) + 0.5, w - 1, Y(g.q1) - Y(g.q3) - 1);
      ctx.strokeStyle = TOCHA; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - w / 2, Y(g.mediana)); ctx.lineTo(cx + w / 2, Y(g.mediana)); ctx.stroke();
      ctx.font = "600 12px 'DM Sans', sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      var tm = fmtSinal(g.mediana, 2), lm = ctx.measureText(tm).width;
      ctx.fillStyle = "#120F0C"; ctx.fillRect(cx + w / 2 + 3, Y(g.mediana) - 8, lm + 6, 16);
      ctx.fillStyle = TOCHA; ctx.fillText(tm, cx + w / 2 + 6, Y(g.mediana));
      // % além de ±30 acima da haste
      ctx.fillStyle = LUAR_FRACO; ctx.font = "12px 'DM Sans', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(fmt(g.pct_extremos, 1) + "% além de ±30", cx, Y(g.bigode_max) - 5);
      // grupo e n embaixo
      ctx.textBaseline = "top"; ctx.fillStyle = LUAR; ctx.font = "600 13px 'DM Sans', sans-serif";
      ctx.fillText(g.grupo, cx, alt - mx.b + 10);
      ctx.fillStyle = LUAR_FRACO; ctx.font = "12px 'DM Sans', sans-serif";
      ctx.fillText("n = " + fmtInt(g.n), cx, alt - mx.b + 28);
    });
  }

  function dicaCaixa(g, ev) {
    mostrarDicaG("<strong>" + esc(g.grupo) + "</strong><dl><dt>trocas</dt><dd>" + fmtInt(g.n) + "</dd><dt>mediana</dt><dd>" +
      fmtSinal(g.mediana, 2) + " pts/12 min</dd><dt>50% centrais</dt><dd>" + fmtSinal(g.q1, 1) + " a " + fmtSinal(g.q3, 1) +
      "</dd><dt>além de ±30</dt><dd>" + fmt(g.pct_extremos, 1) + "%</dd><dt>negativas</dt><dd>" + fmt(g.pct_negativos, 1) +
      "%</dd></dl>", ev);
  }
  function selecionarCaixa(qual, i, ev) {
    var cfg = CAIXAS[qual];
    if (cfg.sel !== i) { cfg.sel = i; desenharCaixas(qual); }
    if (i === null) esconderDicaG(); else dicaCaixa(cfg.layout.gs[i], ev);
  }
  Object.keys(CAIXAS).forEach(function (qual) {
    var cfg = CAIXAS[qual], tela = $(cfg.tela);
    tela.addEventListener("mousemove", function (ev) {
      var l = cfg.layout; if (!l) return;
      var r = tela.getBoundingClientRect(), i = Math.floor((ev.clientX - r.left - l.mx.e) / l.col);
      selecionarCaixa(qual, i >= 0 && i < l.n ? i : null, ev);
    });
    tela.addEventListener("mouseleave", function () { selecionarCaixa(qual, null); });
    // teclado: o foco mostra o grupo atual (o primeiro, de início); as setas trocam de grupo
    function pontoDoGrupo(i) {
      var r = tela.getBoundingClientRect(), l = cfg.layout;
      return { clientX: r.left + l.mx.e + l.col * (i + 0.5) + 30, clientY: r.top + r.height * 0.3 };
    }
    tela.addEventListener("focus", function () { if (cfg.layout) selecionarCaixa(qual, cfg.sel || 0, pontoDoGrupo(cfg.sel || 0)); });
    tela.addEventListener("blur", function () { selecionarCaixa(qual, null); });
    tela.addEventListener("keydown", function (ev) {
      var l = cfg.layout; if (!l || (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft")) return;
      ev.preventDefault();
      var i = Math.max(0, Math.min(l.n - 1, (cfg.sel || 0) + (ev.key === "ArrowRight" ? 1 : -1)));
      selecionarCaixa(qual, i, pontoDoGrupo(i));
    });
  });

  window.addEventListener("resize", function () { if (graf.dados) { desenharBolinhas(); desenharTodasCaixas(); } });

  /* ------------------------------------------------------------ início */
  if (location.hash === "#algoritmos") abrirAba(2, false);
  else if (location.hash === "#graficos") abrirAba(1, false);
})();
