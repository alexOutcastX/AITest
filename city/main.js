import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------- utilities
let seed = 1337;
function rng() { // mulberry32 — deterministic city
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const R = (a, b) => a + rng() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x05060c);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05060c, 130, 280);

let viewSize = 46;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
function setFrustum() {
  const a = innerWidth / innerHeight;
  camera.left = -viewSize * a / 2; camera.right = viewSize * a / 2;
  camera.top = viewSize / 2; camera.bottom = -viewSize / 2;
  camera.updateProjectionMatrix();
}
setFrustum();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.35, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  setFrustum();
});

// ---------------------------------------------------------------- lights
scene.add(new THREE.AmbientLight(0x4a527a, 2.4));
const hemi = new THREE.HemisphereLight(0x44548a, 0x241a28, 1.0);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x8fa3d8, 1.0);
moon.position.set(-30, 60, -20);
scene.add(moon);

const pointBudget = [];
function neonLight(x, y, z, color, intensity, dist) {
  if (pointBudget.length >= 12) return;
  const l = new THREE.PointLight(color, intensity, dist, 1.6);
  l.position.set(x, y, z);
  scene.add(l);
  pointBudget.push(l);
}

// ---------------------------------------------------------------- palettes
const P = {
  platformTop: 0xb2b8c2, platformSide: 0x6b727c,
  asphalt: 0x191c26, sidewalk: 0x4d5462,
  walls: [0x4d5878, 0x3e4763, 0x5d4650, 0x6e5348, 0x35425c, 0x554d6e, 0x455866],
  trim: 0x1c2130,
  awning: [[0xa63a44, 0xd05560], [0x39616f, 0x4f8ba0], [0x84395f, 0xb54f83]],
  roof: 0x23283a,
  windowWarm: 0xffb45e, windowCyan: 0x59e8ff, windowDark: 0x11141f,
  neonRed: 0xff2a3c, neonPink: 0xff5c8a, neonCyan: 0x37e0ff, neonGreen: 0x3bff9e,
  lantern: 0xff4030,
};

