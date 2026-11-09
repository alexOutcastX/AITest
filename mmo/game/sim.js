// Authoritative game simulation. Runs on the Node server, or inside the
// browser in offline mode. It knows nothing about networking: callers feed it
// messages with handle() and pull per-player snapshots with snapshot().

import { generateWorld, isBlocked, inTown, findPath, TOWN } from './world.js';

export const TICK = 0.05;          // 20 Hz simulation
export const PLAYER_SPEED = 4.2;   // tiles / second
export const PLAYER_RADIUS = 0.3;
export const ATTACK_RANGE = 1.6;
const VIEW = 22;                   // half-extent (tiles) of what a player is sent
const HEAL_CD = 12, STRIKE_CD = 6, SWING_CD = 0.8;

export const MONSTERS = {
  slime:    { name: 'Slime',    level: 1,  hp: 30,  atk: 4,  def: 0, speed: 2.2, xp: 9,   gold: [1, 3],   aggro: 0, range: 1.3, cd: 1.2, r: 0.35 },
  wolf:     { name: 'Wolf',     level: 4,  hp: 75,  atk: 10, def: 2, speed: 4.0, xp: 26,  gold: [2, 6],   aggro: 6, range: 1.4, cd: 1.0, r: 0.4 },
  skeleton: { name: 'Skeleton', level: 8,  hp: 150, atk: 17, def: 5, speed: 3.2, xp: 60,  gold: [5, 12],  aggro: 7, range: 1.5, cd: 1.1, r: 0.35 },
  ogre:     { name: 'Ogre',     level: 13, hp: 340, atk: 30, def: 9, speed: 2.8, xp: 150, gold: [12, 30], aggro: 6, range: 1.8, cd: 1.6, r: 0.55 },
};

const BOT_NAMES = ['Aldric', 'Brina', 'Corwin', 'Dessa', 'Eamon', 'Fenna', 'Garrick', 'Hilde', 'Ivo', 'Jessa', 'Kael', 'Lyra'];
const BOT_LINES = [
  'anyone want to group up?', 'wolves to the east hit hard', 'lfg skeletons',
  'that ogre nearly had me', 'selling nothing, buying everything', 'gg',
  'how do I get out of town', 'heal is on 1 btw', 'the road north is safe-ish',
];

export const xpNext = l => Math.round(30 * Math.pow(l, 1.6));
export const playerStats = l => ({ maxHp: 60 + (l - 1) * 14, atk: 7 + (l - 1) * 2.5, def: (l - 1) * 1.2 });

export function blockedAt(map, x, y, r, monster) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (isBlocked(map, tx, ty, monster)) return true;
  return false;
}

// Axis-separated movement so entities slide along walls.
export function moveEntity(map, e, dx, dy, monster) {
  let moved = false;
  if (dx && !blockedAt(map, e.x + dx, e.y, e.r, monster)) { e.x += dx; moved = true; }
  if (dy && !blockedAt(map, e.x, e.y + dy, e.r, monster)) { e.y += dy; moved = true; }
  return moved;
}

// True if a circle of radius r can travel in a straight line from a to (x, y).
function clearLine(map, a, x, y, r, monster) {
  const d = Math.hypot(x - a.x, y - a.y), n = Math.ceil(d / 0.25);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (blockedAt(map, a.x + (x - a.x) * t, a.y + (y - a.y) * t, r, monster)) return false;
  }
  return true;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const r2 = v => Math.round(v * 100) / 100;
const entInTown = e => inTown(Math.floor(e.x), Math.floor(e.y));

export function validName(name) {
  const n = String(name ?? '').trim();
  return /^[A-Za-z0-9_ ]{2,16}$/.test(n) ? n : null;
}

export class World {
  constructor({ seed = 1337, store = null, bots = 0 } = {}) {
    this.seed = seed;
    this.map = generateWorld(seed);
    this.store = store;
    this.ents = new Map();
    this.players = new Map();
    this.respawns = [];
    this.nextId = 1;
    this.time = 0;
    for (const sp of this.map.spawns) this.spawnMonster(sp);
    for (let i = 0; i < bots; i++) this.addBot(BOT_NAMES[i % BOT_NAMES.length]);
  }

  // ---------- lifecycle ----------

