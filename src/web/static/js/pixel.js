/* [IA] Claude – pixel.js: paleta, texturas procedurais em pixel art, marca CESAR e sprite do aluno (LAB.pixel).
 * Rodada 2: tema dungeon — paleta de pedra escura quente (mesmos nomes de chave), lajes, paredes de pedra
 * rústica, poço escuro, trilho com runas, moedas, fonte dourada, placa de pressão CESAR, estrado do baú e
 * porta de madeira com cintas de ferro e cadeado na cor da chave.
 *
 * Módulo sem dependências (não usa THREE): tudo é desenhado em <canvas> com pixels inteiros e
 * imageSmoothingEnabled = false. As texturas são "pintadas à mão" em código: matrizes de caracteres
 * (cada caractere = 1 texel) + sombreamento com luz vinda do canto superior esquerdo.
 *
 * Convenções:
 *  - Texturas de piso usam a orientação do mapa: topo do canvas = norte (linha - 1), direita = leste (coluna + 1).
 *  - Todos os canvases devolvidos por tileTexture/wallTexture/doorTexture/waterFrames são CACHEADOS e
 *    compartilhados: não desenhe sobre eles (copie com drawImage se precisar alterar).
 *  - Matrizes: string[]; '.' (ou ' ') = transparente; os demais caracteres são resolvidos por um mapa de cores.
 */