// ---------------------------------------------------------------- voxel batching
const unitBox = new THREE.BoxGeometry(1, 1, 1);
class Batch {
  constructor(material) { this.items = []; this.material = material; }
  add(x, y, z, w, h, d, color, glow = 1) {
    this.items.push({ x, y, z, w, h, d, color, glow });
  }
  build() {
    const mesh = new THREE.InstancedMesh(unitBox, this.material, this.items.length);
    const m = new THREE.Matrix4(); const c = new THREE.Color();
    this.items.forEach((it, i) => {
      m.makeScale(it.w, it.h, it.d);
      m.setPosition(it.x, it.y + it.h / 2, it.z);
      mesh.setMatrixAt(i, m);
      c.set(it.color).multiplyScalar(it.glow);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }
}
const solid = new Batch(new THREE.MeshLambertMaterial({ color: 0xffffff }));
const glowB = new Batch(new THREE.MeshBasicMaterial({ color: 0xffffff }));
// jittered wall shade for a chunky voxel feel
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return c.getHex();
}

// colliders (AABB) for player
const colliders = [];
function addCollider(x0, z0, x1, z1) { colliders.push({ x0, z0, x1, z1 }); }

// ---------------------------------------------------------------- sign textures
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function textSignTex(text, fg, bg, border) {
  const [c, g] = makeCanvas(text.length * 12 + 12, 22);
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  if (border) { g.strokeStyle = border; g.lineWidth = 2; g.strokeRect(1, 1, c.width - 2, c.height - 2); }
  g.fillStyle = fg; g.font = 'bold 13px "Courier New", monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 1);
  return canvasTex(c);
}
// pseudo-CJK glyph column (avoids missing-font tofu, reads right at voxel scale)
function glyphSignTex(n, fg, bg, vertical = true) {
  const cell = 14, pad = 3;
  const [c, g] = makeCanvas(vertical ? cell + pad * 2 : n * cell + pad * 2, vertical ? n * cell + pad * 2 : cell + pad * 2);
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = fg; g.lineWidth = 1.6;
  g.strokeRect(1, 1, c.width - 2, c.height - 2);
  for (let i = 0; i < n; i++) {
    const ox = vertical ? pad : pad + i * cell;
    const oy = vertical ? pad + i * cell : pad;
    g.strokeStyle = fg;
    const hLines = RI(2, 3), vLines = RI(1, 2);
    for (let k = 0; k < hLines; k++) {
      const y = oy + 2 + Math.floor(rng() * (cell - 4));
      g.beginPath(); g.moveTo(ox + 2, y); g.lineTo(ox + cell - 2, y); g.stroke();
    }
    for (let k = 0; k < vLines; k++) {
      const x = ox + 3 + Math.floor(rng() * (cell - 6));
      g.beginPath(); g.moveTo(x, oy + 2); g.lineTo(x, oy + cell - 2); g.stroke();
    }
    if (rng() < 0.5) g.strokeRect(ox + 3.5, oy + 3.5, cell - 7, cell - 7);
  }
  return canvasTex(c);
}
function crtScreenTex() { // noisy static + a pale face, like the ref's screens
  const [c, g] = makeCanvas(48, 36);
  for (let y = 0; y < 36; y++) for (let x = 0; x < 48; x++) {
    const v = 40 + Math.floor(rng() * 70);
    g.fillStyle = `rgb(${v * 0.4},${v * 0.9},${v})`;
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = '#cfe8ea'; g.fillRect(16, 8, 16, 18);           // face
  g.fillStyle = '#1a3a44'; g.fillRect(19, 14, 3, 3); g.fillRect(26, 14, 3, 3);
  g.fillRect(21, 21, 6, 2);
  g.fillStyle = 'rgba(255,255,255,.25)';
  for (let y = 0; y < 36; y += 3) g.fillRect(0, y, 48, 1);      // scanlines
  return canvasTex(c);
}
const flickerSigns = [];
function signPlane(tex, w, h, x, y, z, ry, glow = 2.2, flicker = false) {
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  mat.color.setScalar(glow);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  p.position.set(x, y, z); p.rotation.y = ry;
  scene.add(p);
  if (flicker) flickerSigns.push({ mat, base: glow, t: R(0, 10) });
  return p;
}
function glowPoolTex() {
  const [c, g] = makeCanvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return canvasTex(c);
}
const poolTex = glowPoolTex();
function glowPool(x, z, color, r, a = 0.5) {
  const m = new THREE.MeshBasicMaterial({
    map: poolTex, color, transparent: true, opacity: a,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), m);
  p.rotation.x = -Math.PI / 2;
  p.position.set(x, 0.06, z);
  scene.add(p);
}

// ---------------------------------------------------------------- city layout
const ROADS = [-16, 16];          // road centerlines on both axes
const RW = 4;                     // road half width
const EXT = 46;                   // platform half size
const spans = [[-45, -20.5], [-11.5, 11.5], [20.5, 45]]; // buildable block extents

// platform (the floating slab the diorama sits on)
solid.add(0, -4, 0, EXT * 2 + 4, 4, EXT * 2 + 4, P.platformSide);
solid.add(0, -0.4, 0, EXT * 2 + 4, 0.4, EXT * 2 + 4, P.platformTop);
// asphalt roads
for (const c of ROADS) {
  solid.add(c, 0, 0, RW * 2, 0.1, EXT * 2 + 4, P.asphalt);
  solid.add(0, 0, c, EXT * 2 + 4, 0.1, RW * 2, P.asphalt);
}
// lane dashes + crosswalks
for (const c of ROADS) {
  for (let v = -EXT; v < EXT; v += 4) {
    if (ROADS.some(o => Math.abs(v - o) < RW + 2)) continue;
    glowB.add(c, 0.1, v, 0.35, 0.03, 1.6, 0xbec7d6, 0.55);
    glowB.add(v, 0.1, c, 1.6, 0.03, 0.35, 0xbec7d6, 0.55);
  }
  for (const o of ROADS) // crosswalk stripes at each intersection approach
    for (let k = -3; k <= 3; k += 1.5) {
      glowB.add(c + k, 0.1, o - RW - 1, 0.9, 0.03, 1.6, 0xd8dee9, 0.5);
      glowB.add(c + k, 0.1, o + RW + 1, 0.9, 0.03, 1.6, 0xd8dee9, 0.5);
      glowB.add(o - RW - 1, 0.1, c + k, 1.6, 0.03, 0.9, 0xd8dee9, 0.5);
      glowB.add(o + RW + 1, 0.1, c + k, 1.6, 0.03, 0.9, 0xd8dee9, 0.5);
    }
}
// sidewalk slabs (whole block pads, slightly raised)
for (const [x0, x1] of spans) for (const [z0, z1] of spans) {
  solid.add((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, 0.35, z1 - z0, P.sidewalk);
}

// ---------------------------------------------------------------- buildings
const blinkers = [];
function lantern(x, y, z) {
  glowB.add(x, y, z, 0.7, 0.9, 0.7, P.lantern, 2.6);
  solid.add(x, y + 0.9, z, 0.25, 0.2, 0.25, 0x2a2020);
  glowB.add(x, y - 0.25, z, 0.16, 0.25, 0.16, 0xffcf7a, 2);
}
function lanternString(x0, y0, z0, x1, y1, z1, n) {
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const sag = Math.sin(t * Math.PI) * 1.1;
    lantern(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - sag, z0 + (z1 - z0) * t);
  }
}
function awning(x, y, z, w, facing, colors) {
  // striped tile awning sticking out over the storefront
  const seg = 1.2, count = Math.floor(w / seg);
  for (let i = 0; i < count; i++) {
    const off = -w / 2 + seg / 2 + i * seg;
    const col = colors[i % 2];
    const [dx, dz] = facing === 'z' ? [off, 0] : [0, off];
    solid.add(x + dx, y, z + dz, facing === 'z' ? seg - 0.08 : 1.6, 0.45, facing === 'z' ? 1.6 : seg - 0.08, col);
    solid.add(x + dx, y - 0.3, z + dz, facing === 'z' ? seg - 0.08 : 1.9, 0.3, facing === 'z' ? 1.9 : seg - 0.08, shade(col, -0.06));
  }
}
function crtTV(x, y, z, ry) {
  // chunky retro TV, screen facing ry
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 5.4, 6), new THREE.MeshLambertMaterial({ color: 0x4a2f30 }));
  body.position.y = 2.7;
  g.add(body);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 4, 0.5), new THREE.MeshLambertMaterial({ color: 0x241a1c }));
  frame.position.set(0, 2.7, 3.05);
  g.add(frame);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.2), new THREE.MeshBasicMaterial({ map: crtScreenTex() }));
  scr.material.color.setScalar(1.7);
  scr.position.set(0, 2.7, 3.32);
  g.add(scr);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.7), body.material);
  legL.position.set(-2.6, -0.4 + 0.4, 2.2); g.add(legL);
  const legR = legL.clone(); legR.position.x = 2.6; g.add(legR);
  // antenna
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.18, 5, 0.18), new THREE.MeshLambertMaterial({ color: 0x666a75 }));
  ant.position.set(1.6, 7.9, -1); g.add(ant);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: P.neonRed }));
  tip.material.color.multiplyScalar(3);
  tip.position.set(1.6, 10.5, -1); g.add(tip);
  blinkers.push({ mat: tip.material, period: 1.4, phase: R(0, 2), hi: 3.2, lo: 0.15, color: P.neonRed });
  g.position.set(x, y, z); g.rotation.y = ry;
  scene.add(g);
}
function building(bx, bz, w, d, floors, facing, dir) {
  // facing: 'z' means storefront faces ±z (dir = +1/-1); 'x' faces ±x
  const wall = pick(P.walls);
  const h = floors * 3.2 + 0.6;
  solid.add(bx, 0.35, bz, w, h, d, wall);
  solid.add(bx, 0.35, bz, w + 0.3, 0.9, d + 0.3, shade(wall, -0.05)); // plinth
  solid.add(bx, h + 0.35, bz, w + 0.4, 0.5, d + 0.4, P.roof);         // parapet
  addCollider(bx - w / 2 - 0.3, bz - d / 2 - 0.3, bx + w / 2 + 0.3, bz + d / 2 + 0.3);

  const fw = facing === 'z' ? w : d;                    // facade width
  const fx = facing === 'z' ? bx : bx + (w / 2 + 0.06) * dir;
  const fz = facing === 'z' ? bz + (d / 2 + 0.06) * dir : bz;
  const ry = facing === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  const out = (o, lat) => facing === 'z'
    ? [bx + lat, bz + (d / 2 + o) * dir]
    : [bx + (w / 2 + o) * dir, bz + lat];

  // ---- ground floor: storefront
  const awCol = pick(P.awning);
  let [ax, az] = out(0.9, 0);
  awning(ax, 3.1, az, fw - 1.6, facing, awCol);
  // glowing shop window + door
  const winW = fw * 0.45;
  let [wx, wz] = out(0.12, -fw * 0.18);
  glowB.add(wx, 1.0, wz, facing === 'z' ? winW : 0.18, 1.7, facing === 'z' ? 0.18 : winW,
    rng() < 0.35 ? P.windowCyan : P.windowWarm, 1.9);
  let [dx2, dz2] = out(0.1, fw * 0.28);
  solid.add(dx2, 0.4, dz2, facing === 'z' ? 1.4 : 0.2, 2.4, facing === 'z' ? 0.2 : 1.4, 0x181420);
  // shelf goods glow inside the window (like the ref's market shelves)
  let [gx, gz] = out(0.16, -fw * 0.18);
  glowB.add(gx, 2.1, gz, facing === 'z' ? winW * 0.8 : 0.12, 0.3, facing === 'z' ? 0.12 : winW * 0.8, 0xffd9a0, 1.4);

  // ---- neon sign above the awning
  const kind = rng();
  let [sx, sz] = out(0.35, 0);
  if (kind < 0.34) {
    const words = ['VIDEO...', 'NOODLE', 'CAFE', 'HOTEL', 'BAR 24H', 'ARCADE', 'MOTEL', 'RAMEN'];
    const word = pick(words);
    const tex = textSignTex(word, '#ffffff', '#6d1019', '#ff4a58');
    signPlane(tex, Math.min(fw - 2, word.length * 0.9), 1.3, sx, 4.4, sz, ry, 2.3, rng() < 0.35);
    if (pointBudget.length < 12 && rng() < 0.5) {
      const [lx, lz] = out(1.6, 0);
      neonLight(lx, 3.5, lz, P.neonRed, 14, 12);
    }
  } else if (kind < 0.6) {
    const tex = glyphSignTex(RI(2, 4), '#ffd9dd', '#8e1622', false);
    signPlane(tex, Math.min(fw - 2, 4.5), 1.4, sx, 4.4, sz, ry, 2.1, rng() < 0.3);
  } else {
    const col = pick([P.neonPink, P.neonCyan, P.neonGreen]);
    glowB.add(sx, 3.9, sz, facing === 'z' ? fw * 0.5 : 0.15, 0.35, facing === 'z' ? 0.15 : fw * 0.5, col, 2.6);
  }
  // vertical glyph banner on taller buildings (the red kanji column in the ref)
  if (floors >= 3 && rng() < 0.65) {
    const n = RI(3, 4);
    const tex = glyphSignTex(n, '#ffe2e5', '#a01824');
    const [vx, vz] = out(0.6, fw / 2 - 0.4);
    const sp = signPlane(tex, 1.5, n * 1.5, vx, h - n * 0.85 - 1, vz, ry, 2.2, rng() < 0.4);
    sp.position.y = h * 0.62;
    if (pointBudget.length < 12 && rng() < 0.4) neonLight(vx, h * 0.5, vz, P.neonRed, 10, 11);
  }
  // hanging lanterns at the awning's edge, above head height
  if (rng() < 0.75) {
    const [l1x, l1z] = out(1.4, -fw * 0.32);
    const [l2x, l2z] = out(1.4, fw * 0.32);
    lantern(l1x, 3.2, l1z);
    lantern(l2x, 3.2, l2z);
  }

  // ---- upper floors: windows on all 4 sides
  for (let f = 1; f < floors; f++) {
    const y = 0.35 + f * 3.2 + 1.1;
    const sides = [
      ['z', 1], ['z', -1], ['x', 1], ['x', -1],
    ];
    for (const [ax2, dr] of sides) {
      const width = ax2 === 'z' ? w : d;
      for (let o = -width / 2 + 1.6; o <= width / 2 - 1.6; o += 2.1) {
        const r = rng();
        const col = r < 0.42 ? P.windowWarm : r < 0.55 ? P.windowCyan : P.windowDark;
        const glow = col === P.windowDark ? 1 : R(1.4, 2.0);
        const px = ax2 === 'z' ? bx + o : bx + (w / 2 + 0.07) * dr;
        const pz = ax2 === 'z' ? bz + (d / 2 + 0.07) * dr : bz + o;
        const b = col === P.windowDark ? solid : glowB;
        b.add(px, y, pz, ax2 === 'z' ? 1.15 : 0.14, 1.5, ax2 === 'z' ? 0.14 : 1.15, col, glow);
      }
    }
    // occasional AC unit
    if (rng() < 0.5) {
      const [cx, cz] = out(0.5, R(-fw / 2 + 2, fw / 2 - 2));
      solid.add(cx, y - 0.4, cz, 0.9, 0.7, 0.9, 0x7b828e);
    }
  }
  // drain pipe
  if (rng() < 0.6) {
    const [px, pz] = out(0.2, fw / 2 - 0.5);
    solid.add(px, 0.4, pz, 0.25, h - 1, 0.25, shade(wall, -0.12));
  }

  // ---- roof props
  const ry0 = h + 0.35;
  if (rng() < 0.6) solid.add(bx - w * 0.25, ry0, bz - d * 0.2, 1.6, 1.1, 1.6, 0x676d79); // water tank
  if (rng() < 0.7) solid.add(bx + w * 0.22, ry0, bz + d * 0.18, 1.2, 0.8, 1.2, 0x555b66); // AC
  if (rng() < 0.55) { // antenna + blinking beacon
    const ah = R(3, 6);
    solid.add(bx + w * 0.3, ry0, bz - d * 0.3, 0.18, ah, 0.18, 0x788093);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4),
      new THREE.MeshBasicMaterial({ color: P.neonRed }));
    tip.material.color.multiplyScalar(3);
    tip.position.set(bx + w * 0.3, ry0 + ah + 0.2, bz - d * 0.3);
    scene.add(tip);
    blinkers.push({ mat: tip.material, period: R(1, 1.8), phase: R(0, 2), hi: 3.2, lo: 0.1, color: P.neonRed });
  }
  if (floors >= 3 && rng() < 0.35) { // rooftop billboard
    const tex = rng() < 0.5
      ? textSignTex(pick(['VIDEO...', 'ネオン', 'CITY', 'OPEN']), '#e8f6ff', '#123a4d', '#37e0ff')
      : glyphSignTex(3, '#c9f3ff', '#0e3a4a', false);
    solid.add(bx, ry0, bz, w * 0.6, 0.4, 0.6, 0x2a2f3d);
    signPlane(tex, w * 0.55, 1.7, facing === 'z' ? bx : bx + 0.35 * dir, ry0 + 1.4,
      facing === 'z' ? bz + 0.35 * dir : bz, ry, 2, rng() < 0.4);
  }
  return { h };
}
function vendingMachine(x, z, ry) {
  solid.add(x, 0.35, z, 1.3, 2.2, 1.1, 0x1e3a4d);
  const dx = Math.sin(ry), dz = Math.cos(ry);
  glowB.add(x + dx * 0.6, 0.9, z + dz * 0.6, Math.abs(dz) * 0.9 + 0.12, 1.3, Math.abs(dx) * 0.9 + 0.12, P.neonCyan, 2.2);
  addCollider(x - 0.8, z - 0.8, x + 0.8, z + 0.8);
}

