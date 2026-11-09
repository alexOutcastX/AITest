// Canvas renderer. All art is drawn procedurally as 16px pixel art and
// scaled up with smoothing off, so there are no image assets to load.

import { T, hash2 } from '../game/world.js';

const ART = 16;           // art pixels per tile
const CHUNK = 16;         // tiles per cached chunk

const PAL = {
  water: '#2b5d9b', water2: '#3a74b8', sand: '#d9c58c', sand2: '#c8b276',
  grass: '#4a9440', grass2: '#3f8237', grass3: '#5aa84d', dark: '#2f5b3a', dark2: '#274d31',
  trunk: '#5b3a22', leaf: '#2d6b2e', leaf2: '#3d8a3a', dleaf: '#1d3f27', dleaf2: '#2a5634',
  rock: '#7d8088', rock2: '#5c5f67', path: '#b8956a', path2: '#a3825a',
  floor: '#8e939c', floor2: '#7a7f88', wall: '#5b5f6b', wall2: '#474a54', wallTop: '#7b8090',
};

export const MOB_HEIGHT = { pc: 18, slime: 10, wolf: 12, skeleton: 18, ogre: 26 };

function nameHue(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}

function drawTile(g, t, x, y, seed) {
  const R = (px, py, w, h, c) => { g.fillStyle = c; g.fillRect(px, py, w, h); };
  const rnd = i => hash2(x * 7 + i, y * 13 - i, seed);
  const speckle = (base, c, n) => {
    R(0, 0, ART, ART, base);
    for (let i = 0; i < n; i++) R(Math.floor(rnd(i) * ART), Math.floor(rnd(i + 50) * ART), 1, 1, c);
  };
  switch (t) {
    case T.WATER:
      R(0, 0, ART, ART, PAL.water);
      for (let i = 0; i < 2; i++) {
        const wx = Math.floor(rnd(i) * 12), wy = Math.floor(rnd(i + 9) * 14);
        R(wx, wy, 4, 1, PAL.water2);
      }
      break;
    case T.SAND: speckle(PAL.sand, PAL.sand2, 10); break;
    case T.GRASS: speckle(PAL.grass, PAL.grass2, 12); for (let i = 0; i < 3; i++) R(Math.floor(rnd(i + 20) * 15), Math.floor(rnd(i + 30) * 14), 1, 2, PAL.grass3); break;
    case T.DARK: speckle(PAL.dark, PAL.dark2, 14); break;
    case T.FLOWERS: {
      speckle(PAL.grass, PAL.grass2, 10);
      const cols = ['#f4e04d', '#f06c9b', '#ffffff', '#9fd3ff'];
      for (let i = 0; i < 4; i++) R(2 + Math.floor(rnd(i + 60) * 12), 2 + Math.floor(rnd(i + 70) * 12), 2, 2, cols[Math.floor(rnd(i + 80) * 4)]);
      break;
    }
    case T.TREE: case T.DARKTREE: {
      const d = t === T.DARKTREE;
      speckle(d ? PAL.dark : PAL.grass, d ? PAL.dark2 : PAL.grass2, 8);
      R(3, 13, 10, 2, 'rgba(0,0,0,.25)');
      R(7, 10, 2, 5, PAL.trunk);
      const a = d ? PAL.dleaf : PAL.leaf, b = d ? PAL.dleaf2 : PAL.leaf2;
      R(4, 2, 8, 9, a); R(3, 4, 10, 5, a); R(5, 1, 6, 1, a);
      R(5, 3, 3, 2, b); R(4, 5, 2, 2, b); R(9, 4, 2, 1, b);
      break;
    }
    case T.ROCK:
      speckle(PAL.grass2, PAL.grass, 6);
      R(2, 5, 12, 9, PAL.rock2); R(3, 4, 10, 8, PAL.rock); R(5, 3, 6, 2, PAL.rock); R(4, 5, 3, 2, '#9a9ea6');
      break;
    case T.PATH: speckle(PAL.path, PAL.path2, 14); break;
    case T.FLOOR:
      R(0, 0, ART, ART, PAL.floor);
      R(0, 0, ART, 1, PAL.floor2); R(0, 8, ART, 1, PAL.floor2);
      R((x & 1) ? 4 : 12, 0, 1, 8, PAL.floor2); R((x & 1) ? 12 : 4, 8, 1, 8, PAL.floor2);
      break;
    case T.WALL:
      R(0, 0, ART, ART, PAL.wall);
      for (let row = 0; row < 4; row++) {
        R(0, row * 4 + 3, ART, 1, PAL.wall2);
        R(((row & 1) * 4 + 2) % 8, row * 4, 1, 3, PAL.wall2);
        R(((row & 1) * 4 + 10) % 16, row * 4, 1, 3, PAL.wall2);
      }
      R(0, 0, ART, 2, PAL.wallTop);
      break;
  }
}

