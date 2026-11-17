/* [IA] Claude – tela de seleção de projeto e página provisória da Parte 2: parede de pedra em pixel art,
   pill do servidor, cursor de menu (↑/↓, W/S, Enter/Espaço, mouse e toque) com o aluno da CESAR ao lado,
   slot trancado que "nega" e a transição de saída. Script clássico; usa LAB.pixel quando ele carregou. */
(function () {
  "use strict";
  var PX = (window.LAB && window.LAB.pixel) || null;
  var calmo = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------ parede da masmorra (fundo) */
  function desenharParede() {
    var c = $("parede");
    if (!c || !PX || !PX.wallTexture) return;
    var escala = window.innerWidth < 640 ? 3 : 4;
    var tw = PX.TILE || 16, th = PX.WALL_H || 20;
    var cols = Math.ceil(window.innerWidth / (tw * escala)) + 1;
    var lins = Math.ceil(window.innerHeight / (th * escala)) + 1;
    c.width = cols * tw; c.height = lins * th;
    c.style.width = cols * tw * escala + "px"; c.style.height = lins * th * escala + "px";
    var ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    var semente = 7;
    var sorteio = function () { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
    for (var l = 0; l < lins; l++) {
      for (var k = 0; k < cols; k++) {
        var r = sorteio();
        var v = r < 0.05 ? 4 : Math.floor(r * 4); // seteira gradeada de vez em quando
        try { ctx.drawImage(PX.wallTexture("side", v), k * tw, l * th); } catch (e) { return; }
      }
    }
    // escurece a parede para o texto ficar legível; a luz vem das tochas (CSS)
    ctx.fillStyle = "rgba(18, 15, 12, 0.84)";
    ctx.fillRect(0, 0, c.width, c.height);
    c.classList.add("is-pronta");
  }
  desenharParede();
  var tParede;
  window.addEventListener("resize", function () { clearTimeout(tParede); tParede = setTimeout(desenharParede, 150); });

  /* ------------------------------------------------------------ servidor (pill no canto) */
  (function servidor() {
    var pill = document.querySelector("[data-servidor-pill]");
    if (!pill || !window.fetch) return;
    var inst = pill.querySelector("[data-servidor-inst]"), zona = pill.querySelector("[data-servidor-zona]");
    fetch("api/info", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (s) {
        pill.setAttribute("data-estado", "ok");
        inst.textContent = s.instancia || "servidor";
        zona.textContent = s.zona || "";
        pill.title = "Respondido por " + s.instancia + (s.zona ? " em " + s.zona : "") + (s.versao ? ", versão " + s.versao : "");
      })
      .catch(function () {
        pill.setAttribute("data-estado", "erro");
        inst.textContent = "servidor fora do ar";
        zona.textContent = "";
      });
  })();

  /* ------------------------------------------------------------ página da Parte 2: só o aluno */
  var obra = $("obraAluno");
  if (obra && PX) {
    obra.getContext("2d").drawImage(PX.studentSprite("front", "idle", 4), 0, 0);
  }

  /* ------------------------------------------------------------ menu de projetos */
  var lista = $("slots");
  if (!lista) return;
  var slots = Array.prototype.slice.call(lista.querySelectorAll("[data-slot]"));
  var cursor = $("cursor"), aluno = $("cursorAluno"), aviso = $("aviso"), cortina = $("cortina");
  var atual = 0, saindo = false, tAviso = 0;

  // miniatura do m03 no cartucho da Parte 1 (a API já manda a grade de cada mapa)
  (function arte() {
    var caixa = $("arteParte1");
    if (!caixa || !PX) return;
    var pintar = function (grade) {
      var L = grade.length, C = grade.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      var w = caixa.clientWidth - 8, h = caixa.clientHeight - 8;
      var s = Math.max(1, Math.floor(Math.min(w / C, h / L)));
      var cv = PX.mapThumb(grade, s);
      caixa.textContent = "";
      caixa.appendChild(cv);
    };
    // reserva enquanto a API responde (ou se ela falhar): a chave âmbar
    try { caixa.appendChild(PX.keyIcon("a", 4)); } catch (e) { /* sem ícone */ }
    if (!window.fetch) return;
    fetch("api/mapas").then(function (r) { return r.json(); }).then(function (d) {
      var g = d && d.grades && (d.grades.m03_tres_chaves || d.grades[d.mapas && d.mapas[0]]);
      if (g && g.length) pintar(g);
    }).catch(function () { /* fica a chave */ });
  })();

  // aluno ao lado do cursor: parado olhando para o slot, piscando de vez em quando
  var ctxAluno = aluno && PX ? aluno.getContext("2d") : null;
  function quadro(view, frame) {
    if (!ctxAluno) return;
    ctxAluno.clearRect(0, 0, aluno.width, aluno.height);
    ctxAluno.drawImage(PX.studentSprite(view, frame, 4), 0, 0);
  }
  quadro("side", "idle");
  if (ctxAluno && !calmo) {
    (function piscar() {
      setTimeout(function () {
        if (saindo) return;
        quadro("side", "blink");
        setTimeout(function () { if (!saindo) quadro("side", "idle"); }, 140);
        piscar();
      }, 2600 + Math.random() * 2400);
    })();
  }
  if (!ctxAluno && aluno) aluno.hidden = true;

  function marcar(i, focar) {
    atual = (i + slots.length) % slots.length;
    slots.forEach(function (s, k) { s.classList.toggle("is-atual", k === atual); });
    var s = slots[atual];
    if (cursor) cursor.style.transform = "translateY(" + (s.offsetTop + (s.offsetHeight - cursor.offsetHeight) / 2) + "px)";
    if (focar && document.activeElement !== s) s.focus({ preventScroll: false });
  }

  function avisar(texto) {
    aviso.textContent = texto;
    clearTimeout(tAviso);
    tAviso = setTimeout(function () { aviso.textContent = ""; }, 3200);
  }

  function escolher(i) {
    if (saindo) return;
    var s = slots[i];
    marcar(i, false);
    if (s.hasAttribute("data-trancado")) {
      avisar("Disponível quando a Parte 2 for entregue.");
      if (!calmo) {
        s.classList.remove("is-negado"); void s.offsetWidth; s.classList.add("is-negado");
        quadro("front", "idle");
        setTimeout(function () { if (!saindo) quadro("side", "idle"); }, 700);
      }
      return;
    }
    var destino = s.getAttribute("href");
    if (calmo) { window.location.href = destino; return; }
    // o único momento orquestrado: o slot pisca, o aluno anda até ele e a tela escurece
    saindo = true;
    var f = 0, passo = 0;
    if (cursor) cursor.classList.add("is-saindo");
    var anda = setInterval(function () {
      quadro("side", f = (f + 1) % 4);
      passo += 6;
      if (aluno) aluno.style.transform = "translateX(" + passo + "px)";
      s.classList.toggle("is-piscando", f % 2 === 0);
    }, 90);
    setTimeout(function () { cortina.classList.add("is-fechando"); }, 380);
    setTimeout(function () { clearInterval(anda); window.location.href = destino; }, 660);
  }

  slots.forEach(function (s, i) {
    s.addEventListener("mouseenter", function () { if (!saindo) marcar(i, false); });
    s.addEventListener("focus", function () { if (!saindo) marcar(i, false); });
    s.addEventListener("click", function (ev) {
      // Ctrl/Cmd/Shift/botão do meio abrem em outra aba como um link comum
      if (!s.hasAttribute("data-trancado") && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0)) return;
      ev.preventDefault();
      escolher(i);
    });
  });

  document.addEventListener("keydown", function (ev) {
    if (saindo || ev.altKey || ev.metaKey || ev.ctrlKey) return;
    var foco = document.activeElement;
    var noMenu = !foco || foco === document.body || slots.indexOf(foco) >= 0;
    if (!noMenu) return;
    var k = ev.key;
    if (k === "ArrowDown" || k === "s" || k === "S") { ev.preventDefault(); marcar(atual + 1, true); }
    else if (k === "ArrowUp" || k === "w" || k === "W") { ev.preventDefault(); marcar(atual - 1, true); }
    else if (k === "Enter" || k === " " || k === "Spacebar") { ev.preventDefault(); escolher(atual); }
  });

  // voltando pelo histórico (bfcache): reabre a tela no estado parado
  window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted) return;
    saindo = false;
    cortina.classList.remove("is-fechando");
    slots.forEach(function (s) { s.classList.remove("is-piscando", "is-negado"); });
    if (aluno) aluno.style.transform = "";
    if (cursor) cursor.classList.remove("is-saindo");
    quadro("side", "idle");
  });

  window.addEventListener("resize", function () { marcar(atual, false); });
  marcar(0, false);
})();