// place buildings in block corners with a guaranteed clear sidewalk ring:
// building footprints stop 2.6 inside the block edge, NPC paths run at 1.2,
// and footprints are capped so the two buildings on a side never meet.
const SIDEWALK = 2.6;
const blockDefs = [];
for (let bi = 0; bi < 3; bi++) for (let bj = 0; bj < 3; bj++) blockDefs.push([bi, bj]);
for (const [bi, bj] of blockDefs) {
  const [x0, x1] = spans[bi], [z0, z1] = spans[bj];
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  if (bi === 1 && bj === 1) {
    // center block: market plaza ringed by four shops facing inward, like the ref diorama
    const q = [
      { ux: -1, uz: -1, w: R(6, 6.8), d: R(6, 6.8), floors: 4, facing: 'z', dir: 1 },
      { ux: 1, uz: -1, w: R(5.5, 6.5), d: R(5.5, 6.5), floors: 3, facing: 'x', dir: -1 },
      { ux: 1, uz: 1, w: R(5.5, 6.5), d: R(5.5, 6.5), floors: 2, facing: 'z', dir: -1 },
      { ux: -1, uz: 1, w: R(5.5, 6.5), d: R(5.5, 6.5), floors: 2, facing: 'x', dir: 1 },
    ];
    let tv = null;
    for (const s of q) {
      const sx = cx + s.ux * (hx - SIDEWALK - s.w / 2);
      const sz = cz + s.uz * (hz - SIDEWALK - s.d / 2);
      const { h } = building(sx, sz, s.w, s.d, s.floors, s.facing, s.dir);
      if (!tv) tv = { x: sx, y: h + 0.35, z: sz };
    }
    crtTV(tv.x, tv.y, tv.z, 0.3);
    lanternString(cx - 7, 5.3, cz - 0.5, cx + 7, 5.6, cz + 0.8, 7);
    vendingMachine(cx, cz + 3.5, Math.PI / 2);
    neonLight(cx, 3, cz + 10, P.neonPink, 16, 15);
    neonLight(cx - 10, 3.5, cz - 10.5, P.neonRed, 14, 13);
    glowPool(cx + 1, cz + 10.5, P.neonPink, 7, 0.4);
    glowPool(cx - 10.5, cz - 10, P.neonRed, 6, 0.38);
  } else {
    // 2–3 buildings per block, storefronts preferring a road-facing side
    const n = RI(2, 3);
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].sort(() => rng() - 0.5).slice(0, n);
    for (const [ux, uz] of corners) {
      const w = R(7, Math.min(10, hx - 3.6));
      const d = R(7, Math.min(10, hz - 3.6));
      const sx = cx + ux * (hx - SIDEWALK - w / 2);
      const sz = cz + uz * (hz - SIDEWALK - d / 2);
      const okX = bi === 1 || (bi === 0 && ux === 1) || (bi === 2 && ux === -1);
      const okZ = bj === 1 || (bj === 0 && uz === 1) || (bj === 2 && uz === -1);
      let facing;
      if (okX && okZ) facing = rng() < 0.5 ? 'x' : 'z';
      else if (okX) facing = 'x';
      else if (okZ) facing = 'z';
      else facing = rng() < 0.5 ? 'x' : 'z';
      building(sx, sz, w, d, RI(2, 4), facing, facing === 'x' ? ux : uz);
    }
    if (rng() < 0.6) vendingMachine(cx, cz + R(-4, 4), pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]));
    if (rng() < 0.4) glowPool(cx + R(-2, 2), cz + R(-6, 6), pick([P.neonCyan, P.neonPink]), 5, 0.25);
  }
}
neonLight(0, 4, -20.5, P.neonCyan, 12, 14);