  spawnMonster(sp) {
    const d = MONSTERS[sp.kind];
    const m = {
      id: this.nextId++, type: 'mob', kind: sp.kind, name: d.name, level: d.level,
      x: sp.x + 0.5, y: sp.y + 0.5, r: d.r, hp: d.hp, maxHp: d.hp, atk: d.atk, def: d.def,
      home: { x: sp.x + 0.5, y: sp.y + 0.5 }, sp, target: 0, cd: 0, state: 'idle',
      wanderAt: Math.random() * 4, wx: null, wy: null, moving: false, face: 1, dmgBy: new Map(),
    };
    this.ents.set(m.id, m);
    return m;
  }

  townSpot() {
    for (let i = 0; i < 50; i++) {
      const x = TOWN.x + 0.5 + (Math.random() * 2 - 1) * 2.5;
      const y = TOWN.y + 0.5 + (Math.random() * 2 - 1) * 2.5;
      if (!blockedAt(this.map, x, y, PLAYER_RADIUS)) return { x, y };
    }
    return { x: TOWN.x + 0.5, y: TOWN.y + 0.5 };
  }

  makePlayer(name, saved, bot) {
    const level = Math.max(1, Math.min(99, saved?.level | 0 || 1));
    const spot = this.townSpot();
    const p = {
      id: this.nextId++, type: 'pc', name, bot: !!bot, level,
      xp: Math.max(0, saved?.xp | 0), gold: Math.max(0, saved?.gold | 0), kills: Math.max(0, saved?.kills | 0),
      x: spot.x, y: spot.y, r: PLAYER_RADIUS, hp: 1, maxHp: 1, atk: 1, def: 0,
      inDx: 0, inDy: 0, goX: null, goY: null, target: 0,
      cd: 0, cdHeal: 0, cdStrike: 0, lastHurt: -99, chatAt: -99, say: null,
      moving: false, face: 1, outbox: bot ? null : [],
      ai: bot ? { next: 0, chatAt: 30 + Math.random() * 90 } : null,
    };
    this.recalc(p);
    p.hp = p.maxHp;
    return p;
  }

  recalc(p) {
    const s = playerStats(p.level);
    p.maxHp = s.maxHp; p.atk = s.atk; p.def = s.def;
  }

  isOnline(name) {
    const n = name.toLowerCase();
    for (const p of this.players.values()) if (p.name.toLowerCase() === n) return true;
    return false;
  }

  join(rawName) {
    const name = validName(rawName);
    if (!name) return { err: 'Names are 2-16 letters, digits, spaces or _.' };
    if (this.isOnline(name)) return { err: 'That name is already in the world.' };
    const p = this.makePlayer(name, this.store?.load(name), false);
    this.players.set(p.id, p);
    this.ents.set(p.id, p);
    this.broadcast({ k: 'sys', text: `${name} has entered Thornvale.` });
    this.tell(p, { k: 'sys', text: 'Welcome! Click or tap monsters to attack. 1 = Heal, 2 = Power Strike. The town walls keep monsters out.' });
    return { id: p.id };
  }