const MINI = {
  [T.WATER]: '#2b5d9b', [T.SAND]: '#d9c58c', [T.GRASS]: '#4a9440', [T.TREE]: '#2d6b2e', [T.ROCK]: '#7d8088',
  [T.PATH]: '#b8956a', [T.FLOOR]: '#a9aeb7', [T.WALL]: '#3d404a', [T.FLOWERS]: '#4f9a45', [T.DARK]: '#2f5b3a', [T.DARKTREE]: '#1d3f27',
};

export class Renderer {
  constructor(canvas, minimap) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.mm = minimap;
    this.mg = minimap.getContext('2d');
    this.chunks = new Map();
    this.cam = { x: 0, y: 0 };
    this.time = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.c.width = Math.round(innerWidth * dpr);
    this.c.height = Math.round(innerHeight * dpr);
    // Integer art scale keeps pixels crisp; aim for ~14 tiles on the short side.
    this.s = Math.max(2, Math.round(Math.min(this.c.width, this.c.height) / (ART * 14)));
    this.ts = ART * this.s;
    const r = this.mm.getBoundingClientRect();
    this.mm.width = Math.round(r.width * dpr) || 150;
    this.mm.height = Math.round(r.height * dpr) || 150;
  }

  setMap(map) {
    this.map = map;
    this.chunks.clear();
    const base = document.createElement('canvas');
    base.width = map.w; base.height = map.h;
    const bg = base.getContext('2d');
    const img = bg.createImageData(map.w, map.h);
    for (let i = 0; i < map.tiles.length; i++) {
      const hex = MINI[map.tiles[i]];
      img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
      img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i * 4 + 3] = 255;
    }
    bg.putImageData(img, 0, 0);
    this.miniBase = base;
  }

  chunk(cx, cy) {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = CHUNK * ART;
    const g = c.getContext('2d');
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cx * CHUNK + tx, y = cy * CHUNK + ty;
        if (x >= this.map.w || y >= this.map.h) continue;
        g.save();
        g.translate(tx * ART, ty * ART);
        drawTile(g, this.map.tiles[y * this.map.w + x], x, y, this.map.seed);
        g.restore();
      }
    }
    this.chunks.set(key, c);
    return c;
  }

  toScreen(wx, wy) {
    return [(wx - this.cam.x) * this.ts + this.c.width / 2, (wy - this.cam.y) * this.ts + this.c.height / 2];
  }

  toWorld(sx, sy) {
    return [this.cam.x + (sx * this.dpr - this.c.width / 2) / this.ts, this.cam.y + (sy * this.dpr - this.c.height / 2) / this.ts];
  }

  draw(st, dt) {
    this.time += dt;
    const { g, c, ts, s } = this;
    const me = st.ents.get(st.you?.id);
    if (me) { this.cam.x = me.rx; this.cam.y = me.ry; }

    g.imageSmoothingEnabled = false;
    g.fillStyle = PAL.water;
    g.fillRect(0, 0, c.width, c.height);

    // Terrain chunks.
    const halfW = c.width / 2 / ts, halfH = c.height / 2 / ts;
    const cx0 = Math.max(0, Math.floor((this.cam.x - halfW) / CHUNK)), cx1 = Math.floor((this.cam.x + halfW) / CHUNK);
    const cy0 = Math.max(0, Math.floor((this.cam.y - halfH) / CHUNK)), cy1 = Math.floor((this.cam.y + halfH) / CHUNK);
    const maxC = Math.ceil(this.map.w / CHUNK) - 1;
    for (let cy = cy0; cy <= Math.min(cy1, maxC); cy++) {
      for (let cx = cx0; cx <= Math.min(cx1, maxC); cx++) {
        const [sx, sy] = this.toScreen(cx * CHUNK, cy * CHUNK);
        g.drawImage(this.chunk(cx, cy), Math.round(sx), Math.round(sy), CHUNK * ts, CHUNK * ts);
      }
    }

    // Click marker.
    if (st.marker && st.marker.t > 0) {
      const [mx, my] = this.toScreen(st.marker.x, st.marker.y);
      const k = st.marker.t;
      g.strokeStyle = `rgba(255,240,180,${k})`;
      g.lineWidth = s;
      g.beginPath();
      g.ellipse(mx, my, ts * 0.3 * (1.5 - k * 0.5), ts * 0.15 * (1.5 - k * 0.5), 0, 0, Math.PI * 2);
      g.stroke();
    }

    // Entities, back to front.
    const list = [...st.ents.values()].sort((a, b) => a.ry - b.ry);
    const tgtId = st.you?.tgt;
    for (const o of list) {
      const [sx, sy] = this.toScreen(o.rx, o.ry);
      if (sx < -ts * 2 || sy < -ts * 2 || sx > c.width + ts * 2 || sy > c.height + ts * 3) continue;
      const fx = Math.round(sx), fy = Math.round(sy + ts * 0.3);
      const big = o.kind === 'ogre' ? 1.5 : 1;
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.beginPath();
      g.ellipse(fx, fy, 5 * s * big, 2 * s * big, 0, 0, Math.PI * 2);
      g.fill();
      if (o.id === tgtId) {
        g.strokeStyle = '#ff5050';
        g.lineWidth = Math.max(2, s * 0.6);
        g.beginPath();
        g.ellipse(fx, fy, 7 * s * big, 3 * s * big, 0, 0, Math.PI * 2);
        g.stroke();
      }
      this.sprite(o, fx, fy);
    }

    // Overlays (bars, names, bubbles) on top of all sprites.
    const font = Math.max(11 * this.dpr, Math.round(3.2 * s));
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (const o of list) {
      const [sx, sy] = this.toScreen(o.rx, o.ry);
      const fx = Math.round(sx), fy = Math.round(sy + ts * 0.3);
      const top = fy - (MOB_HEIGHT[o.kind] || 16) * s - 3 * s;
      const isMe = o.id === st.you?.id;
      const showBar = o.kind === 'pc' || o.hp < o.maxHp || o.id === tgtId;
      if (showBar) {
        const bw = 14 * s, bh = Math.max(3, Math.round(s * 0.9));
        g.fillStyle = 'rgba(0,0,0,.6)';
        g.fillRect(fx - bw / 2 - 1, top - 1, bw + 2, bh + 2);
        const f = Math.max(0, o.hp / o.maxHp);
        g.fillStyle = o.kind === 'pc' ? (isMe ? '#5fe07a' : '#58b8ff') : (f > 0.5 ? '#e0c050' : '#e05050');
        g.fillRect(fx - bw / 2, top, bw * f, bh);
      }
      if (o.kind === 'pc' || o.id === tgtId) {
        g.font = `bold ${font}px ui-monospace, Menlo, Consolas, monospace`;
        const label = o.kind === 'pc' ? `${o.name} ${o.level}` : `${o.mobName} ${o.level}`;
        g.lineWidth = Math.max(3, font / 4);
        g.strokeStyle = 'rgba(0,0,0,.85)';
        g.strokeText(label, fx, top - 2);
        g.fillStyle = o.kind === 'pc' ? (o.flags & 4 ? '#c9b8ff' : isMe ? '#ffffff' : '#bfe4ff') : '#ffb0a0';
        g.fillText(label, fx, top - 2);
      }
      if (o.say) this.bubble(o.say, fx, top - font - 6);
    }

    // Floating combat text.
    g.font = `bold ${Math.round(font * 1.25)}px ui-monospace, Menlo, Consolas, monospace`;
    for (const f of st.floats) {
      const [sx, sy] = this.toScreen(f.x, f.y - 1.2 - f.t * 1.1);
      g.globalAlpha = Math.max(0, 1 - f.t / f.life);
      g.lineWidth = 4;
      g.strokeStyle = '#000';
      g.strokeText(f.text, sx, sy);
      g.fillStyle = f.color;
      g.fillText(f.text, sx, sy);
    }
    g.globalAlpha = 1;

    // Death puffs.
    for (const p of st.puffs) {
      const [sx, sy] = this.toScreen(p.x, p.y);
      const k = p.t / 0.6;
      g.fillStyle = `rgba(230,230,230,${0.6 * (1 - k)})`;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        g.beginPath();
        g.arc(sx + Math.cos(a) * k * ts * 0.6, sy + Math.sin(a) * k * ts * 0.4 - k * ts * 0.3, s * 2 * (1 - k * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    }

    this.minimap(st, me);
  }

  bubble(text, x, y) {
    const { g } = this;
    const fs = Math.max(11 * this.dpr, Math.round(3 * this.s));
    g.font = `${fs}px system-ui, sans-serif`;
    const t = text.length > 40 ? text.slice(0, 39) + '…' : text;
    const w = g.measureText(t).width + fs;
    const h = fs * 1.5;
    g.fillStyle = 'rgba(255,255,245,.95)';
    g.beginPath();
    g.roundRect(x - w / 2, y - h, w, h, fs * 0.4);
    g.fill();
    g.beginPath();
    g.moveTo(x - fs * 0.3, y); g.lineTo(x + fs * 0.3, y); g.lineTo(x, y + fs * 0.4);
    g.fill();
    g.fillStyle = '#222';
    g.textBaseline = 'middle';
    g.fillText(t, x, y - h / 2);
    g.textBaseline = 'bottom';
  }

  sprite(o, fx, fy) {
    const { g, s } = this;
    const flip = o.flags & 2 ? -1 : 1;
    const moving = o.flags & 1;
    const t = this.time + o.id * 0.37;
    const step = moving ? Math.sin(t * 14) : 0;
    const bob = moving ? Math.abs(Math.sin(t * 14)) : 0;
    const swing = o.swing > 0;
    const R = (x, y, w, h, c) => {
      g.fillStyle = c;
      const xx = flip > 0 ? x : -x - w;
      g.fillRect(fx + xx * s, fy + y * s, w * s, h * s);
    };

    if (o.flags & 8) g.globalAlpha = 0.55; // evading back home
    switch (o.kind) {
      case 'pc': {
        const hue = nameHue(o.name);
        const tunic = `hsl(${hue} 55% 45%)`, tunicD = `hsl(${hue} 55% 32%)`;
        const hair = `hsl(${(hue * 7) % 360} 35% ${20 + (hue % 30)}%)`;
        const y0 = -Math.round(bob);
        R(-3, -4 + (step > 0 ? -1 : 0), 2, 4, '#3b3346');
        R(1, -4 + (step < 0 ? -1 : 0), 2, 4, '#3b3346');
        R(-4, -10 + y0, 8, 6, tunic);
        R(-4, -6 + y0, 8, 1, '#4a3420');
        R(-5, -10 + y0, 1, 5, tunicD);
        R(4, -10 + y0, 1, 4, tunicD);
        R(-3, -15 + y0, 6, 5, '#f0c8a0');
        R(-3, -16 + y0, 6, 2, hair);
        R(-3, -15 + y0, 1, 3, hair);
        R(1, -13 + y0, 1, 1, '#222');
        if (swing) { R(5, -8 + y0, 7, 1, '#dfe6f0'); R(4, -9 + y0, 1, 3, '#8a6a2a'); }
        else { R(5, -14 + y0, 1, 7, '#dfe6f0'); R(4, -8 + y0, 3, 1, '#8a6a2a'); }
        break;
      }
      case 'slime': {
        const sq = moving ? Math.sin(t * 8) * 0.8 : Math.sin(t * 3) * 0.4;
        const c = '#5bc85a', d = '#3d9a3f';
        const top = Math.round(-8 - sq);
        R(-3, top, 6, 1, c);
        R(-5, top + 1, 10, 2, c);
        R(-6, top + 3, 12, -top - 3, c);
        R(-6, -1, 12, 1, d);
        R(-3, top + 2, 2, 1, '#c8ffc0');
        R(-2, -5, 1, 2, '#123');
        R(2, -5, 1, 2, '#123');
        break;
      }
      case 'wolf': {
        const c = '#8a8d96', d = '#6a6d76';
        R(-6, -8, 10, 4, c);
        R(-6, -5, 10, 1, d);
        R(3, -10, 4, 4, c);
        R(7, -9, 2, 2, d);
        R(4, -12, 1, 2, d);
        R(-8, -9 - (moving ? Math.round(bob) : 0), 2, 2, c);
        R(5, -9, 1, 1, '#ff4040');
        R(-5, -4, 1, 4 - (step > 0 ? 1 : 0), d);
        R(-2, -4, 1, 4 - (step < 0 ? 1 : 0), d);
        R(1, -4, 1, 4 - (step > 0 ? 1 : 0), d);
        R(3, -4, 1, 4 - (step < 0 ? 1 : 0), d);
        if (swing) R(7, -7, 2, 1, '#fff');
        break;
      }
      case 'skeleton': {
        const b = '#e8e4d4', d = '#a8a494';
        const y0 = -Math.round(bob);
        R(-2, -4 + (step > 0 ? -1 : 0), 1, 4, b);
        R(1, -4 + (step < 0 ? -1 : 0), 1, 4, b);
        R(-3, -10 + y0, 6, 6, b);
        R(-3, -9 + y0, 6, 1, d); R(-3, -7 + y0, 6, 1, d);
        R(-4, -10 + y0, 1, 5, b); R(3, -10 + y0, 1, 5, b);
        R(-3, -16 + y0, 6, 6, b);
        R(-2, -14 + y0, 1, 2, '#200'); R(1, -14 + y0, 1, 2, '#200');
        R(-1, -11 + y0, 3, 1, d);
        if (swing) R(4, -8 + y0, 7, 1, '#9a7a5a');
        else R(4, -14 + y0, 1, 7, '#9a7a5a');
        break;
      }
      case 'ogre': {
        const c = '#7a8a44', d = '#5a6a30';
        const y0 = -Math.round(bob);
        R(-6, -7 + (step > 0 ? -1 : 0), 4, 7, '#5a4030');
        R(2, -7 + (step < 0 ? -1 : 0), 4, 7, '#5a4030');
        R(-8, -18 + y0, 16, 11, c);
        R(-8, -9 + y0, 16, 2, '#6b4a2b');
        R(-10, -17 + y0, 2, 8, d); R(8, -17 + y0, 2, 7, d);
        R(-4, -24 + y0, 8, 7, c);
        R(-2, -22 + y0, 1, 1, '#ff3'); R(2, -22 + y0, 1, 1, '#ff3');
        R(-2, -19 + y0, 1, 2, '#fff'); R(2, -19 + y0, 1, 2, '#fff');
        if (swing) R(9, -13 + y0, 10, 3, '#6b4a2b');
        else R(9, -24 + y0, 3, 14, '#6b4a2b');
        break;
      }
    }
    g.globalAlpha = 1;
  }

  minimap(st, me) {
    const { mg, mm } = this;
    if (!this.miniBase || !me) return;
    mg.imageSmoothingEnabled = false;
    mg.fillStyle = '#163052';
    mg.fillRect(0, 0, mm.width, mm.height);
    // Show a 96x96-tile window around the player.
    const span = 96, k = mm.width / span;
    const ox = me.rx - span / 2, oy = me.ry - span / 2;
    mg.drawImage(this.miniBase, -ox * k, -oy * k, this.map.w * k, this.map.h * k);
    mg.fillStyle = '#7fd0ff';
    for (const [x, y] of st.others) {
      const px = (x - ox) * k, py = (y - oy) * k;
      if (px >= 0 && py >= 0 && px < mm.width && py < mm.height) mg.fillRect(px - 2, py - 2, 4, 4);
    }
    mg.fillStyle = '#fff';
    mg.strokeStyle = '#000';
    mg.lineWidth = 2;
    mg.beginPath();
    mg.arc(mm.width / 2, mm.height / 2, 4, 0, Math.PI * 2);
    mg.fill(); mg.stroke();
  }
}
