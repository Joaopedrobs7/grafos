/* [IA] Claude – maze3d.js: motor 3D do labirinto (LAB.Maze3D, SPEC §5.3).
   Diorama em pixel art 3D com Three.js r159 (global THREE, sem build): render em baixa resolução ampliado com
   nearest-neighbour, luar com sombras, lajes e paredes instanciadas (atlas de texturas do LAB.pixel), água afundada
   e animada, lama, esteiras rolando, chaves/portas/bônus/fonte/saída do LAB.voxel e o aluno da CESAR School
   percorrendo o caminho calculado pelo algoritmo. Também cuida das câmeras, da intro "construção" (onda a partir de S) e do
   modo vitrine (hero). */
(function () {
  'use strict';

  const LAB = (window.LAB = window.LAB || {});
  const THREE = window.THREE;

  // Sem Three.js o app.js cai no renderizador 2D: expomos só um supported() que responde false.
  if (!THREE) {
    const Indisponivel = function () { throw new Error('LAB.Maze3D: Three.js não carregado'); };
    Indisponivel.supported = function () { return false; };
    LAB.Maze3D = Indisponivel;
    return;
  }

  // ------------------------------------------------------------------ constantes do mundo (SPEC §5)
  const WALL_H = 1.25;     // altura de paredes e portas
  const SLAB_H = 0.3;      // espessura da laje de cada casa
  const BASE_H = 1.15;     // bloco de terra embaixo do diorama
  const WATER_Y = -0.1;    // superfície da água (afundada em relação ao chão)
  const WADE = 0.3;        // quanto o aluno afunda na água
  const GROUND_Y = -3.4;   // "papel quadriculado" noturno lá embaixo
  const FOV = 35;
  const DEG = Math.PI / 180;
  const PITCH_MIN = 25 * DEG, PITCH_MAX = 85 * DEG, PITCH_TOPO = 89 * DEG;
  const YAW0 = -35 * DEG, PITCH0 = 52 * DEG, FOLLOW_DIST = 9.5, FOLLOW_OMEGA = 6;
  // [IA] Claude – fix rodada 2: no "Seguir" a câmera fica mais baixa e mais perto, para o rosto do aluno entrar no quadro
  const PITCH_SEGUIR = 42 * DEG, DIST_SEGUIR = 8.2;
  const VITRINE_ZOOM = 0.5;    // distância da vitrine (hero) depois da intro, em fração do enquadramento do mapa inteiro
  const PITCH_LIVRE = 60 * DEG, PITCH_VITRINE = 50 * DEG;   // visões gerais um pouco mais altas: corredores legíveis
  const CUT_H = 0.3;       // altura relativa das paredes "cortadas" na frente do aluno
  const MOVES = { N: [-1, 0], L: [0, 1], S: [1, 0], O: [0, -1] };
  const CONVEYOR = { '^': 'N', '>': 'L', 'v': 'S', '<': 'O' };
  const KEYS = 'abcd', DOORS = 'ABCD';
  const MINUS = '\u2212';
  // [IA] Claude – Floreios: [duração nominal da animação no LAB.voxel, alvo no motor em 1× = 3 passos/s] (s).
  // Em velocidades lentas (< 3 passos/s) o alvo cresce até a duração nominal (floreio inteiro, sem acelerar);
  // acima de 8 passos/s o alvo encurta e a partir de 16 o floreio é pulado (ver _flourishWant()).
  const FLOURISH = {
    insertKey: [0.78, 0.45], open: [0.78, 0.7], raiseKey: [0.78, 0.5], collectKey: [0.42, 0.5],
    collectBonus: [0.45, 0.4], celebrate: [1.35, 1.15]
  };
  const SPEED_MIN = 0.25, SPEED_MAX = 30;
  const CHEST_STOP = 0.1;   // [IA] Claude – fração do último passo andada até o baú: para ~0,9 casa antes dele (fix rodada 2: com 0,4 a tampa e as laterais atravessavam o aluno)
  const MAX_TORCH_LIGHTS = 6;

  // [IA] Claude – paleta de reserva (tema dungeon, UPDATE 5) para quando LAB.pixel ainda não carregou ou ainda
  // traz a paleta roxa da rodada 1 (detectada pelo hex antigo de "noite").
  const LEGACY_NOITE = '#17142e';
  const FALLBACK = {
    noite: '#1A1612', noite2: '#26201A', noite3: '#3A3028', luar: '#F1E6D3', luarFraco: '#B9A68C',
    cesar: '#FF6002', cesarEscuro: '#DD4012', ok: '#3FCF8E', erro: '#FF5470', tocha: '#FFB347',
    chave: { a: '#FFC23A', b: '#35C8F0', c: '#F45BC8', d: '#7DDB45' },
    tiles: { chao: '#5A5148', chaoAlt: '#655B50', parede: '#6B6158', paredeTopo: '#8A7F72', lama: '#4E3A2A',
      agua: '#1F3F55', aguaClara: '#5FA8C8', bonus: '#E8B53A', fonte: '#FFC23A', esteira: '#4A4540',
      inicio: '#FF6002', saida: '#E8B53A' }
  };
  function pal() {
    const p = LAB.pixel && LAB.pixel.PALETTE;
    if (!p) return FALLBACK;
    const legacy = String(p.noite || '').toLowerCase() === LEGACY_NOITE;
    const base = legacy ? { chave: p.chave } : p;   // paleta antiga: só as cores das chaves continuam valendo
    return Object.assign({}, FALLBACK, base, { chave: Object.assign({}, FALLBACK.chave, p.chave), tiles: Object.assign({}, FALLBACK.tiles, legacy ? {} : p.tiles) });
  }

  // ------------------------------------------------------------------ utilitários
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const linear = (t) => t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInQuad = (t) => t * t;
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeOutBounce = (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  };
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hash2(r, c) {
    let h = (Math.imul(r + 1, 374761393) + Math.imul(c + 1, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  function hexToRgb(h) { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mixHex(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return '#' + x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('');
  }
  // Mola criticamente amortecida (Euler implícito, estável para qualquer dt).
  function springTo(st, target, omega, dt) {
    const f = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo, inv = 1 / (f + hhoo);
    const x = (f * st.x + dt * st.v + hhoo * target) * inv;
    st.v = (st.v + hoo * (target - st.x)) * inv;
    st.x = x;
  }
  function fmtCusto(v) { return (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v); }
  function dirBetween(a, b) {
    const dr = b.linha - a.linha, dc = b.coluna - a.coluna;
    if (Math.abs(dr) >= Math.abs(dc)) return dr < 0 ? 'N' : 'S';
    return dc > 0 ? 'L' : 'O';
  }

  // ------------------------------------------------------------------ texturas
  function makeCanvas(w, h, paint) {
    if (LAB.pixel && typeof LAB.pixel.canvas === 'function') return LAB.pixel.canvas(w, h, paint);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; if (paint) paint(ctx);
    return c;
  }
  function canvasTexture(canvas, opts) {
    opts = opts || {};
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = opts.mip ? (opts.smoothMip ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter) : THREE.NearestFilter;
    t.generateMipmaps = !!opts.mip;
    if (opts.repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = opts.repeatY === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; }
    return t;
  }
  // Pequeno pintor de reserva caso LAB.pixel não exista (cor chapada + marca central na cor do símbolo).
  function fallbackTile(ch) {
    const P = pal(), T = P.tiles;
    const base = ch === ',' ? T.lama : ch === '~' ? T.agua : ch === '#' ? T.parede : '^>v<'.indexOf(ch) >= 0 ? T.esteira : T.chao;
    return makeCanvas(16, 16, (ctx) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 15, 16, 1); ctx.fillRect(15, 0, 1, 16);
      const accent = ch === 'S' ? P.cesar : ch === 'G' ? P.ok : ch === '+' ? P.ok : ch === '*' ? T.fonte
        : KEYS.indexOf(ch) >= 0 ? P.chave[ch] : DOORS.indexOf(ch) >= 0 ? P.chave[ch.toLowerCase()] : null;
      if (accent) { ctx.fillStyle = accent; ctx.fillRect(5, 5, 6, 6); }
    });
  }
  function pixelCall(name, args, fallback) {
    try {
      const fn = LAB.pixel && LAB.pixel[name];
      if (typeof fn === 'function') { const out = fn.apply(LAB.pixel, args); if (out) return out; }
    } catch (err) { console.warn('[Maze3D] LAB.pixel.' + name + ' falhou', err); }
    return fallback();
  }
  const tileCanvas = (ch, v) => pixelCall('tileTexture', [ch, v], () => fallbackTile(ch));
  const wallCanvas = (face, v) => pixelCall('wallTexture', [face, v], () => fallbackTile('#'));
  const waterCanvases = (n) => pixelCall('waterFrames', [n], () => [fallbackTile('~')]);

  // Atlas: cada textura ocupa um slot TILE×2·TILE alinhado (mipmaps não vazam entre casas).
  class Atlas {
    constructor(tile) {
      this.t = tile; this.sw = tile; this.sh = tile * 2; this.size = tile * 16;
      this.cols = this.size / this.sw; this.max = this.cols * (this.size / this.sh); this.n = 0; this.rects = new Map();
      this.canvas = makeCanvas(this.size, this.size);
      this.ctx = this.canvas.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    }
    add(key, src) {
      if (this.rects.has(key)) return this.rects.get(key);
      if (this.n >= this.max) return this.rects.values().next().value; // nunca acontece nos mapas atuais
      const i = this.n++, x = (i % this.cols) * this.sw, y = Math.floor(i / this.cols) * this.sh;
      const w = this.sw, h = Math.min(this.sh, Math.round(src.height * (this.sw / src.width)));
      this.ctx.drawImage(src, 0, 0, src.width, src.height, x, y, w, h);
      // borda: repete a última linha no resto do slot para os mipmaps
      if (h < this.sh) this.ctx.drawImage(this.canvas, x, y + h - 1, w, 1, x, y + h, w, this.sh - h);
      const S = this.size, e = 0.01;
      const r = new THREE.Vector4((x + e) / S, 1 - (y + h - e) / S, (w - 2 * e) / S, (h - 2 * e) / S);
      this.rects.set(key, r);
      return r;
    }
  }

  // Injeta no material: (a) UV do atlas por instância (topo × laterais) e (b) "aDim" que escurece e
  // dessatura as casas fora da camada escolhida.
  function patchMaterial(mat, atlas) {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDim;\nvarying float vDim;' +
          (atlas ? '\nattribute vec4 aTop;\nattribute vec4 aSide;' : ''))
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDim = aDim;' +
          (atlas ? '\n#ifdef USE_MAP\nvMapUv = normal.y > 0.5 ? aTop.xy + uv * aTop.zw : aSide.xy + uv * aSide.zw;\n#endif' : ''));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDim;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{\n  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
          '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.86, 0.82, 0.76), vDim * 0.85) * (1.0 - 0.6 * vDim);\n}');
    };
    mat.customProgramCacheKey = () => (atlas ? 'lab-maze-atlas' : 'lab-maze-dim');
    return mat;
  }

  // Caixa com a face de cima "de pé": linha 0 da textura aponta para o norte (−z), como no mapa 2D.
  function slabGeometry(h) {
    const g = new THREE.BoxGeometry(1, h, 1);
    g.translate(0, -h / 2, 0);
    const uv = g.attributes.uv;
    for (let i = 8; i < 12; i++) uv.setY(i, 1 - uv.getY(i));
    return g;
  }
  function wallGeometry() {
    const g = new THREE.BoxGeometry(1, WALL_H, 1);
    g.translate(0, WALL_H / 2, 0);
    const uv = g.attributes.uv;
    for (let i = 8; i < 12; i++) uv.setY(i, 1 - uv.getY(i));
    return g;
  }

  // ------------------------------------------------------------------ reservas para LAB.voxel ausente
  function fallbackEntity(color, h, y) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 0.3), new THREE.MeshLambertMaterial({ color: color, emissive: color, emissiveIntensity: 0.3 }));
    m.position.y = y; m.castShadow = true; g.add(m);
    const o = {
      group: g, isOpen: false,
      update() {}, reset() { m.visible = true; }, setConsumed(b) { m.visible = !b; },
      collect() { m.visible = false; return Promise.resolve(); },
      open() { o.setOpen(true); return Promise.resolve(); }, setOpen(b) { o.isOpen = !!b; m.visible = !b; },
      lockWorldPosition() { return m.getWorldPosition(new THREE.Vector3()); },
      trigger() { return Promise.resolve(); },
      dispose() { m.geometry.dispose(); m.material.dispose(); }
    };
    return o;
  }
  function fallbackStudent() {
    const o = fallbackEntity(pal().cesar, 1.2, 0.6);
    const done = () => Promise.resolve();
    return Object.assign(o, { face() {}, setWalking() {}, setWading() {}, hop: done, celebrate: done, raiseKey: done, insertKey: done, shrug: done, setHeldKeys() {} });
  }
  function voxelMake(name, args, fallback) {
    try {
      const fn = LAB.voxel && LAB.voxel[name];
      if (typeof fn === 'function') { const o = fn.apply(LAB.voxel, args); if (o && o.group) return o; }
    } catch (err) { console.warn('[Maze3D] LAB.voxel.' + name + ' falhou', err); }
    return fallback();
  }
  const call = (obj, name, ...args) => (obj && typeof obj[name] === 'function' ? obj[name](...args) : undefined);

  // ==================================================================== Maze3D
  class Maze3D {
    static supported() {
      if (Maze3D._ok !== undefined) return Maze3D._ok;
      let ok = false;
      try {
        const c = document.createElement('canvas');
        const gl = window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
        ok = !!gl;
        const lose = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (e) { ok = false; }
      return (Maze3D._ok = ok);
    }

    constructor(container, opts) {
      if (!container) throw new Error('LAB.Maze3D: container obrigatório');
      opts = opts || {};
      const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.opts = {
        interactive: opts.interactive !== false,
        pixelScale: opts.pixelScale == null ? 'auto' : opts.pixelScale,
        attract: !!opts.attract,
        reducedMotion: opts.reducedMotion == null ? !!(mq && mq.matches) : !!opts.reducedMotion
      };
      this.container = container;
      this._handlers = {};
      this._tweens = [];
      this._floats = [];
      this._boost = new Map();
      this._time = 0;
      this._lastMoveT = 0;
      this._walkStopAt = 0;
      this._speed = this.opts.attract ? 3.2 : 4;
      this._layer = 'todas';
      this._trapsVisible = false;
      this._trailVisible = true;
      this._idx = 0;
      this._path = null;
      this._m = null;
      this._job = null;
      this._attractGen = 0;
      this._userPaused = false;
      this._inView = true;
      this._ctxLost = false;
      this._disposed = false;
      this._framing = { x: 0, y: 0 };
      this._ready = Promise.resolve();

      this._initRenderer();
      this._initScene();
      this._initCamera();
      if (this.opts.interactive) this._bindPointer();
      this._bindLifecycle();
      this.resize();
      this._wake();
    }

    // ---------------------------------------------------------------- eventos
    on(evt, fn) {
      (this._handlers[evt] || (this._handlers[evt] = [])).push(fn);
      return () => this.off(evt, fn);
    }
    off(evt, fn) {
      const list = this._handlers[evt]; if (!list) return;
      const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1);
    }
    _emit(evt, data) {
      const list = this._handlers[evt]; if (!list) return;
      list.slice().forEach((fn) => { try { fn(data || {}); } catch (err) { console.error('[Maze3D] handler de "' + evt + '"', err); } });
    }

    // ---------------------------------------------------------------- renderer, cena, luzes
    _initRenderer() {
      const r = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
      r.setPixelRatio(1);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFShadowMap;
      r.setClearColor(pal().noite, 1);
      const c = r.domElement;
      c.className = 'maze3d-canvas';
      Object.assign(c.style, { width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' });
      // Firefox antigo não conhece "pixelated"; a segunda atribuição só vale se a primeira falhar.
      if (c.style.imageRendering !== 'pixelated') c.style.imageRendering = 'crisp-edges';
      c.style.touchAction = this.opts.interactive ? 'none' : 'auto';
      c.style.pointerEvents = this.opts.interactive ? 'auto' : 'none';
      if (!this.opts.interactive) c.setAttribute('aria-hidden', 'true');
      this.container.appendChild(c);
      this.renderer = r;
      this.canvas = c;
    }

    _initScene() {
      const P = pal();
      const s = (this.scene = new THREE.Scene());
      s.background = new THREE.Color(P.noite);
      s.fog = new THREE.Fog(P.noite, 30, 90);

      // [IA] Claude – luz de dungeon (UPDATE 5): ambiente frio e fraco (hemisfério cinza-azulado sobre chão
      // marrom), um facho frio de "claraboia" com sombras, um preenchimento quente bem leve e as tochas
      // (até MAX_TORCH_LIGHTS PointLights reais, sempre as mais próximas do alvo da câmera; as demais só brilham).
      this._hemi = new THREE.HemisphereLight(0x9a9c9e, 0x3a2c20, 1.5); // [IA] Claude – integração: céu menos azul (a pedra lia roxa)
      s.add(this._hemi);
      const moon = (this._moon = new THREE.DirectionalLight(0xc2c6ce, 1.2));
      moon.castShadow = true;
      moon.shadow.bias = -0.0006;
      moon.shadow.normalBias = 0.03;
      moon.shadow.mapSize.set(1024, 1024);
      this._moonDir = new THREE.Vector3(-0.45, 1.15, -0.14).normalize();
      s.add(moon, moon.target);
      const fill = (this._fill = new THREE.DirectionalLight(0xff9a50, 0.55));
      this._fillDir = new THREE.Vector3(0.55, 0.42, 0.62).normalize();
      s.add(fill, fill.target);
      // número fixo de luzes (o shader não recompila quando as tochas trocam de dono)
      this._torchLights = [];
      for (let i = 0; i < MAX_TORCH_LIGHTS; i++) {
        const l = new THREE.PointLight(0xff9c45, 0, 6.5, 1.7);
        l.castShadow = false;
        s.add(l);
        this._torchLights.push({ light: l, torch: -1, fade: 0 });
      }
      // luz dourada do baú (brilho ao abrir / farol quando ele não foi alcançado)
      this._chestLight = new THREE.PointLight(0xffc860, 0, 5, 1.6);
      s.add(this._chestLight);

      // Chão infinito em "papel quadriculado" noturno (aceno ao manual) + plano de sombra da ilha.
      const gridTex = canvasTexture(makeCanvas(16, 16, (ctx) => {
        ctx.fillStyle = P.noite; ctx.fillRect(0, 0, 16, 16);
        ctx.fillStyle = mixHex(P.noite, P.noite3, 0.55); ctx.fillRect(0, 0, 16, 1); ctx.fillRect(0, 0, 1, 16);
      }), { repeat: true, mip: true, smoothMip: true });
      gridTex.repeat.set(300, 300);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ map: gridTex }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND_Y;
      const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.ShadowMaterial({ color: 0x0a0604, opacity: 0.55 }));
      shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = GROUND_Y + 0.02; shadowPlane.receiveShadow = true;
      s.add(ground, shadowPlane);
      this._ground = ground; this._shadowPlane = shadowPlane; this._gridTex = gridTex;

      // Marcador do aluno (anel pixelado no chão) para achá-lo em mapas grandes / câmera de topo.
      const ringTex = canvasTexture(makeCanvas(16, 16, (ctx) => {
        ctx.fillStyle = '#ffffff';
        const px = [[2, 0, 4, 1], [10, 0, 4, 1], [0, 2, 1, 4], [15, 2, 1, 4], [0, 10, 1, 4], [15, 10, 1, 4], [2, 15, 4, 1], [10, 15, 4, 1],
          [1, 1, 1, 1], [14, 1, 1, 1], [1, 14, 1, 1], [14, 14, 1, 1]];
        px.forEach((p) => ctx.fillRect(p[0], p[1], p[2], p[3]));
      }));
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05),
        new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, color: P.luar, opacity: 0.75 }));
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 2;
      this._locator = ring; this._locatorTex = ringTex;

      // Pino "você está aqui" (seta em pixel) acima do aluno nas visões distantes / topo: sempre por cima.
      const pinTex = canvasTexture(makeCanvas(13, 11, (ctx) => {
        const rows = ['..OOOOOOO..', '..OOOOOOO..', '..OOOOOOO..', 'OOOOOOOOOOO', '.OOOOOOOOO.', '..OOOOOOO..', '...OOOOO...', '....OOO....', '.....O.....'];
        const fill = (ox, oy, col) => { ctx.fillStyle = col; rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'O') ctx.fillRect(x + ox, y + oy, 1, 1); }); };
        // contorno escuro (a seta deslocada nas 4 direções) + miolo laranja + brilho no canto
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach((o) => fill(1 + o[0], 1 + o[1], P.noite));
        fill(1, 1, P.cesar);
        ctx.fillStyle = mixHex(P.cesar, '#FFFFFF', 0.45); ctx.fillRect(4, 2, 2, 2);
      }));
      const pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTex, depthTest: false, depthWrite: false, transparent: true }));
      pin.center.set(0.5, 0); pin.renderOrder = 20; pin.visible = false;
      this._pin = pin; this._pinTex = pinTex;

      this._rig = new THREE.Group();        // posição do aluno na casa
      this._drop = new THREE.Group();       // deslocamentos de queda / squash da intro
      this._rig.add(this._drop);
      this._rig.add(ring);
      this._rig.add(pin);
      s.add(this._rig);
      this._dummy = new THREE.Object3D();
      this._tmpV = new THREE.Vector3();
      this._tmpC = new THREE.Color();
    }

    _ensureStudent() {
      if (this._student) return this._student;
      const st = voxelMake('createStudent', [], fallbackStudent);
      st.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      this._drop.add(st.group);
      call(st, 'face', 'S');
      this._student = st;
      return st;
    }

    _ensureParticles() {
      if (this._particles !== undefined) return this._particles;
      let p = null;
      const F = LAB.voxel && LAB.voxel.Particles;
      if (typeof F === 'function') {
        try { p = new F(this.scene); } catch (e) { try { p = F(this.scene); } catch (e2) { p = null; } }
      }
      this._particles = p && typeof p.burst === 'function' ? p : null;
      return this._particles;
    }
    _burst(pos, color, n, opts) {
      if (this.opts.reducedMotion) return;
      const p = this._ensureParticles();
      if (p) { try { p.burst(pos.clone ? pos.clone() : pos, color, n, opts || {}); } catch (e) { /* efeito é opcional */ } }
    }
    _floatText(text, color, pos) {
      if (this.opts.reducedMotion || !LAB.voxel || typeof LAB.voxel.floatText !== 'function') return;
      try {
        const ft = LAB.voxel.floatText(text, color);
        if (!ft || !ft.sprite) return;
        ft.sprite.position.copy(pos);
        ft.sprite.renderOrder = 10;
        this.scene.add(ft.sprite);
        this._floats.push(ft);
      } catch (e) { /* efeito é opcional */ }
    }

    // ---------------------------------------------------------------- câmera
    _initCamera() {
      this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
      const mk = (x) => ({ x: x, v: 0 });
      this._cam = {
        mode: this.opts.attract ? 'vitrine' : 'seguir',
        base: this.opts.attract ? 'vitrine' : 'seguir',   // último modo pedido por setCamera (pan solta o "seguir")
        goal: { yaw: YAW0, pitch: PITCH0, dist: FOLLOW_DIST, tx: 0, ty: 0.4, tz: 0 },
        yaw: mk(YAW0), pitch: mk(PITCH0), dist: mk(FOLLOW_DIST), tx: mk(0), ty: mk(0.4), tz: mk(0),
        snap: true
      };
    }

    _fitDistance(yaw, pitch, center) {
      const M = this._m; if (!M) return 20;
      const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
      const F = new THREE.Vector3(-sy * cp, -sp, -cy * cp);               // câmera → alvo
      const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
      const U = new THREE.Vector3().crossVectors(R, F);
      const tanV = Math.tan(FOV * DEG / 2) * (1 - Math.abs(this._framing.y));
      const tanH = Math.tan(FOV * DEG / 2) * this.camera.aspect * (1 - Math.abs(this._framing.x));
      const hx = M.C / 2, hz = M.L / 2, ys = [WALL_H, -SLAB_H - BASE_H * 0.5];
      let d = 0;
      const p = new THREE.Vector3();
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of ys) {
        p.set(sx * hx - center.x, y - center.y, sz * hz - center.z);
        const depth = p.dot(F);
        d = Math.max(d, Math.abs(p.dot(R)) / tanH - depth, Math.abs(p.dot(U)) / tanV - depth);
      }
      return d * 1.02 + 0.3;
    }

    _distLimits() {
      const M = this._m;
      const far = M ? this._fitDistance(this._cam.goal.yaw, Math.max(this._cam.goal.pitch, 40 * DEG), new THREE.Vector3(0, 0, 0)) * 1.35 : 60;
      return [3.5, Math.max(far, 14)];
    }

    _cameraDefaults(mode) {
      const g = this._cam.goal, M = this._m;
      const center = new THREE.Vector3(0, M ? 0.1 : 0, 0);
      if (mode === 'seguir') {
        // janela em retrato (celular) corta dos lados: recua um pouco para os corredores vizinhos aparecerem
        g.pitch = PITCH_SEGUIR; g.yaw = YAW0; g.dist = DIST_SEGUIR * (this.camera && this.camera.aspect < 1 ? 1.3 : 1);
      } else if (mode === 'topo') {
        g.yaw = Math.round(this._cam.yaw.x / (2 * Math.PI)) * 2 * Math.PI;
        g.pitch = PITCH_TOPO;
        g.tx = 0; g.ty = 0; g.tz = 0;
        g.dist = this._fitDistance(g.yaw, g.pitch, new THREE.Vector3(0, 0, 0));
      } else if (mode === 'vitrine') {
        g.yaw = YAW0; g.pitch = PITCH_VITRINE;
        g.tx = center.x; g.ty = center.y; g.tz = center.z;
        g.dist = this._fitDistance(g.yaw, g.pitch, center);
        this._vitFit = { dist: g.dist, tx: g.tx, tz: g.tz };
      } else { // livre: visão geral orbitável
        g.yaw = YAW0; g.pitch = PITCH_LIVRE;
        g.tx = center.x; g.ty = center.y; g.tz = center.z;
        g.dist = this._fitDistance(g.yaw, g.pitch, center);
      }
    }

    setCamera(mode) {
      if (mode !== 'seguir' && mode !== 'livre' && mode !== 'topo') return;
      const changed = this._cam.mode !== mode;
      this._cameraDefaults(mode);
      this._cam.mode = this._cam.base = mode;
      if (changed) this._emit('camera', { mode: mode });
    }

    // Volta ao enquadramento padrão do modo escolhido por último em setCamera (re-prende o "seguir" após um pan).
    resetCamera() {
      const base = this._cam.base, changed = this._cam.mode !== base;
      this._cameraDefaults(base);
      this._cam.mode = base;
      if (this.opts.reducedMotion) this._cam.snap = true;
      if (changed) this._emit('camera', { mode: base });
    }

    /** Extra: desloca o diorama dentro do canvas (fração de meia tela, −0.5..0.5), p.ex. texto do hero à esquerda. */
    setFraming(f) {
      f = f || {};
      this._framing = { x: clamp(+f.x || 0, -0.6, 0.6), y: clamp(+f.y || 0, -0.6, 0.6) };
      this._applyProjection();
      if (this._cam.mode === 'vitrine' || this._cam.mode === 'topo') this._cameraDefaults(this._cam.mode);
    }

    _applyProjection() {
      const cam = this.camera;
      cam.updateProjectionMatrix();
      if (this._framing.x || this._framing.y) {
        // desloca o centro óptico (termos fora do eixo da matriz de projeção): o alvo aparece em NDC (x, y)
        const e = cam.projectionMatrix.elements;
        e[8] -= this._framing.x;
        e[9] -= this._framing.y;
        cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      }
    }

    // Alvo do "seguir": o aluno (meio do corpo) + avanço na direção em que anda. A mola criticamente amortecida
    // atrasa 2·v/ω numa velocidade constante; somar esse avanço mantém o aluno centrado mesmo andando rápido.
    _followTarget(g) {
      const p = this._rig.position, v = this._rigVel || { x: 0, z: 0 }, k = 2 / FOLLOW_OMEGA;
      let lx = v.x * k, lz = v.z * k;
      const len = Math.hypot(lx, lz);
      if (len > 2.5) { lx *= 2.5 / len; lz *= 2.5 / len; }
      g.tx = p.x + lx; g.ty = 0.7; g.tz = p.z + lz;
      // [IA] Claude – final triste: enquadra o aluno e o baú que ele não alcançou
      if (this._failFocus) { g.tx = lerp(p.x, this._failFocus.x, 0.45); g.tz = lerp(p.z, this._failFocus.z, 0.45); }
      else if (this._okFocus) { g.tx = lerp(p.x, this._okFocus.x, 0.4); g.tz = lerp(p.z, this._okFocus.z, 0.4); g.ty = 0.6; }
    }

    _updateCamera(dt) {
      const c = this._cam, g = c.goal;
      // velocidade do aluno (suavizada) para o avanço da câmera
      const rp = this._rig.position, last = this._rigLast || (this._rigLast = rp.clone());
      const vel = this._rigVel || (this._rigVel = { x: 0, z: 0 });
      if (dt > 0) {
        const a = 1 - Math.exp(-dt * 10);
        let vx = (rp.x - last.x) / dt, vz = (rp.z - last.z) / dt;
        if (Math.hypot(vx, vz) > 40) { vx = 0; vz = 0; }       // salto (goTo sem animação): não é movimento
        vel.x += (vx - vel.x) * a; vel.z += (vz - vel.z) * a;
      }
      last.copy(rp);
      if (c.mode === 'seguir') {
        this._followTarget(g);
      }
      if (c.mode === 'vitrine' && !this.opts.reducedMotion) {
        g.yaw = YAW0 + 12 * DEG * Math.sin(this._time * 2 * Math.PI / 38);
        // [IA] Claude – fix rodada 2: depois da intro a vitrine chega mais perto e acompanha o aluno (ele era um
        // borrão de ~15 px com o mapa inteiro em quadro); o labirinto continua aparecendo em volta.
        const vf = this._vitFit;
        if (this._vitClose && vf) {
          g.dist = vf.dist * VITRINE_ZOOM;
          g.tx = lerp(vf.tx, rp.x, 0.8); g.tz = lerp(vf.tz, rp.z, 0.8); g.ty = 0.5;
        }
      }
      if (c.snap || this.opts.reducedMotion) {
        ['yaw', 'pitch', 'dist', 'tx', 'ty', 'tz'].forEach((k) => { c[k].x = g[k]; c[k].v = 0; });
        c.snap = false;
      } else {
        const follow = c.mode === 'seguir' ? FOLLOW_OMEGA : 7;
        springTo(c.yaw, g.yaw, 9, dt); springTo(c.pitch, g.pitch, 9, dt); springTo(c.dist, g.dist, 7, dt);
        springTo(c.tx, g.tx, follow, dt); springTo(c.ty, g.ty, follow, dt); springTo(c.tz, g.tz, follow, dt);
      }
      const yaw = c.yaw.x, pitch = c.pitch.x, d = c.dist.x, cp = Math.cos(pitch);
      this.camera.position.set(c.tx.x + Math.sin(yaw) * cp * d, c.ty.x + Math.sin(pitch) * d, c.tz.x + Math.cos(yaw) * cp * d);
      this.camera.lookAt(c.tx.x, c.ty.x, c.tz.x);
      // névoa acompanha a distância: dá profundidade sem esconder o labirinto
      const R = this._m ? Math.hypot(this._m.C, this._m.L) / 2 : 10;
      this.scene.fog.near = d * 0.85 + R * 0.35;
      this.scene.fog.far = d + R * 1.5 + 22;
      // anel no chão cresce pouco (de longe quem marca o aluno é o pino, que fica acima das paredes)
      const ls = clamp(d / 20, 1, 1.3);
      this._locator.scale.set(ls, ls, 1);
      this._locatorFar = d > 30 || c.mode === 'topo';
      const showPin = this._drop.visible && (c.mode === 'topo' || (this.opts.interactive && d > 34));
      this._pin.visible = showPin;
      if (showPin) {
        const ps = d * 0.034;
        this._pin.scale.set(ps * 13 / 11, ps, 1);
        this._pin.position.y = 1.75 + 0.12 * Math.abs(Math.sin(this._time * 3.2)) * (this.opts.reducedMotion ? 0 : 1) * ps;
      }
    }

    // ---------------------------------------------------------------- ponteiro: órbita, pan, zoom, pinça
    _bindPointer() {
      const el = this.canvas, ptrs = new Map();
      let mode = null, lastSpan = 0, lastMid = null, panAcc = 0;
      const pair = () => { const v = Array.from(ptrs.values()); return [v[0], v[1]]; };
      const down = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 1) {
          mode = (e.button === 2 || e.shiftKey || e.ctrlKey || this._cam.mode === 'topo') ? 'pan' : 'orbit';
        } else {
          mode = 'pinch';
          const [a, b] = pair();
          lastSpan = Math.hypot(a.x - b.x, a.y - b.y); lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; panAcc = 0;
        }
      };
      const move = (e) => {
        const p = ptrs.get(e.pointerId); if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (mode === 'orbit') this._orbit(dx, dy);
        else if (mode === 'pan') this._pan(dx, dy);
        else if (mode === 'pinch' && ptrs.size >= 2) {
          const [a, b] = pair();
          const span = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (lastSpan > 0 && span > 0) this._zoom(lastSpan / span);
          // dois dedos só arrastam a câmera depois de uma zona morta (pinça pura não solta o "seguir")
          if (lastMid) {
            const mx = mid.x - lastMid.x, my = mid.y - lastMid.y;
            if (panAcc > 12) this._pan(mx, my); else panAcc += Math.hypot(mx, my) - Math.abs(span - lastSpan) * 0.5;
          }
          lastSpan = span; lastMid = mid;
        }
      };
      const up = (e) => {
        ptrs.delete(e.pointerId);
        if (ptrs.size === 1) { mode = this._cam.mode === 'topo' ? 'pan' : 'orbit'; lastSpan = 0; lastMid = null; }
        else if (!ptrs.size) mode = null;
      };
      const wheel = (e) => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 300 : 1;
        this._zoom(Math.exp(clamp(e.deltaY * k, -200, 200) * 0.0016));
      };
      const dbl = (e) => { e.preventDefault(); this.resetCamera(); };
      const ctx = (e) => e.preventDefault();
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', wheel, { passive: false });
      el.addEventListener('dblclick', dbl);
      el.addEventListener('contextmenu', ctx);
      this._unbindPointer = () => {
        el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        el.removeEventListener('wheel', wheel); el.removeEventListener('dblclick', dbl); el.removeEventListener('contextmenu', ctx);
      };
    }
    _orbit(dx, dy) {
      const g = this._cam.goal;
      if (this._cam.mode === 'topo') { this._pan(dx, dy); return; }
      g.yaw -= dx * 0.0085;
      g.pitch = clamp(g.pitch + dy * 0.006, PITCH_MIN, PITCH_MAX);
      this._wake();
    }
    _pan(dx, dy) {
      const c = this._cam, g = c.goal, M = this._m;
      if (c.mode === 'seguir') { c.mode = 'livre'; this._emit('camera', { mode: 'livre' }); }
      const h = Math.max(1, this.container.clientHeight);
      const k = 2 * c.dist.x * Math.tan(FOV * DEG / 2) / h;
      const yaw = c.yaw.x, sp = Math.max(Math.sin(c.pitch.x), 0.45);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      g.tx += -rx * dx * k + fx * dy * k / sp;
      g.tz += -rz * dx * k + fz * dy * k / sp;
      if (M) { g.tx = clamp(g.tx, -M.C / 2 - 2, M.C / 2 + 2); g.tz = clamp(g.tz, -M.L / 2 - 2, M.L / 2 + 2); }
      this._wake();
    }
    _zoom(f) {
      const g = this._cam.goal, lim = this._distLimits();
      g.dist = clamp(g.dist * f, lim[0], lim[1]);
      this._wake();
    }

    // ---------------------------------------------------------------- ciclo de vida
    _bindLifecycle() {
      this._frameBound = (now) => this._frame(now);
      this._onVis = () => this._wake();
      document.addEventListener('visibilitychange', this._onVis);
      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(this.container);
      } else {
        this._onWinResize = () => this.resize();
        window.addEventListener('resize', this._onWinResize);
      }
      if (window.IntersectionObserver) {
        this._io = new IntersectionObserver((entries) => {
          this._inView = entries[entries.length - 1].isIntersecting;
          this._wake();
        }, { rootMargin: '120px' });
        this._io.observe(this.container);
      }
      this._onLost = (e) => { e.preventDefault(); this._ctxLost = true; this._emit('contextlost', {}); };
      this._onRestored = () => { this._ctxLost = false; this._wake(); };
      this.canvas.addEventListener('webglcontextlost', this._onLost, false);
      this.canvas.addEventListener('webglcontextrestored', this._onRestored, false);
    }

    // Desenha só quando visível; o relógio continua enquanto houver passo/tween pendente (reprodução fora da
    // tela segue no ritmo certo, sem renderizar). setPaused(true) congela tudo; aba oculta = sem rAF.
    _visible() { return this._inView && !document.hidden; }
    _running() {
      if (this._disposed || this._userPaused || this._ctxLost) return false;
      return this._visible() || !!this._job || this._tweens.length > 0;
    }

    _wake() {
      if (!this._raf && this._running()) {
        this._last = performance.now();
        this._raf = requestAnimationFrame(this._frameBound);
      }
    }

    setPaused(b) { this._userPaused = !!b; this._wake(); }

    resize() {
      if (this._disposed) return;
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      let ps = this.opts.pixelScale;
      if (ps === 'auto' || !(ps > 0)) {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        ps = (w < 1000 || coarse) ? 2 : 2.5;   // [IA] Claude – janela do player (~56% da largura): pixels um pouco menores
        // mantém um mínimo de linhas renderizadas para o diorama não virar mosaico em caixas baixas
        ps = Math.min(ps, Math.max(1, h / 200));
      }
      const rw = Math.max(1, Math.round(w / ps)), rh = Math.max(1, Math.round(h / ps));
      if (rw !== this._rw || rh !== this._rh) {
        this._rw = rw; this._rh = rh;
        this.renderer.setSize(rw, rh, false);
      }
      this.camera.aspect = w / h;
      this._applyProjection();
      if (this._cam.mode === 'vitrine' || this._cam.mode === 'topo') this._cameraDefaults(this._cam.mode);
      this._wake();
    }

    _frame(now) {
      this._raf = 0;
      if (!this._running()) return;
      this._raf = requestAnimationFrame(this._frameBound);
      const dt = clamp((now - this._last) / 1000, 0, 0.1);
      this._last = now;
      this._time += dt;
      this._tick(dt);
      if (this._visible()) this.renderer.render(this.scene, this.camera);
    }

    _tick(dt) {
      const t = this._time, M = this._m;
      // tweens do motor (passos, intro, quedas)
      if (this._tweens.length) {
        const list = this._tweens;
        for (let i = 0; i < list.length; i++) {
          const tw = list[i];
          if (tw.done) continue;
          tw.t += dt;
          const k = Math.min(1, tw.t / tw.dur);
          tw.fn(tw.ease(k), k);
          if (k >= 1) { tw.done = true; tw.resolve(true); }
        }
        this._tweens = list.filter((tw) => !tw.done);
      }
      if (M && M.intro) this._introFrame(M, dt);
      // entidades do LAB.voxel (com aceleração durante floreios em velocidade alta)
      const st = this._student;
      if (st) {
        const b = this._boost.get(st) || 1;
        // o aluno do voxel limita dt antes de aplicar timeScale: acelerar por timeScale não perde tempo
        if ('timeScale' in st) { st.timeScale = b; call(st, 'update', dt, t); } else call(st, 'update', dt * b, t);
      }
      if (M) {
        for (let i = 0; i < M.ents.length; i++) { const e = M.ents[i]; call(e.obj, 'update', dt * (this._boost.get(e.obj) || 1), t); }
        // água e esteiras animam em "quadros" de pixel art (paradas com movimento reduzido)
        const still = this.opts.reducedMotion;
        if (M.waterTex && !still) {
          const f = Math.floor(t * 5) % M.waterFrames;
          M.waterTex.offset.x = f / M.waterFrames;
        }
        for (let i = 0; i < M.belts.length && !still; i++) {
          const b = M.belts[i], step = (Math.floor(t * 16 * 1.1) % 16) / 16;   // 1 texel por quadro de animação
          if (b.dir === 'L') b.tex.offset.x = -step; else if (b.dir === 'O') b.tex.offset.x = step;
          else if (b.dir === 'N') b.tex.offset.y = -step; else b.tex.offset.y = step;
        }
        if (M.dimAnimating) this._dimFrame(M, dt);
        if (M.traps && M.traps.decal.visible) this._trapsFrame(M, t);
        if (M.dust) this._dustFrame(M, dt);
        if (M.torches) this._torchFrame(M, t, dt);
        for (let i = 0; i < M.goalEnts.length; i++) { const b = M.goalEnts[i].beacon; if (b) b.update(t, this.opts.reducedMotion); }
        this._chestLightFrame(dt);
      }
      if (this._particles) call(this._particles, 'update', dt);
      if (this._floats.length) {
        this._floats = this._floats.filter((ft) => {
          let alive = false;
          try { alive = ft.update(dt); } catch (e) { alive = false; }
          if (!alive) {
            this.scene.remove(ft.sprite);
            if (typeof ft.dispose === 'function') ft.dispose();
            else if (ft.sprite.material) { if (ft.sprite.material.map) ft.sprite.material.map.dispose(); ft.sprite.material.dispose(); }
          }
          return alive;
        });
      }
      // [IA] Claude – ciclo negativo: reproduziu e parou (pausa / fim) → mãos para cima, triste
      const pa = this._path;
      if (pa && pa.status === 'CICLO_NEGATIVO' && this._cycleArmed && !this._job && !this._ending && !this.opts.attract &&
          this._time - (this._lastStepEnd || 0) > 0.9) {
        this._cycleArmed = false;
        this._playFailEnding(!this.opts.reducedMotion);
      }
      // depois de um passo: para de andar; parado um tempo, vira para a câmera (mostra o moletom)
      if (st && !this._job) {
        if (this._walkStopAt && t >= this._walkStopAt) { call(st, 'setWalking', false); this._walkStopAt = 0; }
        if (!this._idleFaced && t - this._lastMoveT > 1.6 && !this._busy) {
          this._idleFaced = true;
          call(st, 'face', this._dirToCamera());
        }
      }
      if (this._locator.visible) {
        this._locator.material.opacity = (this._locatorFar ? 0.8 : 0.5) + (this.opts.reducedMotion ? 0 : 0.2 * Math.sin(t * 3.4));
      }
      if (M && !M.intro) this._cutawayFrame(M, dt);
      this._updateCamera(dt);
    }

    _dirToCamera() {
      const dx = this.camera.position.x - this._rig.position.x, dz = this.camera.position.z - this._rig.position.z;
      return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'L' : 'O') : (dz > 0 ? 'S' : 'N');
    }

    // ---------------------------------------------------------------- tweens / esperas no tempo do motor
    _tween(job, dur, fn, ease) {
      return new Promise((resolve) => {
        const tw = { t: 0, dur: Math.max(1e-4, dur), fn: fn || (() => {}), ease: ease || linear, done: false, resolve: resolve };
        tw.cancel = () => { if (!tw.done) { tw.done = true; resolve(false); } };
        this._tweens.push(tw);
        if (job) job.tweens.push(tw);
        this._wake();
      });
    }
    _wait(job, s) { return this._tween(job, s, null); }
    _race(job, p, cap) {
      const list = [this._wait(job, cap)];
      if (p && typeof p.then === 'function') list.push(p.then(() => true, () => true));
      return Promise.race(list);
    }
    // Roda floreios do voxel acelerados para caber no alvo (escalado por fl) e espera no máximo esse tempo.
    async _flourishRun(job, parts, fl) {
      let target = 0;
      const promises = parts.map((pt) => {
        const f = FLOURISH[pt.name], want = this._flourishWant(pt.name, fl);
        target = Math.max(target, want);
        this._boost.set(pt.obj, Math.max(1, f[0] / want));
        return pt.run();
      });
      await this._race(job, Promise.all(promises), target + 0.12);
      parts.forEach((pt) => this._boost.delete(pt.obj));
    }

    // ================================================================ construção do mapa
    load(mapa, opts) {
      if (this._disposed) return Promise.resolve();
      opts = opts || {};
      this._cancelJob();
      this._attractGen++;
      this._vitClose = false;
      this._disposeMap();
      this._path = null;
      this._idx = 0;
      const M = (this._m = this._buildMap(mapa));
      this._ensureStudent();
      this._placeAt(M.start.r, M.start.c);
      this._drop.position.set(0, 0, 0); this._drop.scale.set(1, 1, 1); this._drop.visible = true;
      this._busy = false;
      call(this._student, 'setWading', 0);
      call(this._student, 'setHeldKeys', []);
      call(this._student, 'face', 'S');
      this._applyLayerTargets(true);
      this._rebuildTraps();
      // câmera
      if (this._cam.mode !== 'seguir') this._cameraDefaults(this._cam.mode);
      else { this._cameraDefaults('seguir'); this._followTarget(this._cam.goal); }
      this._cam.snap = true;
      this._updateShadowCamera(M);

      const intro = opts.intro !== false && !this.opts.reducedMotion;
      let p;
      if (intro) {
        p = this._playIntro(M);
        // a câmera chega de um pouco mais longe e gira até o enquadramento (só com movimento liberado)
        this._updateCamera(0);
        this._cam.dist.x = this._cam.goal.dist * 1.3;
        this._cam.yaw.x = this._cam.goal.yaw - 16 * DEG;
        this._cam.pitch.x = Math.min(PITCH_MAX, this._cam.goal.pitch + 8 * DEG);
      } else {
        p = Promise.resolve();
      }
      this._ready = p.then(() => {
        if (this._m !== M || this._disposed) return;
        M.ready = true;
        this._emit('ready', { nome: M.mapa && M.mapa.nome });
      });
      this._wake();
      return this._ready;
    }

    _buildMap(mapa) {
      const P = pal(), T = P.tiles;
      const grade = (mapa && Array.isArray(mapa.grade) && mapa.grade.length) ? mapa.grade : ['###', '#S#', '###'];
      const L = grade.length, C = grade.reduce((m, row) => Math.max(m, row.length), 0), N = L * C;
      const ch = (r, c) => (r >= 0 && r < L && c >= 0 && c < C ? (grade[r][c] || '#') : '#');
      const M = {
        mapa: mapa || {}, grade, L, C, N, ch,
        x: (c) => c - (C - 1) / 2, z: (r) => r - (L - 1) / 2,
        res: [], ents: [], keyEnts: [], doorEnts: [], bonusEnts: [], entByCell: new Map(), belts: [],
        dimTarget: new Float32Array(N), dimCur: new Float32Array(N), group: new THREE.Group(),
        start: { r: 1, c: 1 }, goals: [], intro: false, ready: false
      };
      this.scene.add(M.group);
      const own = (x) => { M.res.push(x); return x; };

      // varredura em ordem de leitura: S, G, bônus '+', fontes '*'
      const plus = [], stars = [];
      let foundS = false;
      for (let r = 0; r < L; r++) for (let c = 0; c < C; c++) {
        const k = ch(r, c);
        if (k === 'S' && !foundS) { M.start = { r, c }; foundS = true; }
        else if (k === 'G') M.goals.push({ r, c });
        else if (k === '+') plus.push({ r, c });
        else if (k === '*') stars.push({ r, c });
      }
      M.nPlus = plus.length;

      // ordem da intro "construção": onda pela distância de Manhattan até S (|Δlinha| + |Δcoluna|).
      // É só geometria da grade: nenhuma busca em grafo roda no navegador (os algoritmos ficam no Python).
      const dist = new Int32Array(N);
      let maxD = 0;
      for (let i = 0; i < N; i++) {
        const r = (i / C) | 0, c = i % C;
        dist[i] = Math.abs(r - M.start.r) + Math.abs(c - M.start.c);
        if (dist[i] > maxD) maxD = dist[i];
      }
      M.dist = dist; M.maxD = Math.max(1, maxD);

      // ---- atlas de chão e paredes
      const TILE = (LAB.pixel && LAB.pixel.TILE) || 16;
      const atlas = new Atlas(TILE);
      const edgeCanvas = makeCanvas(TILE, Math.max(3, Math.round(TILE * SLAB_H)), (ctx) => {
        const h = Math.max(3, Math.round(TILE * SLAB_H)), rnd = rng(7);
        ctx.fillStyle = mixHex(T.chao, P.noite, 0.45); ctx.fillRect(0, 0, TILE, h);
        ctx.fillStyle = mixHex(T.chaoAlt || T.chao, P.luar, 0.12); ctx.fillRect(0, 0, TILE, 1);
        ctx.fillStyle = mixHex(T.chao, P.noite, 0.2); ctx.fillRect(0, 1, TILE, 1);
        ctx.fillStyle = mixHex(T.chao, P.noite, 0.65);
        for (let i = 0; i < TILE; i++) if (rnd() < 0.35) ctx.fillRect(i, 2 + ((rnd() * (h - 2)) | 0), 1, 1);
        ctx.fillRect(0, h - 1, TILE, 1);
      });
      const rectEdge = atlas.add('edge', edgeCanvas);
      const variantOf = (r, c) => hash2(r, c) % 4;
      const floorRect = (k, r, c) => {
        const v = (k === '.' || k === ',') ? variantOf(r, c) : 0;
        const key = 'f' + k + v;
        if (atlas.rects.has(key)) return atlas.rects.get(key);
        return atlas.add(key, tileCanvas(k, v));
      };

      // ---- lajes (todas as casas, menos água) + paredes + água + esteiras
      const slabCells = [], wallCells = [], waterCells = [], beltCells = { N: [], L: [], S: [], O: [] };
      for (let r = 0; r < L; r++) for (let c = 0; c < C; c++) {
        const k = ch(r, c), ci = r * C + c;
        if (k === '~') waterCells.push(ci); else slabCells.push(ci);
        if (k === '#') wallCells.push(ci);
        if (CONVEYOR[k]) beltCells[CONVEYOR[k]].push(ci);
      }

      const atlasTex = own(canvasTexture(atlas.canvas, { mip: true }));
      M.atlas = atlas;
      // material compartilhado de lajes e paredes (UV de atlas por instância + escurecimento por camada)
      const atlasMat = own(patchMaterial(new THREE.MeshLambertMaterial({ map: atlasTex }), true));

      const slabGeo = own(slabGeometry(SLAB_H));
      const slab = new THREE.InstancedMesh(slabGeo, atlasMat, slabCells.length);
      const aTop = new Float32Array(slabCells.length * 4), aSide = new Float32Array(slabCells.length * 4);
      slabCells.forEach((ci, i) => {
        const r = (ci / C) | 0, c = ci % C, k = ch(r, c);
        const top = k === '#' ? rectEdge : floorRect(CONVEYOR[k] ? '.' : k, r, c);
        top.toArray(aTop, i * 4); rectEdge.toArray(aSide, i * 4);
      });
      slabGeo.setAttribute('aTop', new THREE.InstancedBufferAttribute(aTop, 4));
      slabGeo.setAttribute('aSide', new THREE.InstancedBufferAttribute(aSide, 4));
      slabGeo.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(slabCells.length), 1).setUsage(THREE.DynamicDrawUsage));
      slab.receiveShadow = true; slab.castShadow = false; slab.frustumCulled = false;
      M.slab = { mesh: slab, cells: slabCells };

      const wallGeo = own(wallGeometry());
      // [IA] Claude – tom quente neutro na pedra (o lavanda antigo 0xb9b3da deixava as paredes malva)
      const wallMat = own(patchMaterial(new THREE.MeshLambertMaterial({ map: atlasTex, color: 0xd2c8ba }), true));
      const walls = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(1, wallCells.length));
      walls.count = wallCells.length;
      const wTop = new Float32Array(Math.max(1, wallCells.length) * 4), wSide = new Float32Array(Math.max(1, wallCells.length) * 4);
      wallCells.forEach((ci, i) => {
        const r = (ci / C) | 0, c = ci % C, v = variantOf(r, c);
        const top = atlas.rects.get('wt' + v) || atlas.add('wt' + v, wallCanvas('top', v));
        const side = atlas.rects.get('ws' + v) || atlas.add('ws' + v, wallCanvas('side', v));
        top.toArray(wTop, i * 4); side.toArray(wSide, i * 4);
      });
      wallGeo.setAttribute('aTop', new THREE.InstancedBufferAttribute(wTop, 4));
      wallGeo.setAttribute('aSide', new THREE.InstancedBufferAttribute(wSide, 4));
      wallGeo.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, wallCells.length)), 1).setUsage(THREE.DynamicDrawUsage));
      walls.castShadow = true; walls.receiveShadow = true; walls.frustumCulled = false;
      M.walls = { mesh: walls, cells: wallCells };
      atlasTex.needsUpdate = true;
      M.group.add(slab, walls);

      // água: planos afundados, quadros animados numa tira
      if (waterCells.length) {
        const frames = waterCanvases(4);
        const n = Math.max(1, frames.length), fw = frames[0].width, fh = frames[0].height;
        const strip = makeCanvas(fw * n, fh, (ctx) => frames.forEach((f, i) => ctx.drawImage(f, i * fw, 0)));
        const tex = own(canvasTexture(strip, { mip: true }));
        tex.repeat.set(1 / n, 1);
        M.waterTex = tex; M.waterFrames = n;
        const mat = own(patchMaterial(new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.88 }), false));
        const geo = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
        geo.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(waterCells.length), 1).setUsage(THREE.DynamicDrawUsage));
        const water = new THREE.InstancedMesh(geo, mat, waterCells.length);
        water.receiveShadow = true; water.frustumCulled = false; water.renderOrder = 1;
        M.water = { mesh: water, cells: waterCells };
        M.group.add(water);
      }

      // esteiras: placa fina por direção com textura rolando ao longo da seta
      for (const dir of ['N', 'L', 'S', 'O']) {
        const cells = beltCells[dir];
        if (!cells.length) continue;
        const sym = Object.keys(CONVEYOR).find((k) => CONVEYOR[k] === dir);
        const tex = own(canvasTexture(tileCanvas(sym, 0), { repeat: true, mip: true }));
        const mat = own(patchMaterial(new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), false));
        const geo = own(new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2));
        geo.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(cells.length), 1).setUsage(THREE.DynamicDrawUsage));
        const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
        mesh.receiveShadow = true; mesh.frustumCulled = false;
        M.belts.push({ dir, mesh, cells, tex, y: 0.012 });
        M.group.add(mesh);
      }

      // ---- sombra de contato (AO em degraus de pixel) no pé das paredes: dá volume aos corredores
      const aoCells = [];
      for (let r = 0; r < L; r++) for (let c = 0; c < C; c++) {
        const k = ch(r, c);
        if (k === '#') continue;
        for (const d in MOVES) if (ch(r + MOVES[d][0], c + MOVES[d][1]) === '#') aoCells.push({ ci: r * C + c, d, y: k === '~' ? WATER_Y + 0.006 : CONVEYOR[k] ? 0.018 : 0.006 });
      }
      if (aoCells.length) {
        const aoTex = own(canvasTexture(makeCanvas(4, 8, (ctx) => {
          [0.42, 0.42, 0.26, 0.26, 0.12, 0.12, 0, 0].forEach((a, y) => { ctx.fillStyle = 'rgba(8,5,22,' + a + ')'; ctx.fillRect(0, y, 4, 1); });
        })));
        const aoGeo = own(new THREE.PlaneGeometry(1, 0.42).rotateX(-Math.PI / 2).translate(0, 0, -0.5 + 0.21));
        const aoMat = own(new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
        const ao = new THREE.InstancedMesh(aoGeo, aoMat, aoCells.length);
        const rotY = { N: 0, L: -Math.PI / 2, S: Math.PI, O: Math.PI / 2 };
        const dmy = this._dummy;
        aoCells.forEach((a, i) => {
          dmy.position.set(M.x(a.ci % C), a.y, M.z((a.ci / C) | 0)); dmy.rotation.set(0, rotY[a.d], 0); dmy.scale.set(1, 1, 1); dmy.updateMatrix();
          ao.setMatrixAt(i, dmy.matrix);
        });
        ao.frustumCulled = false; ao.renderOrder = 1;
        M.ao = { mesh: ao };
        M.group.add(ao);
      }

      // ---- bloco de terra (base flutuante com "gotas" irregulares embaixo)
      const strataH = Math.round(TILE * BASE_H) + 4;
      const strata = makeCanvas(TILE * 2, strataH, (ctx) => {
        const rnd = rng(31), W = TILE * 2;
        const bands = [mixHex(T.chao, P.noite, 0.4), mixHex(T.parede || T.chao, P.noite, 0.42), mixHex(T.chao, P.noite, 0.55), mixHex(T.parede || T.chao, P.noite, 0.6)];
        let y = 0, bi = 0;
        while (y < strataH) { const h = 3 + ((rnd() * 4) | 0); ctx.fillStyle = bands[bi++ % bands.length]; ctx.fillRect(0, y, W, h); y += h; }
        ctx.fillStyle = mixHex(T.chao, P.luarFraco, 0.18);
        for (let i = 0; i < 9; i++) { const sx = (rnd() * (W - 3)) | 0, sy = (rnd() * (strataH - 9)) | 0; ctx.fillRect(sx, sy, 2 + ((rnd() * 2) | 0), 1 + ((rnd() * 2) | 0)); }
        ctx.fillStyle = mixHex(P.noite, '#000000', 0.2);
        for (let i = 0; i < 14; i++) ctx.fillRect((rnd() * W) | 0, (rnd() * (strataH - 6)) | 0, 1, 1);
        // borda de baixo irregular (transparente) → a ilha parece "arrancada" do chão
        for (let x = 0; x < W; x++) {
          const cut = 1 + ((hash2(x, 3) % 5) === 0 ? 4 : (hash2(x, 9) % 3));
          ctx.clearRect(x, strataH - cut, 1, cut);
        }
      });
      const strataX = own(canvasTexture(strata, { repeat: true, repeatY: false }));
      const strataZ = own(strataX.clone());
      strataX.repeat.set(L / 2, 1); strataZ.repeat.set(C / 2, 1);
      strataZ.needsUpdate = true;
      const bedTex = own(canvasTexture(makeCanvas(TILE, TILE, (ctx) => {
        const rnd = rng(5);
        ctx.fillStyle = mixHex(T.agua, P.noite, 0.78); ctx.fillRect(0, 0, TILE, TILE);
        ctx.fillStyle = mixHex(T.agua, P.noite, 0.6);
        for (let i = 0; i < 10; i++) ctx.fillRect((rnd() * TILE) | 0, (rnd() * TILE) | 0, 2, 1);
      }), { repeat: true, mip: true }));
      bedTex.repeat.set(C, L);
      const sideX = own(new THREE.MeshLambertMaterial({ map: strataX, alphaTest: 0.5 }));
      const sideZ = own(new THREE.MeshLambertMaterial({ map: strataZ, alphaTest: 0.5 }));
      const bed = own(new THREE.MeshLambertMaterial({ map: bedTex }));
      const baseGeo = own(new THREE.BoxGeometry(C, BASE_H, L));
      const base = new THREE.Mesh(baseGeo, [sideX, sideX, bed, bed, sideZ, sideZ]);
      base.position.y = -SLAB_H - BASE_H / 2;
      base.castShadow = true; base.receiveShadow = true;
      M.base = base;
      M.group.add(base);

      // ---- entidades do LAB.voxel
      const addEnt = (kind, r, c, obj, extra) => {
        const holder = new THREE.Group();
        holder.position.set(M.x(c), 0, M.z(r));
        holder.add(obj.group);
        obj.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
        M.group.add(holder);
        const e = Object.assign({ kind, r, c, ci: r * C + c, obj, holder, state: null }, extra || {});
        M.ents.push(e); M.entByCell.set(e.ci, e);
        return e;
      };
      const wallAt = (r, c) => ch(r, c) === '#';
      for (let r = 0; r < L; r++) for (let c = 0; c < C; c++) {
        const k = ch(r, c);
        if (KEYS.indexOf(k) >= 0) {
          M.keyEnts.push(addEnt('key', r, c, voxelMake('createKey', [k], () => fallbackEntity(P.chave[k], 0.2, 0.55)), { letter: k }));
        } else if (DOORS.indexOf(k) >= 0) {
          const ns = wallAt(r - 1, c) && wallAt(r + 1, c), we = wallAt(r, c - 1) && wallAt(r, c + 1);
          let ori = ns && !we ? 'x' : we && !ns ? 'z' : (!wallAt(r, c - 1) || !wallAt(r, c + 1)) ? 'x' : 'z';
          M.doorEnts.push(addEnt('door', r, c, voxelMake('createDoor', [k, ori], () => fallbackEntity(P.chave[k.toLowerCase()], WALL_H, WALL_H / 2)), { letter: k, orientation: ori }));
        }
      }
      plus.forEach((p, i) => {
        M.bonusEnts[i] = addEnt('bonus', p.r, p.c, voxelMake('createBonus', ['+'], () => fallbackEntity(P.ok, 0.25, 0.4)), { bidx: i, sym: '+' });
      });
      stars.forEach((p, j) => {
        M.bonusEnts[plus.length + j] = addEnt('fonte', p.r, p.c, voxelMake('createBonus', ['*'], () => fallbackEntity(T.fonte, 0.25, 0.4)), { bidx: plus.length + j, sym: '*' });
      });
      // [IA] Claude – objetivo G = baú do tesouro (UPDATE 5). Sem createChest no LAB.voxel, usa a saída antiga.
      const hasChest = !!(LAB.voxel && typeof LAB.voxel.createChest === 'function');
      M.goalEnts = M.goals.map((g) => {
        const obj = hasChest ? voxelMake('createChest', [], () => voxelMake('createGoal', [], () => fallbackEntity(T.saida || P.ok, 0.4, 0.2)))
          : voxelMake('createGoal', [], () => fallbackEntity(T.saida || P.ok, 0.4, 0.2));
        const e = addEnt('goal', g.r, g.c, obj, { chest: hasChest && typeof obj.open === 'function' });
        // frente do baú (+z do modelo) para o vizinho livre mais perto de S
        let best = null;
        for (const d in MOVES) {
          const nr = g.r + MOVES[d][0], nc = g.c + MOVES[d][1];
          if (nr < 0 || nc < 0 || nr >= L || nc >= C || ch(nr, nc) === '#') continue;
          const dd = dist[nr * C + nc];
          if (!best || dd < best.dd) best = { d, dd };
        }
        this._orientGoal(e, best ? best.d : 'S');
        e.beacon = this._makeBeacon(own);
        e.holder.add(e.beacon.group);
        return e;
      });
      M.startEnt = addEnt('start', M.start.r, M.start.c, voxelMake('createStartPad', [], () => fallbackEntity(P.cesar, 0.02, 0.01)));

      // ---- tochas nas paredes (UPDATE 5)
      this._buildTorches(M, own, wallCells);

      // ---- poeira em suspensão: grãos quentes que flutuam devagar na luz das tochas
      if (!this.opts.reducedMotion) {
        const n = clamp(Math.round(N / 7), 28, 110), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), rnd = rng(77);
        for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * C; pos[i * 3 + 1] = 0.15 + rnd() * 2.6; pos[i * 3 + 2] = (rnd() - 0.5) * L; }
        const geo = own(new THREE.BufferGeometry());
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
        const mat = own(new THREE.PointsMaterial({ color: 0xffffff, vertexColors: true, size: 1, sizeAttenuation: false, transparent: true,
          opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        const base = new THREE.Color(mixHex(P.luar, P.tocha || '#FFB347', 0.55));
        M.dust = { pts, pos, col, n, base, seeds: Array.from({ length: n }, () => rnd() * 6.28), drift: Array.from({ length: n }, () => [(rnd() - 0.5) * 0.12, 0.03 + rnd() * 0.07, (rnd() - 0.5) * 0.12]) };
        M.group.add(pts);
      }

      this._writeMatrices(M);
      return M;
    }

    // Matrizes finais das peças instanciadas (a intro escreve as suas em _introFrame e chama esta no fim).
    _writeMatrices(M) {
      const d = this._dummy;
      const put = (mesh, i, x, y, z, sx, sy, sz) => {
        d.position.set(x, y, z); d.scale.set(sx, sy, sz); d.rotation.set(0, 0, 0); d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      };
      const C = M.C;
      M.slab.cells.forEach((ci, i) => put(M.slab.mesh, i, M.x(ci % C), 0, M.z((ci / C) | 0), 1, 1, 1));
      M.walls.cells.forEach((ci, i) => put(M.walls.mesh, i, M.x(ci % C), 0, M.z((ci / C) | 0), 1, M.cut ? lerp(1, CUT_H, easeInOutSine(M.cut[i])) : 1, 1));
      if (M.water) M.water.cells.forEach((ci, i) => put(M.water.mesh, i, M.x(ci % C), WATER_Y, M.z((ci / C) | 0), 1, 1, 1));
      M.belts.forEach((b) => b.cells.forEach((ci, i) => put(b.mesh, i, M.x(ci % C), b.y, M.z((ci / C) | 0), 1, 1, 1)));
      [M.slab, M.walls, M.water].concat(M.belts).forEach((o) => { if (o) o.mesh.instanceMatrix.needsUpdate = true; });
    }

    _updateShadowCamera(M) {
      const R = Math.hypot(M.C, M.L) / 2 + 3;
      const sc = this._moon.shadow.camera;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = R * 2 + 60;
      sc.updateProjectionMatrix();
      const size = R > 22 ? 2048 : 1024;
      if (this._moon.shadow.mapSize.x !== size) {
        this._moon.shadow.mapSize.set(size, size);
        if (this._moon.shadow.map) { this._moon.shadow.map.dispose(); this._moon.shadow.map = null; }
      }
      this._moon.position.copy(this._moonDir).multiplyScalar(R + 30);
      this._moon.target.position.set(0, 0, 0);
      this._fill.position.copy(this._fillDir).multiplyScalar(R + 30);
      this._fill.target.position.set(0, 0, 0);
    }

    _disposeMap() {
      const M = this._m;
      if (!M) return;
      if (M.introResolve) { M.introResolve(); M.introResolve = null; }
      this._resetTorchLights();
      this._chestGlow = { cur: 0, target: 0, burst: 0 };
      this._chestLight.intensity = 0;
      this._ending = null;
      M.ents.forEach((e) => { call(e.obj, 'dispose'); });
      if (M.torches && M.torches.voxel) M.torches.list.forEach((o) => call(o.obj, 'dispose'));
      if (M.traps) { M.traps.decal.geometry.dispose(); M.traps.gem.geometry.dispose(); }
      this._disposeTrail();
      M.res.forEach((x) => { try { x.dispose(); } catch (e) { /* já liberado */ } });
      // InstancedMesh guarda buffers próprios (matrizes/cores)
      M.group.traverse((o) => { if (o.isInstancedMesh && typeof o.dispose === 'function') o.dispose(); });
      this.scene.remove(M.group);
      this._m = null;
    }

    // ---------------------------------------------------------------- [IA] Claude – baú, farol e tochas (UPDATE 5)
    // Gira o baú para a frente (+z do modelo) apontar para a casa vizinha na direção d.
    _orientGoal(e, d) {
      const rot = { S: 0, N: Math.PI, L: Math.PI / 2, O: -Math.PI / 2 };
      e.facing = MOVES[d] ? d : 'S';
      e.obj.group.rotation.y = rot[e.facing];
    }

    // Farol suave sobre o baú não alcançado: anel dourado pulsando no chão + coluna de luz bem transparente.
    _makeBeacon(own) {
      const P = pal(), gold = P.tiles.saida || '#E8B53A';
      const g = new THREE.Group(); g.visible = false;
      const ringTex = own(canvasTexture(makeCanvas(24, 24, (ctx) => {
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
          const r = Math.hypot(x - 11.5, y - 11.5);
          const a = r > 11 ? 0 : r > 9 ? 0.95 : r > 7.6 ? 0.35 : r > 6.6 ? 0.6 : 0;
          if (a) { ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(x, y, 1, 1); }
        }
      })));
      const ring = new THREE.Mesh(own(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2)),
        own(new THREE.MeshBasicMaterial({ map: ringTex, color: gold, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })));
      ring.position.y = 0.025; ring.renderOrder = 3;
      const beamTex = own(canvasTexture(makeCanvas(4, 32, (ctx) => {
        for (let y = 0; y < 32; y++) { ctx.fillStyle = 'rgba(255,255,255,' + Math.pow(y / 31, 1.6).toFixed(3) + ')'; ctx.fillRect(0, y, 4, 1); }
      })));
      const beam = new THREE.Mesh(own(new THREE.CylinderGeometry(0.38, 0.46, 3.4, 10, 1, true)),
        own(new THREE.MeshBasicMaterial({ map: beamTex, color: gold, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
          opacity: 0.22, side: THREE.DoubleSide })));
      beam.position.y = 1.7; beam.renderOrder = 4;
      g.add(ring, beam);
      return {
        group: g, ring, beam, on: false,
        set(on) { this.on = !!on; g.visible = this.on; },
        update(t, still) {
          if (!this.on) return;
          const k = still ? 0.6 : 0.5 + 0.5 * Math.sin(t * 2.6);
          ring.material.opacity = 0.45 + 0.45 * k;
          const s = 1 + (still ? 0 : 0.06 * Math.sin(t * 2.6));
          ring.scale.set(s, 1, s);
          beam.material.opacity = 0.2 + 0.18 * k;
        }
      };
    }

    // Tochas: posições determinísticas nas faces de parede que dão para o chão, espaçadas; só as mais
    // próximas do alvo da câmera ganham PointLight real — todas têm chama emissiva, halo e mancha quente
    // no chão/parede (luz "falsa" barata, instanciada).
    _buildTorches(M, own, wallCells) {
      const P = pal(), C = M.C, L = M.L, warm = P.tocha || '#FFB347';
      const wallIdx = new Map(); wallCells.forEach((ci, i) => wallIdx.set(ci, i));
      const cand = [];
      let floors = 0;
      for (let r = 0; r < L; r++) for (let c = 0; c < C; c++) if (M.ch(r, c) !== '#') floors++;
      wallCells.forEach((ci) => {
        const r = (ci / C) | 0, c = ci % C;
        for (const d in MOVES) {
          const nr = r + MOVES[d][0], nc = c + MOVES[d][1];
          if (nr < 0 || nc < 0 || nr >= L || nc >= C) continue;
          const k = M.ch(nr, nc);
          if (k === '#' || k === 'G' || k === 'S') continue;
          // faces voltadas para a câmera padrão (sul / oeste) primeiro: as outras ficam atrás da parede
          const pref = (d === 'S' || d === 'O') ? 0 : 1;
          cand.push({ r, c, d, nr, nc, pref, h: hash2(r * 31 + d.charCodeAt(0), c * 17 + 3) });
        }
      });
      cand.sort((a, b) => a.pref - b.pref || a.h - b.h);
      const cap = clamp(Math.round(floors / 13), 3, 64), list = [];
      for (const t of cand) {
        if (list.length >= cap) break;
        const sp = t.pref ? 5.2 : 4.1;
        const fx = t.c + MOVES[t.d][1] * 0.5, fz = t.r + MOVES[t.d][0] * 0.5;
        if (list.some((o) => (o.fx - fx) * (o.fx - fx) + (o.fz - fz) * (o.fz - fz) < sp * sp)) continue;
        list.push(Object.assign(t, { fx, fz }));
      }
      if (!list.length) { M.torches = null; return; }
      if (LAB.voxel && typeof LAB.voxel.createTorch === 'function') { if (this._buildVoxelTorches(M, list.slice(0, 40), wallIdx)) return; }
      const n = list.length;
      const radial = (size, steps) => makeCanvas(size, size, (ctx) => {
        const h = (size - 1) / 2;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const r = Math.hypot(x - h, y - h) / (h + 0.5);
          if (r >= 1) continue;
          const a = Math.round(Math.pow(1 - r, 1.7) * steps) / steps;   // degraus de pixel art
          if (a > 0) { ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'; ctx.fillRect(x, y, 1, 1); }
        }
      });
      const glowTex = own(canvasTexture(radial(32, 6)));
      const add = (mesh) => { mesh.frustumCulled = false; M.group.add(mesh); return mesh; };
      const iron = own(new THREE.MeshLambertMaterial({ color: 0x2b2420 }));
      const wood = own(new THREE.MeshLambertMaterial({ color: 0x5a3a22 }));
      const bracket = add(new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.07, 0.07, 0.24)), iron, n));
      const cup = add(new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.15, 0.07, 0.15)), iron, n));
      const stick = add(new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.06, 0.16, 0.06)), wood, n));
      const flameO = add(new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.13, 0.17, 0.13).translate(0, 0.085, 0)),
        own(new THREE.MeshBasicMaterial({ color: '#FF7A1E', fog: false })), n));
      const flameI = add(new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.07, 0.11, 0.07).translate(0, 0.055, 0)),
        own(new THREE.MeshBasicMaterial({ color: '#FFE48A', fog: false })), n));
      const fakeMat = { map: glowTex, color: warm, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
      const pool = add(new THREE.InstancedMesh(own(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial(Object.assign({ opacity: 0.32 }, fakeMat))), n));
      const splash = add(new THREE.InstancedMesh(own(new THREE.PlaneGeometry(1.25, 1.25)), own(new THREE.MeshBasicMaterial(Object.assign({ opacity: 0.38 }, fakeMat))), n));
      pool.renderOrder = 1; splash.renderOrder = 1;
      [bracket, cup, stick].forEach((m) => { m.castShadow = false; m.receiveShadow = false; });
      // halo: um ponto aditivo por tocha (brilho varia pela cor do vértice)
      const hpos = new Float32Array(n * 3), hcol = new Float32Array(n * 3);
      const hgeo = own(new THREE.BufferGeometry());
      hgeo.setAttribute('position', new THREE.BufferAttribute(hpos, 3));
      hgeo.setAttribute('color', new THREE.BufferAttribute(hcol, 3).setUsage(THREE.DynamicDrawUsage));
      const halo = new THREE.Points(hgeo, own(new THREE.PointsMaterial({ map: glowTex, size: 1.25, sizeAttenuation: true, vertexColors: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
      add(halo); halo.renderOrder = 5;
      const warmC = new THREE.Color(warm);
      const torches = list.map((t, i) => {
        const nx = MOVES[t.d][1], nz = MOVES[t.d][0];
        const wx = M.x(t.c), wz = M.z(t.r);
        const fx = wx + nx * 0.5, fz = wz + nz * 0.5;   // face da parede
        const rotY = Math.atan2(nx, nz);
        const o = { i, r: t.r, c: t.c, d: t.d, wi: wallIdx.get(t.r * C + t.c), nx, nz, rotY,
          flame: new THREE.Vector3(fx + nx * 0.26, 0.9, fz + nz * 0.26), seed: (t.h % 1000) / 159.0, k: 1 };
        o.light = new THREE.Vector3(fx + nx * 0.45, 1.02, fz + nz * 0.45);
        hpos[i * 3] = o.flame.x; hpos[i * 3 + 1] = o.flame.y + 0.1; hpos[i * 3 + 2] = o.flame.z;
        const d = this._dummy;
        const put = (mesh, x, y, z, sx, sy, sz) => { d.position.set(x, y, z); d.rotation.set(0, rotY, 0); d.scale.set(sx, sy, sz); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); };
        put(bracket, fx + nx * 0.12, 0.8, fz + nz * 0.12, 1, 1, 1);
        put(cup, o.flame.x, 0.84, o.flame.z, 1, 1, 1);
        put(stick, o.flame.x, 0.83, o.flame.z, 1, 1, 1);
        put(pool, wx + nx * 1.05, 0.014, wz + nz * 1.05, 1, 1, 1);
        put(splash, fx + nx * 0.012, 0.92, fz + nz * 0.012, 1, 1, 1);
        hcol[i * 3] = warmC.r; hcol[i * 3 + 1] = warmC.g; hcol[i * 3 + 2] = warmC.b;
        return o;
      });
      [bracket, cup, stick, pool, splash].forEach((m) => { m.instanceMatrix.needsUpdate = true; });
      M.torches = { list: torches, bracket, cup, stick, flameO, flameI, pool, splash, halo, hcol, warmC, nextPick: 0, visible: 1 };
      this._torchFrame(M, 0, 0);
    }

    // Tochas do LAB.voxel (chama em sprite animado, halo e mancha no chão); a luz real continua com o motor.
    _buildVoxelTorches(M, list, wallIdx) {
      const out = [];
      try {
        list.forEach((t, i) => {
          const nx = MOVES[t.d][1], nz = MOVES[t.d][0];
          const fx = M.x(t.c) + nx * 0.5, fz = M.z(t.r) + nz * 0.5, rotY = Math.atan2(nx, nz);
          const obj = LAB.voxel.createTorch({ light: false });
          if (!obj || !obj.group) throw new Error('createTorch sem group');
          obj.group.position.set(fx, 0, fz); obj.group.rotation.y = rotY;
          M.group.add(obj.group);
          out.push({ i, r: t.r, c: t.c, d: t.d, wi: wallIdx.get(t.r * M.C + t.c), nx, nz, rotY, obj, k: 1, vis: 1,
            light: new THREE.Vector3(fx + nx * 0.45, 1.05, fz + nz * 0.45) });
        });
      } catch (err) {
        console.warn('[Maze3D] LAB.voxel.createTorch falhou; usando tochas do motor', err);
        out.forEach((o) => { M.group.remove(o.obj.group); call(o.obj, 'dispose'); });
        return false;
      }
      M.torches = { voxel: true, list: out, nextPick: 0 };
      return true;
    }

    // Chama tremulando (escala/altura por instância), tochas de paredes cortadas somem, halos e luzes reais.
    _torchFrame(M, t, dt) {
      const T = M.torches; if (!T) return;
      const d = this._dummy, still = this.opts.reducedMotion, list = T.list;
      const show = M.intro ? clamp((M.introT - 1.15) / 0.35, 0, 1) : 1;
      if (T.voxel) {
        for (let i = 0; i < list.length; i++) {
          const o = list[i], cut = M.cut && o.wi != null ? M.cut[o.wi] : 0;
          o.vis = cut > 0.08 ? 0 : show;
          o.obj.group.visible = o.vis > 0;
          if (o.vis > 0) { call(o.obj, 'update', still ? 0 : dt, t); o.k = still ? 1 : (o.obj.flicker || 1); }
          if (o.vis > 0 && o.vis < 1) o.obj.group.scale.setScalar(Math.max(0.0001, o.vis)); else o.obj.group.scale.setScalar(1);
        }
      } else {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const cut = M.cut && o.wi != null ? M.cut[o.wi] : 0;
        const vis = (1 - clamp(cut * 4, 0, 1)) * show;
        o.k = still ? 1 : 0.84 + 0.1 * Math.sin(t * 11 + o.seed * 7) + 0.06 * Math.sin(t * 23.7 + o.seed * 3);
        o.vis = vis;
        const s = Math.max(0.0001, vis);
        const put = (mesh, y, sx, sy) => { d.position.set(o.flame.x, y, o.flame.z); d.rotation.set(0, o.rotY + (still ? 0 : 0.2 * Math.sin(t * 5 + o.seed)), 0); d.scale.set(sx * s, sy * s, sx * s); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); };
        put(T.flameO, 0.87, 0.9 + 0.12 * o.k, 0.75 + 0.45 * o.k);
        put(T.flameI, 0.875, 1, 0.7 + 0.5 * o.k);
        const b = vis * (0.7 + 0.3 * o.k);
        T.hcol[i * 3] = T.warmC.r * b; T.hcol[i * 3 + 1] = T.warmC.g * b; T.hcol[i * 3 + 2] = T.warmC.b * b;
      }
      T.flameO.instanceMatrix.needsUpdate = T.flameI.instanceMatrix.needsUpdate = true;
      T.halo.geometry.attributes.color.needsUpdate = true;
      // peças fixas: escondem junto com a parede cortada (só reescreve quando muda)
      const anyCut = M.cut ? 1 : 0;
      if (anyCut || T.visible !== show) {
        T.visible = show;
        for (let i = 0; i < list.length; i++) {
          const o = list[i], s = Math.max(0.0001, o.vis);
          if (o.lastVis === s) continue;
          o.lastVis = s;
          const fx = M.x(o.c) + o.nx * 0.5, fz = M.z(o.r) + o.nz * 0.5;
          const put = (mesh, x, y, z, k) => { d.position.set(x, y, z); d.rotation.set(0, o.rotY, 0); d.scale.set(k, k, k); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); };
          put(T.bracket, fx + o.nx * 0.12, 0.8, fz + o.nz * 0.12, s);
          put(T.cup, o.flame.x, 0.84, o.flame.z, s);
          put(T.stick, o.flame.x, 0.83, o.flame.z, s);
          put(T.splash, fx + o.nx * 0.012, 0.92, fz + o.nz * 0.012, s);
          put(T.pool, M.x(o.c) + o.nx * 1.05, 0.014, M.z(o.r) + o.nz * 1.05, Math.max(0.0001, show));
          T.bracket.instanceMatrix.needsUpdate = T.cup.instanceMatrix.needsUpdate = T.stick.instanceMatrix.needsUpdate = true;
          T.splash.instanceMatrix.needsUpdate = T.pool.instanceMatrix.needsUpdate = true;
        }
      }
      }
      // luzes reais: re-escolhe as mais próximas do alvo da câmera a cada ~0,25 s; quem entra acende em rampa
      const slots = this._torchLights;
      if (this._time >= T.nextPick) {
        T.nextPick = this._time + 0.25;
        const cx = this._cam.tx.x, cz = this._cam.tz.x;
        const order = list.map((o) => ({ i: o.i, d2: (o.light.x - cx) * (o.light.x - cx) + (o.light.z - cz) * (o.light.z - cz) }))
          .sort((a, b) => a.d2 - b.d2).slice(0, slots.length).map((x) => x.i);
        const want = new Set(order);
        slots.forEach((sl) => { if (sl.torch >= 0 && !want.has(sl.torch)) sl.torch = -1; });
        const have = new Set(slots.map((sl) => sl.torch));
        order.forEach((ti) => {
          if (have.has(ti)) return;
          const sl = slots.find((x) => x.torch < 0);
          if (!sl) return;
          sl.torch = ti; sl.fade = 0; have.add(ti);
          sl.light.position.copy(list[ti].light);
        });
      }
      slots.forEach((sl) => {
        if (sl.torch < 0 || sl.torch >= list.length) { sl.light.intensity = 0; return; }
        sl.fade = Math.min(1, sl.fade + dt * 2.5);
        const o = list[sl.torch];
        sl.light.intensity = 5.2 * o.k * o.vis * (still ? 1 : sl.fade);
      });
    }

    _resetTorchLights() {
      (this._torchLights || []).forEach((sl) => { sl.torch = -1; sl.fade = 0; sl.light.intensity = 0; });
    }

    // ---------------------------------------------------------------- intro "construção" em onda a partir de S
    _playIntro(M) {
      M.intro = true;
      M.introT = 0;
      const spread = 0.95;
      M.cellDelay = new Float32Array(M.N);
      for (let i = 0; i < M.N; i++) M.cellDelay[i] = (M.dist[i] / M.maxD) * spread;
      // parede sobe logo depois do chão vizinho mais cedo
      M.wallDelay = new Float32Array(M.walls.cells.length);
      M.walls.cells.forEach((ci, i) => {
        const r = (ci / M.C) | 0, c = ci % M.C;
        let best = Infinity;
        for (const d in MOVES) {
          const nr = r + MOVES[d][0], nc = c + MOVES[d][1];
          if (nr < 0 || nc < 0 || nr >= M.L || nc >= M.C || M.ch(nr, nc) === '#') continue;
          best = Math.min(best, M.cellDelay[nr * M.C + nc]);
        }
        M.wallDelay[i] = (best === Infinity ? M.cellDelay[ci] : best) + 0.14;
      });
      M.ents.forEach((e) => { e.dropDelay = 1.05 + (M.dist[e.ci] / M.maxD) * 0.35; e.holder.visible = false; });
      M.studentDrop = 1.68;
      if (M.ao) M.ao.mesh.visible = false;
      this._drop.visible = false;
      this._locator.visible = false;
      this._introFrame(M, 0);
      return new Promise((resolve) => { M.introResolve = resolve; });
    }

    _introFrame(M, dt) {
      M.introT += dt;
      const t = M.introT, d = this._dummy, C = M.C;
      const put = (mesh, i, x, y, z, sx, sy, sz) => {
        d.position.set(x, y, z); d.scale.set(sx, sy, sz); d.rotation.set(0, 0, 0); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      };
      const pop = (delay, dur) => clamp((t - delay) / dur, 0, 1);
      const tile = (mesh, cells, yBase) => {
        for (let i = 0; i < cells.length; i++) {
          const ci = cells[i], k = pop(M.cellDelay[ci], 0.28);
          const s = k <= 0 ? 0.0001 : Math.max(0.0001, easeOutBack(k));
          put(mesh, i, M.x(ci % C), yBase + (1 - easeOutCubic(k)) * 0.9, M.z((ci / C) | 0), s, s, s);
        }
        mesh.instanceMatrix.needsUpdate = true;
      };
      tile(M.slab.mesh, M.slab.cells, 0);
      if (M.water) tile(M.water.mesh, M.water.cells, WATER_Y);
      M.belts.forEach((b) => tile(b.mesh, b.cells, b.y));
      const wc = M.walls.cells;
      for (let i = 0; i < wc.length; i++) {
        const ci = wc[i], k = pop(M.wallDelay[i], 0.34);
        const sy = k <= 0 ? 0.0001 : Math.max(0.0001, easeOutBack(k));
        const sxz = k <= 0 ? 0.0001 : 1;
        put(M.walls.mesh, i, M.x(ci % C), 0, M.z((ci / C) | 0), sxz, sy, sxz);
      }
      M.walls.mesh.instanceMatrix.needsUpdate = true;
      // o bloco de terra cresce para baixo só depois que a onda de lajes cobriu quase tudo: antes disso o fundo
      // (leito azul da água) aparecia inteiro de uma vez, como um lago, por baixo das casas que ainda não surgiram
      const bk = easeOutCubic(pop(0.8, 0.45));
      M.base.visible = bk > 0;
      M.base.scale.set(1, Math.max(0.0001, bk), 1);
      M.base.position.y = -SLAB_H - (BASE_H * bk) / 2;
      // entidades caem do alto com quique
      M.ents.forEach((e) => {
        const k = pop(e.dropDelay, 0.5);
        e.holder.visible = k > 0;
        e.holder.position.y = (1 - easeOutBounce(k)) * 3.2;
      });
      // o aluno cai em S e dá um "squash"
      const sk = pop(M.studentDrop, 0.3), sq = pop(M.studentDrop + 0.3, 0.24);
      this._drop.visible = sk > 0;
      this._drop.position.y = (1 - easeInQuad(sk)) * 4.5;
      if (sk >= 1 && !M.landed) {
        M.landed = true;
        this._burst(this._rig.position.clone().setY(0.05), pal().luarFraco, 14, { speed: 1.6, up: 0.6, life: 0.5 });
      }
      const squash = sq > 0 && sq < 1 ? Math.sin(sq * Math.PI) * (1 - sq) : 0;
      this._drop.scale.set(1 + squash * 0.35, 1 - squash * 0.4, 1 + squash * 0.35);
      if (t >= M.studentDrop + 0.56) {
        M.intro = false;
        this._writeMatrices(M);
        M.base.visible = true; M.base.scale.set(1, 1, 1); M.base.position.y = -SLAB_H - BASE_H / 2;
        M.ents.forEach((e) => { e.holder.visible = e.hidden !== true; e.holder.position.y = 0; });
        this._drop.visible = true; this._drop.position.y = 0; this._drop.scale.set(1, 1, 1);
        this._locator.visible = true;
        if (M.ao) M.ao.mesh.visible = true;
        this._applyState(this._idx, true);
        if (M.introResolve) { const r = M.introResolve; M.introResolve = null; r(); }
      }
    }

    // ---------------------------------------------------------------- camadas (escurece casas fora de mapa.camadas[k])
    setLayer(k) {
      this._layer = k == null ? 'todas' : String(k);
      this._applyLayerTargets(false);
      this._rebuildTraps();
    }

    _applyLayerTargets(instant) {
      const M = this._m; if (!M) return;
      const camadas = (M.mapa && M.mapa.camadas) || {};
      const k = this._layer, active = k !== 'todas' && Array.isArray(camadas[k]);
      const inLayer = new Uint8Array(M.N);
      if (active) camadas[k].forEach((p) => { if (p && p[0] >= 0 && p[0] < M.L && p[1] >= 0 && p[1] < M.C) inLayer[p[0] * M.C + p[1]] = 1; });
      for (let ci = 0; ci < M.N; ci++) {
        if (!active) { M.dimTarget[ci] = 0; continue; }
        const r = (ci / M.C) | 0, c = ci % M.C;
        if (M.ch(r, c) !== '#') { M.dimTarget[ci] = inLayer[ci] ? 0 : 1; continue; }
        // parede: escurece conforme a vizinhança (8 vizinhos) está fora da camada
        let floors = 0, dimmed = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= M.L || nc >= M.C || M.ch(nr, nc) === '#') continue;
          floors++; if (!inLayer[nr * M.C + nc]) dimmed++;
        }
        M.dimTarget[ci] = floors ? 0.75 * dimmed / floors : 0.45;
      }
      if (instant || this.opts.reducedMotion) { M.dimCur.set(M.dimTarget); this._writeDims(M); M.dimAnimating = false; }
      else { M.dimAnimating = true; this._wake(); }
    }

    _dimFrame(M, dt) {
      const a = 1 - Math.exp(-dt * 9);
      let moving = false;
      for (let i = 0; i < M.N; i++) {
        const d = M.dimTarget[i] - M.dimCur[i];
        if (Math.abs(d) > 0.002) { M.dimCur[i] += d * a; moving = true; } else M.dimCur[i] = M.dimTarget[i];
      }
      this._writeDims(M);
      M.dimAnimating = moving;
    }

    _writeDims(M) {
      const write = (o) => {
        if (!o) return;
        const attr = o.mesh.geometry.getAttribute('aDim');
        for (let i = 0; i < o.cells.length; i++) attr.array[i] = M.dimCur[o.cells[i]];
        attr.needsUpdate = true;
      };
      write(M.slab); write(M.walls); write(M.water); M.belts.forEach(write);
    }

    // ---------------------------------------------------------------- armadilhas (marcadores vermelhos pulsando)
    setTrapsVisible(b) { this._trapsVisible = !!b; this._rebuildTraps(); }

    _rebuildTraps() {
      const M = this._m; if (!M) return;
      const P = pal();
      if (!M.traps) {
        const tex = canvasTexture(makeCanvas(16, 16, (ctx) => {
          ctx.fillStyle = '#ffffff';
          [[1, 1, 4, 1], [1, 1, 1, 4], [11, 1, 4, 1], [14, 1, 1, 4], [1, 14, 4, 1], [1, 11, 1, 4], [11, 14, 4, 1], [14, 11, 1, 4]]
            .forEach((p) => ctx.fillRect(p[0], p[1], p[2], p[3]));
          for (let i = 0; i < 6; i++) { ctx.fillRect(5 + i, 5 + i, 1, 1); ctx.fillRect(10 - i, 5 + i, 1, 1); }
        }));
        M.res.push(tex);
        const cap = Math.max(1, ((M.mapa && M.mapa.armadilhas) || []).length);
        const decalMat = new THREE.MeshBasicMaterial({ map: tex, color: P.erro, transparent: true, depthWrite: false, opacity: 0.9 });
        const gemMat = new THREE.MeshBasicMaterial({ color: P.erro });
        M.res.push(decalMat, gemMat);
        const decal = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), decalMat, cap);
        const gem = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.13, 0), gemMat, cap);
        decal.frustumCulled = gem.frustumCulled = false; decal.renderOrder = 3;
        M.traps = { decal, gem };
        M.group.add(decal, gem);
      }
      const list = ((M.mapa && M.mapa.armadilhas) || []).filter((a) => this._layer === 'todas' || a.chaves === this._layer);
      const seen = new Set(), d = this._dummy;
      M.traps.cells = [];
      let n = 0;
      list.forEach((a) => {
        const ci = a.linha * M.C + a.coluna;
        if (seen.has(ci)) return; seen.add(ci);
        const ch = M.ch(a.linha, a.coluna), y = ch === '~' ? WATER_Y + 0.02 : CONVEYOR[ch] ? 0.03 : 0.02;
        d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
        d.position.set(M.x(a.coluna), y, M.z(a.linha)); d.updateMatrix(); M.traps.decal.setMatrixAt(n, d.matrix);
        M.traps.cells.push([M.x(a.coluna), M.z(a.linha)]);
        n++;
      });
      M.traps.decal.count = M.traps.gem.count = n;
      this._trapsFrame(M, this._time);
      M.traps.decal.instanceMatrix.needsUpdate = M.traps.gem.instanceMatrix.needsUpdate = true;
      M.traps.decal.visible = M.traps.gem.visible = this._trapsVisible && n > 0;
    }

    // Paredes entre a câmera e o aluno abaixam (corte estilo jogo isométrico) para ele nunca sumir atrás delas.
    _cutawayFrame(M, dt) {
      const W = M.walls, nW = W.cells.length;
      if (!nW) return;
      if (!M.cut) { M.cut = new Float32Array(nW); M.cutOn = new Set(); M.wallAt = new Int32Array(M.N).fill(-1); W.cells.forEach((ci, i) => { M.wallAt[ci] = i; }); }
      const want = new Set(), mode = this._cam.mode;
      if ((mode === 'seguir' || mode === 'livre' || mode === 'vitrine') && this._drop.visible) {
        const rx = this._rig.position.x, rz = this._rig.position.z;
        let ux = this.camera.position.x - rx, uz = this.camera.position.z - rz;
        const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        const r0 = Math.round(rz + (M.L - 1) / 2), c0 = Math.round(rx + (M.C - 1) / 2);
        const reach = 0.7 + 1.9 / Math.max(0.6, Math.tan(this._cam.pitch.x));
        for (let r = r0 - 3; r <= r0 + 3; r++) for (let c = c0 - 3; c <= c0 + 3; c++) {
          if (r < 0 || c < 0 || r >= M.L || c >= M.C) continue;
          const wi = M.wallAt[r * M.C + c]; if (wi < 0) continue;
          const dx = M.x(c) - rx, dz = M.z(r) - rz, along = dx * ux + dz * uz, perp = Math.abs(dx * uz - dz * ux);
          if (along > 0.25 && along < reach && perp < 0.95) want.add(wi);
        }
      }
      want.forEach((i) => M.cutOn.add(i));
      if (!M.cutOn.size) return;
      const d = this._dummy, a = 1 - Math.exp(-dt * (this.opts.reducedMotion ? 60 : 9));
      M.cutOn.forEach((i) => {
        const target = want.has(i) ? 1 : 0;
        M.cut[i] += (target - M.cut[i]) * a;
        if (Math.abs(target - M.cut[i]) < 0.01) M.cut[i] = target;
        const ci = W.cells[i], k = easeInOutSine(M.cut[i]);
        d.position.set(M.x(ci % M.C), 0, M.z((ci / M.C) | 0)); d.rotation.set(0, 0, 0); d.scale.set(1, lerp(1, CUT_H, k), 1); d.updateMatrix();
        W.mesh.setMatrixAt(i, d.matrix);
        if (M.cut[i] === 0 && !target) M.cutOn.delete(i);
      });
      W.mesh.instanceMatrix.needsUpdate = true;
    }

    // Armadilhas: retícula vermelha pulsando no chão + losango girando acima da casa.
    _trapsFrame(M, t) {
      const T = M.traps, d = this._dummy, still = this.opts.reducedMotion;
      T.decal.material.opacity = still ? 0.85 : 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t * 4.2));
      for (let i = 0; i < T.cells.length; i++) {
        d.position.set(T.cells[i][0], 1.0 + (still ? 0 : 0.08 * Math.sin(t * 3 + i)), T.cells[i][1]);
        d.rotation.set(0, still ? 0 : t * 1.5 + i, 0); d.scale.set(1, 1.5, 1); d.updateMatrix();
        T.gem.setMatrixAt(i, d.matrix);
      }
      T.gem.instanceMatrix.needsUpdate = true;
    }

    // [IA] Claude – poeira: deriva lenta em 3D, cintila e brilha mais perto das tochas acesas.
    _dustFrame(M, dt) {
      const D = M.dust, pos = D.pos, col = D.col, t = this._time, hx = M.C / 2, hz = M.L / 2;
      for (let i = 0; i < D.n; i++) {
        const j = i * 3, dr = D.drift[i], sd = D.seeds[i];
        pos[j] += (dr[0] + Math.sin(t * 0.5 + sd) * 0.05) * dt;
        pos[j + 1] += dr[1] * dt;
        pos[j + 2] += (dr[2] + Math.cos(t * 0.43 + sd) * 0.05) * dt;
        if (pos[j + 1] > 2.9) pos[j + 1] = 0.15;
        if (pos[j] > hx) pos[j] -= 2 * hx; else if (pos[j] < -hx) pos[j] += 2 * hx;
        if (pos[j + 2] > hz) pos[j + 2] -= 2 * hz; else if (pos[j + 2] < -hz) pos[j + 2] += 2 * hz;
        const tw = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * (1.3 + (sd % 1.7)) + sd * 5));
        col[j] = D.base.r * tw; col[j + 1] = D.base.g * tw; col[j + 2] = D.base.b * tw;
      }
      D.pts.geometry.attributes.position.needsUpdate = true;
      D.pts.geometry.attributes.color.needsUpdate = true;
    }

    // ================================================================ caminho e estado do mundo
    setPath(percurso, opts) {
      if (this._disposed) return;
      opts = opts || {};
      this._cancelJob();
      const P = Array.isArray(percurso) ? percurso.filter((p) => p && Number.isFinite(p.linha) && Number.isFinite(p.coluna)) : [];
      const status = opts.status || (P.length ? 'OK' : 'SEM_SOLUCAO');
      this._clearEndingState();
      this._path = this._analysePath(P, status);
      this._cycleArmed = false;
      // [IA] Claude – baú virado para a casa de onde o aluno chega no último passo
      const fin = this._finalGoal(this._path);
      if (fin && P.length > 1) this._orientGoal(fin, dirBetween(P[P.length - 1], P[P.length - 2]));
      this._buildTrail();
      this._applyState(0, true);
      this._emit('step', { idx: 0 });
      const gen = ++this._attractGen;
      if (!P.length && (status === 'SEM_SOLUCAO' || status === 'RECUSA')) {
        // [IA] Claude – sem caminho: o aluno em S levanta as mãos, triste; o baú fica fechado com um farol
        const path = this._path;
        this._ready.then(() => this._wait(null, 0.25)).then(() => {
          if (this._path !== path || this._disposed || this._ending) return;
          this._playFailEnding(!this.opts.reducedMotion);
        });
      }
      if (this.opts.attract) this._attractLoop(gen);
    }

    _analysePath(P, status) {
      const M = this._m, C = M ? M.C : 1;
      const firstVisit = new Map(), colors = [], lastKeys = [], layers = [];
      const pickCell = {};
      let lastKey = null;
      const P0 = P[0];
      if (P0 && P0.chaves) lastKey = P0.chaves[P0.chaves.length - 1];
      P.forEach((p, i) => {
        const ci = p.linha * C + p.coluna;
        if (!firstVisit.has(ci)) firstVisit.set(ci, i);
        const keys = (p.chaves && p.chaves !== '-') ? p.chaves : '';
        if (i > 0) {
          const prev = (P[i - 1].chaves && P[i - 1].chaves !== '-') ? P[i - 1].chaves : '';
          for (const k of keys) if (prev.indexOf(k) < 0) { lastKey = k; if (!(k in pickCell)) pickCell[k] = M && M.ch(p.linha, p.coluna) === k ? ci : null; }
        }
        lastKeys.push(lastKey);
        layers.push(keys.length);
        colors.push(this._pathColor(keys, keys ? lastKey : null));
      });
      // chaves que já vêm na mão no primeiro estado (ciclo negativo): não sabemos de qual casa vieram
      if (P0 && P0.chaves) for (const k of P0.chaves) if (!(k in pickCell)) pickCell[k] = null;
      return { P, status, last: P.length - 1, firstVisit, colors, lastKeys, layers, pickCell, maxLayer: Math.max(0, ...layers) };
    }

    _pathColor(chaves, lastKey) {
      if (LAB.pixel && typeof LAB.pixel.pathColor === 'function') {
        try { const c = LAB.pixel.pathColor(chaves, lastKey); if (c) return c; } catch (e) { /* usa a regra local */ }
      }
      const P = pal();
      return (!chaves || !lastKey) ? P.luar : (P.chave[lastKey] || P.luar);
    }

    _cellPos(r, c, out) {
      const M = this._m;
      return (out || new THREE.Vector3()).set(M.x(c), 0, M.z(r));
    }

    _placeAt(r, c) {
      if (!this._m) return;
      this._cellPos(r, c, this._rig.position);
      const ch = this._m.ch(r, c);
      this._locator.position.y = ch === '~' ? WATER_Y + 0.015 : CONVEYOR[ch] ? 0.025 : 0.012;
    }

    // ---------------------------------------------------------------- rastro (pontos coloridos por camada)
    _disposeTrail() {
      if (this._trail) {
        this._trail.parent && this._trail.parent.remove(this._trail);
        this._trail.geometry.dispose(); this._trail.material.dispose();
        if (typeof this._trail.dispose === 'function') this._trail.dispose();
        this._trail = null;
      }
    }

    _buildTrail() {
      this._disposeTrail();
      const M = this._m, path = this._path;
      if (!M || !path || !path.P.length) return;
      const P = path.P, n = 2 * P.length - 1;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.04, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
      const d = this._dummy, col = this._tmpC, maxL = path.maxLayer;
      const yAt = (p) => { const ch = M.ch(p.linha, p.coluna); return ch === '~' ? WATER_Y + 0.03 : CONVEYOR[ch] ? 0.04 : 0.03; };
      // cada camada de chaves anda numa "faixa" paralela, deslocada na perpendicular do movimento
      const lane = (k) => (maxL ? (k - maxL / 2) * Math.min(0.17, 0.62 / maxL) : 0);
      const at = (i, p, prev, s, color, li) => {
        const o = lane(li), mv = MOVES[p.movimento] ? p.movimento : (prev ? dirBetween(prev, p) : 'S');
        const horiz = mv === 'L' || mv === 'O';
        let x = M.x(p.coluna), z = M.z(p.linha), y = yAt(p);
        if (prev) { x = (x + M.x(prev.coluna)) / 2; z = (z + M.z(prev.linha)) / 2; y = Math.max(y, yAt(prev)); }
        d.position.set(x + (horiz ? 0 : o), y, z + (horiz ? o : 0)); d.rotation.set(0, 0, 0); d.scale.set(s, 1, s); d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        mesh.setColorAt(i, col.set(color));
      };
      at(0, P[0], null, 1, path.colors[0], path.layers[0]);
      for (let i = 1; i < P.length; i++) {
        at(2 * i - 1, P[i], P[i - 1], 0.55, path.colors[i], path.layers[i]);
        at(2 * i, P[i], null, 1, path.colors[i], path.layers[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.count = 1;
      mesh.visible = this._trailVisible;
      mesh.renderOrder = 2;
      this._trail = mesh;
      M.group.add(mesh);
    }

    _setTrailCount(n) { if (this._trail) this._trail.count = clamp(n, 0, this._trail.instanceMatrix.count); }

    setTrailVisible(b) { this._trailVisible = !!b; if (this._trail) this._trail.visible = this._trailVisible; }

    // ---------------------------------------------------------------- estado derivado para qualquer índice (salto)
    _applyState(idx, force) {
      const M = this._m; if (!M) return;
      const st = this._ensureStudent(), path = this._path;
      const P = path && path.P;
      if (!P || !P.length) {
        this._idx = 0;
        this._placeAt(M.start.r, M.start.c);
        call(st, 'setWalking', false); call(st, 'setWading', 0); call(st, 'setHeldKeys', []);
        M.keyEnts.forEach((e) => this._setEnt(e, 'show', force));
        M.doorEnts.forEach((e) => this._setEnt(e, 'closed', force));
        M.bonusEnts.forEach((e) => e && this._setEnt(e, 'fresh', force));
        this._setTrailCount(0);
        if (this._ending && this._ending !== 'fail') this._clearEndingState();
        return;
      }
      idx = clamp(idx, 0, P.length - 1);
      this._idx = idx;
      const p = P[idx], held = (p.chaves && p.chaves !== '-') ? p.chaves : '';
      this._placeAt(p.linha, p.coluna);
      this._drop.position.y = 0; this._drop.scale.set(1, 1, 1);
      if (!M.intro) this._drop.visible = true;
      call(st, 'setWalking', false);
      call(st, 'setWading', M.ch(p.linha, p.coluna) === '~' ? WADE : 0);
      call(st, 'setHeldKeys', held.split(''));
      if (p.movimento && MOVES[p.movimento]) call(st, 'face', p.movimento);
      else if (idx === 0) call(st, 'face', 'S');
      this._walkStopAt = 0;
      this._lastMoveT = this._time; this._idleFaced = false;
      this._rigVel = { x: 0, z: 0 }; this._rigLast = null;   // salto não conta como velocidade da câmera

      M.keyEnts.forEach((e) => {
        const pc = path.pickCell[e.letter];
        const taken = held.indexOf(e.letter) >= 0 && (pc == null || pc === e.ci);
        this._setEnt(e, taken ? 'taken' : 'show', force);
      });
      M.doorEnts.forEach((e) => {
        const fv = path.firstVisit.get(e.ci);
        this._setEnt(e, fv !== undefined && fv <= idx ? 'open' : 'closed', force);
      });
      const consumed = new Set(Array.isArray(p.bonus) ? p.bonus : []);
      M.bonusEnts.forEach((e) => { if (e) this._setEnt(e, consumed.has(e.bidx) ? 'used' : 'fresh', force); });
      this._setTrailCount(2 * idx + 1);
      // [IA] Claude – salto para o fim de um caminho OK: pose final na hora (baú aberto + joinha)
      if (idx === path.last && this._finalGoal(path)) this._applyOkEndingInstant();
      else if (this._ending) this._clearEndingState();
    }

    _setEnt(e, state, force) {
      if (!force && e.state === state) return;
      e.state = state;
      const o = e.obj;
      if (e.kind === 'key') {
        e.hidden = state === 'taken';
        if (!e.hidden) call(o, 'reset');
        if (!this._m.intro) e.holder.visible = !e.hidden;
        o.group.visible = !e.hidden;
      } else if (e.kind === 'door') {
        call(o, 'setOpen', state === 'open');
      } else {
        call(o, 'setConsumed', state === 'used');
        if (state === 'fresh') call(o, 'reset');
      }
    }

    // ================================================================ reprodução
    goTo(idx, opts) {
      if (this._disposed || !this._m) return Promise.resolve();
      const path = this._path;
      if (!path || !path.P.length) { this._applyState(0); return Promise.resolve(); }
      const last = path.last;
      idx = clamp(Math.round(+idx || 0), 0, last);
      const animate = !!(opts && opts.animate);
      this._cancelJob();
      const from = this._idx;
      // [IA] Claude – voltar a andar desfaz o final triste (ciclo pausado); o final feliz é refeito por _applyState
      if (this._ending === 'fail' && path.P.length) this._clearEndingState();
      // ciclo negativo: do último estado volta ao primeiro (mesma casa) → só reinicia
      if (animate && idx === 0 && from === last && last > 0 && path.status === 'CICLO_NEGATIVO') {
        this._applyState(0);
        this._emit('loop', {});
        this._emit('step', { idx: 0 });
        return Promise.resolve();
      }
      if (!(animate && idx === from + 1)) {
        this._applyState(idx);
        this._emit('step', { idx });
        return Promise.resolve();
      }
      return this._runStep(idx);
    }

    _cancelJob() {
      // tweens auxiliares (queda do recomeço no modo vitrine) também param
      if (this._aux) { this._aux.tweens.forEach((tw) => tw.cancel()); this._aux = null; }
      const job = this._job;
      if (!job) return;
      this._job = null;
      job.cancelled = true;
      job.tweens.forEach((tw) => tw.cancel());
      this._boost.clear();
      this._busy = false;
      this._applyState(job.target, true);
      job.finish();
    }

    _runStep(idx) {
      if (this._path && this._path.status === 'CICLO_NEGATIVO') this._cycleArmed = true;
      return this._runJob(idx, (job) => this._stepSequence(job, idx));
    }

    // [IA] Claude – roda uma sequência animada como "job" cancelável; ao cancelar, _applyState(target) acerta o mundo.
    _runJob(idx, seq) {
      const job = { target: idx, cancelled: false, tweens: [] };
      let settled = false, resolveFn;
      const promise = new Promise((res) => { resolveFn = res; });
      job.finish = () => { if (!settled) { settled = true; resolveFn(); } };
      this._job = job;
      this._wake();
      seq(job).then(() => {
        this._lastStepEnd = this._time;
        if (job.cancelled) return;
        if (this._job === job) this._job = null;
        job.finish();
      }, (err) => {
        console.error('[Maze3D] passo animado falhou', err);
        if (job.cancelled) return;
        if (this._job === job) this._job = null;
        this._applyState(idx, true);
        job.finish();
      });
      return promise;
    }

    // Fator de floreio: 1 até 8 passos/s, cai até ~0.4 perto de 16, e 0 (pula) a partir de 16.
    _flourish() {
      if (this.opts.reducedMotion) return 0;
      const s = this._speed;
      if (s >= 16) return 0;
      if (s <= 8) return 1;
      return 1 - ((s - 8) / 8) * 0.6;
    }

    // [IA] Claude – duração-alvo de um floreio: em 1× (3 passos/s) ou mais rápido usa o alvo do SPEC; mais
    // devagar cresce até a duração nominal da animação (toca inteira, sem acelerar — UPDATE 3/4).
    _flourishWant(name, fl) {
      const f = FLOURISH[name], slow = smoothstep(0.75, 3, this._speed);
      return Math.max(lerp(Math.max(f[0], f[1]), f[1], slow), 0.05) / Math.max(fl, 0.05);
    }

    async _stepSequence(job, idx) {
      const M = this._m, path = this._path, P = path.P, a = P[idx - 1], b = P[idx];
      const st = this._ensureStudent(), PAL = pal();
      const chA = M.ch(a.linha, a.coluna), chB = M.ch(b.linha, b.coluna);
      const dir = MOVES[b.movimento] ? b.movimento : dirBetween(a, b);
      const walkT = 1 / this._speed, fl = this._flourish();
      const from = this._cellPos(a.linha, a.coluna), to = this._cellPos(b.linha, b.coluna);
      const ciB = b.linha * M.C + b.coluna, ent = M.entByCell.get(ciB);
      const heldA = (a.chaves && a.chaves !== '-') ? a.chaves : '', heldB = (b.chaves && b.chaves !== '-') ? b.chaves : '';
      const above = (v, y) => v.clone().setY(y);
      this._idleFaced = false;
      this._walkStopAt = 0;

      // ---- movimento reduzido: passo discreto, mesmo ritmo, sem floreios
      if (this.opts.reducedMotion) {
        this._applyState(idx);
        this._emitArrivalEvents(idx, a, b, chB, ent, heldA, heldB);
        await this._wait(job, walkT);
        return;
      }

      call(st, 'face', dir);
      const cadence = clamp(this._speed / 4, 0.18, 2.6);   // [IA] Claude – devagar: passada lenta, sem patinar
      let doorK = 0;

      // ---- porta: para na frente, encaixa a chave, porta abre, depois entra
      if (ent && ent.kind === 'door' && ent.state !== 'open') {
        doorK = 0.3;
        call(st, 'setWalking', true, cadence);
        await this._move(job, from, to, 0, doorK, walkT * doorK);
        if (job.cancelled) return;
        call(st, 'setWalking', false);
        const letter = ent.letter.toLowerCase();
        if (fl > 0) {
          this._busy = true;
          let lock = null;
          try { lock = call(ent.obj, 'lockWorldPosition', this._rig.position.clone()); } catch (e) { lock = null; }
          await this._flourishRun(job, [{ name: 'insertKey', obj: st, run: () => call(st, 'insertKey', letter, lock || above(to, 0.7)) }], fl);
          if (job.cancelled) return;
          this._burst(above(to, 0.1), PAL.luarFraco, 16, { speed: 1.4, up: 0.5, life: 0.6, floor: 0 });
          await this._flourishRun(job, [{ name: 'open', obj: ent.obj, run: () => call(ent.obj, 'open') }], fl);
          if (job.cancelled) return;
          if (!ent.obj.isOpen) call(ent.obj, 'setOpen', true);
          this._busy = false;
        } else {
          call(ent.obj, 'setOpen', true);
          this._burst(above(to, 0.1), PAL.luarFraco, 8, { speed: 1.2, up: 0.4, life: 0.4 });
        }
        ent.state = 'open';
        this._emit('door', { letter: ent.letter, idx });
      }

      // ---- caminhar (ou deslizar na esteira, quando sai dela na direção da seta)
      const slide = CONVEYOR[chA] === dir;
      call(st, 'setWalking', !slide, cadence);
      const wadeA = chA === '~' ? WADE : 0, wadeB = chB === '~' ? WADE : 0;
      let half = false;
      // [IA] Claude – último passo até o baú: anda só até encostar nele (o baú ocupa a casa G)
      const isFinal = idx === path.last && !!this._finalGoal(path);
      const kEnd = isFinal ? CHEST_STOP : 1;
      await this._move(job, from, to, doorK, kEnd, walkT * (1 - doorK) * (isFinal ? 0.8 : 1), (u) => {
        if (wadeA !== wadeB) call(st, 'setWading', lerp(wadeA, wadeB, smoothstep(0.25, 0.85, u)));
        if (!half && u >= 0.5) { half = true; this._setTrailCount(2 * idx); }
        if (slide) this._drop.rotation.z = 0;
      }, slide ? easeInOutSine : linear);
      if (job.cancelled) return;

      // ---- chegou: estado do índice + efeitos de chegada
      this._idx = idx;
      this._placeAt(b.linha, b.coluna);
      if (isFinal) this._rig.position.lerpVectors(from, to, kEnd);
      this._setTrailCount(2 * idx + 1);
      this._lastMoveT = this._time;
      this._walkStopAt = this._time + 0.16;
      this._emit('step', { idx });

      if (chB === '~') {
        this._burst(above(to, WATER_Y + 0.05), PAL.tiles.aguaClara, 16, { speed: 1.3, up: 1.0, life: 0.55 });
        this._floatText(fmtCusto(5), PAL.erro, above(to, 1.75));
        this._emit('water', { idx });
      } else if (chB === ',') {
        this._burst(above(to, 0.05), PAL.tiles.lama, 12, { speed: 1.1, up: 0.7, life: 0.5 });
        this._floatText(fmtCusto(3), PAL.erro, above(to, 1.75));
        this._emit('mud', { idx });
      }

      // chave
      if (ent && ent.kind === 'key' && heldB.indexOf(ent.letter) >= 0 && heldA.indexOf(ent.letter) < 0) {
        const color = PAL.chave[ent.letter] || PAL.luar;
        this._emit('key', { letter: ent.letter, idx });
        this._burst(above(to, 0.8), color, 22, { speed: 2.0, up: 1.2, life: 0.7 });
        if (fl > 0) {
          this._busy = true;
          call(st, 'setWalking', false);
          await this._flourishRun(job, [
            { name: 'raiseKey', obj: st, run: () => call(st, 'raiseKey', ent.letter) },
            { name: 'collectKey', obj: ent.obj, run: () => call(ent.obj, 'collect') }], fl);
          if (job.cancelled) return;
          this._busy = false;
        }
        this._setEnt(ent, 'taken', true);
        call(st, 'setHeldKeys', heldB.split(''));
      } else if (heldB !== heldA) {
        call(st, 'setHeldKeys', heldB.split(''));
      }

      // bônus '+' e fonte '*'
      if (ent && (ent.kind === 'bonus' || ent.kind === 'fonte')) {
        const before = new Set(Array.isArray(a.bonus) ? a.bonus : []), after = new Set(Array.isArray(b.bonus) ? b.bonus : []);
        const already = before.has(ent.bidx), takesNow = !already && after.has(ent.bidx);
        let value;
        if (ent.kind === 'bonus') value = already ? 1 : -4;
        else value = already ? 1 : -2;                          // fonte: −2 sempre; +1 só na variante consumível
        const color = value < 0 ? PAL.ok : PAL.luarFraco;
        this._floatText(fmtCusto(value), color, above(to, 1.75));
        this._emit('bonus', { value, idx, indice: ent.bidx, casa: ent.sym });
        if (takesNow || (ent.kind === 'bonus' && !already)) {
          this._burst(above(to, 0.5), ent.kind === 'bonus' ? (PAL.ouro || PAL.tiles.bonus || PAL.ok) : PAL.tiles.fonte, 18, { speed: 1.8, up: 1.1, life: 0.6 });
          if (fl > 0) {
            await this._flourishRun(job, [{ name: 'collectBonus', obj: ent.obj, run: () => call(ent.obj, 'collect') }], fl);
            if (job.cancelled) return;
          }
          this._setEnt(ent, 'used', true);
        } else if (ent.kind === 'fonte' && !already) {
          this._burst(above(to, 0.6), PAL.tiles.fonte, 10, { speed: 1.2, up: 1.3, life: 0.5 });
        }
      }

      // [IA] Claude – baú: abre, brilha e o aluno vira para a câmera com um joinha feliz
      if (isFinal) {
        call(st, 'setWalking', false);
        await this._playOkEnding(job, fl);
      }
    }

    // Eventos de chegada sem animação (movimento reduzido).
    _emitArrivalEvents(idx, a, b, chB, ent, heldA, heldB) {
      const doorOpened = ent && ent.kind === 'door';
      if (doorOpened && this._path.firstVisit.get(ent.ci) === idx) this._emit('door', { letter: ent.letter, idx });
      this._emit('step', { idx });
      if (chB === '~') this._emit('water', { idx });
      else if (chB === ',') this._emit('mud', { idx });
      if (ent && ent.kind === 'key' && heldB.indexOf(ent.letter) >= 0 && heldA.indexOf(ent.letter) < 0) this._emit('key', { letter: ent.letter, idx });
      if (ent && (ent.kind === 'bonus' || ent.kind === 'fonte')) {
        const already = (Array.isArray(a.bonus) ? a.bonus : []).indexOf(ent.bidx) >= 0;
        this._emit('bonus', { value: already ? 1 : ent.kind === 'bonus' ? -4 : -2, idx, indice: ent.bidx, casa: ent.sym });
      }
      if (idx === this._path.last && this._finalGoal(this._path)) this._emit('goal', { idx });
    }

    _move(job, from, to, k0, k1, dur, onU, ease) {
      const rig = this._rig.position;
      return this._tween(job, dur, (e) => {
        const u = lerp(k0, k1, e);
        rig.lerpVectors(from, to, u);
        if (onU) onU(u);
      }, ease || linear);
    }

    /** [IA] Claude – passos por segundo (0,25..30; o player usa 0,75..6 = 0,25×..2× com 1× = 3 passos/s).
     *  Devagar, a caminhada ocupa o intervalo inteiro e os floreios tocam completos (nada de pausas paradas). */
    setSpeed(s) {
      const v = +s;
      if (Number.isFinite(v) && v > 0) this._speed = clamp(v, SPEED_MIN, SPEED_MAX);
    }
    get speed() { return this._speed; }

    // ================================================================ [IA] Claude – finais (UPDATE 5)
    // Baú do fim de um caminho OK (null se o caminho não termina num G).
    _finalGoal(path) {
      const M = this._m;
      if (!M || !path || path.status !== 'OK' || !path.P.length) return null;
      const p = path.P[path.last], ci = p.linha * M.C + p.coluna;
      if (M.ch(p.linha, p.coluna) !== 'G') return null;
      return M.goalEnts.find((g) => g.ci === ci) || null;
    }

    // Ponto onde o aluno para, encostado no baú (fração CHEST_STOP do último passo).
    _endApproach(path) {
      const P = path.P, b = P[path.last], a = P[Math.max(0, path.last - 1)];
      const to = this._cellPos(b.linha, b.coluna);
      if (a === b) return to.add(new THREE.Vector3(0, 0, 0.6));
      return this._cellPos(a.linha, a.coluna).lerp(to, CHEST_STOP);
    }

    // thumbsUp/handsUp do LAB.voxel recebem o alvo para onde virar (a câmera) e mantêm a pose; "instantâneo" =
    // adianta o relógio do aluno até o fim da animação de entrada.
    _studentPose(kind, instant, look) {
      const st = this._student; if (!st) return undefined;
      const fn = kind === 'ok' ? 'thumbsUp' : 'handsUp';
      let p;
      if (typeof st[fn] === 'function') p = st[fn](look || this.camera);
      else if (kind === 'ok') { call(st, 'setExpression', 'happy'); p = instant ? undefined : call(st, 'celebrate'); }
      else { call(st, 'setExpression', 'sad'); p = instant ? undefined : call(st, 'shrug'); }
      if (instant && typeof st[fn] === 'function') this._fastForwardStudent(3);
      return p;
    }

    _fastForwardStudent(sec) {
      const st = this._student; if (!st) return;
      if ('timeScale' in st) {
        const ts = st.timeScale;
        for (let i = 0; i < 4; i++) { st.timeScale = sec / 4 / 0.05; call(st, 'update', 0.05, this._time); }
        st.timeScale = ts;
      } else call(st, 'update', sec, this._time);
    }

    _clearStudentPose() {
      const st = this._student; if (!st) return;
      for (const n of ['clearPose', 'resetPose', 'relax']) if (typeof st[n] === 'function') { try { st[n](); } catch (e) { /* opcional */ } break; }
      call(st, 'setExpression', 'normal');
    }

    _setChestOpen(e, open, instant) {
      if (!e) return undefined;
      e.opened = !!open;
      if (e.chest) {
        if (!open) { if (typeof e.obj.setOpen === 'function') e.obj.setOpen(false); else call(e.obj, 'reset'); return undefined; }
        if (instant && typeof e.obj.setOpen === 'function') { e.obj.setOpen(true); return undefined; }
        return call(e.obj, 'open');
      }
      return open && !instant ? call(e.obj, 'trigger') : undefined;   // saída antiga: só o brilho
    }

    _setBeacons(on) {
      const M = this._m; if (!M) return;
      M.goalEnts.forEach((e) => {
        if (e.beacon) e.beacon.set(on);
        for (const n of ['setHighlight', 'highlight', 'setBeacon']) if (typeof e.obj[n] === 'function') { try { e.obj[n](!!on); } catch (err) { /* opcional */ } break; }
      });
    }

    _chestGlowAt(e, target, burst) {
      const g = this._chestGlow || (this._chestGlow = { cur: 0, target: 0, burst: 0 });
      g.target = target; if (burst) g.burst = Math.max(g.burst, burst);
      if (e) {
        const f = MOVES[e.facing] || MOVES.S;
        this._chestLight.position.set(e.holder.position.x + f[1] * 0.45, 0.95, e.holder.position.z + f[0] * 0.45);
      }
    }

    _chestLightFrame(dt) {
      const g = this._chestGlow; if (!g) return;
      g.cur += (g.target - g.cur) * (1 - Math.exp(-dt * 4));
      g.burst = Math.max(0, g.burst - dt * g.burst * 1.6 - dt * 0.6);
      const flick = this.opts.reducedMotion ? 1 : 0.92 + 0.08 * Math.sin(this._time * 8.7);
      this._chestLight.intensity = g.cur * flick + g.burst;
    }

    // Câmera "seguir" no final feliz: um pouco mais alta e de lado, para o baú não ficar escondido atrás do
    // aluno; devolve o ponto (mundo) para onde ele deve virar (a câmera de destino).
    _okEndingCamera(e) {
      const p = this._rig.position, c = e.holder.position;
      let ax = p.x - c.x, az = p.z - c.z;
      const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      const g = this._cam.goal, cy = Math.sin(g.yaw), cz = Math.cos(g.yaw);
      let best = null;
      for (const sgn of [1, -1]) {
        let vx = ax * 0.42 + (-az * sgn) * 0.9, vz = az * 0.42 + (ax * sgn) * 0.9;
        const vl = Math.hypot(vx, vz); vx /= vl; vz /= vl;
        const dot = vx * cy + vz * cz;
        if (!best || dot > best.dot) best = { vx, vz, dot };
      }
      const yaw = Math.atan2(best.vx, best.vz);
      if (this._cam.mode === 'seguir' && !this.opts.attract) {
        if (!this._camSaved) this._camSaved = { yaw: g.yaw, pitch: g.pitch, dist: g.dist };
        // menor giro equivalente
        let y = yaw; while (y - this._cam.yaw.x > Math.PI) y -= 2 * Math.PI; while (y - this._cam.yaw.x < -Math.PI) y += 2 * Math.PI;
        g.yaw = y; g.pitch = 54 * DEG; g.dist = Math.min(g.dist, FOLLOW_DIST * 0.85);
        this._okFocus = c.clone();
        return new THREE.Vector3(p.x + best.vx * 20, 8, p.z + best.vz * 20);
      }
      return this.camera.position.clone();
    }

    _restoreEndingCamera() {
      const sv = this._camSaved; this._camSaved = null;
      this._okFocus = null; this._failFocus = null;
      if (sv && this._cam.mode === 'seguir') { const g = this._cam.goal; g.yaw = sv.yaw; g.pitch = sv.pitch; g.dist = sv.dist; }
    }

    _faceToward(pt, instant) {
      const dx = pt.x - this._rig.position.x, dz = pt.z - this._rig.position.z;
      call(this._student, 'face', Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'L' : 'O') : (dz > 0 ? 'S' : 'N'), instant);
    }

    // Pose final do caminho OK aplicada na hora (saltos, cancelamentos, movimento reduzido). Idempotente.
    _applyOkEndingInstant() {
      const path = this._path, e = this._finalGoal(path), st = this._student;
      if (!e) return;
      this._rig.position.copy(this._endApproach(path));
      if (this._failFocus) this._restoreEndingCamera();
      this._setBeacons(false);
      if (!e.opened) this._setChestOpen(e, true, true);
      this._chestGlowAt(e, 3.2, 0);
      const look = this._okFocus ? null : this._okEndingCamera(e);
      if (look) this._faceToward(look, true);
      this._idleFaced = true;
      if (this._ending !== 'ok') {
        this._ending = 'ok';
        this._studentPose('ok', true, look);
        this._emit('ending', { tipo: 'ok', instant: true });
      }
    }

    async _playOkEnding(job, fl) {
      const M = this._m, path = this._path, e = this._finalGoal(path), st = this._student, PAL = pal();
      if (!e) return;
      const fast = !(fl > 0);
      this._busy = true;
      if (this._failFocus) this._restoreEndingCamera();
      this._setBeacons(false);
      call(st, 'face', dirBetween(path.P[Math.max(0, path.last - 1)], path.P[path.last]));
      if (!fast) await this._wait(job, 0.12);
      if (job && job.cancelled) return;
      const pChest = this._setChestOpen(e, true, fast);
      this._chestGlowAt(e, 3.2, fast ? 0 : 9);
      this._emit('goal', { idx: path.last });
      const top = e.holder.position.clone().setY(0.75);
      const gold = PAL.tiles.saida || '#E8B53A';
      this._burst(top, '#FFE07A', 26, { speed: 2.2, up: 2.2, life: 0.9 });
      this._burst(top, gold, 18, { speed: 1.6, up: 2.6, life: 1.1 });
      this._burst(top, '#FFF6CF', 10, { speed: 1.0, up: 1.6, life: 0.7 });
      if (!fast) {
        await this._race(job, pChest, 0.95 / Math.max(fl, 0.4));
        if (job && job.cancelled) return;
        this._burst(top.clone().setY(1.05), '#FFE07A', 12, { speed: 1.2, up: 1.4, life: 1.0, confetti: true });
      }
      const look = this._okEndingCamera(e);
      this._faceToward(look, fast);
      if (!fast) { await this._wait(job, 0.25); if (job && job.cancelled) return; }
      this._ending = 'ok';
      this._idleFaced = true;
      const pPose = this._studentPose('ok', fast, look);
      this._emit('ending', { tipo: 'ok', instant: fast });
      if (!fast) await this._race(job, pPose, 1.5 / Math.max(fl, 0.4));
      this._busy = false;
    }

    // Final triste: mãos para cima no lugar (S quando não há caminho), baú fechado com farol e a câmera
    // "seguir" recua para mostrar os dois.
    _playFailEnding(animate) {
      const M = this._m, st = this._student; if (!M || !st) return Promise.resolve();
      const path = this._path;
      this._ending = 'fail';
      this._busy = true;
      this._setBeacons(true);
      const e = M.goalEnts[0] || null;
      if (e) { this._setChestOpen(e, false, true); this._chestGlowAt(e, 1.6, 0); }
      call(st, 'setWalking', false);
      call(st, 'face', this._dirToCamera(), !animate);
      this._idleFaced = true;
      if (e && this._cam.mode === 'seguir' && !this.opts.attract) {
        if (!this._camSaved) this._camSaved = { yaw: this._cam.goal.yaw, pitch: this._cam.goal.pitch, dist: this._cam.goal.dist };
        this._failFocus = e.holder.position.clone();
        const dd = Math.hypot(this._failFocus.x - this._rig.position.x, this._failFocus.z - this._rig.position.z);
        this._cam.goal.dist = clamp(FOLLOW_DIST + dd * 0.85, FOLLOW_DIST, this._distLimits()[1]);
      }
      const p = this._studentPose('fail', !animate);
      this._emit('fail', { status: path ? path.status : 'SEM_SOLUCAO', idx: this._idx });
      this._emit('ending', { tipo: 'fail', instant: !animate });
      return Promise.resolve(animate ? this._race(null, p, 2.2) : null).then(() => { if (this._ending === 'fail') this._busy = false; });
    }

    _clearEndingState() {
      const M = this._m;
      const had = this._ending;
      this._ending = null;
      this._restoreEndingCamera();
      if (M) {
        M.goalEnts.forEach((e) => { if (e.opened) this._setChestOpen(e, false, true); });
        this._setBeacons(false);
      }
      this._chestGlowAt(null, 0, 0);
      if (this._chestGlow) this._chestGlow.burst = 0;
      if (had) {
        this._clearStudentPose();
        this._busy = false;
        this._emit('ending', { tipo: null });
      }
    }

    /** [IA] Claude – (re)toca o final do caminho atual. OK: pula para o último passo, abre o baú e faz o joinha.
     *  SEM_SOLUCAO / RECUSA / CICLO_NEGATIVO: mãos para cima, triste, baú fechado com farol.
     *  opts.animate === false → pose final na hora. Devolve Promise (fim da animação). */
    showEnding(opts) {
      if (this._disposed || !this._m || !this._path) return Promise.resolve();
      const animate = !(opts && opts.animate === false) && !this.opts.reducedMotion;
      this._cancelJob();
      const path = this._path;
      if (path.status === 'OK' && path.P.length) {
        if (!this._finalGoal(path)) return Promise.resolve();
        if (this._idx !== path.last) { this._applyState(path.last, true); this._emit('step', { idx: path.last }); }
        if (!animate) { this._applyOkEndingInstant(); return Promise.resolve(); }
        this._clearEndingState();
        this._rig.position.copy(this._endApproach(path));
        return this._runJob(path.last, (job) => this._playOkEnding(job, 1));
      }
      if (this._ending === 'fail') this._clearEndingState();
      return this._playFailEnding(animate);
    }

    /** [IA] Claude – desfaz o final (baú fechado, sem farol, aluno em pose neutra) sem mexer no passo atual. */
    clearEnding() {
      if (this._disposed) return;
      this._cancelJob();
      this._clearEndingState();
      this._cycleArmed = false;
    }

    get ending() { return this._ending || null; }

    // ---------------------------------------------------------------- modo vitrine (hero)
    async _attractLoop(gen) {
      await this._ready;
      const alive = () => gen === this._attractGen && !this._disposed;
      if (!alive()) return;
      const path = this._path;
      if (!path || path.P.length < 2) return;
      if (this.opts.reducedMotion) {
        // sem autoplay: mostra o caminho inteiro de uma vez (aluno na saída, rastro completo)
        this._applyState(path.last, true);
        this._emit('step', { idx: path.last });
        return;
      }
      await this._wait(null, 0.5);
      this._vitClose = true;
      while (alive()) {
        if (this._idx < path.last) {
          await this.goTo(this._idx + 1, { animate: true });
          continue;
        }
        if (path.status === 'CICLO_NEGATIVO') { await this.goTo(0, { animate: true }); continue; }
        await this._wait(null, 1.8);
        if (!alive()) return;
        await this._respawn(gen);
        if (!alive()) return;
        this._emit('loop', {});
        await this._wait(null, 0.5);
      }
    }

    // Some num "puf" e cai de novo no início (recomeço do modo vitrine).
    async _respawn(gen) {
      const PAL = pal(), aux = (this._aux = { tweens: [] });
      const alive = () => gen === this._attractGen && !this._disposed && this._aux === aux;
      this._burst(this._rig.position.clone().setY(0.6), PAL.luar, 18, { speed: 1.8, up: 1, life: 0.5 });
      await this._tween(aux, 0.18, (k) => { const s = Math.max(0.0001, 1 - k); this._drop.scale.set(s, s, s); });
      if (!alive()) return;
      this._applyState(0, true);
      this._emit('step', { idx: 0 });
      this._busy = true;
      this._drop.position.y = 4;
      await this._tween(aux, 0.36, (k) => { this._drop.position.y = (1 - k) * 4; }, easeInQuad);
      if (!alive()) return;
      this._burst(this._rig.position.clone().setY(0.05), PAL.luarFraco, 12, { speed: 1.5, up: 0.5, life: 0.45 });
      await this._tween(aux, 0.22, (k) => {
        const s = Math.sin(k * Math.PI) * (1 - k);
        this._drop.scale.set(1 + s * 0.35, 1 - s * 0.4, 1 + s * 0.35);
      });
      if (!alive()) return;
      this._drop.scale.set(1, 1, 1); this._drop.position.y = 0;
      this._busy = false;
      this._aux = null;
    }

    // ---------------------------------------------------------------- extras de leitura
    get index() { return this._idx; }
    get mapa() { return this._m ? this._m.mapa : null; }
    get cameraMode() { return this._cam.mode; }

    // ---------------------------------------------------------------- descarte
    dispose() {
      if (this._disposed) return;
      this._cancelJob();
      this._disposed = true;
      this._attractGen++;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._tweens.forEach((tw) => tw.cancel());
      this._tweens = [];
      if (this._unbindPointer) this._unbindPointer();
      document.removeEventListener('visibilitychange', this._onVis);
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
      this.canvas.removeEventListener('webglcontextlost', this._onLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
      this._disposeMap();
      this._floats.forEach((ft) => {
        this.scene.remove(ft.sprite);
        if (typeof ft.dispose === 'function') ft.dispose();
        else if (ft.sprite.material) { if (ft.sprite.material.map) ft.sprite.material.map.dispose(); ft.sprite.material.dispose(); }
      });
      this._floats = [];
      if (this._student) call(this._student, 'dispose');
      if (this._particles) call(this._particles, 'dispose');
      [this._ground, this._shadowPlane, this._locator].forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
      this._pin.material.dispose();
      this._gridTex.dispose(); this._locatorTex.dispose(); this._pinTex.dispose();
      if (this._moon.shadow.map) this._moon.shadow.map.dispose();
      this.renderer.dispose();
      // libera o contexto já (o Chrome limita ~16 contextos); se ele já foi perdido não há o que forçar
      if (!this._ctxLost) { try { this.renderer.forceContextLoss(); } catch (e) { /* ok */ } }
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      this._handlers = {};
    }
  }

  LAB.Maze3D = Maze3D;
})();