// ---------------------------------------------------------------- traffic lights
const LIGHT_CYCLE = 16; // seconds: 0–7 EW green, 7–8 all red, 8–15 NS green, 15–16 all red
function lightState(t) {
  const m = t % LIGHT_CYCLE;
  if (m < 7) return 'EW';
  if (m < 8) return 'NONE';
  if (m < 15) return 'NS';
  return 'NONE';
}
const lampMats = [];
for (const ix of ROADS) for (const iz of ROADS) {
  const px = ix + RW + 1, pz = iz + RW + 1;
  solid.add(px, 0.35, pz, 0.3, 5, 0.3, 0x2c313d);
  const mkLamp = (ox, oz, axis) => {
    const m = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), m);
    lamp.position.set(px + ox, 5.1, pz + oz);
    scene.add(lamp);
    solid.add(px + ox, 4.6, pz + oz, 0.7, 0.2, 0.7, 0x22262f);
    lampMats.push({ m, axis });
  };
  mkLamp(-0.6, 0, 'EW'); // controls east-west flow
  mkLamp(0, -0.6, 'NS');
}
function updateLamps(t) {
  const st = lightState(t);
  for (const { m, axis } of lampMats) {
    if (st === axis) m.color.set(0x2bff6a).multiplyScalar(2.4);
    else m.color.set(0xff2233).multiplyScalar(2.2);
  }
}

