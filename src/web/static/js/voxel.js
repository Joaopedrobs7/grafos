/* [IA] Claude – voxel.js: o aluno da CESAR School em voxel ("pixel art meio 3D") e os objetos animados do
   labirinto 3D: chaves, portas com cadeado, bônus, fonte, saída, plataforma de início, partículas e textos
   flutuantes. Rodada 2 (tema dungeon): baú do tesouro (createChest; createGoal agora devolve o baú sobre um
   estrado), tochas de parede (createTorch), porta de madeira com cintas de ferro em duas folhas, monte de
   moedas, fonte de pedra com água dourada, rosto do aluno legível na câmera de 52° e finais com emoção
   (thumbsUp feliz / handsUp triste, setExpression, resetPose). Script clássico (sem módulos): publica LAB.voxel. Depende de THREE (r159, global) e usa
   LAB.pixel (paleta, marca CESAR, cores do sprite 2D) quando existir, com reservas internas idênticas.

   Convenções
   - 1 casa do labirinto = 1 unidade de mundo; 1 voxel = 1/20 de casa (constante U).
   - Texturas desenhadas em canvas, 1 texel = 1 voxel, NearestFilter, SRGB (cara de pixel art).
   - Cada construtor devolve { group, update(dt, t), dispose(), ... }; animações devolvem Promise.
   - As animações só avançam dentro de update(dt): quem chama deve atualizar os objetos a cada quadro.
     dispose() conclui (resolve) qualquer animação pendente para ninguém ficar esperando para sempre. */