(function () {
  'use strict';

  const LAB = (window.LAB = window.LAB || {});

  /** Texels por aresta de tile (piso e topo de parede). */
  const TILE = 16;
  /** Altura em texels da face lateral de parede/porta (paredes têm 1.25 tile de altura). */
  const WALL_H = 20;

  // ---------------------------------------------------------------------------------------------
  // [IA] Claude – Paleta "dungeon" (rodada 2): os nomes das chaves continuam os mesmos da rodada 1
  // (noite, noite2, noite3, luar, luarFraco...) para nada quebrar; só os valores mudaram. A "noite" agora
  // é pedra escura quente (NÃO roxo, NÃO preto puro) e o "luar" é um branco-osso quente.
  // ---------------------------------------------------------------------------------------------
  const PALETTE = {
    noite: '#1A1612',      // fundo das telas (hero, player, rodapé) — pedra quase preta, quente
    noite2: '#26201A',     // painéis/HUD
    noite3: '#3A3028',     // bordas/inserções
    noite4: '#4A3E33',     // borda clara / hover em superfícies de tela
    luar: '#EFE6D8',       // texto na tela
    luarFraco: '#B5A895',  // texto secundário na tela (≥ 4.5:1 sobre noite)
    tocha: '#FFB347',      // âmbar da tocha (acentos de UI, brilho)
    tochaEscura: '#E07B24',
    papel: '#F3F5FA',
    quadricula: '#DCE3F0',
    grafite: '#1C1B29',
    grafiteFraco: '#5B5F7A',
    cesar: '#FF6002',
    cesarEscuro: '#DD4012',
    chave: { a: '#FFC23A', b: '#35C8F0', c: '#F45BC8', d: '#7DDB45' },
    ok: '#3FCF8E',
    erro: '#FF5470',
    ouro: '#E9AE3C',       // moedas, baú, fonte mágica
    ouroClaro: '#FFE08A',
    // Cor "representativa" de cada tipo de casa (minimapa, miniaturas, legendas).
    tiles: {
      chao: '#5A5249',
      chaoAlt: '#625950',
      parede: '#4F4842',
      paredeTopo: '#7A7065',
      lama: '#4C3A28',
      agua: '#1C3A44',
      aguaClara: '#6FB7C2',
      bonus: '#E9AE3C',
      fonte: '#FFD24A',
      esteira: '#3A342D',
      inicio: '#FF6002',
      saida: '#C9923A'
    }
  };

  // Rampas de cor por material (escuro → claro).
  // Lajes do chão: pedra cinza-amarronzada gasta.
  const STONE = {
    grout: '#2A241F', lo: '#433C35', base: '#564E45', hi: '#7A6F62', pit: '#3A332D', grain: '#6C6257',
    tones: ['#564E45', '#5E554B', '#50493F', '#5A5450', '#62584C']
  };
  // Topo das paredes: blocos mais claros, gastos pelo tempo.
  const CAP = {
    edge: '#4A423A', lo: '#62594F', base: '#7A7065', mid: '#857A6D', hi: '#9D9282', pit: '#6A6156', grain: '#8F8577',
    tones: ['#7A7065', '#827769', '#74695F', '#7D746B', '#867B6C']
  };
  // Face das paredes: blocos rústicos de pedra.
  const WALLSTONE = {
    mortar: '#231E1A', lo: '#3B352F', hi: '#7E7468', pit: '#403933', grain: '#6E655A',
    tones: ['#5B534B', '#655C52', '#4F4842', '#6B6157', '#575049', '#605A54']
  };
  const MOSS = { dark: '#34482A', base: '#4F6B35', hi: '#6E8A45' };
  const MUD = { dark: '#30241A', base: '#4C3A28', mid: '#5C4732', hi: '#735A3E', sheen: '#55636A', wet: '#3A3A36' };
  const WATER = { deep: '#10232A', base: '#1A3540', mid: '#234955', hi: '#356A75', foam: '#6FA8AE', glint: '#CDEBE6' };
  const BELT = {
    rail0: '#24201D', rail1: '#4B4642', rail2: '#7C756D', rivet: '#A39A8E',
    belt: '#3A342D', slat: '#221D19', beltHi: '#4A4339', chev: '#F1DDB0', chevLo: '#B99E6C', rune: '#3E2F1E'
  };
  const GREEN = { dark: '#1A6B4E', mid: '#2A9C6C', base: '#3FCF8E', hi: '#9BF2C8' };
  const GOLD = { dark: '#7A4E14', lo: '#B5791F', base: '#E9AE3C', hi: '#FFE08A', white: '#FFF8DC' };
  const WOOD = { dark: '#2E1F14', lo: '#4A3220', base: '#62432A', mid: '#6F4D30', hi: '#8A6440', grain: '#553923' };
  const IRON = { dark: '#1C1A19', lo: '#33302E', base: '#4A4643', hi: '#79736B', rivet: '#A8A096' };

  // ---------------------------------------------------------------------------------------------
  // Utilidades de cor
  // ---------------------------------------------------------------------------------------------
  function hexToRgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + ((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1).toUpperCase();
  }
  /** Mistura linear entre duas cores hex (t = 0 → a, t = 1 → b). */
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  const KEY_LETTERS = ['a', 'b', 'c', 'd'];
  function keyColor(letter) {
    return PALETTE.chave[String(letter || '').toLowerCase()] || PALETTE.luar;
  }
  /** Rampa de 5 tons a partir da cor de uma chave: contorno, escuro, base, claro, brilho. */
  function keyRamp(letter) {
    const base = keyColor(letter);
    return {
      k: mix(base, PALETTE.noite, 0.78),
      d: mix(base, PALETTE.noite, 0.42),
      m: base,
      l: mix(base, '#FFFFFF', 0.38),
      w: mix(base, '#FFFFFF', 0.75)
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Canvas e matrizes
  // ---------------------------------------------------------------------------------------------
  /** Cria um canvas w×h sem suavização e chama painter(ctx). */
  function canvas(w, h, painter) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    c.style.imageRendering = 'pixelated';
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (typeof painter === 'function') painter(ctx, c);
    return c;
  }

  /** Desenha uma matriz de caracteres. '.' e ' ' (ou caracteres sem cor) são pulados. */
  function draw(ctx, rows, colors, x, y, scale) {
    x = x || 0; y = y || 0; scale = scale || 1;
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const col = colors[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + i * scale, y + j * scale, scale, scale);
      }
    }
  }

  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  function px(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }

  /** Espelha horizontalmente uma matriz. */
  function flipH(rows) {
    return rows.map((r) => r.split('').reverse().join(''));
  }
  /** Gira uma matriz 90° no sentido horário. */
  function rotateCW(rows) {
    const h = rows.length, w = rows[0].length, out = [];
    for (let x = 0; x < w; x++) {
      let s = '';
      for (let y = h - 1; y >= 0; y--) s += rows[y][x];
      out.push(s);
    }
    return out;
  }
  /**
   * Converte uma máscara ('#' = cheio) em matriz sombreada com contorno:
   * 'k' contorno externo, 'l' borda iluminada (topo/esquerda), 'd' borda na sombra (base/direita), 'm' miolo.
   * Mantém a luz sempre vindo do canto superior esquerdo, mesmo para formas giradas.
   */
  function shadeMask(mask, withOutline) {
    const pad = withOutline ? 1 : 0;
    const h = mask.length, w = mask[0].length;
    const filled = (x, y) => y >= 0 && y < h && x >= 0 && x < w && mask[y][x] === '#';
    const out = [];
    for (let y = -pad; y < h + pad; y++) {
      let s = '';
      for (let x = -pad; x < w + pad; x++) {
        if (filled(x, y)) {
          const up = !filled(x, y - 1), left = !filled(x - 1, y);
          const down = !filled(x, y + 1), right = !filled(x + 1, y);
          if (up || left) s += 'l';
          else if (down || right) s += 'd';
          else s += 'm';
        } else if (withOutline && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) {
          s += 'k';
        } else s += '.';
      }
      out.push(s);
    }
    return out;
  }

  const cache = new Map();
  function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  }

  // ---------------------------------------------------------------------------------------------
  // Marca CESAR (limpa à mão a partir de brand/marca.png): elipse laranja larga; na metade de cima,
  // um anel branco aberto, um anel laranja e o centro branco, com o entalhe vertical no topo.
  // ---------------------------------------------------------------------------------------------
  const LOGO = {
    mark11: [
      '.OOO...OOO.',
      'OO..O.O..OO',
      'OOO.OOO.OOO',
      'OOOO...OOOO',
      '.OOOOOOOOO.'
    ],
    mark15: [
      '..OOOO...OOOO..',
      '.OO..O...O..OO.',
      'OOO..OOOOO..OOO',
      'OOOO.......OOOO',
      '.OOOOOOOOOOOOO.',
      '...OOOOOOOOO...'
    ],
    mark23: [
      '....OOOOO.....OOOOO....',
      '..OOO....OO.OO....OOO..',
      '.OOO...OOO...OOO...OOO.',
      'OOOO...OOOOOOOOO...OOOO',
      'OOOOOO...........OOOOOO',
      'OOOOOOOOOOOOOOOOOOOOOOO',
      '.OOOOOOOOOOOOOOOOOOOOO.',
      '...OOOOOOOOOOOOOOOOO...',
      '......OOOOOOOOOOO......'
    ],
    // Versão mínima usada no peito do sprite 2D (8×3): dois "U" aninhados com o entalhe no topo.
    chest: [
      'OO....OO',
      'O.OOOO.O',
      '.OOOOOO.'
    ],
    word: null // montado abaixo a partir da fonte 3×5
  };

  // Fonte 3×5 minúscula, de traço fino e cantos arredondados como a palavra "c.e.s.a.r" da marca.
  const FONT35 = {
    c: ['.OO', 'O..', 'O..', 'O..', '.OO'],
    e: ['.O.', 'O.O', 'OOO', 'O..', '.OO'],
    s: ['.OO', 'O..', '.O.', '..O', 'OO.'],
    a: ['.OO', 'O.O', 'O.O', 'O.O', '.OO'],
    r: ['O.O', 'OO.', 'O..', 'O..', 'O..'],
    '.': ['.', '.', '.', '.', 'O']
  };
  /** Compõe um texto com a fonte 3×5 (1 coluna de espaço entre glifos). */
  function pixelText(text) {
    const rows = ['', '', '', '', ''];
    const chars = String(text).split('');
    chars.forEach((ch, idx) => {
      const g = FONT35[ch] || ['...', '...', '...', '...', '...']; // caractere sem glifo = espaço
      for (let y = 0; y < 5; y++) rows[y] += g[y] + (idx < chars.length - 1 ? '.' : '');
    });
    return rows;
  }
  LOGO.word = pixelText('c.e.s.a.r');
  LOGO.wordPlain = pixelText('cesar');

  /** Canvas com uma marca do LOGO (nome 'mark11' | 'mark15' | 'mark23' | 'chest' | 'word' | 'wordPlain'). */
  function logoCanvas(name, scale, color) {
    const rows = LOGO[name] || LOGO.mark15;
    scale = Math.max(1, Math.round(scale || 4));
    return canvas(rows[0].length * scale, rows.length * scale, (ctx) =>
      draw(ctx, rows, { O: color || PALETTE.cesar, w: '#FFFFFF' }, 0, 0, scale));
  }

  // ---------------------------------------------------------------------------------------------
  // [IA] Claude – Pisos da dungeon (rodada 2): lajes de pedra irregulares, lama molhada, poço escuro,
  // trilho de pedra com runas, moedas, fonte mágica, placa de pressão com a marca CESAR e o estrado do baú.
  // ---------------------------------------------------------------------------------------------
  /** PRNG determinístico (xorshift) — texturas idênticas a cada carga. */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }

  // Disposição das lajes por variação: [x, y, w, h] — w/h incluem a linha de rejunte à direita/embaixo.
  const FLAG_LAYOUTS = [
    [[0, 0, 16, 9], [0, 9, 7, 7], [7, 9, 9, 7]],
    [[0, 0, 16, 16]],
    [[0, 0, 9, 7], [9, 0, 7, 10], [0, 7, 9, 9], [9, 10, 7, 6]],
    [[0, 0, 10, 6], [10, 0, 6, 16], [0, 6, 10, 10]]
  ];

  /**
   * Pinta lajes de pedra: rejunte escuro, cada pedra com tom próprio, aresta de luz em cima/esquerda,
   * sombra embaixo/direita, cantos lascados, poros e grãos. R = rampa (STONE ou CAP).
   */
  function paintStones(ctx, layout, R, seed) {
    const r = rng(seed);
    rect(ctx, 0, 0, TILE, TILE, R.grout || R.edge);
    layout.forEach(([x, y, w, h], i) => {
      const tone = R.tones[(seed * 3 + i * 7) % R.tones.length];
      const iw = w - 1, ih = h - 1;
      rect(ctx, x, y, iw, ih, tone);
      rect(ctx, x, y, iw, 1, mix(tone, R.hi, 0.55));            // aresta iluminada
      rect(ctx, x, y + 1, 1, ih - 1, mix(tone, R.hi, 0.3));
      rect(ctx, x + 1, y + ih - 1, iw - 1, 1, mix(tone, R.lo, 0.6)); // sombra
      rect(ctx, x + iw - 1, y + 1, 1, ih - 1, mix(tone, R.lo, 0.45));
      // cantos lascados (pedra gasta, nada de quadrado perfeito)
      px(ctx, x + iw - 1, y + ih - 1, R.lo);
      if (r() < 0.6) px(ctx, x, y, mix(tone, R.hi, 0.2));
      if (r() < 0.5) px(ctx, x + iw - 1, y, mix(tone, R.lo, 0.3));
      // poros e grãos no miolo
      for (let yy = y + 1; yy < y + ih - 1; yy++) {
        for (let xx = x + 1; xx < x + iw - 1; xx++) {
          const v = r();
          if (v < 0.05) px(ctx, xx, yy, R.pit);
          else if (v < 0.085) px(ctx, xx, yy, R.grain);
        }
      }
    });
  }

  /** Laje do chão 16×16 (variação 0..3). `R` padrão = STONE. */
  function paintSlab(ctx, variant, R) {
    R = R || STONE;
    const v = variant == null || variant < 0 ? 1 : variant % 4;
    paintStones(ctx, FLAG_LAYOUTS[v], R, 11 + v * 5 + (R === CAP ? 100 : 0));
    if (variant === 1) { // rachadura fina atravessando a laje grande
      draw(ctx, [
        '.........g.',
        '........g..',
        '........g..',
        '.......gd..',
        '......g....',
        '.....dg....',
        '.....g.....'
      ], { g: R.grout || R.edge, d: R.lo }, 3, 4);
    } else if (variant === 3 && R === STONE) { // musgo no rejunte
      draw(ctx, ['.mM', 'mMm', '.m.'], { m: MOSS.dark, M: MOSS.base }, 8, 4);
      draw(ctx, ['m.', 'Mm'], { m: MOSS.dark, M: MOSS.base }, 14, 11);
    }
  }

  // Lama ',': terra molhada contínua (emenda com a vizinha), poças rasas que refletem e torrões.
  const MUD_PUDDLES = [
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbwwwwbbb',
    'bbbbbbbbwwssswwb',
    'bbbbbbbbwswwwwbb',
    'bbbbbbbbbwwwbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbwwbbbbbbbbbbb',
    'bbwsswwbbbbbbbbb',
    'bbbwwwbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb'
  ];
  const MUD_LUMPS = [
    [[2, 2], [11, 11]],
    [[12, 1], [4, 7]],
    [[3, 13], [12, 8]],
    [[9, 1], [1, 9]]
  ];
  const MUD_LUMP = ['hm.', 'mmd', '.dd'];

  function paintMud(ctx, variant) {
    let map = MUD_PUDDLES;
    if (variant & 1) map = flipH(map);
    if (variant & 2) map = map.slice().reverse();
    draw(ctx, map, { b: MUD.base, w: MUD.wet, s: MUD.sheen });
    const r = rng(77 + variant * 13);
    for (let i = 0; i < 26; i++) { // textura de terra: manchas escuras e claras
      const x = Math.floor(r() * TILE), y = Math.floor(r() * TILE);
      if (map[y][x] !== 'b') continue;
      px(ctx, x, y, r() < 0.6 ? MUD.dark : MUD.mid);
    }
    for (const [x, y] of MUD_LUMPS[variant % 4]) draw(ctx, MUD_LUMP, { h: MUD.hi, m: MUD.mid, d: MUD.dark }, x, y);
    // pedrinha meio afundada
    draw(ctx, ['hg', 'gl'], { h: STONE.hi, g: STONE.base, l: STONE.lo }, (5 + variant * 4) % 13, (3 + variant * 5) % 13);
  }

  // Água '~': poço escuro de masmorra; ondulações escuras + cristas claras que "respiram" (emenda e faz loop).
  const WATER_BASE = [
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'ddbbbbbbbbbbbddd',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbddddbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbddddb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbb'
  ];
  const WATER_CRESTS = [[1, 1, 0], [8, 5, 0.33], [3, 9, 0.66], [10, 13, 0.15]];
  const WATER_GLINTS = [[13, 2, 0.1], [6, 12, 0.6]];

  function paintWater(ctx, phase) {
    draw(ctx, WATER_BASE, { b: WATER.base, d: WATER.deep });
    const put = (x, y, c) => px(ctx, ((x % TILE) + TILE) % TILE, ((y % TILE) + TILE) % TILE, c);
    for (const [x, y, ph] of WATER_CRESTS) {
      const t = (phase + ph) % 1;
      if (t < 0.25) {
        put(x + 1, y + 1, WATER.mid); put(x + 2, y + 1, WATER.mid);
      } else if (t < 0.5) {
        put(x + 1, y, WATER.hi); put(x + 2, y, WATER.hi);
        put(x, y + 1, WATER.mid); put(x + 3, y + 1, WATER.hi); put(x + 4, y + 1, WATER.mid);
        put(x + 1, y - 1, WATER.foam);
      } else if (t < 0.75) {
        put(x + 2, y, WATER.hi); put(x + 3, y, WATER.foam);
        put(x + 1, y + 1, WATER.mid); put(x + 4, y + 1, WATER.hi); put(x + 5, y + 1, WATER.mid);
      } else {
        put(x + 4, y + 1, WATER.mid); put(x + 5, y + 1, WATER.mid);
      }
    }
    for (const [x, y, ph] of WATER_GLINTS) {
      const t = (phase + ph) % 1;
      if (t < 0.2) put(x, y, WATER.glint);
      else if (t < 0.4) put(x, y, WATER.foam);
    }
  }

  /** Quadros da animação da água (TILE×TILE cada; emendam lado a lado e fazem loop). */
  function waterFrames(n) {
    n = Math.max(1, Math.round(n || 4));
    return cached('water:' + n, () => {
      const frames = [];
      for (let i = 0; i < n; i++) frames.push(canvas(TILE, TILE, (ctx) => paintWater(ctx, i / n)));
      return frames;
    });
  }

  // Bônus '+': monte de moedas de ouro no chão (o objeto 3D fica por cima; isto vale para legenda/2D).
  // k contorno, d sombra, m ouro, l luz, w brilho, r rubi, R rubi claro.
  const COINS_MAP = [
    '................',
    '................',
    '........kkk.....',
    '.......kwllk....',
    '.....kkkmmdkk...',
    '....kwllkddkllk.',
    '...kkkmmdkkmmdk.',
    '..kwllkddklllk..',
    '..klmmmkkmmmmdk.',
    '.kwllkmmmdkrRdk.',
    '.klmmdkddkkrrdk.',
    '.kmmmmmkkllkdk..',
    '..kddddkmmmmdk..',
    '...kkkk.kddddk..',
    '.........kkkk...',
    '................'
  ];

  // Fonte '*': bacia de pedra redonda com água dourada mágica e bica no centro.
  const FOUNTAIN_MAP = [
    '................',
    '.....hhhhhh.....',
    '...hhrrrrrrhh...',
    '..hrrqqqqqqrrd..',
    '..hrqwwwwwwwqd..',
    '.hrqwwccwwwwwrd.',
    '.hrqwcwwwwccwrd.',
    '.hrqwwwyyywwwrd.',
    '.hrqwwwyGywwwrd.',
    '.hrqwcwyyywcwrd.',
    '.hrqwwcwwwwwwrd.',
    '..hrqwwwwccwrd..',
    '..hrrwwwwwwrrd..',
    '...hrrrrrrrrd...',
    '.....dddddd.....',
    '................'
  ];

  // Início 'S': placa de pressão de pedra com os anéis da marca CESAR entalhados e brilhando em laranja.
  const START_MAP = [
    '.....nnnnnn.....',
    '...nnOOnnOOnn...',
    '..nOOOOnnOOOOn..',
    '.nOOOOOnnOOOOOn.',
    '.nOOOnnnnnnOOOn.',
    'nOOOnnonnonnOOOn',
    'nOOOnoonnoonOOOn',
    'nOOnnonnnnonnOOn',
    'nOOnnonnnnonnOOn',
    'nOOOnoonnoonOOOn',
    'nOOOnnoooonnOOOn',
    '.nOOOnnnnnnOOOn.',
    '.nOOOOOnnOOOOOn.',
    '..nOOOOOOOOOOn..',
    '...nnOOOOOOnn...',
    '.....nnnnnn.....'
  ];
  const START_SHADE = [
    '................',
    '.....ll..ll.....',
    '...ll......l....',
    '..l.........x...',
    '..l..........x..',
    '.l....l........x',
    '.l.............x',
    '.l...........x.x',
    '.l...........x.x',
    '.l.............x',
    '..........x....x',
    '..............x.',
    '..x..........x..',
    '...xxxxxxxxxxx..',
    '................',
    '................'
  ];

  /** Placa de pressão: laje rebaixada em volta (sulco), placa quadrada clara e os anéis entalhados. */
  function paintStart(ctx) {
    paintSlab(ctx, 0, STONE);
    const P = { edge: '#2A241F', lo: '#4E463E', base: '#655B50', hi: '#8A7E6E' };
    rect(ctx, 0, 0, TILE - 1, TILE - 1, P.edge);              // sulco
    rect(ctx, 1, 1, TILE - 3, TILE - 3, P.base);              // placa
    rect(ctx, 1, 1, TILE - 3, 1, P.hi);
    rect(ctx, 1, 2, 1, TILE - 4, mix(P.base, P.hi, 0.5));
    rect(ctx, 2, TILE - 3, TILE - 4, 1, P.lo);
    rect(ctx, TILE - 3, 2, 1, TILE - 4, P.lo);
    // anéis: entalhe (n) mais escuro que a placa, brasa laranja dentro
    const ring = START_MAP.map((row) => row.replace(/n/g, '.'));
    const glow = mix(PALETTE.cesar, '#FFB347', 0.25);
    draw(ctx, ring, { O: PALETTE.cesar, o: glow });
    draw(ctx, START_SHADE, { l: '#FF9A4D', x: PALETTE.cesarEscuro });
  }

  /** Saída 'G': estrado de pedra octogonal com friso de ouro, onde fica o baú do tesouro. */
  function paintDais(ctx) {
    paintSlab(ctx, 2, STONE);
    const map = [
      '................',
      '....kkkkkkkk....',
      '...kyYYYYYYyk...',
      '..kyhhhhhhhhyk..',
      '.kyhssssssssdyk.',
      '.kYhsmmmmmmsdYk.',
      '.kYhsmmmmmmsdYk.',
      '.kYhsmmmmmmsdYk.',
      '.kYhsmmmmmmsdYk.',
      '.kYhsmmmmmmsdYk.',
      '.kYhsmmmmmmsdYk.',
      '.kyhsssssssddyk.',
      '..kyddddddddyk..',
      '...kyyyyyyyyk...',
      '....kkkkkkkk....',
      '................'
    ];
    draw(ctx, map, {
      k: '#231D18', y: GOLD.lo, Y: GOLD.base, h: CAP.hi, s: CAP.base, m: CAP.lo, d: CAP.edge
    });
    // brilho no friso
    px(ctx, 5, 2, GOLD.hi); px(ctx, 2, 5, GOLD.hi);
  }

  // Chave (máscara 10×5): argola à esquerda, haste e dois dentes.
  const KEY_MASK = [
    '.##.......',
    '#..#######',
    '#..#######',
    '.##....#.#',
    '.......#..'
  ];
  // Disco discreto sob a chave (o "pedestal" onde ela flutua).
  const KEY_DISC = [
    '................',
    '................',
    '.....tttttt.....',
    '...tttttttttt...',
    '..tttttttttttt..',
    '..tttttttttttt..',
    '.tttttttttttttu.',
    '.tttttttttttttu.',
    '.tttttttttttttu.',
    '.tttttttttttttu.',
    '..ttttttttttttu.',
    '..tttttttttttu..',
    '...ttttttttuu...',
    '.....uuuuuu.....',
    '................',
    '................'
  ];

  /** Piso com uma chave entalhada na pedra, tingida com a cor da chave. */
  function paintKeyFloor(ctx, letter, variant) {
    paintSlab(ctx, variant === 1 ? 0 : variant, STONE);
    const col = keyColor(letter);
    draw(ctx, KEY_DISC, { t: mix(STONE.base, col, 0.12), u: mix(STONE.lo, col, 0.25) });
    const glyph = shadeMask(KEY_MASK, false);
    draw(ctx, glyph, {
      l: mix(STONE.base, col, 0.62),
      m: mix(STONE.base, col, 0.48),
      d: mix(STONE.lo, col, 0.36)
    }, 3, 6);
  }

  /** Soleira da porta: degrau de pedra gasto com frisos na cor da chave e a sombra das folhas. */
  function paintDoorFloor(ctx, letter) {
    paintSlab(ctx, -1, STONE);
    const r = keyRamp(letter);
    const map = [
      '................',
      '.kkkkkkkkkkkkkk.',
      '.kllllllllllllk.',
      '.klsssssssssmdk.',
      '.klshhhhhhhhmdk.',
      '.klsh......smdk.',
      '.klsh......smdk.',
      '.klsh......smdk.',
      '.klsh......smdk.',
      '.klsh......smdk.',
      '.klsh......smdk.',
      '.klssssssssssdk.',
      '.klmmmmmmmmmmdk.',
      '.kddddddddddddk.',
      '.kkkkkkkkkkkkkk.',
      '................'
    ];
    draw(ctx, map, { k: r.k, l: r.l, m: r.m, d: r.d, s: STONE.lo, h: STONE.pit });
    // degrau central gasto (pedra mais clara, polida pelos passos)
    rect(ctx, 5, 5, 6, 6, CAP.lo);
    rect(ctx, 5, 5, 6, 1, CAP.base);
    px(ctx, 7, 7, CAP.pit); px(ctx, 9, 8, CAP.pit);
  }

  // Esteira: chevron apontando para leste (desenhado uma vez e girado para as outras direções).
  const CHEVRON_EAST = [
    '##......',
    '.##.....',
    '..##....',
    '...##...',
    '...##...',
    '..##....',
    '.##.....',
    '##......'
  ];
  /**
   * Trilho de pedra para '>' / '<' / '^' / 'v': trilhos de ferro rebitados nas laterais e placas de pedra
   * deslizantes de 8 texels (2 por tile, juntas escuras) com uma runa de seta clara entalhada → a textura
   * rola sem emenda ao longo do eixo da seta.
   */
  function paintConveyor(ctx, dir) {
    const horizontal = dir === '>' || dir === '<';
    rect(ctx, 0, 0, TILE, TILE, BELT.belt);
    // placas: junta escura a cada 8 texels + aresta de luz do lado de lá da junta
    for (let k = 0; k < TILE; k += 8) {
      if (horizontal) {
        rect(ctx, k + 7, 2, 1, 12, BELT.slat); rect(ctx, k, 2, 1, 12, BELT.beltHi);
        px(ctx, k + 3, 4, BELT.slat); px(ctx, k + 5, 12, BELT.slat); // poros
      } else {
        rect(ctx, 2, k + 7, 12, 1, BELT.slat); rect(ctx, 2, k, 12, 1, BELT.beltHi);
        px(ctx, 4, k + 3, BELT.slat); px(ctx, 12, k + 5, BELT.slat);
      }
    }
    if (horizontal) { // trilhos de ferro em cima/embaixo, rebites a cada 8 texels
      rect(ctx, 0, 0, TILE, 1, BELT.rail2); rect(ctx, 0, 1, TILE, 1, BELT.rail1);
      rect(ctx, 0, 2, TILE, 1, BELT.slat);
      rect(ctx, 0, 14, TILE, 1, BELT.rail1); rect(ctx, 0, 15, TILE, 1, BELT.rail0);
      for (let k = 3; k < TILE; k += 8) { px(ctx, k, 1, BELT.rivet); px(ctx, k, 14, BELT.rail2); }
    } else {
      rect(ctx, 0, 0, 1, TILE, BELT.rail2); rect(ctx, 1, 0, 1, TILE, BELT.rail1);
      rect(ctx, 2, 0, 1, TILE, BELT.slat);
      rect(ctx, 14, 0, 1, TILE, BELT.rail1); rect(ctx, 15, 0, 1, TILE, BELT.rail0);
      for (let k = 3; k < TILE; k += 8) { px(ctx, 1, k, BELT.rivet); px(ctx, 14, k, BELT.rail2); }
    }
    let mask = CHEVRON_EAST;
    const turns = { '>': 0, 'v': 1, '<': 2, '^': 3 }[dir] || 0;
    for (let t = 0; t < turns; t++) mask = rotateCW(mask);
    const shaded = shadeMask(mask, false);
    const groove = mask.map((row) => row.replace(/#/g, 's'));
    for (let k = 0; k < 2; k++) {
      const x = horizontal ? k * 8 + 0 : 4, y = horizontal ? 4 : k * 8 + 0;
      draw(ctx, groove, { s: BELT.rune }, x + 1, y + 1); // sulco da runa
      draw(ctx, shaded, { l: BELT.chev, m: BELT.chev, d: BELT.chevLo }, x, y);
    }
  }

  /** Textura de piso TILE×TILE para um símbolo da grade (ver SPEC §5.1). Cacheada. */
  function tileTexture(ch, variant) {
    variant = Math.abs(Math.round(variant || 0)) % 4;
    ch = String(ch || '.');
    return cached('tile:' + ch + ':' + variant, () => canvas(TILE, TILE, (ctx) => {
      switch (ch) {
        case ',': paintMud(ctx, variant); break;
        case '~': paintWater(ctx, 0); break;
        case '+':
          paintSlab(ctx, variant === 3 ? 0 : variant, STONE);
          draw(ctx, COINS_MAP, { k: GOLD.dark, d: GOLD.lo, m: GOLD.base, l: mix(GOLD.base, GOLD.hi, 0.5), w: GOLD.white, r: '#B3243A', R: '#FF6A7E' });
          break;
        case '*':
          paintSlab(ctx, -1, STONE);
          draw(ctx, FOUNTAIN_MAP, {
            h: CAP.hi, r: CAP.base, d: CAP.edge, q: GOLD.lo, w: GOLD.base,
            c: GOLD.hi, y: GOLD.hi, G: GOLD.white
          });
          break;
        case 'S': paintStart(ctx); break;
        case 'G': paintDais(ctx); break;
        case '^': case '>': case 'v': case '<':
          paintConveyor(ctx, ch);
          break;
        default:
          if (KEY_LETTERS.indexOf(ch) >= 0) paintKeyFloor(ctx, ch, variant);
          else if (KEY_LETTERS.indexOf(ch.toLowerCase()) >= 0) paintDoorFloor(ctx, ch);
          else paintSlab(ctx, variant, STONE); // '.', e qualquer símbolo desconhecido
      }
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // [IA] Claude – Paredes e portas da dungeon (rodada 2): blocos rústicos de pedra cinza-amarronzada
  // (alguns rachados/com musgo), capa superior mais clara e gasta, porta de madeira com cintas de ferro.
  // ---------------------------------------------------------------------------------------------
  // Fiadas da face lateral (16×20): capa nas linhas 0–2; depois blocos; linha 19 = oclusão com o chão.
  // [y, altura incluindo a junta de baixo]
  const WALL_ROWS = [[3, 5], [8, 4], [12, 5], [17, 2]];
  // Juntas verticais por variação e por fiada (colunas de argamassa; os blocos "dão a volta" no tile).
  const WALL_JOINTS = [
    [[5, 12], [1, 9], [6, 13], [3, 10]],
    [[3, 11], [7, 14], [2, 9], [6, 12]],
    [[6, 14], [2, 10], [5, 12], [0, 8]],
    [[4, 10], [0, 7, 13], [4, 11], [2, 9]],
    [[5, 12], [1, 9], [6, 13], [3, 10]]
  ];

  function paintWallSide(ctx, variant) {
    const R = WALLSTONE;
    const r = rng(500 + variant * 37);
    rect(ctx, 0, 0, TILE, WALL_H, R.mortar);
    WALL_ROWS.forEach(([y0, h], row) => {
      const joints = WALL_JOINTS[variant][row];
      const ih = h - 1; // a última linha da fiada é argamassa
      // tom por bloco (bloco k = entre joints[k] e joints[k+1], dando a volta)
      const tones = joints.map(() => R.tones[Math.floor(r() * R.tones.length)]);
      for (let x = 0; x < TILE; x++) {
        if (joints.indexOf(x) >= 0) continue; // junta vertical
        // bloco a que x pertence: último joint <= x (ou o último da lista, dando a volta)
        let k = -1;
        for (let j = 0; j < joints.length; j++) if (joints[j] < x) k = j;
        if (k < 0) k = joints.length - 1;
        const tone = tones[k];
        const left = joints.indexOf((x - 1 + TILE) % TILE) >= 0;
        const right = joints.indexOf((x + 1) % TILE) >= 0;
        for (let yy = 0; yy < ih; yy++) {
          let c = tone;
          if (yy === 0) c = mix(tone, R.hi, 0.5);
          else if (yy === ih - 1) c = mix(tone, R.lo, 0.6);
          else if (left) c = mix(tone, R.hi, 0.25);
          else if (right) c = mix(tone, R.lo, 0.45);
          else { const v = r(); if (v < 0.07) c = R.pit; else if (v < 0.11) c = R.grain; }
          px(ctx, x, y0 + yy, c);
        }
        // cantos arredondados (lasca escura na quina de baixo/direita)
        if (right) px(ctx, x, y0 + ih - 1, R.lo);
      }
    });
    // capa (continuação da face de cima): borda gasta clara + lábio que projeta sombra
    rect(ctx, 0, 0, TILE, 1, CAP.hi);
    rect(ctx, 0, 1, TILE, 1, CAP.base);
    rect(ctx, 0, 2, TILE, 1, '#2C2621');
    for (let x = 0; x < TILE; x++) { // desgaste
      const v = r();
      if (v < 0.2) px(ctx, x, 0, CAP.base);
      else if (v < 0.3) px(ctx, x, 1, CAP.lo);
    }
    rect(ctx, 0, WALL_H - 1, TILE, 1, '#15110E'); // oclusão onde a parede encontra o chão
    if (variant === 1) { // bloco rachado
      draw(ctx, ['..m.', '.m..', '.mm.', 'm...'], { m: R.mortar }, 8, 12);
      draw(ctx, ['m.', '.m'], { m: R.mortar }, 3, 5);
    } else if (variant === 2) { // musgo escorrendo da capa e tufo na base
      draw(ctx, [
        'mMMmm..mMm..mMMm',
        '.mMm....m....mm.',
        '..m..........m..',
        '..m.............'
      ], { m: MOSS.dark, M: MOSS.base }, 0, 2);
      draw(ctx, ['..h...', '.hMm.h', 'mMMmMM'], { h: MOSS.hi, M: MOSS.base, m: MOSS.dark }, 9, 16);
    } else if (variant === 3) { // bloco faltando: buraco escuro com borda de baixo iluminada
      draw(ctx, ['kkkkkk', 'kkkkkk', 'kddddd'], { k: '#15110E', d: R.lo }, 7, 8);
      px(ctx, 8, 9, '#3A2E26');
    } else if (variant === 4) { // seteira gradeada (janela pequena com barras de ferro)
      draw(ctx, [
        '.kkkkkk.',
        'kdIdIddk',
        'kdIdIddk',
        'kdIdIddk',
        'kdIdIddk',
        '.hhhhhh.'
      ], { k: '#15110E', d: '#0E0B09', I: IRON.hi, h: R.hi }, 4, 7);
    }
  }

  function paintWallTop(ctx, variant) {
    const layouts = [
      [[0, 0, 9, 16], [9, 0, 7, 8], [9, 8, 7, 8]],
      [[0, 0, 16, 7], [0, 7, 6, 9], [6, 7, 10, 9]],
      [[0, 0, 6, 10], [6, 0, 10, 10], [0, 10, 16, 6]],
      [[0, 0, 16, 16]]
    ];
    paintStones(ctx, layouts[variant % 4], CAP, 200 + variant * 9);
    if (variant === 2) draw(ctx, ['.m', 'mM'], { m: MOSS.dark, M: MOSS.base }, 5, 9);
  }

  /**
   * Face de parede: 'top' (TILE×TILE, capa clara) ou 'side' (TILE×20, blocos de pedra). variant 0..3;
   * para 'side', variant 4 = seteira gradeada (use com parcimônia, ex.: 1 em cada ~15 paredes).
   */
  function wallTexture(face, variant) {
    const side = face !== 'top';
    variant = Math.abs(Math.round(variant || 0));
    variant = side && variant === 4 ? 4 : variant % 4;
    return cached('wall:' + (side ? 'side' : 'top') + ':' + variant, () =>
      canvas(TILE, side ? WALL_H : TILE, (ctx) => (side ? paintWallSide(ctx, variant) : paintWallTop(ctx, variant))));
  }

  /**
   * Porta (frente, 16×20): 4 tábuas de madeira, duas cintas de ferro rebitadas, plaqueta na cor da chave e
   * cadeado na cor da chave. opts.lock === false: sem cadeado pintado (o voxel.js põe um cadeado 3D por cima e
   * divide a porta em duas folhas na junta do meio) — fica só o ferrolho com a plaqueta colorida.
   */
  function doorTexture(letter, opts) {
    const L = String(letter || 'A').toUpperCase();
    const withLock = !(opts && opts.lock === false);
    return cached('door:' + L + (withLock ? '' : ':semCadeado'), () => canvas(TILE, WALL_H, (ctx) => {
      const r = keyRamp(L);
      const W = WOOD, I = IRON;
      const planks = [W.base, W.mid, W.lo, W.mid];
      const rr = rng(900 + L.charCodeAt(0));
      for (let p = 0; p < 4; p++) {
        const x0 = p * 4;
        rect(ctx, x0, 0, 4, WALL_H, planks[p]);
        rect(ctx, x0, 0, 1, WALL_H, mix(planks[p], W.hi, 0.35));      // luz na borda da tábua
        rect(ctx, x0 + 3, 0, 1, WALL_H, W.dark);                       // fresta entre tábuas
        for (let y = 1; y < WALL_H - 1; y++) if (rr() < 0.18) px(ctx, x0 + 1 + Math.floor(rr() * 2), y, W.grain);
      }
      px(ctx, 6, 16, W.dark); px(ctx, 6, 17, W.grain); // nó da madeira
      // moldura escura
      rect(ctx, 0, 0, TILE, 1, W.dark); rect(ctx, 0, WALL_H - 1, TILE, 1, '#15110E');
      rect(ctx, 0, 0, 1, WALL_H, W.dark); rect(ctx, TILE - 1, 0, 1, WALL_H, W.dark);
      // cintas de ferro com rebites
      [3, 15].forEach((y) => {
        rect(ctx, 0, y, TILE, 2, I.base);
        rect(ctx, 0, y, TILE, 1, I.hi);
        rect(ctx, 0, y + 2, TILE, 1, I.dark);
        [2, 6, 9, 13].forEach((x) => px(ctx, x, y, I.rivet));
      });
      if (withLock) {
        // ferrolho de ferro + cadeado grande na cor da chave (alça de ferro, corpo colorido, buraco escuro)
        rect(ctx, 2, 10, 12, 2, I.base); rect(ctx, 2, 10, 12, 1, I.hi); rect(ctx, 2, 12, 12, 1, I.dark);
        draw(ctx, [
          '..sss..',
          '.s...s.',
          '.s...s.',
          'kkkkkkk',
          'kllllmk',
          'klmkmdk',
          'klmkmdk',
          'kmmmmdk',
          'kdddddk',
          '.kkkkk.'
        ], { s: I.rivet, k: r.k, l: r.w, m: r.m, d: r.d }, 5, 7);
      } else {
        // plaqueta colorida no alto + ferrolho atravessando a junta do meio, com chapa na cor da chave
        draw(ctx, ['kkkkkk', 'klmmmk', 'kmmmdk', 'kkkkkk'], { k: r.k, l: r.w, m: r.m, d: r.d }, 5, 6);
        rect(ctx, 3, 11, 10, 2, I.base); rect(ctx, 3, 11, 10, 1, I.hi); rect(ctx, 3, 13, 10, 1, I.dark);
        draw(ctx, ['kmmk', 'kddk'], { k: r.k, m: r.m, d: r.d }, 6, 11);
      }
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // Ícone de chave (HUD)
  // ---------------------------------------------------------------------------------------------
  /**
   * Ícone de chave 12×7 (art px) na cor da chave. opts.empty = silhueta apagada (slot vazio do inventário).
   */
  function keyIcon(letter, scale, opts) {
    scale = Math.max(1, Math.round(scale || 3)); // escala inteira: pixels nítidos mesmo com DPR fracionário
    opts = opts || {};
    const rows = shadeMask(KEY_MASK, true);
    const r = keyRamp(letter);
    const colors = opts.empty
      ? { k: PALETTE.noite3, l: PALETTE.noite2, m: PALETTE.noite2, d: PALETTE.noite2 }
      : { k: r.k, l: r.l, m: r.m, d: r.d };
    return canvas(rows[0].length * scale, rows.length * scale, (ctx) => {
      draw(ctx, rows, colors, 0, 0, scale);
      if (!opts.empty) { // brilho no topo da argola
        ctx.fillStyle = r.w;
        ctx.fillRect(2 * scale, 1 * scale, scale, scale);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // O aluno da CESAR School (sprite 2D, 16×24). Também é a referência de cores do personagem voxel.
  // Cabelo cacheado escuro, pele marrom, óculos redondos, moletom carvão com a marca CESAR laranja no
  // peito, cordões laranja, fone de ouvido no pescoço, mochila azul, jeans e tênis brancos.
  // ---------------------------------------------------------------------------------------------
  const STUDENT_COLORS = {
    k: '#1A1626', // contorno
    h: '#2E1F26', // cabelo cacheado
    H: '#4D3541', // brilho dos cachos
    s: '#A86A4A', // pele
    S: '#865039', // pele na sombra
    r: '#B85F57', // bochecha corada
    n: '#5A2C2A', // boca
    g: '#16121F', // armação dos óculos
    L: '#BFE4FF', // reflexo da lente
    e: '#120F1C', // olho
    c: '#2A2838', // moletom (carvão)
    C: '#1E1C2B', // moletom na sombra
    m: '#3D3A54', // moletom iluminado
    O: '#FF6002', // marca CESAR
    d: '#FFA25E', // ponta dos cordões (laranja claro)
    p: '#E6E4F4', // fone de ouvido
    P: '#9F9CC2', // fone na sombra
    b: '#3D5AA3', // mochila / alças
    B: '#2A3F7A', // mochila na sombra
    j: '#4566AA', // jeans
    J: '#2F4A86', // jeans na sombra
    i: '#6386C8', // jeans iluminado
    w: '#F4F3FA', // tênis
    W: '#B5B3CC'  // solado / sombra do tênis
  };
  // Nomes descritivos (o personagem voxel reaproveita a mesma paleta).
  const STUDENT_NAMED = {
    outline: STUDENT_COLORS.k,
    hair: STUDENT_COLORS.h, hairLight: STUDENT_COLORS.H,
    skin: STUDENT_COLORS.s, skinShadow: STUDENT_COLORS.S, blush: STUDENT_COLORS.r, mouth: STUDENT_COLORS.n,
    glasses: STUDENT_COLORS.g, lens: STUDENT_COLORS.L, eye: STUDENT_COLORS.e,
    hoodie: STUDENT_COLORS.c, hoodieShadow: STUDENT_COLORS.C, hoodieLight: STUDENT_COLORS.m,
    logo: STUDENT_COLORS.O, drawstring: STUDENT_COLORS.O, drawstringTip: STUDENT_COLORS.d,
    headphones: STUDENT_COLORS.p, headphonesShadow: STUDENT_COLORS.P,
    backpack: STUDENT_COLORS.b, backpackShadow: STUDENT_COLORS.B, strap: STUDENT_COLORS.b,
    jeans: STUDENT_COLORS.j, jeansShadow: STUDENT_COLORS.J, jeansLight: STUDENT_COLORS.i,
    sneakers: STUDENT_COLORS.w, sole: STUDENT_COLORS.W
  };

  // Cada vista = cabeça (linhas 0–12) + corpo (13–19) + pernas (20–23). Simetria da frente na coluna 7,5.
  const FRONT_HEAD = [
    '.....kkkkkk.....',
    '...kkhhHHhhkk...',
    '..khHHhkhhHHhk..',
    '.khhkhHHhhkhHhk.',
    '.kHHhhkhhHHhkhk.',
    '.khhhHhhhhhHhhk.',
    '.khSssssssssShk.',
    '.khsggssssggshk.',
    '.ksgLsggggsLgsk.',
    '.kSgsegssgesgSk.',
    '.kSsggssssggsSk.',
    '..krsssnnsssrk..',
    '...kSssssssSk...'
  ];
  const FRONT_BODY = [
    '..kPpkSSSSkpPk..', // fone no pescoço
    '.kmPPkOccOkPPck.', // gola + cordões
    '.kmcmcdccdcccCk.',
    '.kmcOOccccOOcCk.', // marca CESAR (anéis abertos, entalhe no topo)
    '.kmcOcOOOOcOcCk.',
    '.kmccOOOOOOccCk.',
    '.ksSCCCCCCCCSsk.'  // barra do moletom + mãos
  ];
  // Pernas: 0 = pé direito (da tela) levantado, 1/3 = passagem, 2 = pé esquerdo levantado.
  const FRONT_LEGS = [
    ['..kkijjjjjjJkk..', '...kijjk.kwwWk..', '..kwwwk..kWWWk..', '..kWWWk.........'],
    ['..kkijjjjjjJkk..', '...kijjkkjjJk...', '..kwwwk..kwwwk..', '..kWWWk..kWWWk..'],
    ['..kkijjjjjjJkk..', '..kwwWk.kjjJk...', '..kWWWk..kwwwk..', '.........kWWWk..'],
    ['..kkijjjjjjJkk..', '...kijjkkjjJk...', '..kwwwk..kwwwk..', '..kWWWk..kWWWk..']
  ];

  const BACK_HEAD = [
    '.....kkkkkk.....',
    '...kkhhHHhhkk...',
    '..khHHhkhhHHhk..',
    '.khhkhHHhhkhHhk.',
    '.kHHhhkhhHHhkhk.',
    '.khhhHhhkhhHhhk.',
    '.kHhhhkHHhhhkhk.',
    '.khhkhhhhHhhhhk.',
    '.kshHhhkhhhhHsk.',
    '.kShhhHhhkhhhSk.',
    '.kShkhhhhhhhhSk.',
    '..khhhHhhhhhhk..',
    '...kPppppppPk...'  // arco do fone na nuca
  ];
  const BACK_BODY = [
    '..kmmmmmmmmmmk..',
    '.kmcbmccccCbcCk.', // capuz caído + alças
    '.kmcbkCCCCkbcCk.',
    '.kmcbbkkkkbbcCk.', // mochila
    '.kmcbbbbbbbbcCk.',
    '.kmcbkBBOBkbcCk.', // bolso com puxador laranja
    '.ksSkBBBBBBkSsk.'
  ];
  // De costas, o lado da tela se inverte: o quadro 0 levanta o pé esquerdo da tela.
  const BACK_LEGS = [
    ['..kkjjjjjjjjkk..', '..kwwWk.kjijk...', '..kWWWk..kwwwk..', '.........kWWWk..'],
    ['..kkjjjjjjjjkk..', '...kjjjkkijjk...', '..kwwwk..kwwwk..', '..kWWWk..kWWWk..'],
    ['..kkjjjjjjjjkk..', '...kjjjk.kwwWk..', '..kwwwk..kWWWk..', '..kWWWk.........'],
    ['..kkjjjjjjjjkk..', '...kjjjkkijjk...', '..kwwwk..kwwwk..', '..kWWWk..kWWWk..']
  ];

  // De lado, olhando para a direita (leste).
  const SIDE_HEAD = [
    '......kkkkk.....',
    '....kkhhHHhkk...',
    '...khHhhkhHHhk..',
    '..khhkHHhhhkhhk.',
    '.khHhhhhkhHHhhk.',
    '.khhhkhHhhhHhhk.',
    '.kHhhhhhhhSsssk.',
    '.khhkhhhhsSggsk.',
    '.khhhHhsgggLegk.',
    '.khhhhhSsssggssk',
    '..khhhhSsssrssk.',
    '..khhhhkSsssnsk.',
    '...kkkkkSSsssk..'
  ];
  // Corpo de lado por pose do braço (balança ao contrário da perna da frente).
  const SIDE_BODY = {
    idle: [
      '..kbkmmmmPpk....',
      '.kbbkmcccmcOk...',
      '.kbbkcccmmcdk...',
      '.kbbkccCmccOk...',
      '.kBbkccCmcccCk..',
      '.kBBkcCmmcccCk..',
      '..kkkCCksskCCk..'
    ],
    back: [
      '..kbkmmmmPpk....',
      '.kbbkmmmccOk....',
      '.kbbkmmcccdk....',
      '.kbbkmcCccOk....',
      '.kBbmmCcccccCk..',
      '.kBBSkcccccCk...',
      '..kSskCCCCCCk...'
    ],
    fwd: [
      '..kbkmmmmPpk....',
      '.kbbkmcccmmOk...',
      '.kbbkcccccmmk...',
      '.kbbkccccCcmmk..',
      '.kBbkcccccCmmk..',
      '.kBBkccccccCssk.',
      '..kkkCCCCCCkSk..'
    ]
  };
  // Perna de perto (clara) e de longe (escura): 0 = de perto à frente, 2 = de longe à frente.
  const SIDE_LEGS = [
    ['....kjjjjjjjk...', '...kJjjk.kijjk..', '..kJjk....kijk..', '..kwwk....kwwwk.'],
    ['.....kjjjjjjk...', '.....kijjkJjk...', '.....kwwwkwwwk..', '.....kWWWkWWWk..'],
    ['....kjjjjjjjk...', '...kijjk.kJjjk..', '..kijk....kJjk..', '..kwwk....kwwwk.'],
    ['.....kjjjjjjk...', '.....kJjjkijk...', '.....kwwwkwwwk..', '.....kWWWkWWWk..']
  ];

  /** Piscada: o olho vira um traço de pele sombreada (quadro 'blink', para o idle animado de quem consome). */
  function blinkRows(rows, view) {
    const out = rows.slice();
    if (view === 'front') out[9] = '.kSgSSgssgSSgSk.';
    else if (view === 'side') out[8] = out[8].replace('e', 'S');
    return out;
  }

  /**
   * Matriz 16×24 de um quadro. view: 'front' | 'back' | 'side'.
   * frame: 'idle' (parado), 0..3 (ciclo de caminhada: contato, passagem, contato, passagem) ou 'blink'.
   */
  function studentRows(view, frame) {
    const walk = typeof frame === 'number' && isFinite(frame);
    const f = walk ? ((Math.round(frame) % 4) + 4) % 4 : 1;
    let rows;
    if (view === 'back') rows = BACK_HEAD.concat(BACK_BODY, BACK_LEGS[f]);
    else if (view === 'side') {
      const arm = !walk ? 'idle' : f === 0 ? 'back' : f === 2 ? 'fwd' : 'idle';
      rows = SIDE_HEAD.concat(SIDE_BODY[arm], SIDE_LEGS[f]);
    } else rows = FRONT_HEAD.concat(FRONT_BODY, FRONT_LEGS[f]);
    return frame === 'blink' ? blinkRows(rows, view) : rows;
  }

  /**
   * Canvas do aluno (16×24 art px × scale).
   * view: 'front' | 'back' | 'side' (olhando para a direita) | 'left' (espelhado);
   * frame: 0..3 (caminhada) | 'idle' | 'blink'.
   */
  function studentSprite(view, frame, scale) {
    view = view || 'front';
    scale = Math.max(1, Math.round(scale || 4));
    if (frame === undefined || frame === null) frame = 'idle';
    const left = view === 'left';
    let rows = studentRows(left ? 'side' : view === 'right' ? 'side' : view, frame);
    if (left) rows = flipH(rows);
    return canvas(16 * scale, 24 * scale, (ctx) => draw(ctx, rows, STUDENT_COLORS, 0, 0, scale));
  }

  /** Só a cabeça (16×13 art px) — marca do navbar, loader, favicon. */
  function studentHead(scale, view) {
    scale = Math.max(1, Math.round(scale || 2));
    const rows = view === 'side' ? SIDE_HEAD : view === 'back' ? BACK_HEAD : FRONT_HEAD;
    return canvas(16 * scale, rows.length * scale, (ctx) => draw(ctx, rows, STUDENT_COLORS, 0, 0, scale));
  }

  const STUDENT = {
    front: studentRows('front', 'idle'),
    back: studentRows('back', 'idle'),
    side: studentRows('side', 'idle'),
    colors: Object.assign({}, STUDENT_COLORS, STUDENT_NAMED),
    frames: {
      front: [0, 1, 2, 3].map((f) => studentRows('front', f)),
      back: [0, 1, 2, 3].map((f) => studentRows('back', f)),
      side: [0, 1, 2, 3].map((f) => studentRows('side', f))
    },
    width: 16,
    height: 24
  };

  // ---------------------------------------------------------------------------------------------
  // Miniatura do mapa
  // ---------------------------------------------------------------------------------------------
  // Setinhas 3×3 das esteiras na miniatura.
  const THUMB_ARROWS = {
    '>': ['#..', '.#.', '#..'],
    '<': ['..#', '.#.', '..#'],
    '^': ['...', '.#.', '#.#'],
    'v': ['#.#', '.#.', '...']
  };

  /**
   * [IA] Claude – cores da dungeon (rodada 2).
   * Miniatura vista de cima (cards de nível, base do minimapa). Cada casa (r, c) ocupa o bloco
   * [c*scale, r*scale, scale, scale]; o canvas tem C*scale × L*scale. Paredes claras com aresta de luz
   * e "pé" de tijolo quando não há parede abaixo; chaves = ponto na cor; portas = bloco na cor.
   */
  function mapThumb(grade, scale) {
    scale = Math.max(1, Math.round(scale || 4));
    const rows = (grade || []).map(String);
    const L = rows.length, C = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const T = PALETTE.tiles;
    const isWall = (r, c) => r >= 0 && r < L && (rows[r][c] || '#') === '#';
    return canvas(Math.max(1, C * scale), Math.max(1, L * scale), (ctx) => {
      rect(ctx, 0, 0, C * scale, L * scale, PALETTE.noite);
      const inner = Math.max(1, Math.round(scale * 0.5));
      const io = Math.floor((scale - inner) / 2);
      for (let r = 0; r < L; r++) {
        for (let c = 0; c < C; c++) {
          const ch = rows[r][c] || '#';
          const x = c * scale, y = r * scale;
          if (ch === '#') {
            rect(ctx, x, y, scale, scale, CAP.base);
            if (scale >= 3) {
              if (!isWall(r - 1, c)) rect(ctx, x, y, scale, 1, CAP.hi);
              if (!isWall(r + 1, c)) rect(ctx, x, y + scale - 1, scale, 1, WALLSTONE.lo);
            }
            continue;
          }
          let floor = (r + c) % 2 ? T.chao : T.chaoAlt;
          if (ch === ',') floor = T.lama;
          else if (ch === '~') floor = T.agua;
          else if (THUMB_ARROWS[ch]) floor = T.esteira;
          rect(ctx, x, y, scale, scale, floor);
          if (ch === 'S') {
            rect(ctx, x, y, scale, scale, T.inicio);
            if (scale >= 4) rect(ctx, x + io, y + io, inner, inner, PALETTE.cesarEscuro);
          } else if (ch === 'G') { // [IA] Claude – baú: madeira escura com miolo dourado
            rect(ctx, x, y, scale, scale, T.saida);
            if (scale >= 4) {
              rect(ctx, x + io, y + io, inner, inner, WOOD.lo);
              rect(ctx, x + io, y + io, inner, 1, GOLD.hi);
            }
          } else if (ch === '+') rect(ctx, x + io, y + io, inner, inner, T.bonus);
          else if (ch === '*') rect(ctx, x + io, y + io, inner, inner, T.fonte);
          else if (KEY_LETTERS.indexOf(ch) >= 0) rect(ctx, x + io, y + io, inner, inner, keyColor(ch));
          else if (KEY_LETTERS.indexOf(ch.toLowerCase()) >= 0) {
            rect(ctx, x, y, scale, scale, keyColor(ch));
            if (scale >= 4) rect(ctx, x + io, y + io, inner, inner, keyRamp(ch).k);
          } else if (THUMB_ARROWS[ch] && scale >= 3) {
            const o = Math.floor((scale - 3) / 2);
            draw(ctx, THUMB_ARROWS[ch], { '#': BELT.chev }, x + o, y + o);
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Cor do rastro (SPEC §3): sem chaves → luar; senão, a cor da chave coletada mais recentemente.
  // ---------------------------------------------------------------------------------------------
  function pathColor(chaves, lastKey) {
    const held = String(chaves == null ? '' : chaves).replace(/[^a-d]/gi, '').toLowerCase();
    if (!held) return PALETTE.luar;
    const k = String(lastKey || '').toLowerCase();
    if (PALETTE.chave[k]) return PALETTE.chave[k];
    return PALETTE.chave[held[held.length - 1]] || PALETTE.luar;
  }

  // ---------------------------------------------------------------------------------------------
  LAB.pixel = {
    PALETTE,
    TILE,
    WALL_H,
    LOGO,
    STUDENT,
    draw,
    canvas,
    tileTexture,
    wallTexture,
    doorTexture,
    waterFrames,
    keyIcon,
    studentSprite,
    studentHead,
    mapThumb,
    pathColor,
    // extras (fora do contrato, úteis para quem consome)
    mix,
    keyColor,
    keyRamp,
    logoCanvas,
    pixelText,
    flipH,
    shadeMask
  };
})();