// ---------------------------------------------------------------- characters
function makeCharacter(opts = {}) {
  const g = new THREE.Group();
  const skin = opts.skin ?? pick([0xd9a066, 0xba8352, 0xe8b98a, 0x8a5a3b]);
  const shirt = opts.shirt ?? pick([0xd8d3c8, 0x7a3038, 0x2f5a6b, 0xc9803a, 0x4a4e6a, 0x8a2d4a]);
  const pants = opts.pants ?? pick([0x23283a, 0x3a2f28, 0x2c3a44]);
  const hair = opts.hair ?? pick([0x1a1a22, 0x3a2a1d, 0x555a66, 0x6b2430]);
  const M = (c) => new THREE.MeshLambertMaterial({ color: c });
  const mk = (w, h, d, c, x, y, z, parent = g) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c));
    b.position.set(x, y, z); parent.add(b); return b;
  };
  const legL = new THREE.Group(); legL.position.set(-0.18, 0.8, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.18, 0.8, 0); g.add(legR);
  mk(0.28, 0.8, 0.3, pants, 0, -0.4, 0, legL);
  mk(0.28, 0.8, 0.3, pants, 0, -0.4, 0, legR);
  mk(0.75, 0.85, 0.42, shirt, 0, 1.25, 0);
  const armL = new THREE.Group(); armL.position.set(-0.48, 1.6, 0); g.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.48, 1.6, 0); g.add(armR);
  mk(0.2, 0.75, 0.24, shirt, 0, -0.32, 0, armL);
  mk(0.2, 0.75, 0.24, shirt, 0, -0.32, 0, armR);
  mk(0.5, 0.5, 0.48, skin, 0, 1.95, 0);
  mk(0.56, 0.2, 0.54, hair, 0, 2.22, 0);
  mk(0.56, 0.18, 0.2, hair, 0, 2.05, -0.2);
  g.userData = { legL, legR, armL, armR, phase: R(0, 6) };
  scene.add(g);
  return g;
}
function animChar(ch, moving, speed, t) {
  const u = ch.userData;
  const s = moving ? Math.sin((t + u.phase) * 9 * Math.min(speed, 1.4)) * 0.55 : 0;
  u.legL.rotation.x = s; u.legR.rotation.x = -s;
  u.armL.rotation.x = -s * 0.8; u.armR.rotation.x = s * 0.8;
  ch.position.y = 0.45 + (moving ? Math.abs(Math.sin((t + u.phase) * 9)) * 0.05 : 0);
}