  addBot(name) {
    const p = this.makePlayer(name, { level: rint(1, 7) }, true);
    this.players.set(p.id, p);
    this.ents.set(p.id, p);
  }

  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.save(p);
    this.players.delete(id);
    this.ents.delete(id);
    this.broadcast({ k: 'sys', text: `${p.name} has left.` });
  }

  save(p) {
    if (!p.bot && this.store) this.store.save(p.name, { level: p.level, xp: p.xp, gold: p.gold, kills: p.kills });
  }

  saveAll() { for (const p of this.players.values()) this.save(p); }

  // ---------- events ----------

  tell(p, ev) { if (p.outbox && p.outbox.length < 200) p.outbox.push(ev); }
  broadcast(ev) { for (const p of this.players.values()) this.tell(p, ev); }
  emit(ev, x, y) {
    for (const p of this.players.values())
      if (Math.abs(p.x - x) < VIEW + 4 && Math.abs(p.y - y) < VIEW + 4) this.tell(p, ev);
  }

  // ---------- input ----------

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'in': {
        let dx = Number(msg.dx) || 0, dy = Number(msg.dy) || 0;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        p.inDx = dx; p.inDy = dy;
        if (l > 0.1) p.goX = p.goY = null;
        break;
      }
      case 'go': {
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return;
        p.goX = x; p.goY = y; p.target = 0;
        break;
      }
      case 'tgt': {
        const t = this.ents.get(msg.id | 0);
        p.target = t && t.type === 'mob' ? t.id : 0;
        if (p.target) p.goX = p.goY = null;
        break;
      }
      case 'ab':
        this.ability(p, msg.k);
        break;
      case 'chat': {
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
        if (!text || this.time - p.chatAt < 0.6) return;
        this.say(p, text);
        break;
      }
    }
  }

  say(p, text) {
    p.chatAt = this.time;
    p.say = { text, until: this.time + 5 };
    this.broadcast({ k: 'chat', from: p.name, bot: p.bot ? 1 : 0, text });
  }

  ability(p, k) {
    if (k === 'heal') {
      if (p.cdHeal > 0 || p.hp >= p.maxHp) return;
      const n = Math.round(p.maxHp * 0.35);
      p.hp = Math.min(p.maxHp, p.hp + n);
      p.cdHeal = HEAL_CD;
      this.emit({ k: 'heal', id: p.id, n }, p.x, p.y);
    } else if (k === 'strike') {
      const t = this.ents.get(p.target);
      if (p.cdStrike > 0 || !t || dist(p, t) > ATTACK_RANGE) return;
      p.cdStrike = STRIKE_CD;
      p.cd = Math.max(p.cd, 0.4);
      this.attack(p, t, 2.2);
    }
  }

  // ---------- simulation ----------

  tick(dt = TICK) {
    this.time += dt;
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      if (this.respawns[i].at <= this.time) {
        this.spawnMonster(this.respawns[i].sp);
        this.respawns.splice(i, 1);
      }
    }
    for (const e of [...this.ents.values()]) {
      if (!this.ents.has(e.id)) continue;
      if (e.type === 'pc') this.updatePlayer(e, dt);
      else this.updateMob(e, dt);
    }
  }

  updatePlayer(p, dt) {
    if (p.bot) this.botThink(p);
    p.cd = Math.max(0, p.cd - dt);
    p.cdHeal = Math.max(0, p.cdHeal - dt);
    p.cdStrike = Math.max(0, p.cdStrike - dt);
    if (p.say && p.say.until < this.time) p.say = null;

    let tgt = p.target ? this.ents.get(p.target) : null;
    if (p.target && !tgt) p.target = 0;

    const mx = p.inDx, my = p.inDy;
    if (Math.hypot(mx, my) >= 0.1) {
      p.path = null;
      p.moving = moveEntity(this.map, p, mx * PLAYER_SPEED * dt, my * PLAYER_SPEED * dt, false);
      if (Math.abs(mx) > 0.2) p.face = mx > 0 ? 1 : -1;
    } else if (p.goX != null) {
      if (Math.hypot(p.goX - p.x, p.goY - p.y) < 0.15 || !this.navigate(p, p.goX, p.goY, PLAYER_SPEED, dt)) p.goX = p.goY = null;
    } else if (tgt && dist(p, tgt) > ATTACK_RANGE * 0.85) {
      if (!this.navigate(p, tgt.x, tgt.y, PLAYER_SPEED, dt)) p.target = 0;
    } else p.moving = false;

    if (tgt && p.cd <= 0 && dist(p, tgt) <= ATTACK_RANGE) {
      p.face = tgt.x >= p.x ? 1 : -1;
      this.attack(p, tgt, 1);
      p.cd = SWING_CD;
    }

    const town = entInTown(p);
    if (town || this.time - p.lastHurt > 5)
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * (town ? 0.12 : 0.025) * dt);
  }

  updateMob(m, dt) {
    const d = MONSTERS[m.kind];
    m.cd = Math.max(0, m.cd - dt);
    const homeD = Math.hypot(m.x - m.home.x, m.y - m.home.y);

    if (m.state === 'return') {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5 * dt);
      if (homeD < 0.4) { m.state = 'idle'; m.hp = m.maxHp; m.dmgBy.clear(); m.moving = false; return; }
      if (!this.navigate(m, m.home.x, m.home.y, d.speed * 1.3, dt)) { m.x = m.home.x; m.y = m.home.y; }
      return;
    }

    let tgt = m.target ? this.ents.get(m.target) : null;
    if (tgt && (tgt.type !== 'pc' || entInTown(tgt))) { tgt = null; m.target = 0; }

    if (!tgt && d.aggro > 0) {
      let best = null, bd = d.aggro;
      for (const p of this.players.values()) {
        const pd = dist(m, p);
        if (pd < bd && !entInTown(p)) { bd = pd; best = p; }
      }
      if (best) { tgt = best; m.target = best.id; }
    }

    if (tgt) {
      if (homeD > 14) { m.state = 'return'; m.target = 0; return; }
      const td = dist(m, tgt);
      if (td > d.range * 0.8) { if (!this.navigate(m, tgt.x, tgt.y, d.speed, dt)) { m.state = 'return'; m.target = 0; return; } }
      else m.moving = false;
      if (td <= d.range && m.cd <= 0) {
        m.face = tgt.x >= m.x ? 1 : -1;
        this.attack(m, tgt, 1);
        m.cd = d.cd;
      }
      return;
    }

    if (homeD > 6) { m.state = 'return'; return; }
    if (this.time > m.wanderAt) {
      m.wanderAt = this.time + 3 + Math.random() * 5;
      if (Math.random() < 0.6) {
        m.wx = m.home.x + (Math.random() * 2 - 1) * 4;
        m.wy = m.home.y + (Math.random() * 2 - 1) * 4;
      } else m.wx = null;
    }
    if (m.wx != null) {
      if (Math.hypot(m.wx - m.x, m.wy - m.y) < 0.3 || !this.stepToward(m, m.wx, m.wy, d.speed * 0.4, dt)) {
        m.wx = null; m.moving = false;
      }
    } else m.moving = false;
  }

  // Move toward (x, y): straight line when clear, otherwise follow an A* path.
  // Returns false if the destination is unreachable or we're stuck.
  navigate(e, x, y, speed, dt) {
    const mob = e.type === 'mob';
    if (clearLine(this.map, e, x, y, e.r, mob)) {
      e.path = null;
      return this.stepToward(e, x, y, speed, dt) || Math.hypot(x - e.x, y - e.y) < 0.05;
    }
    const gx = Math.floor(x), gy = Math.floor(y);
    if (!e.path || e.pathGoal !== gy * this.map.w + gx || this.time > e.pathAt + 2) {
      e.path = findPath(this.map, e.x, e.y, gx, gy, mob, mob ? 1500 : 4000);
      e.pathGoal = gy * this.map.w + gx;
      e.pathAt = this.time;
      if (!e.path) return false;
    }
    // Skip waypoints we can already see past.
    while (e.path.length > 1 && clearLine(this.map, e, e.path[1].x, e.path[1].y, e.r, mob)) e.path.shift();
    const wp = e.path[0];
    if (!wp) { e.path = null; return this.stepToward(e, x, y, speed, dt); }
    if (Math.hypot(wp.x - e.x, wp.y - e.y) < 0.2) e.path.shift();
    this.stepToward(e, wp.x, wp.y, speed, dt);
    return true;
  }

  stepToward(e, x, y, speed, dt) {
    const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
    if (d < 0.01) { e.moving = false; return false; }
    const s = Math.min(d, speed * dt);
    const moved = moveEntity(this.map, e, (dx / d) * s, (dy / d) * s, e.type === 'mob');
    e.moving = moved;
    if (Math.abs(dx) > 0.05) e.face = dx > 0 ? 1 : -1;
    return moved;
  }

  attack(a, t, mult) {
    let dmg = a.atk * (0.85 + Math.random() * 0.3) * mult - t.def * 0.5;
    const crit = Math.random() < 0.1;
    if (crit) dmg *= 1.75;
    dmg = Math.max(1, Math.round(dmg));
    t.hp -= dmg;
    this.emit({ k: 'sw', id: a.id }, a.x, a.y);
    this.emit({ k: 'dmg', id: t.id, n: dmg, c: crit ? 1 : 0, pc: t.type === 'pc' ? 1 : 0 }, t.x, t.y);
    if (t.type === 'mob') {
      t.dmgBy.set(a.id, (t.dmgBy.get(a.id) || 0) + dmg);
      if (!t.target) t.target = a.id;
      if (t.hp <= 0) this.killMob(t);
    } else {
      t.lastHurt = this.time;
      if (t.hp <= 0) this.killPlayer(t, a);
    }
  }

  killMob(m) {
    const d = MONSTERS[m.kind];
    this.ents.delete(m.id);
    this.respawns.push({ at: this.time + 10 + Math.random() * 10, sp: m.sp });
    this.emit({ k: 'die', id: m.id, x: r2(m.x), y: r2(m.y), kind: m.kind }, m.x, m.y);
    let top = null, topDmg = 0;
    for (const [pid, amt] of m.dmgBy) {
      const p = this.players.get(pid);
      if (!p) continue;
      if (amt > topDmg) { topDmg = amt; top = p; }
      // Everyone who helped gets full XP, scaled by level difference.
      const scale = Math.max(0.1, Math.min(2, 1 + (m.level - p.level) * 0.15));
      const xp = Math.max(1, Math.round(d.xp * scale));
      p.kills++;
      this.tell(p, { k: 'xp', n: xp });
      this.giveXp(p, xp);
    }
    if (top) {
      const g = rint(d.gold[0], d.gold[1]);
      top.gold += g;
      this.tell(top, { k: 'gold', n: g });
    }
  }

  giveXp(p, n) {
    p.xp += n;
    while (p.xp >= xpNext(p.level)) {
      p.xp -= xpNext(p.level);
      p.level++;
      this.recalc(p);
      p.hp = p.maxHp;
      this.emit({ k: 'lvl', id: p.id, level: p.level }, p.x, p.y);
      this.broadcast({ k: 'sys', text: `${p.name} reached level ${p.level}!` });
    }
    this.save(p);
  }

  killPlayer(p, killer) {
    const lost = Math.floor(p.xp * 0.2);
    p.xp -= lost;
    this.emit({ k: 'die', id: p.id, x: r2(p.x), y: r2(p.y), kind: 'pc' }, p.x, p.y);
    this.tell(p, { k: 'dead', by: killer.name, lost });
    const spot = this.townSpot();
    p.x = spot.x; p.y = spot.y;
    p.hp = p.maxHp; p.target = 0; p.goX = p.goY = null; p.inDx = p.inDy = 0;
    p.respawned = true;
    for (const e of this.ents.values()) if (e.type === 'mob' && e.target === p.id) { e.target = 0; e.state = 'return'; }
    this.save(p);
  }

  // ---------- simulated players (offline mode / server ambience) ----------

  botThink(p) {
    const ai = p.ai;
    if (this.time >= ai.chatAt) {
      ai.chatAt = this.time + 60 + Math.random() * 120;
      this.say(p, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]);
    }
    if (p.hp < p.maxHp * 0.4 && p.cdHeal <= 0) this.ability(p, 'heal');
    if (p.hp < p.maxHp * 0.25) { p.target = 0; p.goX = TOWN.x + 0.5; p.goY = TOWN.y + 0.5; ai.resting = true; return; }
    if (ai.resting) {
      if (p.hp < p.maxHp * 0.95) { if (entInTown(p)) p.goX = p.goY = null; return; }
      ai.resting = false;
    }
    const t = this.ents.get(p.target);
    if (t && p.cdStrike <= 0 && dist(p, t) <= ATTACK_RANGE) this.ability(p, 'strike');
    if (t || this.time < ai.next) return;
    ai.next = this.time + 1 + Math.random();
    let best = null, bd = 14;
    for (const e of this.ents.values()) {
      if (e.type !== 'mob' || e.level > p.level + 1 || e.state === 'return') continue;
      const d = dist(p, e);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { p.target = best.id; p.goX = p.goY = null; return; }
    if (p.goX == null) {
      // Head out to a ring that matches our level.
      const ring = p.level < 4 ? 28 : p.level < 8 ? 46 : p.level < 13 ? 62 : 78;
      const a = Math.random() * Math.PI * 2;
      p.goX = TOWN.x + 0.5 + Math.cos(a) * ring;
      p.goY = TOWN.y + 0.5 + Math.sin(a) * ring;
    }
  }

  // ---------- snapshots ----------

  snapshot(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const e = [];
    for (const o of this.ents.values()) {
      if (Math.abs(o.x - p.x) > VIEW || Math.abs(o.y - p.y) > VIEW) continue;
      const flags = (o.moving ? 1 : 0) | (o.face < 0 ? 2 : 0) | (o.bot ? 4 : 0) | (o.state === 'return' ? 8 : 0);
      e.push([o.id, o.type === 'pc' ? 'pc' : o.kind, r2(o.x), r2(o.y), Math.ceil(o.hp), o.maxHp, o.level, flags,
        o.type === 'pc' ? o.name : 0, o.say ? o.say.text : 0]);
    }
    const pl = [];
    for (const o of this.players.values()) if (o !== p) pl.push([Math.round(o.x), Math.round(o.y)]);
    const ev = p.outbox;
    p.outbox = [];
    const you = {
      id: p.id, x: r2(p.x), y: r2(p.y), hp: Math.ceil(p.hp), maxHp: p.maxHp, level: p.level,
      xp: p.xp, xpNext: xpNext(p.level), gold: p.gold, kills: p.kills, tgt: p.target,
      cd: [r2(p.cd), r2(p.cdHeal), r2(p.cdStrike)], cdMax: [SWING_CD, HEAL_CD, STRIKE_CD],
    };
    if (p.respawned) { you.snap = 1; p.respawned = false; }
    return { t: 's', you, e, pl, n: this.players.size, ev };
  }
}
