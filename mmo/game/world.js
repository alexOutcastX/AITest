// Deterministic world generation shared by the server and the client.
// Same seed => same map everywhere, so the map is never sent over the wire.

export const W = 192;
export const H = 192;

export const T = {
  WATER: 0, SAND: 1, GRASS: 2, TREE: 3, ROCK: 4, PATH: 5,
  FLOOR: 6, WALL: 7, FLOWERS: 8, DARK: 9, DARKTREE: 10,
};
const BLOCKS = [true, false, false, true, true, false, false, true, false, false, true];

// Town is a walled square in the middle of the island; monsters can't enter it.
export const TOWN = { x: 96, y: 96, half: 9 };

export function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed, oct) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += noise(x * f, y * f, seed + i * 101) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function inTown(tx, ty) {
  return Math.abs(tx - TOWN.x) <= TOWN.half && Math.abs(ty - TOWN.y) <= TOWN.half;
}

export function zoneKind(x, y) {
  const d = Math.hypot(x - TOWN.x, y - TOWN.y);
  if (d < 40) return 'slime';
  if (d < 56) return 'wolf';
  if (d < 72) return 'skeleton';
  return 'ogre';
}

export function generateWorld(seed) {
  const tiles = new Uint8Array(W * H);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = t; };
  const get = (x, y) => tiles[y * W + x];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const e = fbm(x / 28, y / 28, seed, 5) + 0.46 - d * d * 0.8;
      const m = fbm(x / 16 + 50, y / 16 + 50, seed + 7, 4);
      const r = fbm(x / 9 + 200, y / 9 + 200, seed + 13, 3);
      const far = Math.hypot(x - TOWN.x, y - TOWN.y) > 66;
      let t;
      if (e < 0.33) t = T.WATER;
      else if (e < 0.37) t = T.SAND;
      else if (r > 0.7) t = T.ROCK;
      else if (m > 0.6) t = far ? T.DARKTREE : T.TREE;
      else if (hash2(x, y, seed + 3) < 0.025) t = T.FLOWERS;
      else t = far ? T.DARK : T.GRASS;
      tiles[y * W + x] = t;
    }
  }

  // Clear meadow around town.
  for (let y = TOWN.y - 16; y <= TOWN.y + 16; y++)
    for (let x = TOWN.x - 16; x <= TOWN.x + 16; x++)
      if (Math.hypot(x - TOWN.x, y - TOWN.y) <= 16) set(x, y, hash2(x, y, seed + 9) < 0.05 ? T.FLOWERS : T.GRASS);

  // Roads from each gate until they hit the sea.
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    for (let i = TOWN.half; i < W; i++) {
      const cx = TOWN.x + dx * i, cy = TOWN.y + dy * i;
      if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1 || get(cx, cy) === T.WATER) break;
      for (let w = -1; w <= 1; w++) set(cx + dy * w, cy + dx * w, T.PATH);
    }
  }

  // Town: stone plaza, wall ring with 3-wide gates, a few buildings.
  const { x: tx, y: ty, half } = TOWN;
  for (let y = ty - half; y <= ty + half; y++) {
    for (let x = tx - half; x <= tx + half; x++) {
      const edge = Math.abs(x - tx) === half || Math.abs(y - ty) === half;
      const gate = Math.abs(x - tx) <= 1 || Math.abs(y - ty) <= 1;
      set(x, y, edge && !gate ? T.WALL : T.FLOOR);
    }
  }
  for (const [ox, oy] of [[-6, -6], [3, -6], [-6, 4], [3, 4]])
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) set(tx + ox + x, ty + oy + y, T.WALL);

  // Monster spawn points, banded by distance from town (harder further out).
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const spawns = [];
  let tries = 0;
  const quota = { slime: 64, wolf: 60, skeleton: 52, ogre: 44 };
  while (spawns.length < 220 && tries++ < 40000) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
    const t = get(x, y);
    if (BLOCKS[t] || t === T.PATH || inTown(x, y)) continue;
    if (Math.hypot(x - tx, y - ty) < 20) continue;
    const kind = zoneKind(x, y);
    if (quota[kind] <= 0) continue;
    if (spawns.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) < 4)) continue;
    quota[kind]--;
    spawns.push({ x, y, kind });
  }

  return { seed, w: W, h: H, tiles, spawns };
}

export function tileAt(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return T.WATER;
  return map.tiles[ty * map.w + tx];
}

export function isBlocked(map, tx, ty, monster) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  if (BLOCKS[map.tiles[ty * map.w + tx]]) return true;
  return !!monster && inTown(tx, ty);
}

// A* over the tile grid (8-way, no corner cutting). Returns tile-centre
// waypoints from just after the start to the goal, or null if unreachable
// within the node budget.
export function findPath(map, sx, sy, gx, gy, monster, budget = 4000) {
  const w = map.w;
  sx |= 0; sy |= 0; gx |= 0; gy |= 0;
  if (isBlocked(map, gx, gy, monster)) return null;
  const start = sy * w + sx, goal = gy * w + gx;
  if (start === goal) return [];
  const g = new Map([[start, 0]]);
  const from = new Map();
  const heap = new Heap();
  heap.push(Math.hypot(gx - sx, gy - sy), start);
  const closed = new Set();
  while (heap.size && closed.size < budget) {
    const cur = heap.pop();
    if (cur === goal) {
      const path = [];
      for (let n = goal; n !== start; n = from.get(n)) path.push({ x: (n % w) + 0.5, y: Math.floor(n / w) + 0.5 });
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % w, cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (isBlocked(map, nx, ny, monster)) continue;
        if (dx && dy && (isBlocked(map, cx + dx, cy, monster) || isBlocked(map, cx, cy + dy, monster))) continue;
        const n = ny * w + nx;
        if (closed.has(n)) continue;
        const ng = g.get(cur) + (dx && dy ? 1.4142 : 1);
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng); from.set(n, cur);
          heap.push(ng + Math.hypot(gx - nx, gy - ny), n);
        }
      }
    }
  }
  return null;
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const { k, v } = this;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const { k, v } = this;
    const top = v[0], lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