// player
const player = makeCharacter({ shirt: 0xe8e2d4, pants: 0x2c3a44, hair: 0x1a1a22 });
player.position.set(0, 0.45, 9.7); // south sidewalk of the market block, in clear view, off the NPC path line

// locator diamond above the player, drawn through buildings so you never lose yourself
const markerMat = new THREE.MeshBasicMaterial({ color: 0xff5c8a, transparent: true, opacity: 0.85, depthTest: false });
const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), markerMat);
marker.renderOrder = 999;
scene.add(marker);
let focusT = 0;

// NPCs walk loops around their block's sidewalk
const npcs = [];
for (const [bi, bj] of blockDefs) {
  const [x0, x1] = spans[bi], [z0, z1] = spans[bj];
  const inset = 1.3;
  const rect = { x0: x0 + inset, x1: x1 - inset, z0: z0 + inset, z1: z1 - inset };
  const per = 2 * (rect.x1 - rect.x0) + 2 * (rect.z1 - rect.z0);
  const count = (bi === 1 && bj === 1) ? 4 : RI(1, 3);
  for (let i = 0; i < count; i++) {
    npcs.push({
      ch: makeCharacter(), rect, per,
      s: R(0, per), speed: R(1.2, 2.4) * (rng() < 0.5 ? 1 : -1),
      pauseT: 0,
    });
  }
}
function perimeterPos(rect, s) {
  const wx = rect.x1 - rect.x0, wz = rect.z1 - rect.z0;
  s = ((s % (2 * wx + 2 * wz)) + 2 * wx + 2 * wz) % (2 * wx + 2 * wz);
  if (s < wx) return [rect.x0 + s, rect.z0, 1, 0];
  s -= wx;
  if (s < wz) return [rect.x1, rect.z0 + s, 0, 1];
  s -= wz;
  if (s < wx) return [rect.x1 - s, rect.z1, -1, 0];
  s -= wx;
  return [rect.x0, rect.z1 - s, 0, -1];
}