(function (root) {
  'use strict';

  var LAB = root.LAB = root.LAB || {};
  var voxel = LAB.voxel = LAB.voxel || {};
  var THREE = root.THREE;
  if (!THREE) { voxel.available = false; return; }
  voxel.available = true;

  /* ======================================================================================
     1. Constantes, paleta e cores do aluno
     ====================================================================================== */

  var U = 1 / 20;                  // tamanho de 1 voxel em casas
  var TAU = Math.PI * 2;
  var KEY_UNIT = 0.046;            // voxel da chave flutuante (chave de ~0,65 casa, 3 voxels de espessura)
  var KEY_FACING = -0.6;           // a chave balança em torno desta direção (de frente p/ a câmera padrão, yaw -35°)

  // Reserva da paleta (mesmos hexadecimais do SPEC §3 / LAB.pixel.PALETTE).
  var FALLBACK_PALETTE = {
    // [IA] Claude – paleta dungeon (rodada 2), mesmos nomes de LAB.pixel.PALETTE
    noite: '#1A1612', noite2: '#26201A', noite3: '#3A3028', luar: '#EFE6D8', luarFraco: '#B5A895',
    tocha: '#FFB347', ouro: '#E9AE3C', ouroClaro: '#FFE08A',
    cesar: '#FF6002', cesarEscuro: '#DD4012',
    chave: { a: '#FFC23A', b: '#35C8F0', c: '#F45BC8', d: '#7DDB45' },
    ok: '#3FCF8E', erro: '#FF5470'
  };

  // Marca CESAR para o peito do voxel (11×7, limpa à mão a partir de brand/marca.png): elipse laranja; na
  // metade de cima, o anel vazado que se abre no topo da elipse, o anel laranja e o centro vazado. O "branco"
  // do logo vira o próprio tecido do moletom. 'O' = laranja, '.' = transparente.
  // Por que não LAB.pixel.LOGO.mark11 (11×5)? No peito 3D, laranja com furos escuros vira "abóbora": com só
  // 5 linhas (ou com o tracinho do entalhe dividindo a abertura) os vãos leem como olhos, nariz e boca.
  // Com 7 linhas e a abertura do topo contínua, os anéis ficam contínuos e a leitura é a de anéis
  // concêntricos, como na marca. Testado lado a lado em frente, 3/4 e câmera de jogo.
  // [IA] Claude – fix rodada 2: 7 colunas (antes 11, a largura toda do tronco), para sobrar moletom escuro dos
  // dois lados e a marca ler como logo no peito, não como um bloco laranja.
  var CHEST_MARK = [
    '.O...O.',
    'O..O..O',
    'O.O.O.O',
    'O..O..O',
    '.OOOOO.',
    '..OOO..'
  ];

  // Cores-base do aluno: cópia de LAB.pixel.STUDENT.colors (nomes descritivos do sprite 2D), para o voxel e o
  // sprite serem o mesmo personagem. As variações (claro/escuro) são derivadas em studentColors().
  var FALLBACK_STUDENT = {
    hair: '#2E1F26', hairLight: '#4D3541',
    skin: '#A86A4A', skinShadow: '#865039', blush: '#B85F57', mouth: '#5A2C2A',
    glasses: '#16121F', lens: '#BFE4FF', eye: '#120F1C',
    hoodie: '#2A2838', hoodieShadow: '#1E1C2B', hoodieLight: '#3D3A54',
    logo: '#FF6002', drawstring: '#FF6002', drawstringTip: '#FFA25E',
    headphones: '#E6E4F4', headphonesShadow: '#9F9CC2',
    backpack: '#3D5AA3', backpackShadow: '#2A3F7A',
    jeans: '#4566AA', jeansShadow: '#2F4A86', jeansLight: '#6386C8',
    sneakers: '#F4F3FA', sole: '#B5B3CC'
  };

  function lookup(obj, path) {
    var parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      if (obj == null) return undefined;
      obj = obj[parts[i]];
    }
    return obj;
  }

  function pixelLib() { return LAB.pixel || null; }

  /** Cor da paleta do site por caminho ("cesar", "chave.a"...), com reserva interna. */
  function paletteColor(path) {
    var lib = pixelLib();
    var v = lookup(lib && lib.PALETTE, path);
    return typeof v === 'string' ? v : lookup(FALLBACK_PALETTE, path);
  }

  /** Cor da chave/porta pela letra (a..d, maiúscula ou minúscula). */
  function keyColor(letter) {
    var l = String(letter || 'a').charAt(0).toLowerCase();
    return paletteColor('chave.' + l) || paletteColor('chave.a');
  }

  /** Cores do aluno: as do sprite 2D (LAB.pixel.STUDENT.colors) ou a reserva idêntica, mais as derivadas. */
  function studentColors() {
    var base = {}, k;
    for (k in FALLBACK_STUDENT) base[k] = FALLBACK_STUDENT[k];
    var lib = pixelLib();
    var src = lib && lib.STUDENT && lib.STUDENT.colors;
    if (src && typeof src === 'object') {
      for (k in FALLBACK_STUDENT) if (typeof src[k] === 'string' && /^#[0-9a-f]{6}$/i.test(src[k])) base[k] = src[k];
    }
    var b = base;
    return {
      hair: b.hair, hairHi: b.hairLight, hairLo: darken(b.hair, 0.35), curlTop: mixHex(b.hairLight, '#8A5A4C', 0.3),
      skin: b.skin, skinHi: lighten(b.skin, 0.12), skinLo: b.skinShadow, blush: b.blush, mouth: b.mouth,
      tongue: mixHex(b.blush, '#FF7A8A', 0.4),
      frame: b.glasses, lens: b.lens, glint: '#FFFFFF', eye: b.eye,
      hoodie: b.hoodie, hoodieHi: b.hoodieLight, hoodieLo: b.hoodieShadow,
      rib: darken(b.hoodieShadow, 0.15), hoodInner: darken(b.hoodie, 0.55),
      logo: paletteColor('cesar') || b.logo, logoGlow: darken(paletteColor('cesar') || b.logo, 0.35),
      string: b.drawstring, aglet: b.drawstringTip,
      jeans: b.jeans, jeansHi: b.jeansLight, jeansLo: b.jeansShadow, cuff: lighten(b.jeansLight, 0.18),
      shoe: b.sneakers, shoeLo: mixHex(b.sneakers, b.sole, 0.5), sole: b.sole, shoeAccent: paletteColor('cesar') || b.logo,
      phones: b.headphones, phonesLo: b.headphonesShadow, phonesPad: mixHex(b.hoodie, b.hoodieLight, 0.5),
      pack: b.backpack, packHi: lighten(b.backpack, 0.16), packLo: b.backpackShadow, zip: paletteColor('cesar') || b.logo,
      lining: darken(paletteColor('cesar') || b.logo, 0.22)
    };
  }

  /** Matriz da marca CESAR usada no peito do voxel (cópia; ver CHEST_MARK). */
  function logoMark() { return CHEST_MARK.slice(); }

  /* ======================================================================================
     2. Utilitários: cor, matemática, easing
     ====================================================================================== */

  var _col = new THREE.Color();

  function rgb255(css) {
    var n = _col.setStyle(css).getHex();      // getHex() devolve sRGB
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(r, g, b) {
    function c(v) { return Math.max(0, Math.min(255, Math.round(v))); }
    return '#' + ((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1);
  }
  function mixHex(a, b, t) {
    var A = rgb255(a), B = rgb255(b);
    return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function lighten(c, t) { return mixHex(c, '#FFFFFF', t); }
  function darken(c, t) { return mixHex(c, '#0B0A14', t); }   // escurece rumo à tinta da noite, não ao preto puro

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function seg(p, a, b) { return clamp01((p - a) / (b - a)); }       // progresso dentro de um trecho [a, b]
  function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
  function approach(v, target, step) { return v < target ? Math.min(target, v + step) : Math.max(target, v - step); }
  function bump(p) { return Math.sin(clamp01(p) * Math.PI); }        // 0 → 1 → 0

  var ease = {
    outCubic: function (p) { p = clamp01(p); return 1 - Math.pow(1 - p, 3); },
    inCubic: function (p) { p = clamp01(p); return p * p * p; },
    inOut: function (p) { p = clamp01(p); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    outBack: function (p) { p = clamp01(p); var s = 1.9; return 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2); },
    inQuad: function (p) { p = clamp01(p); return p * p; }
  };

  // Gerador pseudoaleatório determinístico (texturas iguais em toda carga).
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }

  /* ======================================================================================
     3. Canvas, texturas e descarte
     ====================================================================================== */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return c;
  }

  function pixelTexture(canvas) {
    var t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  /** Desenha uma matriz de caracteres num contexto 2D (char → cor; '.' e cores ausentes são pulados). */
  function drawRows(ctx, rows, map, ox, oy, scale) {
    scale = scale || 1;
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        var c = map[rows[y].charAt(x)];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect((ox || 0) + x * scale, (oy || 0) + y * scale, scale, scale);
      }
    }
  }

  /** Saco de recursos descartáveis (geometrias, materiais, texturas, subobjetos). */
  function Bag() { this.items = []; }
  Bag.prototype.add = function (o) { if (o) this.items.push(o); return o; };
  Bag.prototype.dispose = function () {
    for (var i = this.items.length - 1; i >= 0; i--) {
      var o = this.items[i];
      if (o && typeof o.dispose === 'function') o.dispose();
    }
    this.items.length = 0;
  };

  function detach(obj) { if (obj && obj.parent) obj.parent.remove(obj); }

  // Texturas compartilhadas entre objetos (pequenas, criadas uma vez e nunca descartadas).
  var shared = {};
  function sharedTexture(name, painter, w, h) {
    if (shared[name]) return shared[name];
    var c = makeCanvas(w, h);
    painter(c.getContext('2d'), w, h);
    shared[name] = pixelTexture(c);
    return shared[name];
  }

  /** Brilho radial "em degraus" (pixel art): branco com alfa quantizado; o material tinge. */
  function glowTexture() {
    return sharedTexture('glow', function (x, w, h) {
      var cx = (w - 1) / 2, cy = (h - 1) / 2;
      for (var y = 0; y < h; y++) {
        for (var i = 0; i < w; i++) {
          var d = Math.sqrt((i - cx) * (i - cx) + (y - cy) * (y - cy)) / (w / 2);
          var a = d < 0.28 ? 0.95 : d < 0.5 ? 0.55 : d < 0.72 ? 0.28 : d < 0.95 ? 0.1 : 0;
          if (!a) continue;
          x.fillStyle = 'rgba(255,255,255,' + a + ')';
          x.fillRect(i, y, 1, 1);
        }
      }
    }, 16, 16);
  }

  /** Anel de chão (halo) em degraus. */
  function haloTexture() {
    return sharedTexture('halo', function (x, w, h) {
      var cx = (w - 1) / 2, cy = (h - 1) / 2;
      for (var y = 0; y < h; y++) {
        for (var i = 0; i < w; i++) {
          var d = Math.sqrt((i - cx) * (i - cx) + (y - cy) * (y - cy));
          var a = (d > 6.2 && d < 7.6) ? 0.9 : d < 6.2 ? (d < 3 ? 0.35 : 0.18) : 0;
          if (!a) continue;
          x.fillStyle = 'rgba(255,255,255,' + a + ')';
          x.fillRect(i, y, 1, 1);
        }
      }
    }, 16, 16);
  }

  /** Clarão em estrela (momento "item get"). */
  function flashTexture() {
    return sharedTexture('flash', function (x, w, h) {
      var c = (w - 1) / 2;
      for (var y = 0; y < h; y++) {
        for (var i = 0; i < w; i++) {
          var dx = Math.abs(i - c), dy = Math.abs(y - c), d = Math.sqrt(dx * dx + dy * dy);
          var a = 0;
          if (dx < 1 || dy < 1) a = d < 4 ? 1 : d < 7 ? 0.6 : 0.3;            // raios em cruz
          else if (Math.abs(dx - dy) < 0.8 && d < 5.5) a = d < 3 ? 0.8 : 0.4;  // raios diagonais
          if (d < 2.2) a = 1;
          if (!a) continue;
          x.fillStyle = 'rgba(255,255,255,' + a + ')';
          x.fillRect(i, y, 1, 1);
        }
      }
    }, 17, 17);
  }

  /** Feixe vertical (saída): forte embaixo, some em degraus para cima. */
  function beamTexture() {
    return sharedTexture('beam', function (x, w, h) {
      for (var y = 0; y < h; y++) {
        var t = y / (h - 1);                  // 1 embaixo, 0 em cima (flipY: linha 0 do canvas = topo do cilindro)
        var a = Math.round(Math.pow(t, 1.4) * 5) / 5;
        for (var i = 0; i < w; i++) {
          var edge = (i === 0 || i === w - 1) ? 1.25 : 1;
          x.fillStyle = 'rgba(255,255,255,' + clamp01(a * 0.8 * edge) + ')';
          x.fillRect(i, y, 1, 1);
        }
      }
    }, 8, 16);
  }

  /** Balão "?" em pixel art (sem solução). */
  function questionTexture() {
    return sharedTexture('question', function (x) {
      drawRows(x, [
        '.KKKKKKKKK.',
        'KWWWWWWWWWK',
        'KWWWOOOWWWK',
        'KWWOOWOOWWK',
        'KWWWWWOOWWK',
        'KWWWWOOWWWK',
        'KWWWWOOWWWK',
        'KWWWWWWWWWK',
        'KWWWWOOWWWK',
        'KWWWWWWWWWK',
        '.KKKKWKKKK.',
        '....KWK....',
        '.....K.....'
      ], { K: paletteColor('noite'), W: '#F4F2FB', O: paletteColor('cesar') }, 0, 0, 1);
    }, 11, 13);
  }

  /** [IA] Claude – Balão "…" (triste/sem saída) em pixel art. */
  function dotsTexture() {
    return sharedTexture('dots', function (x) {
      drawRows(x, [
        '.KKKKKKKKKKK.',
        'KWWWWWWWWWWWK',
        'KWWWWWWWWWWWK',
        'KWWWWWWWWWWWK',
        'KWOOWWOOWWOOK',
        'KWOOWWOOWWOOK',
        'KWWWWWWWWWWWK',
        'KWWWWWWWWWWWK',
        '.KKKKWKKKKKK.',
        '....KWK......',
        '.....K.......'
      ], { K: paletteColor('noite'), W: '#F4F2FB', O: '#5B5F7A' }, 0, 0, 1);
    }, 13, 11);
  }

  /** [IA] Claude – Gota de suor/lágrima (sprite 3×5). */
  function sweatTexture() {
    return sharedTexture('sweat', function (x) {
      drawRows(x, ['.k.', 'kwk', 'kbk', 'kbk', '.k.'], { k: '#2B6F94', w: '#FFFFFF', b: '#9FE3FF' }, 0, 0, 1);
    }, 3, 5);
  }

  /* ======================================================================================
     4. Animações (lista de tweens com Promise)
     ====================================================================================== */

  function Anim() { this.list = []; }
  /** Executa step(p, dt) de p=0 até p=1 em `duration` segundos; resolve no fim. */
  Anim.prototype.play = function (duration, step, tag) {
    var self = this;
    return new Promise(function (resolve) {
      self.list.push({ t: 0, d: Math.max(0.001, duration), step: step, resolve: resolve, tag: tag || '' });
    });
  };
  Anim.prototype.update = function (dt) {
    for (var i = 0; i < this.list.length; i++) {
      var a = this.list[i];
      a.t += dt;
      var p = Math.min(1, a.t / a.d);
      a.step(p, dt);
      if (p >= 1) { this.list.splice(i--, 1); a.resolve(); }
    }
  };
  /** Conclui imediatamente (aplica o estado final e resolve). Sem tag: todas. */
  Anim.prototype.finish = function (tag) {
    var keep = [];
    var done = [];
    for (var i = 0; i < this.list.length; i++) {
      if (!tag || this.list[i].tag === tag) done.push(this.list[i]); else keep.push(this.list[i]);
    }
    this.list = keep;
    done.forEach(function (a) { try { a.step(1, 0); } catch (e) { /* estado final best-effort */ } a.resolve(); });
  };
  Anim.prototype.busy = function (tag) {
    for (var i = 0; i < this.list.length; i++) if (!tag || this.list[i].tag === tag) return true;
    return false;
  };

  /* ======================================================================================
     5. Modelo voxel com atlas de texturas por face (personagem, bônus, saída)
        Cada caixa recebe uma "pele" por face: cor sólida (texel compartilhado) ou função pintora
        que desenha texel a texel. Tudo vai para um único atlas (cor + emissivo), com borda de 1px
        replicada para o NearestFilter não vazar texels vizinhos. Cada "parte" vira uma geometria.
     ====================================================================================== */

  // Ordem das faces e orientação da imagem (vista de fora, topo da imagem = +y; no topo/base, ver abaixo):
  //   pz frente (+z): esquerda = -x      nz trás (-z): esquerda = +x
  //   px lado +x:     esquerda = frente   nx lado -x:   esquerda = trás
  //   py topo:        esquerda = -x, topo da imagem = trás (-z)
  //   ny base:        esquerda = -x, topo da imagem = frente (+z)
  var FACES = [
    { name: 'px', n: [1, 0, 0], size: function (w, h, d) { return [d, h]; },
      corners: function (a, b) { return [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]]]; } },
    { name: 'nx', n: [-1, 0, 0], size: function (w, h, d) { return [d, h]; },
      corners: function (a, b) { return [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], a[2]], [a[0], a[1], b[2]]]; } },
    { name: 'py', n: [0, 1, 0], size: function (w, h, d) { return [w, d]; },
      corners: function (a, b) { return [[a[0], b[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], b[2]], [b[0], b[1], b[2]]]; } },
    { name: 'ny', n: [0, -1, 0], size: function (w, h, d) { return [w, d]; },
      corners: function (a, b) { return [[a[0], a[1], b[2]], [b[0], a[1], b[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]]]; } },
    { name: 'pz', n: [0, 0, 1], size: function (w, h) { return [w, h]; },
      corners: function (a, b) { return [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [a[0], a[1], b[2]], [b[0], a[1], b[2]]]; } },
    { name: 'nz', n: [0, 0, -1], size: function (w, h) { return [w, h]; },
      corners: function (a, b) { return [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]]; } }
  ];

  /** Caneta de pintura de uma face: coordenadas locais em texels, com espelhamento opcional. */
  function Pen(ctx, ectx, ox, oy, w, h, mirror) {
    this.c = ctx; this.e = ectx; this.ox = ox; this.oy = oy; this.w = w; this.h = h; this.m = !!mirror;
  }
  Pen.prototype._r = function (ctx, x, y, w, h, color) {
    if (!color) return;
    if (this.m) x = this.w - x - w;
    var x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.fillStyle = color;
    ctx.fillRect(this.ox + x0, this.oy + y0, x1 - x0, y1 - y0);
  };
  Pen.prototype.fill = function (color) { this._r(this.c, 0, 0, this.w, this.h, color); return this; };
  Pen.prototype.rect = function (x, y, w, h, color) { this._r(this.c, x, y, w, h, color); return this; };
  Pen.prototype.px = function (x, y, color) { this._r(this.c, x, y, 1, 1, color); return this; };
  Pen.prototype.rows = function (rows, map, ox, oy) {
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        var c = map[rows[y].charAt(x)];
        if (c) this._r(this.c, (ox || 0) + x, (oy || 0) + y, 1, 1, c);
      }
    }
    return this;
  };
  Pen.prototype.glow = function (x, y, w, h, color) { this._r(this.e, x, y, w, h, color); return this; };
  Pen.prototype.glowRows = function (rows, map, ox, oy) {
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        var c = map[rows[y].charAt(x)];
        if (c) this._r(this.e, (ox || 0) + x, (oy || 0) + y, 1, 1, c);
      }
    }
    return this;
  };
  /** Salpica pixels de `color` com densidade `d` (determinístico). */
  Pen.prototype.speckle = function (color, d, seed, x0, y0, w, h) {
    var r = rng(seed || 7);
    x0 = x0 || 0; y0 = y0 || 0; w = w == null ? this.w : w; h = h == null ? this.h : h;
    for (var y = y0; y < y0 + h; y++) for (var x = x0; x < x0 + w; x++) if (r() < d) this.px(x, y, color);
    return this;
  };

  function VoxelModel() { this.parts = {}; this.order = []; this.reqs = []; this.solids = {}; }

  /** Declara uma parte (vira uma malha) com o pivô em `origin` (coordenadas em voxels). */
  VoxelModel.prototype.part = function (name, origin) {
    if (!this.parts[name]) { this.parts[name] = { origin: origin || [0, 0, 0], boxes: [] }; this.order.push(name); }
    return this.parts[name];
  };

  VoxelModel.prototype._request = function (spec, w, h, mirror) {
    if (typeof spec === 'string') {
      if (!this.solids[spec]) {
        this.solids[spec] = { w: 1, h: 1, solid: true, paint: (function (c) { return function (p) { p.fill(c); }; })(spec) };
        this.reqs.push(this.solids[spec]);
      }
      return this.solids[spec];
    }
    var r = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), paint: spec, mirror: !!mirror };
    this.reqs.push(r);
    return r;
  };

  /**
   * Adiciona uma caixa à parte `name`. (x0, y0, z0) = canto mínimo em voxels no espaço do modelo
   * (pés na origem, frente = +z); w, h, d em voxels. `skin` define a pintura por face:
   *   { px|nx|py|ny|pz|nz: cor | pintor, sides: pintor p/ px e nx (nx espelhado: coluna 0 = frente nos dois),
   *     all: padrão, skip: ['ny', ...] faces omitidas (escondidas) }
   * Pintor: function (pen, w, h).
   */
  VoxelModel.prototype.box = function (name, x0, y0, z0, w, h, d, skin) {
    var part = this.part(name);
    skin = skin || {};
    var box = { a: [x0, y0, z0], b: [x0 + w, y0 + h, z0 + d], faces: {} };
    for (var i = 0; i < FACES.length; i++) {
      var f = FACES[i];
      if (skin.skip && skin.skip.indexOf(f.name) >= 0) continue;
      var spec = skin[f.name], mirror = false;
      if (spec == null && (f.name === 'px' || f.name === 'nx') && skin.sides != null) {
        spec = skin.sides;
        mirror = f.name === 'nx' && typeof spec === 'function';
      }
      if (spec == null) spec = skin.all;
      if (spec == null) spec = '#FF00FF';
      var sz = f.size(w, h, d);
      box.faces[f.name] = this._request(spec, sz[0], sz[1], mirror);
    }
    part.boxes.push(box);
    return box;
  };

  /**
   * Empacota as faces no atlas, pinta e gera uma BufferGeometry por parte.
   * opts.selfLight (0..1): fração da cor que também vai para o emissivo (o personagem não some no escuro).
   */
  VoxelModel.prototype.build = function (opts) {
    opts = opts || {};
    var reqs = this.reqs.slice().sort(function (a, b) { return (b.h - a.h) || (b.w - a.w); });
    function pack(W) {
      var x = 0, y = 0, rowH = 0;
      for (var i = 0; i < reqs.length; i++) {
        var r = reqs[i], rw = r.w + 2, rh = r.h + 2;
        if (x + rw > W) { x = 0; y += rowH; rowH = 0; }
        r.ax = x + 1; r.ay = y + 1;
        x += rw; rowH = Math.max(rowH, rh);
      }
      return y + rowH;
    }
    var AW = 32, AH;
    for (;;) { AH = pack(AW); if (AH <= AW || AW >= 2048) break; AW *= 2; }
    var ah = 1; while (ah < AH) ah *= 2; AH = ah;

    var cCanvas = makeCanvas(AW, AH), eCanvas = makeCanvas(AW, AH);
    var cx = cCanvas.getContext('2d'), ex = eCanvas.getContext('2d');
    ex.fillStyle = '#000'; ex.fillRect(0, 0, AW, AH);

    function paint(r) {
      cx.clearRect(r.ax - 1, r.ay - 1, r.w + 2, r.h + 2);
      ex.fillStyle = '#000'; ex.fillRect(r.ax - 1, r.ay - 1, r.w + 2, r.h + 2);
      r.paint(new Pen(cx, ex, r.ax, r.ay, r.w, r.h, r.mirror), r.w, r.h);
      extrudeEdges(cx, r); extrudeEdges(ex, r);
    }
    reqs.forEach(paint);
    function selfLight() {
      if (!opts.selfLight) return;
      ex.save();
      ex.globalCompositeOperation = 'lighter';
      ex.globalAlpha = opts.selfLight;
      ex.drawImage(cCanvas, 0, 0);
      ex.restore();
    }
    selfLight();

    var colorTexture = pixelTexture(cCanvas);
    var emissiveTexture = pixelTexture(eCanvas);

    var geometries = {};
    var self = this;
    this.order.forEach(function (name) {
      var part = self.parts[name], o = part.origin;
      var pos = [], nor = [], uv = [], idx = [];
      part.boxes.forEach(function (bx) {
        var a = [(bx.a[0] - o[0]) * U, (bx.a[1] - o[1]) * U, (bx.a[2] - o[2]) * U];
        var b = [(bx.b[0] - o[0]) * U, (bx.b[1] - o[1]) * U, (bx.b[2] - o[2]) * U];
        for (var i = 0; i < FACES.length; i++) {
          var f = FACES[i], r = bx.faces[f.name];
          if (!r) continue;
          var base = pos.length / 3;
          var cs = f.corners(a, b);
          for (var k = 0; k < 4; k++) { pos.push(cs[k][0], cs[k][1], cs[k][2]); nor.push(f.n[0], f.n[1], f.n[2]); }
          var u0, u1, vt, vb;
          if (r.solid) { u0 = u1 = (r.ax + 0.5) / AW; vt = vb = 1 - (r.ay + 0.5) / AH; }
          else { u0 = r.ax / AW; u1 = (r.ax + r.w) / AW; vt = 1 - r.ay / AH; vb = 1 - (r.ay + r.h) / AH; }
          uv.push(u0, vt, u1, vt, u0, vb, u1, vb);
          idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      geometries[name] = g;
    });

    return {
      geometries: geometries,
      colorTexture: colorTexture,
      emissiveTexture: emissiveTexture,
      /** Repinta uma face (ex.: piscar de olhos) e marca as texturas para reenvio. */
      repaint: function (req) {
        if (!req || req.ax == null) return;
        paint(req);
        if (opts.selfLight) {
          ex.save(); ex.globalCompositeOperation = 'lighter'; ex.globalAlpha = opts.selfLight;
          ex.drawImage(cCanvas, req.ax - 1, req.ay - 1, req.w + 2, req.h + 2, req.ax - 1, req.ay - 1, req.w + 2, req.h + 2);
          ex.restore();
        }
        colorTexture.needsUpdate = true;
        emissiveTexture.needsUpdate = true;
      }
    };
  };

  function extrudeEdges(ctx, r) {
    var c = ctx.canvas, x = r.ax, y = r.ay, w = r.w, h = r.h;
    ctx.drawImage(c, x, y, w, 1, x, y - 1, w, 1);
    ctx.drawImage(c, x, y + h - 1, w, 1, x, y + h, w, 1);
    ctx.drawImage(c, x, y - 1, 1, h + 2, x - 1, y - 1, 1, h + 2);
    ctx.drawImage(c, x + w - 1, y - 1, 1, h + 2, x + w, y - 1, 1, h + 2);
  }

  /* ======================================================================================
     6. Extrusão de matrizes (chaves, cadeado): cada pixel vira um voxel com cor por vértice.
        Só as faces expostas são geradas; `depthMap` permite pixels mais rasos (ex.: buraco da
        fechadura rebaixado). Geometria centrada na origem; colunas → +x, linhas → -y.
     ====================================================================================== */

  var SIDE_SHADE = { pz: 1, nz: 0.92, py: 1.12, ny: 0.7, px: 0.86, nx: 0.86 };

  function extrude(rows, colors, opts) {
    opts = opts || {};
    var unit = opts.unit || U, depth = opts.depth || 2, dmap = opts.depthMap || {};
    var H = rows.length, W = 0, i;
    for (i = 0; i < H; i++) W = Math.max(W, rows[i].length);
    function cell(x, y) {
      if (y < 0 || y >= H || x < 0 || x >= W) return null;
      var ch = rows[y].charAt(x);
      return (ch && ch !== '.' && ch !== ' ' && colors[ch]) ? ch : null;
    }
    function dep(ch) { return ch ? (dmap[ch] != null ? dmap[ch] : depth) : 0; }

    var pos = [], nor = [], col = [], idx = [];
    var lin = {};
    function linear(ch) {
      if (!lin[ch]) { _col.setStyle(colors[ch]); lin[ch] = [_col.r, _col.g, _col.b]; }
      return lin[ch];
    }
    function quad(face, a, b, c) {
      var f = FACES_BY_NAME[face], cs = f.corners(a, b), base = pos.length / 3, s = SIDE_SHADE[face];
      for (var k = 0; k < 4; k++) {
        pos.push(cs[k][0], cs[k][1], cs[k][2]);
        nor.push(f.n[0], f.n[1], f.n[2]);
        col.push(Math.min(1, c[0] * s), Math.min(1, c[1] * s), Math.min(1, c[2] * s));
      }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    var cx = W / 2, cy = H / 2;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var ch = cell(x, y);
        if (!ch) continue;
        var c = linear(ch), hd = dep(ch) * unit / 2;
        var x0 = (x - cx) * unit, x1 = x0 + unit, y1 = (cy - y) * unit, y0 = y1 - unit;
        quad('pz', [x0, y0, -hd], [x1, y1, hd], c);
        quad('nz', [x0, y0, -hd], [x1, y1, hd], c);
        var nbs = [['px', 1, 0], ['nx', -1, 0], ['py', 0, -1], ['ny', 0, 1]];
        for (var k = 0; k < 4; k++) {
          var nd = dep(cell(x + nbs[k][1], y + nbs[k][2])) * unit / 2;
          if (nd >= hd) continue;
          if (nd <= 0) { quad(nbs[k][0], [x0, y0, -hd], [x1, y1, hd], c); continue; }
          quad(nbs[k][0], [x0, y0, nd], [x1, y1, hd], c);       // faixa da frente
          quad(nbs[k][0], [x0, y0, -hd], [x1, y1, -nd], c);     // faixa de trás
        }
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.userData.size = [W * unit, H * unit, depth * unit];
    return g;
  }
  var FACES_BY_NAME = {};
  FACES.forEach(function (f) { FACES_BY_NAME[f.name] = f; });

  /* ======================================================================================
     7. Chave voxel (geometria + material compartilhados por letra e escala)
     ====================================================================================== */

  // Chave robusta: argola com furo 2×2, haste dupla e dois dentes. h = luz, d = sombra, w = brilho.
  var KEY_ROWS = [
    '.hhhh.........',
    'hwOOOd........',
    'hO..Ohhhhhhhhh',
    'hO..OOOOOOOOOd',
    'hOOOOd...Od.Od',
    '.dddd....dd.dd'
  ];
  // Mini chave (pingente da mochila), em pé: argola em cima, dente embaixo.
  var CHARM_ROWS = [
    'hOd',
    'O.d',
    'hOd',
    '.O.',
    '.OO',
    '.O.',
    '.OO'
  ];

  var keyAssets = {};
  function keyAsset(letter, unit, rows, depth) {
    var l = String(letter || 'a').charAt(0).toLowerCase();
    var id = l + '|' + unit + '|' + (rows === CHARM_ROWS ? 'charm' : 'key') + '|' + (depth || 2);
    if (keyAssets[id]) return keyAssets[id];
    var base = keyColor(l);
    var geo = extrude(rows || KEY_ROWS, { O: base, h: lighten(base, 0.45), d: darken(base, 0.3), w: '#FFFFFF' },
      { unit: unit, depth: depth || 2 });
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(base), emissiveIntensity: 0.42 });
    keyAssets[id] = { geometry: geo, material: mat, color: base };
    return keyAssets[id];
  }
  function keyMesh(letter, unit, rows, depth) {
    var a = keyAsset(letter, unit || KEY_UNIT, rows, depth);
    var m = new THREE.Mesh(a.geometry, a.material);
    m.castShadow = true;
    m.name = 'chave-' + letter;
    return m;
  }

  /* ======================================================================================
     8. Partículas: cubinhos de pixel (InstancedMesh), gravidade, arrasto, encolhem até sumir
     ====================================================================================== */

  var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
    _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c3 = new THREE.Color();

  /**
   * Particles(parent, opts) — funciona com ou sem `new`. `parent` = cena ou qualquer Object3D (as posições
   * de burst() são no espaço desse pai). opts.max = capacidade (padrão 600).
   */
  function Particles(parent, opts) {
    if (!(this instanceof Particles)) return new Particles(parent, opts);
    opts = opts || {};
    this.max = opts.max || 600;
    this.parts = [];
    this.parent = parent || null;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c3.set(0xffffff));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'particulas';
    this.mesh.visible = false;
    if (this.parent) this.parent.add(this.mesh);
  }

  /**
   * burst(pos, color, n=24, opts): estoura n partículas em pos (THREE.Vector3 ou [x,y,z]).
   * color: css/hex ou lista de cores. opts: speed (1.6), up (1.4), spread (0..1: cone → esfera),
   * gravity (5.5), drag (1.4), life (0.8 s), size (0.06 casas), radius (raio de origem),
   * box ([hx,hy,hz] meia-caixa de origem), ring (true: velocidade só horizontal), floor (y do chão para
   * quicar), spin (giro), colors (lista; tem prioridade sobre color).
   */
  Particles.prototype.burst = function (pos, color, n, opts) {
    opts = opts || {};
    n = n == null ? 24 : n;
    var px = pos.x != null ? pos.x : pos[0], py = pos.y != null ? pos.y : pos[1], pz = pos.z != null ? pos.z : pos[2];
    var colors = opts.colors || (Array.isArray(color) ? color : [color == null ? '#FFFFFF' : color]);
    var speed = opts.speed != null ? opts.speed : 1.6, up = opts.up != null ? opts.up : 1.4;
    var spread = opts.spread != null ? opts.spread : 1, life = opts.life || 0.8, size = opts.size || 0.06;
    for (var i = 0; i < n; i++) {
      if (this.parts.length >= this.max) this.parts.shift();       // recicla o mais antigo
      var th = Math.random() * TAU;
      var el = opts.ring ? 0 : (1 - spread) * (Math.PI / 2) + Math.random() * spread * (Math.PI / 2);
      if (!opts.ring && spread >= 1 && Math.random() < 0.3) el = -el * 0.4;
      var sp = speed * (0.45 + Math.random() * 0.75);
      var ox = 0, oy = 0, oz = 0;
      if (opts.radius) { var rr = Math.sqrt(Math.random()) * opts.radius, ra = Math.random() * TAU; ox = Math.cos(ra) * rr; oz = Math.sin(ra) * rr; }
      if (opts.box) { ox += (Math.random() * 2 - 1) * opts.box[0]; oy += (Math.random() * 2 - 1) * opts.box[1]; oz += (Math.random() * 2 - 1) * opts.box[2]; }
      var c = colors[(Math.random() * colors.length) | 0];
      _c3.set(c);
      var spin = opts.spin != null ? opts.spin : 9;
      this.parts.push({
        x: px + ox, y: py + oy, z: pz + oz,
        vx: Math.cos(th) * Math.cos(el) * sp, vy: Math.sin(el) * sp + up * (0.6 + Math.random() * 0.6), vz: Math.sin(th) * Math.cos(el) * sp,
        age: 0, life: life * (0.65 + Math.random() * 0.7), size: size * (0.6 + Math.random() * 0.8),
        rx: Math.random() * TAU, ry: Math.random() * TAU, rz: 0,
        wx: (Math.random() * 2 - 1) * spin, wy: (Math.random() * 2 - 1) * spin,
        r: _c3.r, g: _c3.g, b: _c3.b,
        grav: opts.gravity != null ? opts.gravity : 5.5, drag: opts.drag != null ? opts.drag : 1.4,
        floor: opts.floor != null ? opts.floor : null
      });
    }
    this.mesh.visible = true;
    return this;
  };

  Particles.prototype.update = function (dt) {
    dt = Math.min(dt || 0, 0.1);
    var list = this.parts, n = 0, mesh = this.mesh;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      var k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor != null && p.y < p.floor + p.size / 2) {
        p.y = p.floor + p.size / 2; p.vy = Math.abs(p.vy) * 0.25; p.vx *= 0.5; p.vz *= 0.5; p.wx *= 0.5; p.wy *= 0.5;
      }
      p.rx += p.wx * dt; p.ry += p.wy * dt;
      var t = p.age / p.life, s = p.size * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      list[n++] = p;
      if (n > this.max) continue;
      _e.set(p.rx, p.ry, 0);
      _q.setFromEuler(_e);
      _m4.compose(_v.set(p.x, p.y, p.z), _q, _s.set(s, s, s));
      mesh.setMatrixAt(n - 1, _m4);
      mesh.setColorAt(n - 1, _c3.setRGB(p.r, p.g, p.b));
    }
    list.length = n;
    mesh.count = Math.min(n, this.max);
    mesh.visible = n > 0;
    if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
    return n;
  };

  Particles.prototype.clear = function () { this.parts.length = 0; this.mesh.count = 0; this.mesh.visible = false; };
  Particles.prototype.dispose = function () {
    this.clear();
    detach(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  };

  /* ======================================================================================
     9. Texto flutuante (Pixelify Sans em canvas, binarizado para pixels nítidos + contorno)
     ====================================================================================== */

  var FONT_STACK = '"Pixelify Sans", "PixelifySans", sans-serif';
  var fontReady = false, fontPromise = null;
  function ensureFont() {
    if (fontReady) return null;
    if (!fontPromise && root.document && document.fonts && document.fonts.load) {
      fontPromise = document.fonts.load('600 16px "Pixelify Sans"').then(function (faces) {
        fontReady = !!(faces && faces.length);
        return fontReady;
      }, function () { return false; });
    }
    return fontPromise;
  }

  /** Desenha `text` binarizado (sem antialias) com contorno de 1px e sombra; devolve canvas. */
  function pixelTextCanvas(text, color, px, outline) {
    var font = '600 ' + px + 'px ' + FONT_STACK;
    var probe = makeCanvas(4, 4).getContext('2d');
    probe.font = font;
    var tw = Math.ceil(probe.measureText(text).width);
    var pad = 3, w = tw + pad * 2, h = Math.ceil(px * 1.25) + pad * 2;
    var c = makeCanvas(w, h), x = c.getContext('2d');
    x.font = font; x.textBaseline = 'alphabetic'; x.fillStyle = '#FFFFFF';
    x.fillText(text, pad, pad + Math.round(px * 0.95));
    var img = x.getImageData(0, 0, w, h), d = img.data;
    var on = new Uint8Array(w * h), i, j;
    for (i = 0; i < w * h; i++) on[i] = d[i * 4 + 3] > 100 ? 1 : 0;
    var fill = rgb255(color), out = rgb255(outline || '#17142E');
    for (i = 0; i < w * h; i++) { d[i * 4 + 3] = 0; }
    for (j = 0; j < h; j++) {
      for (i = 0; i < w; i++) {
        var k = j * w + i;
        if (on[k]) { d[k * 4] = fill[0]; d[k * 4 + 1] = fill[1]; d[k * 4 + 2] = fill[2]; d[k * 4 + 3] = 255; continue; }
        var near = false;
        for (var dy = -1; dy <= 2 && !near; dy++) {         // contorno + 1px de sombra para baixo
          for (var dx = -1; dx <= 1 && !near; dx++) {
            var xx = i + dx, yy = j - dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && on[yy * w + xx]) near = true;
          }
        }
        if (near) { d[k * 4] = out[0]; d[k * 4 + 1] = out[1]; d[k * 4 + 2] = out[2]; d[k * 4 + 3] = 255; }
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  /**
   * floatText(text, color, opts) → { sprite, update(dt) → vivo?, dispose() }. Quem chama posiciona e adiciona
   * o sprite; ele sobe e some sozinho e, ao morrer, sai do pai e libera a textura.
   * opts: life (1.15 s), rise (0.55 casa), px (tamanho da fonte, 12), scale (casas por pixel do canvas, 0.024).
   */
  function floatText(text, color, opts) {
    opts = opts || {};
    text = String(text == null ? '' : text);
    color = color || paletteColor('luar');
    var px = opts.px || 12, k = opts.scale || 0.024;
    var tex = pixelTexture(pixelTextCanvas(text, color, px, opts.outline));
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    var sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 999;
    sprite.name = 'texto-flutuante';
    function sizeFromCanvas() {
      var img = tex.image;
      sprite.scale.set(img.width * k, img.height * k, 1);
    }
    sizeFromCanvas();
    var p = ensureFont();
    var alive = true;
    if (p && p.then) {
      p.then(function (ok) {
        if (!ok || !alive) return;
        tex.image = pixelTextCanvas(text, color, px, opts.outline);
        tex.needsUpdate = true;
        sizeFromCanvas();
      });
    }
    var st = { age: 0, life: opts.life || 1.15, rise: opts.rise != null ? opts.rise : 0.55, baseY: null };
    var base = sprite.scale.clone();
    var obj = {
      sprite: sprite,
      update: function (dt) {
        if (!alive) return false;
        if (st.baseY === null) { st.baseY = sprite.position.y; base.copy(sprite.scale); }
        st.age += Math.min(dt || 0, 0.1);
        var t = clamp01(st.age / st.life);
        sprite.position.y = st.baseY + st.rise * ease.outCubic(t);
        var pop = t < 0.14 ? ease.outBack(t / 0.14) : 1;
        sprite.scale.set(base.x * pop, base.y * pop, 1);
        mat.opacity = t < 0.62 ? 1 : 1 - seg(t, 0.62, 1);
        if (t >= 1) { obj.dispose(); return false; }
        return true;
      },
      dispose: function () {
        if (!alive) return;
        alive = false;
        detach(sprite);
        tex.dispose(); mat.dispose();
      }
    };
    return obj;
  }

  /* ======================================================================================
     10. O aluno da CESAR School
     ====================================================================================== */

  // [IA] Claude – Rosto 12×12 (rodada 2): na rodada 1 o rosto sumia sob o cabelo na câmera de 52°. Agora o
  // cabelo ocupa só as 2 primeiras linhas (franja curta, quase sem beiral), há sobrancelhas (dão as emoções),
  // óculos de 4 linhas com olhos 2×2 e boca mais baixa. A cabeça também inclina um pouco para cima (pose base).
  // H cabelo, h brilho do cabelo, b sobrancelha, S pele, s pele na sombra, k armação, e olho, w reflexo,
  // L lente, c bochecha, m boca, M língua, T lágrima.
  var FACE = [
    'HHHHHHHHHHHH',
    'HhHSHHHHSHhH',
    'HSbbSSSSbbSH',
    'SSSSSSSSSSSS',
    'SkkkkSSkkkkS',
    'kweeLkkLeewk',
    'kLeeLSSLeeLk',
    'SkkkkSSkkkkS',
    'SSSSSssSSSSS',
    'ScSSSSSSSScS',
    'SSSSSmmSSSSS',
    'sSSSSSSSSSSs'
  ];
  // Linhas trocadas por expressão (índice da linha → conteúdo).
  var EXPRESSIONS = {
    normal: {},
    blink: { 5: 'kLLLLkkLLLLk', 6: 'kkeekSSkeekk' },
    happy: { 2: 'HbbSSSSSSbbH', 5: 'kLeeLkkLeeLk', 6: 'keLLeSSeLLek', 9: 'ScSSSSSSSScS', 10: 'SSSmSSSSmSSS', 11: 'sSSSmMMmSSSs' },
    sad: { 2: 'HSSSbSSbSSSH', 3: 'SSbbSSSSbbSS', 5: 'kLLLLkkLLLLk', 6: 'kLeeLSSLeeLk', 8: 'SSSSSssSSTSS',
      9: 'SSSSSSSSSTSS', 10: 'SSSSmmmmSSSS', 11: 'sSSmSSSSmSSs' },
    confused: { 1: 'HhHSHHHHbbhH', 2: 'HSbbSSSSSSSH', 5: 'kweeLkkLLLLk', 10: 'SSSSSSSmmSSS' },
    focus: { 2: 'HSSSSSSSSSSH', 3: 'SSbbbSSbbbSS', 10: 'SSSSSmmSSSSS' }
  };
  var EXPRESSION_ALIAS = { neutral: 'normal', neutro: 'normal', feliz: 'happy', triste: 'sad', piscar: 'blink' };
  // Lateral da cabeça 9×12 (coluna 0 = frente): haste dos óculos até a orelha (E).
  var HEAD_SIDE = [
    'HHHHHHHHH',
    'HHHHHhHHH',
    'SHHHHHHHH',
    'SSHHHHHhH',
    'kSSHHHHHH',
    'kkkkEHHHH',
    'SSSSEHHHH',
    'kSSSSHhHH',
    'SSSSSHHHH',
    'SSSSSSHHH',
    'sSSSSsHHH',
    'sssssssHH'
  ];
  var HAIR_BACK = [
    'HHhHHHHHhHHH',
    'HHHHHhHHHHHH',
    'HhHHHHHHHhHH',
    'HHHHhHHHHHHH',
    'HHHHHHHhHHHH',
    'HhHHHHHHHHhH',
    'HHHHhHHHHHHH',
    'HHHHHHHHhHHH',
    'HHhHHHHHHHHH',
    'HHHHHHhHHHHH',
    'dHHHHHdHHHHd',
    'dddddddddddd'
  ];

  // Volume do cabelo: "touca" de cachos um pouco mais larga que a cabeça, recuada atrás do rosto (z ≤ 3,25).
  var HEAD_TOP = 28;              // cabeça em y 16..28, z -5..4
  var HAIR_CAP = [-6.5, 24, -5.75, 13, 4.75, 9];
  // Cachos: [x0, y0, z0, w, h, d] em voxels.
  var CURLS = [
    // franja curta: só cobre as 2 linhas de cabelo do rosto e quase não avança (0,5 voxel)
    [-6.25, 26.75, 4, 2.5, 2.25, 0.5], [-3.5, 27.25, 4, 2.25, 1.75, 0.5], [-1.0, 26.5, 4, 2, 2.5, 0.5],
    [1.25, 27.25, 4, 2.25, 1.75, 0.5], [3.75, 26.75, 4, 2.5, 2.25, 0.5],
    // costeletas descendo até a orelha e nuca
    [-6.75, 21.5, -1.5, 0.75, 3, 2.5], [6, 21.5, -1.5, 0.75, 3, 2.5],
    [-5, 19.5, -5.75, 4, 4, 0.75], [0.5, 20, -5.75, 4.5, 3.5, 0.75]
  ];

  /**
   * Cachos do topo da cabeça: grade desencontrada (fileiras deslocadas meia célula), tamanhos e posições com
   * variação determinística e alturas em domo (mais altos no cocuruto) + alguns cachinhos soltos por cima.
   * Cada cacho pega luz no topo e as frestas entre eles ficam escuras: lê como cabelo crespo, não como grade.
   */
  function topCurls(cap) {
    var r = rng(4242), out = [];
    var x0 = cap[0], z0 = cap[2], W = cap[3], D = cap[5], top = cap[1] + cap[4];
    var rows = 3, cols = 4, cw = W / cols, cd = D / rows;
    function dome(cx, cz) {
      var nx = (cx - (x0 + W / 2)) / (W / 2), nz = (cz - (z0 + D * 0.42)) / (D / 2);
      return clamp01(1 - 0.75 * (nx * nx + nz * nz));
    }
    for (var j = 0; j < rows; j++) {
      var shift = (j % 2) ? -cw / 2 : 0;
      for (var i = 0; i <= cols; i++) {
        var w = cw * (0.8 + r() * 0.35), d = cd * (0.85 + r() * 0.3);
        var cx = x0 + shift + (i + 0.5) * cw + (r() - 0.5) * 0.8, cz = z0 + (j + 0.5) * cd + (r() - 0.5) * 0.6;
        var a = Math.max(x0, cx - w / 2), b = Math.min(x0 + W, cx + w / 2);
        if (b - a < 1.5) continue;
        var h = 0.75 + 1.9 * dome(cx, cz) + r() * 0.5;
        out.push([a, top, Math.max(z0, cz - d / 2), b - a, h, Math.min(d, z0 + D - Math.max(z0, cz - d / 2))]);
      }
    }
    for (var k = 0; k < 4; k++) {                        // cachinhos soltos no alto
      var sw = 1.6 + r() * 1.2, sx = x0 + 2 + r() * (W - 4 - sw), sz = z0 + 1.5 + r() * (D - 4);
      out.push([sx, top + 1.2 + 1.3 * dome(sx, sz), sz, sw, 0.9 + r() * 0.6, 1.6 + r() * 1.2]);
    }
    return out;
  }

  /** Monta o modelo voxel do aluno (partes com pivôs para animação). */
  function buildStudentModel(m, K, mark, face) {
    var faceMap = {
      H: K.hair, h: K.hairHi, S: K.skin, s: K.skinLo, k: K.frame, e: K.eye, w: K.glint,
      L: K.lens, c: K.blush, m: K.mouth, M: K.tongue, E: K.skinLo, d: K.hairLo,
      b: K.hairLo, T: '#9FE3FF'
    };

    // ---------- pernas (jeans + tênis) ----------
    function jeans(p, w, h) {
      p.fill(K.jeans);
      p.rect(0, 0, w, 1, K.jeansLo);             // sombra do moletom
      p.px(1, 1, K.jeansHi);
      p.rect(0, h - 1, w, 1, K.cuff);            // barra dobrada
    }
    function shoeFront(p, w) { p.fill(K.shoe); p.rect(0, 1, w, 1, K.sole); p.px(0, 0, K.shoeLo); }
    function shoeSide(p, w) {                   // coluna 0 = bico
      p.fill(K.shoe); p.rect(0, 1, w, 1, K.sole);
      p.rect(2, 0, 2, 1, K.shoeAccent);          // risco laranja
    }
    function shoeBack(p, w) { p.fill(K.shoe); p.rect(0, 1, w, 1, K.sole); p.rect(1, 0, w - 2, 1, K.shoeAccent); }
    function shoeTop(p, w, h) { p.fill(K.shoe); p.rect(1, h - 1, w - 2, 1, K.shoeLo); }
    [1, -1].forEach(function (sx) {
      var name = sx > 0 ? 'legL' : 'legR';
      m.part(name, [2.5 * sx, 6, 0]);
      var x0 = 2.5 * sx - 2;
      m.box(name, x0, 2, -2, 4, 4, 4, { all: jeans, py: K.jeansLo, skip: ['ny'] });
      m.box(name, x0, 0, -2, 4, 2, 5, { pz: shoeFront, sides: shoeSide, nz: shoeBack, py: shoeTop, ny: K.sole });
    });

    // ---------- tronco: moletom com a marca CESAR ----------
    function torsoFront(p, w, h) {
      p.fill(K.hoodie);
      p.rect(0, 0, w, 1, K.hoodieLo);                       // sombra sob o queixo
      p.rect(3, 0, 5, 1, K.hoodInner);                       // gola
      p.rect(0, h - 1, w, 1, K.rib);                         // barra canelada
      for (var x = 1; x < w; x += 2) p.px(x, h - 1, K.hoodieLo);
      var mw = 0;
      mark.forEach(function (r) { mw = Math.max(mw, r.length); });
      var ox = Math.floor((w - mw) / 2), oy = Math.max(2, h - 2 - mark.length);
      p.rows(mark, { O: K.logo, w: '#FFF4EA' }, ox, oy);
      p.glowRows(mark, { O: K.logoGlow, w: '#5A4A40' }, ox, oy);
    }
    function torsoBack(p, w, h) {
      p.fill(K.hoodie);
      p.rect(0, h - 1, w, 1, K.rib);
      for (var x = 0; x < w; x += 2) p.px(x, h - 1, K.hoodieLo);
    }
    function torsoSide(p, w, h) {
      p.fill(K.hoodie);
      p.rect(0, h - 1, w, 1, K.rib);
      p.rect(Math.floor(w / 2), 0, 1, h - 1, K.hoodieLo); // costura lateral
    }
    m.part('torso', [0, 6, 0]);
    m.box('torso', -5.5, 6, -3, 11, 10, 6, { pz: torsoFront, nz: torsoBack, sides: torsoSide, py: K.hoodieLo, ny: K.hoodieLo });

    // capuz caído nas costas: por cima vê-se a abertura escura
    function hoodBack(p, w, h) {
      p.fill(K.hoodieHi);
      p.rect(0, 0, w, 1, lighten(K.hoodieHi, 0.08));
      p.rect(0, h - 1, w, 1, K.hoodie);
      p.rect(Math.floor(w / 2), 1, 1, h - 2, K.hoodie);     // costura central do capuz
    }
    // forro do capuz em laranja escuro: de cima e de costas aparece um toque da CESAR
    function hoodTop(p, w, h) { p.fill(K.hoodieHi); p.rect(1, 1, w - 2, h - 1, K.lining); p.rect(2, h - 1, w - 4, 1, darken(K.lining, 0.35)); }
    function hoodSide(p, w, h) { p.fill(K.hoodieHi); p.rect(0, h - 1, w, 1, K.hoodie); }
    m.box('torso', -4.5, 13.25, -6.75, 9, 3.5, 3.75, { nz: hoodBack, py: hoodTop, sides: hoodSide, pz: K.lining, ny: K.hoodie });

    // mochila pequena com bolso e zíper laranja
    function packBack(p, w, h) {
      p.fill(K.pack);
      p.rect(0, 0, w, 2, K.packHi);                        // aba
      p.rect(0, 2, w, 1, K.packLo);
      p.rect(0, h - 1, w, 1, K.packLo);
      p.px(0, 3, K.packLo); p.px(w - 1, 3, K.packLo);
    }
    function packSide(p, w, h) {                           // coluna 0 = lado do corpo
      p.fill(K.pack); p.rect(0, 0, w, 1, K.packHi); p.rect(0, 0, 1, h, K.packLo); p.rect(0, h - 1, w, 1, K.packLo);
    }
    function packTop(p, w, h) { p.fill(K.packHi); p.rect(2, 1, w - 4, 1, K.packLo); }
    function pocket(p, w, h) {
      p.fill(K.pack);
      p.rect(0, 0, w, 1, K.packLo);                        // zíper
      p.px(w - 2, 0, K.zip); p.px(w - 2, 1, K.zip);        // puxador
      p.glow(w - 2, 0, 1, 2, darken(K.zip, 0.6));
      p.rect(0, h - 1, w, 1, K.packLo);
    }
    m.box('torso', -4, 7.5, -6, 8, 6, 3, { nz: packBack, sides: packSide, py: packTop, ny: K.packLo, pz: K.packLo });
    m.box('torso', -3, 8, -6.6, 6, 3, 0.6, { nz: pocket, sides: K.packLo, py: K.packHi, ny: K.packLo, pz: K.packLo });
    // alças da mochila passando por cima dos ombros
    m.box('torso', -4, 13.5, -3.4, 1.5, 2.6, 0.6, { all: K.packLo, py: K.pack });
    m.box('torso', 2.5, 13.5, -3.4, 1.5, 2.6, 0.6, { all: K.packLo, py: K.pack });

    // cordões laranja do capuz (saem do pescoço, ponteira clara)
    function string(p, w, h) { p.fill(K.string); p.rect(0, h - 1, w, 1, K.aglet); p.glow(0, 0, w, h - 1, darken(K.string, 0.55)); }
    m.box('torso', -1.5, 13.5, 3, 1, 2.5, 0.5, { all: string });
    m.box('torso', 0.5, 13.5, 3, 1, 2.5, 0.5, { all: string });

    // fone de ouvido no pescoço: conchas sobre os ombros + arco atrás da nuca
    // concha vista de lado: casco claro arredondado com o ponto laranja no meio
    function cupShell(p, w, h) {
      p.fill(K.phones);
      p.px(0, 0, K.phonesLo); p.px(w - 1, 0, K.phonesLo); p.px(0, h - 1, K.phonesLo); p.px(w - 1, h - 1, K.phonesLo);
      p.rect(0, h - 1, w, 1, K.phonesLo);
      p.px(Math.floor(w / 2), Math.floor(h / 2) - 1, K.logo); p.glow(Math.floor(w / 2), Math.floor(h / 2) - 1, 1, 1, darken(K.logo, 0.5));
    }
    // concha vista de frente: almofada escura do lado do pescoço, casco claro por fora
    function cupFrontL(p, w, h) { p.fill(K.phones); p.rect(0, 0, 1, h, K.phonesPad); p.rect(0, h - 1, w, 1, K.phonesLo); }
    m.box('torso', 4, 14, 0, 2.5, 3.5, 3.5, { px: cupShell, nx: K.phonesPad, pz: cupFrontL, nz: K.phonesLo, py: K.phones, ny: K.phonesLo });
    m.box('torso', -6.5, 14, 0, 2.5, 3.5, 3.5, { nx: cupShell, px: K.phonesPad, pz: function (p, w, h) {
      p.fill(K.phones); p.rect(w - 1, 0, 1, h, K.phonesPad); p.rect(0, h - 1, w, 1, K.phonesLo);
    }, nz: K.phonesLo, py: K.phones, ny: K.phonesLo });
    // arco que passa por trás do pescoço, apoiado no capuz
    m.box('torso', -6, 15.8, -5.9, 12, 1, 0.8, { all: K.phones, ny: K.phonesLo, py: lighten(K.phones, 0.3) });
    m.box('torso', -6.5, 15.8, -5.9, 1, 1, 6, { all: K.phones, ny: K.phonesLo });
    m.box('torso', 5.5, 15.8, -5.9, 1, 1, 6, { all: K.phones, ny: K.phonesLo });

    // ---------- braços (manga, punho canelado, mão) ----------
    function arm(p, w, h) {
      p.fill(K.hoodie);
      p.rect(0, 0, w, 1, K.hoodieHi);
      p.rect(0, h - 3, w, 1, K.rib);
      p.rect(0, h - 2, w, 2, K.skin);
      p.rect(0, h - 1, w, 1, K.skinLo);
    }
    [1, -1].forEach(function (sx) {
      var name = sx > 0 ? 'armL' : 'armR';
      m.part(name, [6.8 * sx, 15.5, 0]);
      m.box(name, 6.8 * sx - 1.5, 7.5, -1.5, 3, 8, 3, { all: arm, py: K.hoodieHi, ny: K.skinLo });
    });
    // [IA] Claude – punho fechado + polegar (só aparece no joinha): fica no pivô do braço direito.
    // O polegar sai pela frente (+z) da mão; com o braço esticado para a frente, ele aponta para cima.
    m.part('thumb', [-6.8, 15.5, 0]);
    function fist(p, w, h) { p.fill(K.skin); p.rect(0, 0, w, 1, K.skinHi); p.rect(0, h - 1, w, 1, K.skinLo); p.px(w - 1, 1, K.skinLo); }
    m.box('thumb', -8.55, 7.1, -1.75, 3.5, 2.7, 3.5, { all: fist, py: K.skinHi, ny: K.skinLo,
      pz: function (p, w, h) { fist(p, w, h); p.rect(0, 1, w, 1, K.skinLo); } });          // dedos dobrados
    m.box('thumb', -7.6, 7.6, 1.75, 1.6, 1.6, 2.6, { all: function (p, w, h) { p.fill(K.skin); p.rect(0, h - 1, w, 1, K.skinLo); },
      pz: function (p, w, h) { p.fill(K.skinHi); p.px(0, h - 1, K.skinLo); }, py: K.skinHi, ny: K.skinLo });

    // ---------- cabeça ----------
    m.part('head', [0, 16, -0.5]);
    var headBox = m.box('head', -6, 16, -5, 12, HEAD_TOP - 16, 9, {
      pz: function (p) {
        var rows = FACE.slice(), ex = EXPRESSIONS[face.expr] || EXPRESSIONS.normal;
        for (var r in ex) rows[r] = ex[r];
        p.rows(rows, faceMap, 0, 0);
        p.glow(1, 5, 1, 1, '#3A4A5C'); p.glow(10, 5, 1, 1, '#3A4A5C');  // reflexo das lentes brilha um pouco
        if (face.expr === 'sad') p.glow(9, 8, 1, 2, '#2C5A70');           // lágrima brilha
      },
      sides: function (p) { p.rows(HEAD_SIDE, faceMap, 0, 0); },
      nz: function (p) { p.rows(HAIR_BACK, faceMap, 0, 0); },
      py: function (p, w, h) { p.fill(K.hair).speckle(K.hairHi, 0.18, 11); },
      ny: K.skinLo
    });
    // cacho: topo claro com um "miolo" escuro (a volta do cacho), laterais escuras embaixo
    function curl(seed) {
      return {
        py: function (p, w, h) {
          p.fill(K.curlTop);
          var r = rng(seed);
          p.px(Math.floor(r() * w), Math.floor(r() * h), K.hairHi);
          p.px(Math.floor(r() * w), Math.floor(r() * h), K.hair);
          p.px(Math.floor(r() * w), Math.floor(r() * h), lighten(K.curlTop, 0.15));
        },
        sides: function (p, w, h) { p.fill(K.hair); p.rect(0, h - 1, w, 1, K.hairLo); p.px(1, 0, K.hairHi); },
        pz: function (p, w, h) { p.fill(K.hair); p.rect(0, h - 1, w, 1, K.hairLo); p.speckle(K.hairHi, 0.18, seed + 5, 0, 0, w, h - 1); },
        nz: function (p, w, h) { p.fill(K.hair); p.speckle(K.hairHi, 0.2, seed + 7); },
        ny: K.hairLo
      };
    }
    function curlySide(seed) {
      return function (p, w, h) {
        p.fill(K.hair);
        p.speckle(K.hairHi, 0.22, seed);
        p.rect(0, h - 1, w, 1, K.hairLo);
      };
    }
    var cap = HAIR_CAP;
    m.box('head', cap[0], cap[1], cap[2], cap[3], cap[4], cap[5], {
      sides: curlySide(5), nz: curlySide(9), pz: curlySide(13), py: K.hairLo, ny: K.hairLo
    });
    topCurls(cap).forEach(function (c, i) { m.box('head', c[0], c[1], c[2], c[3], c[4], c[5], curl(31 + i * 17)); });
    CURLS.forEach(function (c, i) { m.box('head', c[0], c[1], c[2], c[3], c[4], c[5], curl(301 + i * 13)); });

    return { faceReq: headBox.faces.pz };
  }

  /**
   * createStudent() → Student. Origem nos pés; altura ≈ 1,45 casa; olha para +z.
   * setWalking(on, speed): speed multiplica a cadência (1 = ritmo padrão; o motor passa passos/s ÷ 4).
   * Extras além do SPEC: setExpression(nome), timeScale (multiplica o tempo das animações),
   * face(dir, instantâneo), dispose().
   */
  function createStudent(opts) {
    opts = opts || {};
    var K = studentColors();
    var mark = logoMark();
    var faceState = { expr: 'normal' };
    var model = new VoxelModel();
    var info = buildStudentModel(model, K, mark, faceState);
    var built = model.build({ selfLight: 0.1 });
    var bag = new Bag();
    bag.add(built.colorTexture); bag.add(built.emissiveTexture);
    var mat = bag.add(new THREE.MeshLambertMaterial({
      map: built.colorTexture, emissive: 0xffffff, emissiveMap: built.emissiveTexture, emissiveIntensity: 1
    }));

    function meshOf(name) {
      var g = bag.add(built.geometries[name]);
      var me = new THREE.Mesh(g, mat);
      me.castShadow = true; me.receiveShadow = false; me.name = 'aluno-' + name;
      return me;
    }
    function pivot(parent, x, y, z, name) {
      var g = new THREE.Group(); g.position.set(x * U, y * U, z * U); g.name = name; parent.add(g); return g;
    }

    var group = new THREE.Group(); group.name = 'aluno';
    var mover = pivot(group, 0, 0, 0, 'aluno-movimento');      // pulo, achatamento, giro
    var body = pivot(mover, 0, 0, 0, 'aluno-corpo');           // afunda na água
    var legL = pivot(body, 2.5, 6, 0, 'perna-esq'); legL.add(meshOf('legL'));
    var legR = pivot(body, -2.5, 6, 0, 'perna-dir'); legR.add(meshOf('legR'));
    var torso = pivot(body, 0, 6, 0, 'tronco'); torso.add(meshOf('torso'));
    var head = pivot(torso, 0, 10, -0.5, 'cabeca'); head.add(meshOf('head'));
    var armL = pivot(torso, 6.8, 9.5, 0, 'braco-esq'); armL.add(meshOf('armL'));
    var armR = pivot(torso, -6.8, 9.5, 0, 'braco-dir'); armR.add(meshOf('armR'));
    var thumbMesh = meshOf('thumb'); thumbMesh.visible = false; armR.add(thumbMesh);   // [IA] Claude – joinha
    var charms = pivot(torso, 0, 0.5, -6.3, 'pingentes');      // base da mochila
    var above = pivot(mover, 0, 35, 0.5, 'acima-da-cabeca');   // chave erguida / balão

    // clarão "item get" atrás da chave erguida
    var flashMat = bag.add(new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffffff, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    var flash = new THREE.Sprite(flashMat); flash.scale.set(0.01, 0.01, 1); flash.visible = false; above.add(flash);

    // balão "?"
    var bubbleMat = bag.add(new THREE.SpriteMaterial({ map: questionTexture(), transparent: true, alphaTest: 0.5, depthWrite: false }));
    var bubble = new THREE.Sprite(bubbleMat); bubble.center.set(0.5, 0); bubble.visible = false; bubble.renderOrder = 5;
    bubble.position.set(0.12, 0.02, 0); above.add(bubble);

    // [IA] Claude – balão "…" (triste) e gota de suor ao lado da cabeça
    var dotsMat = bag.add(new THREE.SpriteMaterial({ map: dotsTexture(), transparent: true, alphaTest: 0.5, depthWrite: false }));
    var dots = new THREE.Sprite(dotsMat); dots.center.set(0.5, 0); dots.visible = false; dots.renderOrder = 5;
    dots.position.set(0.16, 0.02, 0); above.add(dots);
    var sweatMat = bag.add(new THREE.SpriteMaterial({ map: sweatTexture(), transparent: true, alphaTest: 0.5, depthWrite: false }));
    var sweat = new THREE.Sprite(sweatMat); sweat.visible = false; sweat.renderOrder = 5;
    sweat.scale.set(3 * U * 0.8, 5 * U * 0.8, 1);
    mover.add(sweat);

    var st = {
      yaw: 0, targetYaw: 0, walking: false, walkW: 0, speed: 1, phase: 0,
      wade: 0, wadeTarget: 0, t: 0, blinkIn: 1.8 + Math.random() * 2, blinkLeft: 0,
      action: null, lookT: 0, heldKeys: '', charmSwing: 0, charmVel: 0, lastYaw: 0,
      hold: null, holdT: 0, forcedExpr: null
    };
    var HEAD_TILT = -0.12;      // [IA] Claude – cabeça levemente erguida: o rosto aparece na câmera de 52°
    var HEAD_SCALE = 1.06;
    var pose = {};
    var student;

    function setExpr(name) {
      if (faceState.expr === name) return;
      faceState.expr = name;
      built.repaint(info.faceReq);
    }

    function clearPose() {
      pose.y = 0; pose.sx = 1; pose.sy = 1; pose.spin = 0; pose.lean = 0; pose.twist = 0; pose.breath = 0;
      pose.headX = 0; pose.headY = 0; pose.headZ = 0;
      pose.armLx = 0; pose.armLz = 0.06; pose.armRx = 0; pose.armRz = -0.06; pose.legL = 0; pose.legR = 0;
      pose.expr = null;
    }

    /* ----- ações (uma por vez; uma nova conclui a anterior) ----- */
    function runAction(name, duration, fn, setup, cleanup) {
      if (st.action) finishAction();
      clearHold();
      return new Promise(function (resolve) {
        st.action = { name: name, t: 0, d: duration, fn: fn, cleanup: cleanup, resolve: resolve };
        if (setup) setup();
      });
    }
    function finishAction() {
      var a = st.action;
      if (!a) return;
      st.action = null;
      if (a.cleanup) a.cleanup();
      a.resolve();
    }

    /* ----- quadro a quadro ----- */
    function update(dt) {
      dt = clamp(dt || 0, 0, 0.1) * (student.timeScale || 1);
      st.t += dt;

      // giro suave para a direção pedida (~120 ms)
      var diff = wrapAngle(st.targetYaw - st.yaw);
      st.yaw = Math.abs(diff) < 0.002 ? st.targetYaw : st.yaw + diff * (1 - Math.exp(-dt / 0.035));
      group.rotation.y = st.yaw;

      // pesos de caminhada e água
      st.walkW = approach(st.walkW, st.walking ? 1 : 0, dt / 0.12);
      st.wade = lerp(st.wade, st.wadeTarget, 1 - Math.exp(-dt / 0.08));
      var wadeK = st.wade / 0.35;
      // ciclos de passada por segundo: speed 1 ≈ ritmo padrão do jogo (4 passos/s no motor)
      var cadence = Math.min(5, 2.6 * Math.pow(Math.max(0.25, st.speed), 0.6)) * (1 - 0.4 * wadeK);
      if (st.walkW > 0) st.phase += dt * cadence * TAU;
      else st.phase = 0;

      clearPose();
      var w = st.walkW, s = Math.sin(st.phase), idle = 1 - w;
      var legA = 0.62 * (1 - 0.45 * wadeK), armA = 0.55;
      pose.legL = s * legA * w; pose.legR = -s * legA * w;
      pose.armLx = -s * armA * w; pose.armRx = s * armA * w;
      pose.armLz += 0.5 * wadeK; pose.armRz -= 0.5 * wadeK;           // braços abertos para equilibrar na água
      pose.y = (1 - Math.abs(s)) * 0.9 * U * w;                       // sobe quando as pernas se cruzam
      pose.lean = 0.07 * w + 0.06 * wadeK;
      pose.twist = s * 0.07 * w;
      pose.headX = HEAD_TILT - 0.04 * w;
      // respiração e olhar distraído quando parado
      pose.breath = Math.sin(st.t * 2.3) * 0.018 * idle;
      pose.armLz += Math.sin(st.t * 2.3) * 0.025 * idle; pose.armRz -= Math.sin(st.t * 2.3) * 0.025 * idle;
      var look = Math.sin(st.t * 0.45) * Math.sin(st.t * 0.21);
      pose.headY = look * 0.22 * idle;
      pose.headZ = Math.sin(st.t * 0.9) * 0.025 * idle;

      // ação em curso sobrescreve/soma
      if (st.action) {
        var a = st.action;
        a.t += dt;
        var p = Math.min(1, a.t / a.d);
        a.fn(p, dt);
        if (p >= 1) finishAction();
      }
      // [IA] Claude – pose mantida (joinha / mãos para cima) até a próxima ação
      if (st.hold && !st.action) { st.holdT += dt; st.hold.fn(1, dt, st.holdT); }

      // piscar
      st.blinkIn -= dt;
      if (st.blinkIn <= 0) { st.blinkLeft = 0.12; st.blinkIn = 2 + Math.random() * 3.5; }
      if (st.blinkLeft > 0) st.blinkLeft -= dt;
      setExpr(pose.expr || st.forcedExpr || (st.blinkLeft > 0 ? 'blink' : 'normal'));

      // aplica a pose
      mover.position.y = pose.y;
      mover.scale.set(pose.sx, pose.sy, pose.sx);
      mover.rotation.y = pose.spin;
      body.position.y = -st.wade;
      torso.rotation.set(pose.lean, pose.twist, 0);
      torso.scale.set(1, 1 + pose.breath, 1);
      head.rotation.set(pose.headX, pose.headY, pose.headZ);
      head.scale.set(HEAD_SCALE, HEAD_SCALE / (1 + pose.breath), HEAD_SCALE);
      armL.rotation.set(pose.armLx, 0, pose.armLz);
      armR.rotation.set(pose.armRx, 0, pose.armRz);
      legL.rotation.x = pose.legL;
      legR.rotation.x = pose.legR;

      // pingentes balançam (pêndulo amortecido empurrado pelo passo e pelos giros)
      var yawRate = wrapAngle(st.yaw - st.lastYaw) / Math.max(dt, 1e-4);
      st.lastYaw = st.yaw;
      var force = -st.charmSwing * 60 - st.charmVel * 5 + Math.cos(st.phase * 2) * 9 * w + yawRate * 1.5;
      st.charmVel += force * dt;
      st.charmSwing = clamp(st.charmSwing + st.charmVel * dt, -0.7, 0.7);
      for (var i = 0; i < charms.children.length; i++) {
        charms.children[i].rotation.x = st.charmSwing * (1 + i * 0.15);
        charms.children[i].rotation.z = st.charmSwing * 0.4 * (i % 2 ? 1 : -1);
      }
    }

    /* ----- API pública ----- */
    var DIRS = { S: 0, L: Math.PI / 2, N: Math.PI, O: -Math.PI / 2 };

    function face(dir, instant) {
      var yaw = typeof dir === 'number' ? dir : DIRS[String(dir || 'S').toUpperCase()];
      if (yaw == null) return;
      st.targetYaw = yaw;
      if (instant) { st.yaw = yaw; group.rotation.y = yaw; st.lastYaw = yaw; }
    }

    function setWalking(on, speed) {
      if (on) clearHold();
      st.walking = !!on;
      st.speed = speed > 0 ? speed : 1;
    }

    function setWading(depth) { st.wadeTarget = clamp(+depth || 0, 0, 0.35); }

    function hop() {
      return runAction('hop', 0.46, function (p) {
        if (p < 0.18) {                                     // antecipação: agacha
          var k = Math.sin(seg(p, 0, 0.18) * Math.PI / 2) * 0.2;
          pose.sy = 1 - k; pose.sx = 1 + k * 0.6;
          pose.armLz += k * 1.2; pose.armRz -= k * 1.2;
        } else if (p < 0.78) {                              // no ar: estica
          var q = seg(p, 0.18, 0.78);
          pose.y += 4 * q * (1 - q) * 0.4;
          var str = 0.13 * (1 - Math.abs(2 * q - 1));
          pose.sy = 1 + str; pose.sx = 1 - str * 0.5;
          pose.legL = pose.legR = -0.35 * bump(q);
          pose.armLz += 0.7 * bump(q); pose.armRz -= 0.7 * bump(q);
        } else {                                            // aterrissa: amassa e volta
          var r = bump(seg(p, 0.78, 1)) * 0.17;
          pose.sy = 1 - r; pose.sx = 1 + r * 0.6;
        }
      });
    }

    function celebrate() {
      return runAction('celebrate', 1.35, function (p) {
        pose.expr = 'happy';
        var armsUp = Math.min(seg(p, 0, 0.12), 1 - seg(p, 0.88, 1));
        var wave = Math.sin(p * 26) * 0.25 * seg(p, 0.55, 0.65);
        pose.armLx = lerp(pose.armLx, -2.75 + wave, ease.outCubic(armsUp));
        pose.armRx = lerp(pose.armRx, -2.75 - wave, ease.outCubic(armsUp));
        pose.armLz = lerp(pose.armLz, 0.35, armsUp); pose.armRz = lerp(pose.armRz, -0.35, armsUp);
        if (p < 0.1) {
          var k = bump(seg(p, 0, 0.1) / 2) * 0.18; pose.sy = 1 - k; pose.sx = 1 + k * 0.6;
        } else if (p < 0.52) {
          var q = seg(p, 0.1, 0.52);
          pose.y += 4 * q * (1 - q) * 0.6;
          pose.spin = ease.inOut(q) * TAU;
          pose.legL = -0.5 * bump(q); pose.legR = -0.2 * bump(q);
          var str = 0.12 * (1 - Math.abs(2 * q - 1)); pose.sy = 1 + str; pose.sx = 1 - str * 0.5;
        } else if (p < 0.62) {
          var r = bump(seg(p, 0.52, 0.62)) * 0.2; pose.sy = 1 - r; pose.sx = 1 + r * 0.6;
        } else {
          var b = seg(p, 0.62, 1);
          pose.y += Math.abs(Math.sin(b * Math.PI * 2)) * 0.07 * (1 - b);
          pose.headZ = Math.sin(b * Math.PI * 4) * 0.12;
        }
      });
    }

    var heldKey = null;
    function raiseKey(letter) {
      var key;
      return runAction('raiseKey', 0.78, function (p) {
        pose.expr = 'happy';
        // pose "item get": os dois braços para cima, abertos, segurando a chave acima da cabeça
        var up = Math.min(ease.outCubic(seg(p, 0, 0.16)), 1 - seg(p, 0.82, 1));
        pose.armRx = lerp(pose.armRx, -2.8, up); pose.armRz = lerp(pose.armRz, -0.5, up);
        pose.armLx = lerp(pose.armLx, -2.8, up); pose.armLz = lerp(pose.armLz, 0.5, up);
        pose.headX = lerp(pose.headX, -0.12, up);
        if (p < 0.12) { var k = bump(seg(p, 0, 0.12)) * 0.12; pose.sy = 1 - k; pose.sx = 1 + k * 0.5; }
        var sIn = ease.outBack(seg(p, 0.04, 0.24)), sOut = 1 - ease.inCubic(seg(p, 0.8, 1));
        var sc = Math.max(0.0001, Math.min(sIn, sOut));
        key.scale.setScalar(sc);
        key.position.y = 0.06 * Math.sin(seg(p, 0.1, 0.8) * Math.PI) - 0.25 * seg(p, 0.8, 1);
        key.rotation.y = p * TAU * 0.75;
        flash.visible = true;
        var f = Math.min(seg(p, 0.06, 0.2), 1 - seg(p, 0.55, 0.85));
        flashMat.opacity = 0.85 * f;
        var fs = 0.25 + 0.55 * ease.outCubic(seg(p, 0.06, 0.3));
        flash.scale.set(fs, fs, 1);
        flash.material.rotation = p * 1.6;
      }, function () {
        key = keyMesh(letter, U * 0.85);
        key.castShadow = false;
        key.scale.setScalar(0.0001);
        heldKey = key;
        above.add(key);
        flashMat.color.set(keyColor(letter));
      }, function () {
        detach(key);
        if (heldKey === key) heldKey = null;
        flash.visible = false; flashMat.opacity = 0;
      });
    }

    var _hand = new THREE.Vector3(), _dir = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0),
      _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
    function insertKey(letter, worldTarget) {
      var key, space, from = new THREE.Vector3(), to = new THREE.Vector3(), dir = new THREE.Vector3(), launched = false;
      var keyLen = KEY_ROWS[0].length * U * 0.8;
      function handWorld(out) { return armR.localToWorld(out.set(0, -7.5 * U, 0.6 * U)); }
      return runAction('insertKey', 0.78, function (p) {
        pose.expr = 'focus';
        var reach = Math.min(ease.outCubic(seg(p, 0, 0.22)), 1 - ease.inOut(seg(p, 0.78, 1)));
        pose.armRx = lerp(pose.armRx, -1.45, reach);
        pose.armRz = lerp(pose.armRz, 0.12, reach);
        pose.lean += 0.08 * reach;
        if (p < 0.24) {
          // a chave aparece na mão, apontando para a frente do aluno
          group.updateWorldMatrix(true, true);
          handWorld(from);
          space.worldToLocal(from);
          key.position.copy(from);
          _dir.set(Math.sin(st.yaw), 0, Math.cos(st.yaw));
          if (space !== group) space.getWorldQuaternion(_qb).invert(); else _qb.copy(group.quaternion).invert();
          _dir.applyQuaternion(_qb).normalize();
          key.quaternion.setFromUnitVectors(_X, _dir);
          key.scale.setScalar(Math.max(0.0001, ease.outBack(seg(p, 0, 0.18)) * 0.8));
        } else {
          if (!launched) {
            launched = true;
            from.copy(key.position);
            to.copy(worldTarget || from);
            space.worldToLocal(to);
            dir.subVectors(to, from);
            if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
            dir.normalize();
            to.addScaledVector(dir, -keyLen * 0.5 * 0.85);            // ponta da chave encosta no alvo
            _qa.setFromUnitVectors(_X, dir);
          }
          var f = ease.inOut(seg(p, 0.24, 0.56));
          key.position.lerpVectors(from, to, f);
          key.position.y += Math.sin(f * Math.PI) * 0.18;
          var turn = ease.outBack(seg(p, 0.6, 0.8)) * (Math.PI / 2);          // gira 90° dentro do cadeado
          _qb.setFromAxisAngle(dir, turn);
          key.quaternion.copy(_qa).premultiply(_qb);
          if (p > 0.56 && p < 0.62) key.position.addScaledVector(dir, 0.02 * bump(seg(p, 0.56, 0.62)));
          key.scale.setScalar(Math.max(0.0001, 0.8 * (1 - ease.inCubic(seg(p, 0.84, 1)))));
        }
      }, function () {
        space = group.parent || group;
        key = keyMesh(letter, U * 0.8);
        key.castShadow = false;
        key.scale.setScalar(0.0001);
        space.add(key);
      }, function () { detach(key); });
    }

    function shrug() {
      return runAction('shrug', 1.5, function (p) {
        pose.expr = 'confused';
        var k = Math.min(ease.outCubic(seg(p, 0, 0.16)), 1 - ease.inOut(seg(p, 0.82, 1)));
        var pulse = 1 + 0.35 * bump(seg(p, 0.4, 0.55));
        pose.armLz = lerp(pose.armLz, 0.95 * pulse, k); pose.armRz = lerp(pose.armRz, -0.95 * pulse, k);
        pose.armLx = lerp(pose.armLx, -0.55, k); pose.armRx = lerp(pose.armRx, -0.55, k);
        pose.headZ = lerp(pose.headZ, 0.2, k);
        pose.breath += 0.05 * k * pulse;
        bubble.visible = true;
        var bs = Math.min(ease.outBack(seg(p, 0.02, 0.18)), 1 - ease.inCubic(seg(p, 0.86, 1)));
        bubble.scale.set(0.42 * Math.max(0.0001, bs) * (11 / 13), 0.42 * Math.max(0.0001, bs), 1);
        bubble.position.y = 0.02 + Math.sin(p * 9) * 0.015;
      }, null, function () { bubble.visible = false; });
    }

    /* ----- [IA] Claude – finais (rodada 2): joinha feliz e mãos para cima triste; a pose fica mantida ----- */
    var _tw = new THREE.Vector3(), _tg = new THREE.Vector3();
    /** Converte "para onde olhar" em yaw: número (rad), 'N'|'L'|'S'|'O', Vector3 do mundo ou Object3D (câmera). */
    function yawToward(target) {
      if (target == null) return null;
      if (typeof target === 'number') return target;
      if (typeof target === 'string') return DIRS[target.toUpperCase()] != null ? DIRS[target.toUpperCase()] : null;
      if (target.isObject3D) target = target.getWorldPosition(_tw);
      if (!target.isVector3) return null;
      _tw.copy(target);
      group.updateWorldMatrix(true, false);
      group.getWorldPosition(_tg);
      if (group.parent) { group.parent.worldToLocal(_tw); group.parent.worldToLocal(_tg); }
      var dx = _tw.x - _tg.x, dz = _tw.z - _tg.z;
      if (dx * dx + dz * dz < 1e-6) return null;
      return Math.atan2(dx, dz);
    }
    function turnTo(target) {
      var y = yawToward(target);
      if (y != null) st.targetYaw = y;
    }

    function clearHold() {
      if (!st.hold) return;
      st.hold = null; st.holdT = 0;
      thumbMesh.visible = false;
      dots.visible = false; sweat.visible = false;
    }

    // Pose do joinha (k = 0..1 de entrada; t = tempo mantido, para um balanço sutil)
    function thumbPose(k, t) {
      pose.expr = 'happy';
      var bob = Math.sin(t * 2.4);
      pose.armRx = lerp(pose.armRx, -1.9 + 0.05 * bob, k);       // braço direito esticado à frente, um pouco acima
      pose.armRz = lerp(pose.armRz, -0.3, k);
      pose.armLx = lerp(pose.armLx, 0.12, k);                     // mão esquerda na cintura
      pose.armLz = lerp(pose.armLz, 0.55, k);
      pose.lean = lerp(pose.lean, -0.08, k);                      // peito estufado
      pose.headZ = lerp(pose.headZ, 0.14 + 0.03 * bob, k);
      pose.headY = lerp(pose.headY, 0, k);
      pose.twist = lerp(pose.twist, 0.18, k);                     // gira o ombro para mostrar o polegar
    }

    /**
     * thumbsUp(alvo?) → Promise: vira (opcional: yaw, 'N'|'L'|'S'|'O', Vector3 ou câmera), estica o braço com o
     * polegar para cima, rosto feliz, pulinho; resolve no fim da animação e MANTÉM a pose até a próxima ação
     * (ou setWalking(true) / resetPose()).
     */
    function thumbsUp(target) {
      turnTo(target);
      var hold = { name: 'thumbsUp', fn: function (p, dt, t) { thumbPose(1, t); } };
      return runAction('thumbsUp', 1.05, function (p) {
        var k = ease.outBack(seg(p, 0.08, 0.34));
        thumbPose(Math.min(1, k), 0);
        thumbMesh.visible = p > 0.12;
        // pulinho de alegria no meio
        if (p < 0.4) {
          var c = bump(seg(p, 0, 0.16)) * 0.14; pose.sy = 1 - c; pose.sx = 1 + c * 0.5;
        } else if (p < 0.78) {
          var q = seg(p, 0.4, 0.78);
          pose.y += 4 * q * (1 - q) * 0.22;
          pose.legL = pose.legR = -0.3 * bump(q);
          var str = 0.1 * (1 - Math.abs(2 * q - 1)); pose.sy = 1 + str; pose.sx = 1 - str * 0.5;
        } else {
          var r = bump(seg(p, 0.78, 1)) * 0.12; pose.sy = 1 - r; pose.sx = 1 + r * 0.6;
        }
      }, function () { thumbMesh.visible = false; }, function () {
        thumbMesh.visible = true;
        st.hold = hold; st.holdT = 0;
      });
    }

    // Pose das mãos para cima, desamparado (k = 0..1; t = tempo mantido)
    function handsPose(k, t) {
      pose.expr = 'sad';
      var sway = Math.sin(t * 1.7);
      // braços abertos para cima em "V" (mãos ao lado da cabeça, palmas para a frente)
      pose.armLx = lerp(pose.armLx, -0.35, k); pose.armLz = lerp(pose.armLz, 2.55 + 0.06 * sway, k);
      pose.armRx = lerp(pose.armRx, -0.35, k); pose.armRz = lerp(pose.armRz, -2.55 + 0.06 * sway, k);
      pose.headZ = lerp(pose.headZ, -0.16 + 0.03 * sway, k);
      pose.headX = lerp(pose.headX, HEAD_TILT + 0.04, k);         // cabisbaixo, mas o rosto continua visível
      pose.headY = lerp(pose.headY, 0, k);
      pose.lean = lerp(pose.lean, 0.05, k);
      pose.breath -= 0.02 * k;                                    // ombros caídos
      pose.y -= 0.25 * U * k;
      // balão "…" e gota de suor escorrendo
      dots.visible = k > 0.3;
      var ds = 0.4 * Math.min(1, k * 1.4);
      dots.scale.set(ds, ds * (11 / 13), 1);
      dots.position.y = 0.02 + Math.sin(t * 2.2) * 0.012;
      sweat.visible = k > 0.5;
      var sp = (t * 0.55) % 1;
      sweat.position.set(-6.6 * U, (16 + 11.5 - 4 * sp) * U, 3.2 * U);
      sweatMat.opacity = sp < 0.8 ? 1 : 1 - (sp - 0.8) / 0.2;
    }

    /**
     * handsUp(alvo?) → Promise: os dois braços para cima, sem saber o que fazer, rosto triste (sobrancelhas
     * caídas, boca para baixo, lágrima), balão "…" e gota de suor. Mantém a pose até a próxima ação.
     */
    function handsUp(target) {
      turnTo(target);
      var hold = { name: 'handsUp', fn: function (p, dt, t) { handsPose(1, t + 0.9); } };
      return runAction('handsUp', 0.9, function (p) {
        var k = ease.outCubic(seg(p, 0, 0.3));
        // sobe rápido, treme de leve e "desaba" um pouco
        var shake = Math.sin(p * 60) * 0.06 * bump(seg(p, 0.25, 0.6));
        handsPose(k, p);
        pose.armLz += shake; pose.armRz -= shake;
        if (p > 0.6) { var d = bump(seg(p, 0.6, 1)) * 0.08; pose.sy = 1 - d; pose.sx = 1 + d * 0.4; }
      }, null, function () { st.hold = hold; st.holdT = 0; });
    }

    /** Volta à pose neutra: cancela ação/pose mantida, esconde balões e libera a expressão. */
    function resetPosePublic() {
      if (st.action) finishAction();
      clearHold();
      bubble.visible = false;
      st.forcedExpr = null;
    }

    /** setExpression('neutral'|'happy'|'sad'|'blink'|'confused'|'focus'): força a expressão (neutral = automático). */
    function setExpression(name) {
      var n = EXPRESSION_ALIAS[name] || name;
      st.forcedExpr = EXPRESSIONS[n] && n !== 'normal' ? n : null;
    }

    var charmBag = new Bag();
    function setHeldKeys(letters) {
      var list = Array.isArray(letters) ? letters.join('') : String(letters || '');
      list = list.replace(/[^a-dA-D]/g, '').toLowerCase();
      if (list === st.heldKeys) return;
      st.heldKeys = list;
      while (charms.children.length) charms.remove(charms.children[0]);
      charmBag.dispose();
      for (var i = 0; i < list.length; i++) {
        var holder = new THREE.Group();
        holder.position.set((3 - i * 2.1) * U, 0, -0.4 * U);
        var m = keyMesh(list[i], U * 0.62, CHARM_ROWS);
        m.position.y = -CHARM_ROWS.length * U * 0.62 / 2;
        m.castShadow = false;
        holder.add(m);
        charms.add(holder);
      }
    }

    function dispose() {
      if (st.action) finishAction();
      charmBag.dispose();
      detach(group);
      bag.dispose();
    }

    clearPose();
    student = {
      group: group,
      update: update,
      face: face,
      setWalking: setWalking,
      setWading: setWading,
      hop: hop,
      celebrate: celebrate,
      raiseKey: raiseKey,
      insertKey: insertKey,
      shrug: shrug,
      setHeldKeys: setHeldKeys,
      setExpression: setExpression,
      thumbsUp: thumbsUp,
      handsUp: handsUp,
      resetPose: resetPosePublic,
      get pose() { return st.hold ? st.hold.name : (st.action ? st.action.name : (st.walking ? 'walk' : 'idle')); },
      timeScale: 1,
      dispose: dispose,
      parts: { mover: mover, body: body, torso: torso, head: head, armL: armL, armR: armR, legL: legL, legR: legR }
    };
    update(0);
    return student;
  }

  /* ======================================================================================
     11. Chave flutuante
     ====================================================================================== */

  function createKey(letter) {
    var col = keyColor(letter);
    var bag = new Bag();
    var anim = new Anim();
    var group = new THREE.Group(); group.name = 'chave-' + letter;
    var holder = new THREE.Group(); group.add(holder);
    var mesh = keyMesh(letter, KEY_UNIT, null, 3);
    mesh.rotation.y = KEY_FACING;
    holder.add(mesh);

    var glowMat = bag.add(new THREE.SpriteMaterial({ map: glowTexture(), color: col, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
    var glow = new THREE.Sprite(glowMat); glow.scale.set(0.95, 0.95, 1); holder.add(glow);

    var haloGeo = bag.add(new THREE.PlaneGeometry(0.78, 0.78));
    var haloMat = bag.add(new THREE.MeshBasicMaterial({ map: haloTexture(), color: col, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, toneMapped: false }));
    var halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.015; halo.renderOrder = 1;
    group.add(halo);

    var sparks = bag.add(new Particles(group, { max: 64 }));
    var st = { t: Math.random() * 10, collected: false, spinBoost: 0 };
    var BASE_Y = 0.5;

    function update(dt) {
      dt = clamp(dt || 0, 0, 0.1);
      st.t += dt;
      anim.update(dt);
      if (!st.collected && !anim.busy()) {
        holder.position.y = BASE_Y + Math.sin(st.t * 2.2) * 0.05;
        // balança de um lado para o outro (quase sempre de frente, nunca "de faca" para a câmera padrão)
        mesh.rotation.y = KEY_FACING + Math.sin(st.t * 1.05) * 0.8;
        mesh.rotation.z = Math.sin(st.t * 1.6) * 0.1;
        glowMat.opacity = 0.42 + Math.sin(st.t * 4.4) * 0.08;
        var hs = 1 + Math.sin(st.t * 2.2) * 0.06;
        halo.scale.set(hs, hs, 1);
      }
      sparks.update(dt);
    }

    function collect() {
      if (st.collected) return Promise.resolve();
      var burst = false, y0 = holder.position.y;
      return anim.play(0.42, function (p, dt) {
        mesh.rotation.y += (dt || 0) * (6 + 30 * p);
        holder.position.y = y0 + 0.3 * ease.outCubic(p);
        var s = p < 0.35 ? 1 + 0.3 * ease.outCubic(p / 0.35) : 1.3 * (1 - ease.inCubic(seg(p, 0.35, 1)));
        mesh.scale.setScalar(Math.max(0.0001, s));
        glowMat.opacity = 0.9 * (1 - p);
        haloMat.opacity = 0.55 * (1 - p);
        if (!burst && p >= 0.35) {
          burst = true;
          sparks.burst([0, holder.position.y, 0], [col, lighten(col, 0.5), '#FFFFFF'], 22,
            { speed: 1.5, up: 0.8, gravity: 3, life: 0.6, size: 0.045, drag: 2 });
        }
        if (p >= 1) { st.collected = true; holder.visible = false; halo.visible = false; }
      }, 'collect');
    }

    function reset() {
      anim.finish();
      sparks.clear();
      st.collected = false;
      holder.visible = true; halo.visible = true;
      mesh.scale.setScalar(1);
      mesh.rotation.set(0, KEY_FACING, 0);
      holder.position.y = BASE_Y;
      glowMat.opacity = 0.5; haloMat.opacity = 0.55;
    }

    return {
      group: group, update: update, collect: collect, reset: reset,
      get collected() { return st.collected; },
      dispose: function () { anim.finish(); detach(group); bag.dispose(); }
    };
  }

  /* ======================================================================================
     12. [IA] Claude – Porta da dungeon (rodada 2): duas folhas de madeira com cintas de ferro, cadeado na cor
         da chave. Abrir = cadeado treme, a alça salta, o cadeado cai e as folhas giram nas dobradiças,
         empurradas para longe de quem chega (encostam nas paredes do corredor).
     ====================================================================================== */

  var LOCK_BODY = [
    '.hhhhhhh.',
    'hOOOOOOOd',
    'hOOOkOOOd',
    'hOOkkkOOd',
    'hOOOkOOOd',
    'hOOOkOOOd',
    'hOOOOOOOd',
    '.ddddddd.'
  ];
  var LOCK_SHACKLE = [
    '.sssss.',
    's.....s',
    's.....s',
    's.....s',
    's.....s'
  ];

  // Madeira e ferro da porta/baú (mesmos tons de LAB.pixel).
  var WOODC = { dark: '#2E1F14', lo: '#4A3220', base: '#62432A', mid: '#6F4D30', hi: '#8A6440', grain: '#553923' };
  var IRONC = { dark: '#1C1A19', lo: '#33302E', base: '#4A4643', hi: '#79736B', rivet: '#A8A096' };
  var GOLDC = { dark: '#7A4E14', lo: '#B5791F', base: '#E9AE3C', hi: '#FFE08A', white: '#FFF8DC' };

  /** Textura própria da porta (16×20) quando LAB.pixel.doorTexture não existe. */
  function paintDoorCanvas(letter) {
    var col = keyColor(letter);
    var c = makeCanvas(16, 20), x = c.getContext('2d');
    var planks = [WOODC.base, WOODC.mid, WOODC.lo, WOODC.mid];
    for (var p = 0; p < 4; p++) {
      x.fillStyle = planks[p]; x.fillRect(p * 4, 0, 4, 20);
      x.fillStyle = WOODC.dark; x.fillRect(p * 4 + 3, 0, 1, 20);
    }
    x.fillStyle = IRONC.base; x.fillRect(0, 3, 16, 2); x.fillRect(0, 15, 16, 2); x.fillRect(3, 11, 10, 2);
    x.fillStyle = col; x.fillRect(5, 6, 6, 3);
    return c;
  }

  /** Ajusta o u das faces frente/trás (+z/−z) de uma BoxGeometry para mostrar só a metade [u0, u0+0,5]. */
  function halfDoorUV(geo, uFront, uBack) {
    var uv = geo.attributes.uv;
    for (var f = 4; f <= 5; f++) {
      var u0 = f === 4 ? uFront : uBack;
      for (var k = 0; k < 4; k++) { var i = f * 4 + k; uv.setX(i, u0 + uv.getX(i) * 0.5); }
    }
    uv.needsUpdate = true;
  }

  /**
   * createDoor(letra, orientação) — orientação = eixo por onde o corredor passa ('z' padrão: a folha fica
   * no plano x; 'x': girada 90°). Extras: lockWorldPosition(deOnde?) devolve o cadeado do lado de `deOnde`
   * (THREE.Vector3 do aluno) e lembra esse lado para as folhas abrirem para longe dele; open(deOnde?) também
   * aceita o lado; reset() = setOpen(false).
   */
  function createDoor(letter, orientation) {
    var col = keyColor(letter);
    var bag = new Bag(), anim = new Anim();
    var group = new THREE.Group(); group.name = 'porta-' + letter;
    var inner = new THREE.Group(); inner.rotation.y = orientation === 'x' ? Math.PI / 2 : 0; group.add(inner);

    var H = 1.25, W = 1, T = 0.18, OPEN = Math.PI / 2 * 0.94;
    var lib = pixelLib();
    var canvas = null;
    try { if (lib && typeof lib.doorTexture === 'function') canvas = lib.doorTexture(String(letter).toUpperCase(), { lock: false }); } catch (e) { canvas = null; }
    if (!canvas || !canvas.width) canvas = paintDoorCanvas(letter);
    var faceTex = bag.add(pixelTexture(canvas));
    var faceMat = bag.add(new THREE.MeshLambertMaterial({ map: faceTex, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.08 }));
    var sideMat = bag.add(new THREE.MeshLambertMaterial({ color: WOODC.lo, emissive: new THREE.Color(WOODC.dark), emissiveIntensity: 0.4 }));
    var topMat = bag.add(new THREE.MeshLambertMaterial({ color: WOODC.mid, emissive: new THREE.Color(WOODC.dark), emissiveIntensity: 0.4 }));
    var bandMat = bag.add(new THREE.MeshLambertMaterial({ color: IRONC.base, emissive: new THREE.Color(IRONC.dark), emissiveIntensity: 0.5 }));

    // duas folhas, cada uma com pivô na dobradiça (x = ±0,5)
    var leaves = [-1, 1].map(function (sx) {
      var pivotG = new THREE.Group(); pivotG.position.set(sx * W / 2, 0, 0); inner.add(pivotG);
      var geo = bag.add(new THREE.BoxGeometry(W / 2, H, T));
      // folha esquerda (x<0): frente mostra u 0..0,5; de trás ela fica à direita de quem olha → u 0,5..1
      if (sx < 0) halfDoorUV(geo, 0, 0.5); else halfDoorUV(geo, 0.5, 0);
      var leaf = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, faceMat, faceMat]);
      leaf.position.set(-sx * W / 4, H / 2, 0); leaf.castShadow = true; leaf.receiveShadow = true; leaf.name = 'folha';
      pivotG.add(leaf);
      // dobradiças de ferro salientes (leem bem de cima)
      var hingeGeo = bag.add(new THREE.BoxGeometry(0.16, 0.08, T + 0.04));
      [0.25, 1.0].forEach(function (y) {
        var hg = new THREE.Mesh(hingeGeo, bandMat); hg.position.set(-sx * 0.07, y, 0); hg.castShadow = true; pivotG.add(hg);
      });
      return { pivot: pivotG, sx: sx };
    });

    // cadeados (um de cada lado), corpo na cor da chave, alça de ferro
    var bodyColors = { O: col, h: lighten(col, 0.45), d: darken(col, 0.35), k: '#15110E' };
    var LU = U * 0.85;   // voxel do cadeado
    var bodyGeo = bag.add(extrude(LOCK_BODY, bodyColors, { unit: LU, depth: 3, depthMap: { k: 1 } }));
    var shackleGeo = bag.add(extrude(LOCK_SHACKLE, { s: IRONC.hi }, { unit: LU, depth: 1 }));
    var lockMat = bag.add(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(col), emissiveIntensity: 0.3 }));
    var steelMat = bag.add(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a2622, emissiveIntensity: 1 }));
    var LOCK_Y = 0.6;
    var locks = [1, -1].map(function (side) {
      var lock = new THREE.Group();
      lock.position.set(0, LOCK_Y, side * (T / 2 + 1.5 * U));
      lock.rotation.y = side > 0 ? 0 : Math.PI;
      var bodyM = new THREE.Mesh(bodyGeo, lockMat); bodyM.castShadow = true; lock.add(bodyM);
      var shPivot = new THREE.Group();
      shPivot.position.set(-3 * LU, 4 * LU, 0); lock.add(shPivot);
      var sh = new THREE.Mesh(shackleGeo, steelMat); sh.position.set(3 * LU, 2 * LU, 0); sh.castShadow = true; shPivot.add(sh);
      inner.add(lock);
      return { group: lock, shackle: shPivot, side: side };
    });
    // brilho suave do cadeado (ajuda a achar a porta de longe)
    var lockGlowMat = bag.add(new THREE.SpriteMaterial({ map: glowTexture(), color: col, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
    var lockGlows = locks.map(function (l) {
      var g = new THREE.Sprite(lockGlowMat); g.scale.set(0.42, 0.42, 1); g.position.set(0, 0, 0.05); l.group.add(g); return g;
    });

    var dust = bag.add(new Particles(inner, { max: 90 }));
    var api = { group: group, isOpen: false };
    var pushSide = 1;   // +1: folhas abrem para −z (aluno veio do lado +z)

    function setLeaves(a) {
      leaves.forEach(function (l) { l.pivot.rotation.y = l.sx < 0 ? pushSide * a : -pushSide * a; });
    }
    function applyClosed() {
      setLeaves(0);
      locks.forEach(function (l) {
        l.group.visible = true;
        l.group.position.set(0, LOCK_Y, l.side * (T / 2 + 1.5 * U));
        l.group.rotation.set(0, l.side > 0 ? 0 : Math.PI, 0);
        l.group.scale.setScalar(1);
        l.shackle.position.y = 4 * LU; l.shackle.rotation.y = 0;
      });
    }
    function applyOpen() {
      setLeaves(OPEN);
      locks.forEach(function (l) { l.group.visible = false; });
    }

    var _lp = new THREE.Vector3(), _gp = new THREE.Vector3(), _nrm = new THREE.Vector3();
    function sideOf(from) {
      inner.getWorldPosition(_gp);
      _nrm.set(0, 0, 1).transformDirection(inner.matrixWorld);
      return _nrm.dot(_lp.subVectors(from, _gp)) < 0 ? -1 : 1;
    }
    api.lockWorldPosition = function (from) {
      var pick = locks[0];
      group.updateWorldMatrix(true, true);
      if (from && from.isVector3) {
        pushSide = sideOf(from);
        if (pushSide < 0) pick = locks[1];
      }
      return pick.group.localToWorld(new THREE.Vector3(0, 0, 1.6 * U));
    };

    api.open = function (from) {
      if (api.isOpen) return Promise.resolve();
      anim.finish();
      if (from && from.isVector3) { group.updateWorldMatrix(true, true); pushSide = sideOf(from); }
      applyClosed();
      var dust1 = false, dust2 = false;
      return anim.play(0.78, function (p) {
        var shake = p < 0.24 ? Math.sin(p * 90) * 0.2 * (1 - seg(p, 0.1, 0.24)) : 0;
        locks.forEach(function (l) {
          l.group.rotation.z = shake;
          var pop = ease.outBack(seg(p, 0.2, 0.36));
          l.shackle.position.y = (4 + 2.4 * pop) * LU;
          l.shackle.rotation.y = -1.3 * pop;
          var fall = seg(p, 0.34, 0.62);
          l.group.position.y = LOCK_Y - 0.55 * fall * fall;
          l.group.position.z = l.side * (T / 2 + 1.5 * U + 0.12 * fall);
          l.group.rotation.x = l.side * fall * 1.4;
          l.group.scale.setScalar(Math.max(0.0001, 1 - ease.inCubic(seg(p, 0.48, 0.64))));
          l.group.visible = p < 0.64;
        });
        // folhas: destrava (tranco pequeno) e giram até encostar, com um quique
        var swing = seg(p, 0.4, 1);
        var a = swing < 0.82 ? OPEN * 1.04 * ease.inOut(swing / 0.82) : OPEN * (1.04 - 0.04 * ease.outCubic((swing - 0.82) / 0.18));
        if (p > 0.36 && p < 0.42) a = -0.03;
        setLeaves(a);
        if (!dust1 && p >= 0.42) {
          dust1 = true;
          dust.burst([0, 0.04, 0], ['#8C7F6C', '#5A4E42', lighten(col, 0.2)], 26,
            { box: [0.45, 0.02, T / 2 + 0.06], speed: 0.8, up: 0.8, gravity: 3.2, drag: 3, life: 0.7, size: 0.05, spread: 0.6, floor: 0.01 });
        }
        if (!dust2 && p >= 0.86) {
          dust2 = true;
          [-1, 1].forEach(function (sx) {
            dust.burst([sx * 0.46, 0.04, -pushSide * 0.45], ['#8C7F6C', '#5A4E42'], 8,
              { box: [0.04, 0.02, 0.3], speed: 0.5, up: 0.5, gravity: 2.5, drag: 3, life: 0.5, size: 0.04, spread: 0.5, floor: 0.01 });
          });
        }
        if (p >= 1) { applyOpen(); api.isOpen = true; }
      }, 'open');
    };

    api.setOpen = function (open) {
      anim.finish();
      dust.clear();
      if (open) { applyOpen(); api.isOpen = true; } else { applyClosed(); api.isOpen = false; }
    };
    api.reset = function () { api.setOpen(false); };

    var t0 = Math.random() * 10;
    api.update = function (dt) {
      dt = clamp(dt || 0, 0, 0.1);
      t0 += dt;
      anim.update(dt);
      dust.update(dt);
      if (!api.isOpen && !anim.busy()) {
        lockMat.emissiveIntensity = 0.28 + 0.14 * Math.sin(t0 * 3);
        lockGlowMat.opacity = 0.28 + 0.1 * Math.sin(t0 * 3);
      }
    };
    api.dispose = function () { anim.finish(); detach(group); bag.dispose(); };

    applyClosed();
    return api;
  }

  /* ======================================================================================
     13. [IA] Claude – Bônus '+' = monte de moedas de ouro (com um rubi); fonte '*' = fontezinha de pedra
         com água dourada mágica.
     ====================================================================================== */

  function createBonus(kind) {
    return kind === '*' ? createFountain() : createCoins();
  }

  /** Brilho em estrela que pisca (glint) — sprite aditivo compartilhado. */
  function makeGlint(bag, color, size) {
    var m = bag.add(new THREE.SpriteMaterial({ map: flashTexture(), color: color || '#FFF4C8', transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false }));
    var s = new THREE.Sprite(m); s.scale.set(size || 0.16, size || 0.16, 1); s.renderOrder = 4;
    return s;
  }

  function coinSkin() {
    var G = GOLDC;
    return {
      py: function (p, w, h) {
        p.fill(G.base);
        p.rect(0, 0, w, 1, G.hi); p.rect(0, 0, 1, h, G.hi);
        p.rect(w - 1, 1, 1, h - 1, G.lo); p.rect(1, h - 1, w - 1, 1, G.lo);
        p.px(Math.floor(w / 2), Math.floor(h / 2), G.hi);
        p.glow(0, 0, w, h, darken(G.base, 0.75));
      },
      all: function (p, w, h) { p.fill(G.lo); p.rect(0, 0, w, 1, G.base); p.glow(0, 0, w, 1, darken(G.base, 0.8)); },
      ny: G.dark
    };
  }

  function createCoins() {
    var G = GOLDC;
    var bag = new Bag(), anim = new Anim();
    var group = new THREE.Group(); group.name = 'bonus';
    var holder = new THREE.Group(); group.add(holder);

    var model = new VoxelModel();
    model.part('pile', [0, 0, 0]);
    var cs = coinSkin();
    // base do monte: moedas espalhadas (camada de baixo)
    var coins = [
      // [x, z, h(empilhadas)]
      [-6, -3, 1], [1, -6, 1], [5, -2, 1], [-2, 4, 1], [-7, 2, 1], [3, 5, 1], [6, 3, 1], [-4, 5, 1],
      [-3, -2, 4], [1, -2, 6], [4, 1, 3], [-1, 2, 3], [-5, 0, 2], [2, -5, 2], [-2, -5, 2]
    ];
    coins.forEach(function (c) {
      for (var k = 0; k < c[2]; k++) {
        var j = (k % 2) ? 0.3 : -0.2;
        model.box('pile', c[0] - 2 + j, k, c[1] - 2 - j * 0.5, 4, 1, 4, cs);
      }
    });
    // rubi no topo
    model.box('pile', -1.5, 6, -2.5, 2.5, 2.5, 2.5, {
      all: function (p, w, h) { p.fill('#B3243A'); p.px(0, 0, '#FF6A7E'); p.glow(0, 0, w, h, '#4A0812'); },
      py: function (p) { p.fill('#E0445C'); p.px(0, 0, '#FFC2CC'); p.glow(0, 0, 2, 2, '#601020'); }
    });
    var built = model.build();
    bag.add(built.colorTexture); bag.add(built.emissiveTexture); bag.add(built.geometries.pile);
    var mat = bag.add(new THREE.MeshLambertMaterial({ map: built.colorTexture, emissive: 0xffffff,
      emissiveMap: built.emissiveTexture, emissiveIntensity: 1 }));
    var pile = new THREE.Mesh(built.geometries.pile, mat); pile.castShadow = true; pile.receiveShadow = true;
    pile.rotation.y = 0.35;
    // [IA] Claude – bônus esgotado: o monte fica no lugar, cinza e transparente (repassar custa 1, não −4)
    var ghostMat = bag.add(new THREE.MeshLambertMaterial({ map: built.colorTexture, color: 0x8A8A8A,
      transparent: true, opacity: 0.3, depthWrite: false }));
    function esgotado(v) { pile.material = v ? ghostMat : mat; pile.castShadow = !v; }
    holder.add(pile);

    var haloGeo = bag.add(new THREE.PlaneGeometry(0.8, 0.8));
    var haloMat = bag.add(new THREE.MeshBasicMaterial({ map: glowTexture(), color: G.base, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32, toneMapped: false }));
    var halo = new THREE.Mesh(haloGeo, haloMat); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.012; group.add(halo);

    var glints = [makeGlint(bag), makeGlint(bag)];
    glints.forEach(function (g) { holder.add(g); });
    var glintSpots = [[-0.15, 0.12, 0.02], [0.08, 0.22, -0.05], [0.18, 0.08, 0.15], [-0.2, 0.06, -0.12], [0.02, 0.3, 0.0]];

    // marca depois de consumido: duas moedinhas esquecidas
    var leftModel = new VoxelModel();
    leftModel.part('left', [0, 0, 0]);
    leftModel.box('left', -4, 0, 1, 3, 0.6, 3, cs);
    leftModel.box('left', 2, 0, -3, 3, 0.6, 3, cs);
    var lb = leftModel.build();
    bag.add(lb.colorTexture); bag.add(lb.emissiveTexture); bag.add(lb.geometries.left);
    var leftMat = bag.add(new THREE.MeshLambertMaterial({ map: lb.colorTexture, emissive: 0xffffff, emissiveMap: lb.emissiveTexture, emissiveIntensity: 0.5 }));
    var leftover = new THREE.Mesh(lb.geometries.left, leftMat); leftover.visible = false; leftover.receiveShadow = true;
    group.add(leftover);

    var sparks = bag.add(new Particles(group, { max: 80 }));
    var st = { t: Math.random() * 10, consumed: false };

    function update(dt) {
      dt = clamp(dt || 0, 0, 0.1);
      st.t += dt;
      anim.update(dt);
      if (!st.consumed && !anim.busy()) {
        mat.emissiveIntensity = 0.9 + Math.sin(st.t * 3.2) * 0.2;
        haloMat.opacity = 0.26 + Math.sin(st.t * 3.2) * 0.06;
        glints.forEach(function (g, i) {
          var k = (st.t * 0.7 + i * 0.5) % 1.6;                 // pisca ~0,25 s a cada 1,6 s
          var spot = glintSpots[Math.floor(st.t * 0.7 / 1.6 + i * 3) % glintSpots.length];
          if (k < 0.25) { g.position.set(spot[0], spot[1], spot[2]); g.material.opacity = bump(k / 0.25); g.material.rotation = k * 3; }
          else g.material.opacity = 0;
        });
      }
      sparks.update(dt);
    }

    function setConsumed(v) {
      anim.finish();
      st.consumed = !!v;
      holder.visible = true; halo.visible = !v; leftover.visible = false;
      holder.scale.setScalar(1); holder.position.y = 0; esgotado(!!v);
      glints.forEach(function (g) { g.material.opacity = 0; });
      if (!v) haloMat.opacity = 0.32;
    }

    function collect() {
      if (st.consumed) return Promise.resolve();
      var burst = false;
      return anim.play(0.45, function (p, dt) {
        holder.rotation.y += (dt || 0) * (4 + 20 * p);
        holder.position.y = 0.22 * ease.outCubic(p);
        var s = p < 0.3 ? 1 + 0.25 * ease.outCubic(p / 0.3) : 1.25 * (1 - ease.inCubic(seg(p, 0.3, 1)));
        holder.scale.setScalar(Math.max(0.0001, s));
        haloMat.opacity = 0.32 * (1 - p);
        if (!burst && p >= 0.25) {
          burst = true;
          sparks.burst([0, 0.2, 0], [G.base, G.hi, G.white, G.lo], 30,
            { speed: 1.6, up: 1.4, gravity: 4.5, life: 0.75, size: 0.05, drag: 1.6, floor: 0.02 });
        }
        if (p >= 1) { st.consumed = true; halo.visible = false; holder.scale.setScalar(1); holder.position.y = 0; esgotado(true); glints.forEach(function (g) { g.material.opacity = 0; }); }
      }, 'collect');
    }

    return {
      group: group, update: update, collect: collect, setConsumed: setConsumed,
      reset: function () { sparks.clear(); setConsumed(false); holder.rotation.y = 0; },
      get consumed() { return st.consumed; },
      dispose: function () { anim.finish(); detach(group); bag.dispose(); }
    };
  }

  function createFountain() {
    var G = { lo: '#6A44C2', base: '#9A74F0', hi: '#C9B6FF', white: '#F3EEFF' };   // água mágica violeta (o ouro fica só no bônus)
    var stone = '#6E6458', stoneHi = '#918574', stoneLo = '#4E463E', stoneDk = '#35302A';
    var water = '#9A74F0', waterDeep = '#6A44C2';
    var bag = new Bag(), anim = new Anim();
    var group = new THREE.Group(); group.name = 'fonte';

    var model = new VoxelModel();
    model.part('fonte', [0, 0, 0]);
    function rim(p, w, h) { p.fill(stone); p.rect(0, 0, w, 1, stoneHi); p.rect(0, h - 1, w, 1, stoneLo); p.speckle(stoneLo, 0.12, 9); }
    function rimTop(p, w, h) { p.fill(stoneHi); p.speckle(stone, 0.3, 5); }
    var rimSkin = { all: rim, py: rimTop, ny: stoneDk };
    // bacia octogonal (bordas em degraus)
    model.box('fonte', -6, 0, 5, 12, 3, 2, rimSkin);
    model.box('fonte', -6, 0, -7, 12, 3, 2, rimSkin);
    model.box('fonte', -7, 0, -5, 2, 3, 10, rimSkin);
    model.box('fonte', 5, 0, -5, 2, 3, 10, rimSkin);
    model.box('fonte', -5, 0, -5, 10, 1, 10, { all: stoneLo, py: stoneDk });
    // coluna com cálice e bica
    function column(p, w, h) {
      p.fill(stone); p.rect(0, 0, 1, h, stoneHi); p.rect(w - 1, 0, 1, h, stoneLo);
      p.rect(0, 2, w, 1, stoneLo); p.rect(0, h - 2, w, 1, stoneLo);
    }
    model.box('fonte', -1.5, 0, -1.5, 3, 7, 3, { all: column, py: stoneHi, ny: stoneDk });
    model.box('fonte', -3, 7, -3, 6, 1.5, 6, { all: function (p, w) { p.fill(stoneLo); p.rect(0, 0, w, 1, stoneHi); }, py: function (p, w, h) {
      p.fill(water); p.rect(0, 0, w, 1, stoneHi); p.rect(0, 0, 1, h, stoneHi); p.rect(w - 1, 0, 1, h, stoneLo); p.rect(0, h - 1, w, 1, stoneLo);
      p.glow(1, 1, w - 2, h - 2, darken(water, 0.25));
    }, ny: stoneDk });
    model.box('fonte', -1, 8.5, -1, 2, 1.5, 2, {
      all: function (p, w, h) { p.fill(G.hi); p.glow(0, 0, w, h, darken(G.hi, 0.4)); },
      py: function (p) { p.fill(G.white); p.glow(0, 0, 2, 2, darken(G.white, 0.3)); }
    });
    var built = model.build();
    bag.add(built.colorTexture); bag.add(built.emissiveTexture); bag.add(built.geometries.fonte);
    var mat = bag.add(new THREE.MeshLambertMaterial({ map: built.colorTexture, emissive: 0xffffff,
      emissiveMap: built.emissiveTexture, emissiveIntensity: 1 }));
    var basin = new THREE.Mesh(built.geometries.fonte, mat); basin.castShadow = true; basin.receiveShadow = true;
    group.add(basin);

    // espelho d'água violeta no tanque
    var surfGeo = bag.add(new THREE.PlaneGeometry(10 * U, 10 * U));
    var surfMat = bag.add(new THREE.MeshBasicMaterial({ color: waterDeep, toneMapped: false }));
    var surf = new THREE.Mesh(surfGeo, surfMat); surf.rotation.x = -Math.PI / 2; surf.position.y = 2.2 * U; group.add(surf);
    var glowMat = bag.add(new THREE.SpriteMaterial({ map: glowTexture(), color: water, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
    var glow = new THREE.Sprite(glowMat); glow.scale.set(0.9, 0.9, 1); glow.position.y = 0.3; group.add(glow);

    // gotas em arco (loop determinístico)
    var N = 16;
    var dropGeo = bag.add(new THREE.BoxGeometry(1, 1, 1));
    var dropMat = bag.add(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    var drops = new THREE.InstancedMesh(dropGeo, dropMat, N);
    drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage); drops.frustumCulled = false;
    for (var i = 0; i < N; i++) drops.setColorAt(i, _c3.set(i % 3 === 0 ? G.white : (i % 3 === 1 ? water : G.hi)));
    group.add(drops);

    var sparks = bag.add(new Particles(group, { max: 80 }));
    var st = { t: 0, consumed: false, flow: 1 };
    var ripples = 0;

    function update(dt) {
      dt = clamp(dt || 0, 0, 0.1);
      st.t += dt;
      anim.update(dt);
      st.flow = approach(st.flow, st.consumed ? 0 : 1, dt * 2);
      var y0 = 10 * U, v = 0.85, g = 1.3;
      for (var i = 0; i < N; i++) {
        var a = (i / N) * TAU + 0.4;
        var tau = (st.t * 0.95 + (i * 0.618) % 1) % 1;
        var r = 0.22 * Math.sqrt(tau), y = y0 + v * tau - g * tau * tau;
        var s = (0.9 + (i % 3) * 0.25) * U * st.flow;
        _m4.compose(_v.set(Math.cos(a) * r, Math.max(2.2 * U, y), Math.sin(a) * r), _q.identity(), _s.set(s, s, s));
        drops.setMatrixAt(i, _m4);
      }
      drops.instanceMatrix.needsUpdate = true;
      drops.visible = st.flow > 0.01;
      surfMat.color.set(st.consumed ? darken(waterDeep, 0.5) : (Math.sin(st.t * 6) > 0.2 ? waterDeep : lighten(waterDeep, 0.15)));
      glowMat.opacity = st.consumed ? 0.08 : 0.3 + 0.06 * Math.sin(st.t * 4);
      ripples += dt;
      if (!st.consumed && ripples > 0.5) {
        ripples = 0;
        sparks.burst([0, 0.5, 0], [G.hi, G.white], 1, { speed: 0.15, up: 0.35, gravity: -0.1, life: 1.1, size: 0.03, drag: 1, radius: 0.25 });
      }
      sparks.update(dt);
    }

    function collect() {
      var once = false;
      return anim.play(0.5, function (p) {
        var s = 1 + 0.12 * bump(p);
        basin.scale.set(s, 1 / s, s);
        if (!once) {
          once = true;
          sparks.burst([0, 0.45, 0], [G.base, G.hi, water, G.white], 28, { speed: 1.4, up: 1.4, gravity: 4, life: 0.7, size: 0.045, drag: 1.6 });
        }
      }, 'collect');
    }

    function setConsumed(v) { st.consumed = !!v; if (!v) st.flow = 1; }

    return {
      group: group, update: update, collect: collect, setConsumed: setConsumed,
      reset: function () { anim.finish(); basin.scale.setScalar(1); sparks.clear(); setConsumed(false); },
      get consumed() { return st.consumed; },
      dispose: function () { anim.finish(); detach(group); bag.dispose(); }
    };
  }

  /* ======================================================================================
     14. [IA] Claude – Baú do tesouro (objetivo 'G'): madeira, cantoneiras e frisos de ouro, fechadura.
         open(): a tampa gira na dobradiça de trás, sai um clarão dourado com moedas faiscando.
     ====================================================================================== */

  /**
   * createChest(opts) → { group, update, open(): Promise, setOpen(bool), isOpen, reset(), dispose(),
   *   trigger() (= open, compatível com o antigo createGoal), setHighlight(bool) (brilho chamando atenção
   *   quando o aluno não chega), light (PointLight ou null) }.
   * opts.dais (true): estrado de pedra octogonal com friso de ouro por baixo; opts.light (false): PointLight
   * dourada que acende na abertura (o motor limita o total de luzes).
   * Origem = centro da casa no chão; a frente do baú olha para +z.
   */
  function createChest(opts) {
    opts = opts || {};
    var G = GOLDC, Wd = WOODC;
    var bag = new Bag(), anim = new Anim();
    var group = new THREE.Group(); group.name = 'bau';
    var lift = opts.dais === false ? 0 : 1.5;   // altura do estrado (voxels)

    var model = new VoxelModel();
    // ---- estrado
    if (lift) {
      model.part('dais', [0, 0, 0]);
      var dStone = '#6E6458', dHi = '#8E8270', dLo = '#4A423A';
      function daisTop(p, w, h) {
        p.fill(dStone); p.speckle(dLo, 0.1, 3); p.speckle(dHi, 0.08, 4);
        p.rect(0, 0, w, 1, G.lo); p.rect(0, h - 1, w, 1, G.lo); p.rect(0, 0, 1, h, G.lo); p.rect(w - 1, 0, 1, h, G.lo);
        p.glow(0, 0, w, 1, darken(G.lo, 0.7)); p.glow(0, h - 1, w, 1, darken(G.lo, 0.7));
      }
      function daisSide(p, w, h) { p.fill(dLo); p.rect(0, 0, w, 1, dHi); p.speckle(dStone, 0.15, 6); }
      model.box('dais', -9, 0, -7, 18, lift, 14, { py: daisTop, all: daisSide, ny: dLo });
      model.box('dais', -7, 0, -9, 14, lift, 2, { py: daisTop, all: daisSide, ny: dLo });
      model.box('dais', -7, 0, 7, 14, lift, 2, { py: daisTop, all: daisSide, ny: dLo });
    }
    // ---- corpo: 16 × 8 × 11 voxels
    var BW = 16, BH = 8, BD = 11, x0 = -BW / 2, z0 = -BD / 2, y0 = lift;
    function plankFront(p, w, h) {
      p.fill(Wd.base);
      for (var y = 0; y < h; y += 3) { p.rect(0, y, w, 1, Wd.hi); p.rect(0, y + 2, w, 1, Wd.lo); }
      p.speckle(Wd.grain, 0.08, 21);
      p.rect(0, 0, w, 1, G.base); p.rect(0, h - 1, w, 1, G.lo);           // frisos de ouro
      p.rect(0, 0, 1, h, G.lo); p.rect(w - 1, 0, 1, h, G.lo);
      p.glow(0, 0, w, 1, darken(G.base, 0.75));
    }
    function plankSide(p, w, h) {
      p.fill(Wd.mid);
      for (var y = 0; y < h; y += 3) { p.rect(0, y, w, 1, Wd.hi); p.rect(0, y + 2, w, 1, Wd.lo); }
      p.rect(0, 0, w, 1, G.base); p.rect(0, h - 1, w, 1, G.lo);
      p.rect(0, 0, 1, h, G.lo); p.rect(w - 1, 0, 1, h, G.lo);
      // alça de ferro
      p.rect(Math.floor(w / 2) - 2, 3, 4, 1, IRONC.hi); p.rect(Math.floor(w / 2) - 2, 4, 1, 1, IRONC.base); p.rect(Math.floor(w / 2) + 1, 4, 1, 1, IRONC.base);
    }
    function heap(p, w, h) {                                     // moedas dentro (vistas quando abre)
      p.fill(G.base);
      var r = rng(77);
      for (var i = 0; i < w * h * 0.35; i++) p.px(Math.floor(r() * w), Math.floor(r() * h), r() < 0.5 ? G.hi : G.lo);
      p.px(3, 3, '#E0445C'); p.px(10, 6, '#35C8F0'); p.px(6, 2, '#7DDB45');
      p.glow(0, 0, w, h, darken(G.base, 0.45));
    }
    model.part('body', [0, 0, 0]);
    model.box('body', x0, y0, z0, BW, BH, BD, { pz: plankFront, nz: plankFront, sides: plankSide, py: heap, ny: Wd.dark });
    // cantoneiras de ouro nos 4 cantos verticais (saltam 0,4 voxel)
    function corner(p, w, h) { p.fill(G.base); p.rect(0, 0, 1, h, G.hi); p.rect(w - 1, 0, 1, h, G.lo); p.px(0, 1, G.white); p.px(0, h - 2, G.white); p.glow(0, 0, w, h, darken(G.base, 0.7)); }
    [[x0 - 0.4, z0 - 0.4], [x0 + BW - 1.6, z0 - 0.4], [x0 - 0.4, z0 + BD - 1.6], [x0 + BW - 1.6, z0 + BD - 1.6]].forEach(function (c) {
      model.box('body', c[0], y0, c[1], 2, BH, 2, { all: corner, py: G.hi, ny: G.dark });
    });
    // tira de ferro vertical no meio da frente/trás + placa da fechadura
    model.box('body', -1.5, y0, z0 + BD, 3, BH - 0.5, 0.4, { all: function (p, w, h) { p.fill(IRONC.base); p.rect(0, 0, 1, h, IRONC.hi); p.px(1, 2, IRONC.rivet); p.px(1, h - 2, IRONC.rivet); } });
    model.box('body', -2, y0 + BH - 4, z0 + BD + 0.2, 4, 4, 0.6, {
      pz: function (p, w, h) { p.fill(G.base); p.rect(0, 0, w, 1, G.hi); p.rect(0, 0, 1, h, G.hi); p.rect(w - 1, 0, 1, h, G.lo); p.rect(0, h - 1, w, 1, G.lo);
        p.px(1, 1, '#1A1210'); p.px(2, 1, '#1A1210'); p.px(1, 2, '#1A1210'); p.glow(0, 0, w, h, darken(G.base, 0.6)); },
      all: G.lo, py: G.hi
    });

    // ---- tampa: pivô na dobradiça (aresta de trás, em cima do corpo)
    var LH = 5;
    model.part('lid', [0, y0 + BH, z0]);
    function lidFront(p, w, h) {
      p.fill(Wd.mid); p.rect(0, 1, w, 1, Wd.hi); p.rect(0, h - 2, w, 1, Wd.lo);
      p.rect(0, h - 1, w, 1, G.base); p.rect(0, 0, w, 1, G.lo); p.rect(0, 0, 1, h, G.lo); p.rect(w - 1, 0, 1, h, G.lo);
      p.glow(0, h - 1, w, 1, darken(G.base, 0.7));
    }
    function lidTop(p, w, h) {
      p.fill(Wd.mid);
      for (var x = 0; x < w; x += 4) { p.rect(x, 0, 1, h, Wd.lo); p.rect(x + 1, 0, 1, h, Wd.hi); }
      p.rect(0, 0, w, 1, G.lo); p.rect(0, h - 1, w, 1, G.base); p.rect(0, 0, 1, h, G.base); p.rect(w - 1, 0, 1, h, G.lo);
      // faixas de ouro atravessando a tampa
      p.rect(2, 0, 2, h, G.base); p.rect(w - 4, 0, 2, h, G.base); p.rect(2, 0, 1, h, G.hi); p.rect(w - 4, 0, 1, h, G.hi);
      p.glow(2, 0, 2, h, darken(G.base, 0.75)); p.glow(w - 4, 0, 2, h, darken(G.base, 0.75));
    }
    function lidInside(p, w, h) { p.fill(Wd.dark); p.rect(1, 1, w - 2, h - 2, '#3A2414'); p.glow(1, 1, w - 2, h - 2, '#2A1608'); }
    // tampa "abaulada" em 3 degraus
    model.box('lid', x0, y0 + BH, z0, BW, 3, BD, { pz: lidFront, nz: lidFront, sides: lidFront, py: lidTop, ny: lidInside });
    model.box('lid', x0, y0 + BH + 3, z0 + 1, BW, 1.25, BD - 2, { pz: lidFront, nz: lidFront, sides: lidFront, py: lidTop, ny: Wd.dark });
    model.box('lid', x0, y0 + BH + 4.25, z0 + 2.5, BW, 0.75, BD - 5, { pz: lidFront, nz: lidFront, sides: lidFront, py: lidTop, ny: Wd.dark });
    // cantoneiras da tampa + trinco que desce sobre a fechadura
    [[x0 - 0.4, z0 - 0.4], [x0 + BW - 1.6, z0 - 0.4], [x0 - 0.4, z0 + BD - 1.6], [x0 + BW - 1.6, z0 + BD - 1.6]].forEach(function (c) {
      model.box('lid', c[0], y0 + BH, c[1], 2, 3, 2, { all: corner, py: G.hi, ny: G.dark });
    });
    model.box('lid', -1, y0 + BH - 1.5, z0 + BD + 0.6, 2, 3.5, 0.6, { all: function (p, w, h) { p.fill(G.base); p.rect(0, 0, 1, h, G.hi); p.glow(0, 0, w, h, darken(G.base, 0.6)); }, ny: G.lo });

    var built = model.build({ selfLight: 0.06 });
    bag.add(built.colorTexture); bag.add(built.emissiveTexture);
    var mat = bag.add(new THREE.MeshLambertMaterial({ map: built.colorTexture, emissive: 0xffffff,
      emissiveMap: built.emissiveTexture, emissiveIntensity: 1 }));
    function mesh(name) {
      var me = new THREE.Mesh(bag.add(built.geometries[name]), mat); me.castShadow = true; me.receiveShadow = true; me.name = 'bau-' + name; return me;
    }
    if (lift) group.add(mesh('dais'));
    var chestG = new THREE.Group(); chestG.name = 'bau-corpo'; group.add(chestG);
    chestG.add(mesh('body'));
    var hinge = new THREE.Group(); hinge.position.set(0, (y0 + BH) * U, z0 * U); chestG.add(hinge);
    var lid = mesh('lid'); hinge.add(lid);
    var OPEN_ANGLE = -1.95;

    // clarão dourado (sai de dentro), feixe e halo no chão
    var beamGeo = bag.add(new THREE.CylinderGeometry(0.22, 0.3, 1.4, 8, 1, true));
    var beamMat = bag.add(new THREE.MeshBasicMaterial({ map: beamTexture(), color: G.hi, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0, toneMapped: false }));
    var beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = (y0 + BH) * U + 0.8; beam.renderOrder = 2; beam.visible = false;
    group.add(beam);
    var burstMat = bag.add(new THREE.SpriteMaterial({ map: flashTexture(), color: G.hi, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false }));
    var burstS = new THREE.Sprite(burstMat); burstS.position.y = (y0 + BH + 2) * U; burstS.visible = false; burstS.renderOrder = 3;
    group.add(burstS);
    var innerGlowMat = bag.add(new THREE.SpriteMaterial({ map: glowTexture(), color: G.base, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    var innerGlow = new THREE.Sprite(innerGlowMat); innerGlow.position.y = (y0 + BH + 1) * U; innerGlow.scale.set(0.8, 0.55, 1);
    group.add(innerGlow);
    var haloGeo = bag.add(new THREE.PlaneGeometry(1.3, 1.3));
    var haloMat = bag.add(new THREE.MeshBasicMaterial({ map: haloTexture(), color: G.base, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false }));
    var halo = new THREE.Mesh(haloGeo, haloMat); halo.rotation.x = -Math.PI / 2; halo.position.y = lift * U + 0.012; group.add(halo);

    var glints = [makeGlint(bag, '#FFF4C8', 0.2), makeGlint(bag, '#FFF4C8', 0.16)];
    glints.forEach(function (g) { group.add(g); });
    var GL = [[x0 * U, (y0 + BH + 3) * U, (z0 + BD) * U], [-x0 * U, (y0 + BH) * U, (z0 + BD) * U], [0, (y0 + BH - 2) * U, (z0 + BD + 1) * U],
      [x0 * U, (y0 + 1) * U, (z0 + BD) * U], [-x0 * U, (y0 + BH + 4) * U, 0]];

    var light = null;
    if (opts.light) {
      light = new THREE.PointLight(0xffc860, 0, 3.5, 1.6);
      light.position.set(0, (y0 + BH + 6) * U, 0.1);
      group.add(light);
    }

    var sparks = bag.add(new Particles(group, { max: 200 }));
    var st = { t: Math.random() * 5, open: false, highlight: false, hl: 0, energy: 0, coinT: 0 };
    var api = { group: group, light: light };

    function setLid(a) { hinge.rotation.x = a; }

    function update(dt) {
      dt = clamp(dt || 0, 0, 0.1);
      st.t += dt;
      anim.update(dt);
      st.hl = approach(st.hl, st.highlight ? 1 : 0, dt * 2);
      st.energy = Math.max(0, st.energy - dt * 0.4);
      if (!anim.busy()) {
        if (st.open) {
          // aberto: brilho contínuo saindo de dentro + moedinhas faiscando
          innerGlowMat.opacity = 0.32 + 0.06 * Math.sin(st.t * 3) + 0.15 * st.energy;
          beamMat.opacity = 0.05 + 0.02 * Math.sin(st.t * 2.2) + 0.12 * st.energy;
          haloMat.opacity = 0.18 + 0.04 * Math.sin(st.t * 2.2);
          st.coinT += dt;
          if (st.coinT > 0.35) {
            st.coinT = 0;
            sparks.burst([(Math.random() - 0.5) * 0.4, (y0 + BH) * U + 0.05, (Math.random() - 0.5) * 0.25], [G.hi, G.white], 1,
              { speed: 0.12, up: 0.5, gravity: 0.2, life: 1.1, size: 0.035, drag: 1 });
          }
          if (light) light.intensity = 1.4 + 0.25 * Math.sin(st.t * 3) + 2 * st.energy;
        } else {
          // fechado: halo pulsa quando destacado (aluno não chegou); brilho fraquinho pela fresta
          var pulse = 0.5 + 0.5 * Math.sin(st.t * 2.6);
          haloMat.opacity = st.hl * (0.25 + 0.3 * pulse);
          halo.scale.setScalar(1 + 0.08 * pulse * st.hl);
          innerGlowMat.opacity = 0.06 + st.hl * 0.18 * pulse;
          mat.emissiveIntensity = 1 + st.hl * 0.35 * pulse;
          if (light) light.intensity = st.hl * 0.6 * pulse;
        }
      }
      // glints nos frisos de ouro (mais frequentes quando destacado)
      var period = st.hl > 0.5 ? 0.9 : 1.8;
      glints.forEach(function (g, i) {
        var k = (st.t + i * period / 2) % period;
        var idx = Math.floor((st.t + i * period / 2) / period + i * 2) % GL.length;
        if (k < 0.28) { g.position.set(GL[idx][0], GL[idx][1], GL[idx][2]); g.material.opacity = bump(k / 0.28); g.material.rotation = k * 4; }
        else g.material.opacity = 0;
      });
      sparks.update(dt);
    }

    api.open = function () {
      if (st.open) return Promise.resolve();
      anim.finish();
      var burst1 = false, burst2 = false;
      beam.visible = true; burstS.visible = true;
      return anim.play(1.05, function (p) {
        // 1) chacoalha (algo dentro!) 2) tampa salta e gira com quique 3) clarão + moedas
        var shake = p < 0.22 ? Math.sin(p * 80) * 0.025 * bump(p / 0.22) : 0;
        chestG.rotation.z = shake;
        chestG.position.y = p < 0.22 ? Math.abs(Math.sin(p * 40)) * 0.01 : 0;
        var q = seg(p, 0.2, 0.62);
        var a = q < 1 ? OPEN_ANGLE * 1.06 * ease.outCubic(q) : OPEN_ANGLE * (1.06 - 0.06 * ease.outBack(seg(p, 0.62, 0.8)));
        setLid(a);
        var f = seg(p, 0.24, 1);
        burstMat.opacity = bump(Math.min(1, f * 1.6)) * 0.85;
        var bs = 0.3 + 0.9 * ease.outCubic(f);
        burstS.scale.set(bs, bs, 1); burstMat.rotation = f * 0.8;
        beamMat.opacity = 0.45 * bump(f) + 0.1 * f;
        beam.scale.set(1 + 0.5 * bump(f), 0.6 + 0.4 * ease.outCubic(f), 1 + 0.5 * bump(f));
        innerGlowMat.opacity = 0.6 * bump(f) + 0.35 * f;
        haloMat.opacity = 0.5 * bump(f) + 0.18 * f;
        halo.scale.setScalar(0.6 + 1.2 * ease.outCubic(f));
        if (light) light.intensity = 3.5 * bump(f) + 1.4 * f;
        if (!burst1 && p >= 0.3) {
          burst1 = true;
          sparks.burst([0, (y0 + BH) * U + 0.05, 0], [G.base, G.hi, G.white, G.lo], 46,
            { speed: 1.1, up: 2.4, gravity: 4.2, life: 1.1, size: 0.05, spread: 0.3, drag: 1.2, radius: 0.18, floor: lift * U + 0.02 });
        }
        if (!burst2 && p >= 0.5) {
          burst2 = true;
          sparks.burst([0, (y0 + BH) * U + 0.3, 0], ['#FFFFFF', G.hi], 24,
            { speed: 1.6, up: 0.6, gravity: 0.8, life: 0.8, size: 0.03, drag: 2.2 });
        }
        if (p >= 1) { st.open = true; st.energy = 1; burstS.visible = false; chestG.rotation.z = 0; chestG.position.y = 0; }
      }, 'open');
    };
    api.trigger = api.open;

    api.setOpen = function (open) {
      anim.finish();
      sparks.clear();
      st.open = !!open; st.energy = 0;
      setLid(open ? OPEN_ANGLE : 0);
      chestG.rotation.z = 0; chestG.position.y = 0;
      beam.visible = !!open; burstS.visible = false; burstMat.opacity = 0;
      beam.scale.set(1, 1, 1);
      if (!open) { innerGlowMat.opacity = 0.06; beamMat.opacity = 0; haloMat.opacity = 0; halo.scale.setScalar(1); }
      if (light) light.intensity = open ? 1.4 : 0;
    };
    api.reset = function () { api.setOpen(false); st.highlight = false; st.hl = 0; mat.emissiveIntensity = 1; };
    api.setHighlight = function (on) { st.highlight = !!on; };
    api.update = update;
    api.dispose = function () { anim.finish(); detach(group); bag.dispose(); };
    Object.defineProperty(api, 'isOpen', { get: function () { return st.open; }, enumerable: true });

    api.setOpen(false);
    return api;
  }

  /** Objetivo 'G' (contrato da rodada 1): agora é o baú do tesouro sobre um estrado. trigger() = open(). */
  function createGoal(opts) {
    var o = { dais: true };
    if (opts) for (var k in opts) o[k] = opts[k];
    return createChest(o);
  }

  /* ======================================================================================
     14b. [IA] Claude – Tocha de parede: suporte de ferro, cabo de madeira, chama em sprite animado (4 quadros
          de pixel art), brilho aditivo, mancha de luz falsa no chão e faíscas. PointLight só com opts.light.
     ====================================================================================== */

  var FLAME_FRAMES = [
    ['...o....', '...oo...', '..oyo...', '..oyyo..', '.oyyyo..', '.oywwyo.', '.oywwyo.', 'ooywwyoo', '.oyyyyo.', '..oyyo..', '..rooor.', '...rr...'],
    ['....o...', '...oo...', '...oyo..', '..oyyo..', '..oyyyo.', '.oywwyo.', '.oywwyo.', '.oywwyoo', 'ooyyyyo.', '..oyyo..', '..roorr.', '...rr...'],
    ['..o.....', '..oo....', '..oyo...', '.oyyo...', '.oyyyo..', '.oywwyo.', 'ooywwyo.', '.oywwyoo', '.oyyyyo.', '..oyyo..', '.rooor..', '...rr...'],
    ['...o..o.', '...oo.o.', '..oyooo.', '..oyyyo.', '.oyyyyo.', '.oywwyo.', '.oywwyoo', 'ooywwyo.', '.oyyyyo.', '..oyyo..', '..rooor.', '...rr...']
  ];
  function flameStrip() {
    return sharedTexture('flame', function (x) {
      FLAME_FRAMES.forEach(function (rows, i) {
        drawRows(x, rows, { r: '#B8401A', o: '#FF8A2A', y: '#FFD24A', w: '#FFF6D0' }, i * 8, 0, 1);
      });
    }, 32, 12);
  }

  /**
   * createTorch(opts) → { group, update(dt,t), light, setLit(bool), flicker, dispose() }.
   * Origem = pé da parede (y = 0 no chão), na face da parede; +z aponta para fora da parede (corredor).
   * opts.height (0,82): altura do suporte; opts.light (false): cria uma PointLight âmbar que tremula
   * (o motor deve usar no máx. ~6); opts.floorGlow (true): mancha de luz falsa no chão à frente da parede;
   * opts.intensity (2.2), opts.distance (4.5): parâmetros da luz.
   */
  function createTorch(opts) {
    opts = opts || {};
    var h = opts.height != null ? opts.height : 0.82;
    var bag = new Bag();
    var group = new THREE.Group(); group.name = 'tocha';
    var mount = new THREE.Group(); mount.position.y = h; group.add(mount);

    var model = new VoxelModel();
    model.part('torch', [0, 0, 0]);
    function iron(p, w, hh) { p.fill(IRONC.base); p.rect(0, 0, w, 1, IRONC.hi); p.rect(0, hh - 1, w, 1, IRONC.dark); }
    model.box('torch', -1.5, -2.5, 0, 3, 5, 0.6, { all: iron, pz: function (p, w, hh) { iron(p, w, hh); p.px(1, 1, IRONC.rivet); p.px(1, hh - 2, IRONC.rivet); } });  // chapa
    model.box('torch', -0.5, -1, 0.6, 1, 1, 2.6, { all: iron });                                  // braço
    model.box('torch', -1.5, 0, 2.2, 3, 1, 3, { all: iron, py: IRONC.dark });                     // anel
    function woodS(p, w, hh) { p.fill(WOODC.base); p.rect(0, 0, 1, hh, WOODC.hi); p.rect(w - 1, 0, 1, hh, WOODC.lo); p.px(0, 2, WOODC.grain); }
    model.box('torch', -0.75, -3, 2.95, 1.5, 6, 1.5, { all: woodS, ny: WOODC.dark });          // cabo
    model.box('torch', -1.1, 3, 2.6, 2.2, 1.6, 2.2, { all: function (p, w, hh) { p.fill('#3A2416'); p.px(0, 0, '#FF8A2A'); p.glow(0, 0, w, 1, '#802A08'); }, py: function (p, w, hh) { p.fill('#FF8A2A'); p.glow(0, 0, w, hh, '#FF8A2A'); } }); // pano em brasa
    var built = model.build();
    bag.add(built.colorTexture); bag.add(built.emissiveTexture); bag.add(built.geometries.torch);
    var mat = bag.add(new THREE.MeshLambertMaterial({ map: built.colorTexture, emissive: 0xffffff, emissiveMap: built.emissiveTexture, emissiveIntensity: 1 }));
    var body = new THREE.Mesh(built.geometries.torch, mat); body.castShadow = false; mount.add(body);

    // chama (sprite com 4 quadros; cada tocha tem sua cópia da textura para trocar o quadro)
    var strip = flameStrip();
    var ftex = bag.add(strip.clone()); ftex.needsUpdate = true;
    ftex.repeat.set(0.25, 1);
    var flameMat = bag.add(new THREE.SpriteMaterial({ map: ftex, transparent: true, alphaTest: 0.4, depthWrite: false, toneMapped: false }));
    var flame = new THREE.Sprite(flameMat); flame.center.set(0.5, 0.05); flame.renderOrder = 4;
    var FW = 8 * U * 0.9, FH = 12 * U * 0.9;
    flame.scale.set(FW, FH, 1);
    flame.position.set(0, 4.4 * U, 3.7 * U + 0.04);
    mount.add(flame);
    var glowMat = bag.add(new THREE.SpriteMaterial({ map: glowTexture(), color: '#FFA040', transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, toneMapped: false }));
    var glow = new THREE.Sprite(glowMat); glow.scale.set(0.9, 0.9, 1); glow.position.set(0, 7 * U, 4 * U); mount.add(glow);

    var floorMat = null, floor = null;
    if (opts.floorGlow !== false) {
      var fGeo = bag.add(new THREE.PlaneGeometry(1.5, 1.2));
      floorMat = bag.add(new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#FF9A3A', transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22, toneMapped: false }));
      floor = new THREE.Mesh(fGeo, floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.014, 0.42); floor.renderOrder = 1;
      group.add(floor);
    }

    var light = null;
    if (opts.light) {
      light = new THREE.PointLight(0xffa850, opts.intensity != null ? opts.intensity : 2.2, opts.distance != null ? opts.distance : 4.5, 1.6);
      light.position.set(0, h + 0.3, 0.35);
      light.castShadow = false;
      group.add(light);
    }
    var baseI = light ? light.intensity : 0;

    var embers = bag.add(new Particles(mount, { max: 24 }));
    var st = { t: Math.random() * 10, frameT: Math.random(), frame: 0, lit: true, emberT: 0 };
    var api = { group: group, light: light, flicker: 1 };

    function update(dt) {
      dt = clamp(dt || 0, 0, 0.1);
      st.t += dt;
      st.frameT += dt;
      if (st.frameT > 0.11) { st.frameT = 0; st.frame = (st.frame + 1 + (Math.random() < 0.25 ? 1 : 0)) % 4; ftex.offset.x = st.frame * 0.25; }
      // tremulação: soma de senos + um pouco de ruído
      var f = 0.82 + 0.1 * Math.sin(st.t * 9.1) + 0.06 * Math.sin(st.t * 23.7 + 1.3) + 0.04 * (Math.random() - 0.5);
      if (!st.lit) f = 0;
      api.flicker = f;
      flame.visible = st.lit;
      flame.scale.set(FW * (0.95 + 0.08 * f), FH * (0.88 + 0.16 * f), 1);
      glowMat.opacity = 0.42 * f;
      var gs = 0.8 + 0.15 * f; glow.scale.set(gs, gs, 1);
      if (floorMat) floorMat.opacity = 0.2 * f;
      if (light) light.intensity = baseI * f;
      st.emberT += dt;
      if (st.lit && st.emberT > 0.4 + Math.random() * 0.6) {
        st.emberT = 0;
        embers.burst([0, 8 * U, 3.7 * U], ['#FFD24A', '#FF8A2A'], 1, { speed: 0.12, up: 0.55, gravity: -0.15, life: 0.9, size: 0.022, drag: 1.4, radius: 0.04 });
      }
      embers.update(dt);
    }

    api.update = update;
    api.setLit = function (on) { st.lit = !!on; if (!on) embers.clear(); };
    api.dispose = function () { detach(group); bag.dispose(); };
    update(0);
    return api;
  }

  /* ======================================================================================
     15. Plataforma de início: anéis concêntricos da CESAR em laranja, pulsando
     ====================================================================================== */

  function createStartPad() {
    var cesar = paletteColor('cesar'), escuro = paletteColor('cesarEscuro');
    var bag = new Bag();
    var group = new THREE.Group(); group.name = 'inicio';
    var S = 20;
    var tex = bag.add(pixelTexture((function () {
      var c = makeCanvas(S, S), x = c.getContext('2d');
      var cx = (S - 1) / 2, cy = (S - 1) / 2 + 0.6;          // anéis "caídos" para baixo, como na marca
      for (var y = 0; y < S; y++) {
        for (var i = 0; i < S; i++) {
          var dx = i - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy * 1.08);
          var col = null;
          if (d > 8 && d <= 9.6) col = (dy > 2) ? escuro : cesar;          // anel externo
          else if (d > 4.6 && d <= 6.2) col = cesar;                        // anel do meio
          else if (d <= 2.4) col = cesar;                                   // centro
          if (col && Math.abs(dx) < 1.1 && dy < -6) col = null;             // abertura no topo
          if (!col) continue;
          x.fillStyle = col; x.fillRect(i, y, 1, 1);
        }
      }
      return c;
    })()));
    var geo = bag.add(new THREE.PlaneGeometry(0.9, 0.9));
    // [IA] Claude – rodada 2: os anéis já estão entalhados na textura do piso 'S' (placa de pressão);
    // aqui eles só "acendem" (aditivo, pulsando), deixando a pedra entalhada aparecer por baixo.
    var mat = bag.add(new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.5, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    var pad = new THREE.Mesh(geo, mat); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.008; pad.receiveShadow = true;
    group.add(pad);

    var ringMat = bag.add(new THREE.MeshBasicMaterial({ map: haloTexture(), color: cesar, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false }));
    var ring = new THREE.Mesh(geo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; group.add(ring);

    var glowMat = bag.add(new THREE.MeshBasicMaterial({ map: glowTexture(), color: cesar, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.25, toneMapped: false }));
    var glow = new THREE.Mesh(geo, glowMat); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01; glow.scale.setScalar(1.2);
    group.add(glow);

    var t = 0;
    return {
      group: group,
      update: function (dt) {
        t += clamp(dt || 0, 0, 0.1);
        var k = (t % 2.2) / 2.2;
        var s = 0.7 + 0.7 * ease.outCubic(k);
        ring.scale.set(s, s, 1);
        ringMat.opacity = 0.7 * (1 - k);
        glowMat.opacity = 0.2 + 0.08 * Math.sin(t * 2.4);
        mat.opacity = 0.42 + 0.14 * Math.sin(t * 2.4);
      },
      dispose: function () { detach(group); bag.dispose(); }
    };
  }

  /* ======================================================================================
     16. API pública
     ====================================================================================== */

  voxel.U = U;
  voxel.keyColor = keyColor;
  voxel.studentColors = studentColors;
  voxel.logoMark = logoMark;
  voxel.keyMesh = function (letter, unit) { return keyMesh(letter, unit || KEY_UNIT); };
  voxel.createStudent = createStudent;
  voxel.createKey = createKey;
  voxel.createDoor = createDoor;
  voxel.createBonus = createBonus;
  voxel.createGoal = createGoal;
  voxel.createChest = createChest;     // [IA] Claude – rodada 2 (dungeon)
  voxel.createTorch = createTorch;
  voxel.createStartPad = createStartPad;
  voxel.Particles = Particles;
  voxel.floatText = floatText;
  voxel.pixelTextCanvas = pixelTextCanvas;
})(typeof window !== 'undefined' ? window : this);