// ---------------------------------------------------------------- cars
const carBodies = [0x8e2f37, 0x2f4b6b, 0x3a3f4c, 0x6b5a2f, 0x54306b, 0xb8b4a8];
function makeCar() {
  const g = new THREE.Group();
  const col = pick(carBodies);
  const M = (c) => new THREE.MeshLambertMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.0, 1.9), M(col));
  body.position.y = 0.75; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 1.7), M(shade(col, -0.04)));
  cab.position.set(-0.3, 1.6, 0); g.add(cab);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.5, 1.5), new THREE.MeshBasicMaterial({ color: 0x9fd9e8 }));
  glass.material.color.multiplyScalar(0.9);
  glass.position.set(-0.3, 1.65, 0); g.add(glass);
  for (const [wx, wz] of [[-1.3, 0.95], [1.3, 0.95], [-1.3, -0.95], [1.3, -0.95]]) {
    const wh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.3), M(0x14151c));
    wh.position.set(wx, 0.35, wz); g.add(wh);
  }
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 1.5), new THREE.MeshBasicMaterial({ color: 0xfff2c9 }));
  hl.material.color.multiplyScalar(2.6);
  hl.position.set(2.05, 0.75, 0); g.add(hl);
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 1.5), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
  tl.material.color.multiplyScalar(2.4);
  tl.position.set(-2.02, 0.78, 0); g.add(tl);
  scene.add(g);
  return g;
}
// lanes: axis of travel, sign of direction, and the fixed cross coordinate
const lanes = [];
for (const c of ROADS) {
  lanes.push({ axis: 'x', dir: 1, cross: c - 2 });
  lanes.push({ axis: 'x', dir: -1, cross: c + 2 });
  lanes.push({ axis: 'z', dir: 1, cross: c + 2 });
  lanes.push({ axis: 'z', dir: -1, cross: c - 2 });
}
const cars = [];
for (const lane of lanes) {
  const n = RI(2, 3);
  for (let i = 0; i < n; i++) {
    cars.push({
      g: makeCar(), lane,
      p: R(-EXT, EXT) + i * (2 * EXT / n),
      v: 0, vmax: R(6, 8.5),
    });
  }
}
function carUpdate(car, dt, t) {
  const { lane } = car;
  let target = car.vmax;
  const ahead = (d) => car.p + lane.dir * d; // helper meaning: coordinate d units ahead

  // stop for red lights
  const st = lightState(t);
  const green = lane.axis === 'x' ? 'EW' : 'NS';
  for (const ic of ROADS) {
    const stop = ic - lane.dir * (RW + 2.2);
    const dist = (stop - car.p) * lane.dir;
    if (dist > 0 && dist < 10 && st !== green) {
      target = Math.min(target, Math.max(0, (dist - 1.2) * 1.8));
    }
  }
  // follow the car ahead in the same lane
  for (const o of cars) {
    if (o === car || o.lane !== lane) continue;
    let gap = (o.p - car.p) * lane.dir;
    if (gap < 0) gap += 2 * EXT + 16; // wrapped
    if (gap < 7) target = Math.min(target, Math.max(0, (gap - 5) * 2));
  }
  // brake for pedestrians / the player in the roadway ahead
  const peds = [player, ...npcs.map(n => n.ch)];
  for (const ped of peds) {
    const along = lane.axis === 'x' ? ped.position.x : ped.position.z;
    const cross = lane.axis === 'x' ? ped.position.z : ped.position.x;
    const dist = (along - car.p) * lane.dir;
    if (dist > 0 && dist < 8 && Math.abs(cross - lane.cross) < 2.6) {
      target = Math.min(target, Math.max(0, (dist - 3.5) * 1.6));
    }
  }
  car.v += Math.sign(target - car.v) * Math.min(Math.abs(target - car.v), (target > car.v ? 5 : 14) * dt);
  car.p += car.v * lane.dir * dt;
  const lim = EXT + 8;
  if (car.p > lim) car.p = -lim;
  if (car.p < -lim) car.p = lim;

  if (lane.axis === 'x') {
    car.g.position.set(car.p, 0.1, lane.cross);
    car.g.rotation.y = lane.dir > 0 ? 0 : Math.PI;
  } else {
    car.g.position.set(lane.cross, 0.1, car.p);
    car.g.rotation.y = lane.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
}

// ---------------------------------------------------------------- finalize static geometry
solid.build();
glowB.build();

// ---------------------------------------------------------------- input
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
let camAngle = Math.PI / 4;   // 45°, matching the reference view
let camTargetAngle = camAngle;
addEventListener('keydown', (e) => {
  if (e.code === 'KeyQ') camTargetAngle += Math.PI / 2;
  if (e.code === 'KeyE') camTargetAngle -= Math.PI / 2;
});
addEventListener('wheel', (e) => {
  viewSize = Math.min(80, Math.max(18, viewSize + e.deltaY * 0.03));
  setFrustum();
}, { passive: true });

function focusPlayer() {
  viewSize = 26;
  setFrustum();
  camTarget.copy(player.position);
  focusT = 2.5;
}
document.getElementById('focus')?.addEventListener('click', focusPlayer);
addEventListener('keydown', (e) => { if (e.code === 'KeyF') focusPlayer(); });

// touch joystick
const stick = document.getElementById('stick');
const knob = document.getElementById('knob');
let joy = { x: 0, y: 0, active: false };
if (stick) {
  const onMove = (e) => {
    const t = e.touches[0];
    const r = stick.getBoundingClientRect();
    let dx = t.clientX - (r.left + 55), dy = t.clientY - (r.top + 55);
    const m = Math.hypot(dx, dy);
    if (m > 38) { dx = dx / m * 38; dy = dy / m * 38; }
    knob.style.left = 35 + dx + 'px'; knob.style.top = 35 + dy + 'px';
    joy.x = dx / 38; joy.y = dy / 38; joy.active = true;
  };
  stick.addEventListener('touchstart', onMove, { passive: true });
  stick.addEventListener('touchmove', onMove, { passive: true });
  stick.addEventListener('touchend', () => {
    joy = { x: 0, y: 0, active: false };
    knob.style.left = '35px'; knob.style.top = '35px';
  });
}

function collide(x, z) {
  if (Math.abs(x) > EXT + 1 || Math.abs(z) > EXT + 1) return true;
  for (const c of colliders) {
    if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
  }
  return false;
}

// ---------------------------------------------------------------- main loop
const camTarget = new THREE.Vector3().copy(player.position);
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // --- player movement (camera-relative)
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz -= 1;
  if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.active) { ix = joy.x; iz = joy.y; }
  const mag = Math.hypot(ix, iz);
  let moving = false;
  if (mag > 0.1) {
    const sp = 7 * Math.min(mag, 1);
    const sin = Math.sin(camAngle), cos = Math.cos(camAngle);
    const dx = (ix * cos - iz * sin) * sp * dt;
    const dz = (ix * sin + iz * cos) * sp * dt;
    if (!collide(player.position.x + dx, player.position.z)) player.position.x += dx;
    if (!collide(player.position.x, player.position.z + dz)) player.position.z += dz;
    player.rotation.y = Math.atan2(dx, dz);
    moving = true;
  }
  animChar(player, moving, 1, t);

  // locator marker: bobbing diamond, pulses big after "find me"
  marker.position.set(player.position.x, player.position.y + 3.1 + Math.sin(t * 3) * 0.15, player.position.z);
  marker.rotation.y = t * 1.5;
  if (focusT > 0) {
    focusT -= dt;
    marker.scale.setScalar(1 + Math.max(0, Math.sin(focusT * 5)) * 1.1);
  } else {
    marker.scale.setScalar(1);
  }

  // --- NPCs
  for (const n of npcs) {
    if (n.pauseT > 0) {
      n.pauseT -= dt;
      animChar(n.ch, false, 0, t);
      continue;
    }
    if (rng() < 0.0008) n.pauseT = R(1, 3);
    n.s += n.speed * dt;
    const [x, z, dx, dz] = perimeterPos(n.rect, n.s);
    n.ch.position.x = x; n.ch.position.z = z;
    const f = Math.sign(n.speed);
    n.ch.rotation.y = Math.atan2(dx * f, dz * f);
    animChar(n.ch, true, Math.abs(n.speed) / 2, t);
  }

  // --- traffic
  for (const car of cars) carUpdate(car, dt, t);
  updateLamps(t);

  // --- neon flicker & beacons
  for (const f of flickerSigns) {
    f.t += dt;
    const on = Math.sin(f.t * 23) + Math.sin(f.t * 7.3) > -0.9 ? 1 : 0.25;
    f.mat.color.setScalar(f.base * on);
  }
  for (const b of blinkers) {
    const on = ((t + b.phase) % b.period) < b.period * 0.55;
    b.mat.color.set(b.color).multiplyScalar(on ? b.hi : b.lo);
  }

  // --- camera
  camAngle += (camTargetAngle - camAngle) * Math.min(1, dt * 5);
  camTarget.lerp(player.position, Math.min(1, dt * 4));
  const elev = 0.62; // ~35°
  const dist = 120;
  camera.position.set(
    camTarget.x + Math.sin(camAngle) * Math.cos(elev) * dist,
    camTarget.y + Math.sin(elev) * dist,
    camTarget.z + Math.cos(camAngle) * Math.cos(elev) * dist,
  );
  camera.lookAt(camTarget.x, camTarget.y + 2, camTarget.z);

  composer.render();
}
tick();
