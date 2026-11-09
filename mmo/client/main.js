import { generateWorld } from '../game/world.js';
import { moveEntity, MONSTERS, PLAYER_SPEED, PLAYER_RADIUS } from '../game/sim.js';
import { connect } from './net.js';
import { Renderer } from './render.js';

const $ = id => document.getElementById(id);

const st = {
  you: null, ents: new Map(), others: [], online: 0,
  floats: [], puffs: [], marker: null, pred: null,
};
let conn = null, map = null, renderer = null;

// ---------------- login ----------------

$('name').value = localStorage.getItem('tv.name') || '';
$('loginform').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!/^[A-Za-z0-9_ ]{2,16}$/.test(name)) { $('status').textContent = 'Use 2-16 letters, digits, spaces or _.'; return; }
  $('play').disabled = true;
  $('status').textContent = '';
  $('status').style.color = 'var(--muted)';
  $('status').textContent = 'Connecting…';
  try {
    conn = await connect(name, onMessage);
  } catch (err) {
    $('status').style.color = '';
    $('status').textContent = err.message || 'Could not connect.';
    $('play').disabled = false;
    return;
  }
  localStorage.setItem('tv.name', name);
  start(name);
});

function start(name) {
  map = generateWorld(conn.welcome.seed);
  renderer = new Renderer($('game'), $('minimap'));
  renderer.setMap(map);
  $('login').classList.add('hidden');
  $('hud').classList.remove('hidden');
  renderer.resize();
  $('myname').textContent = name;
  $('mode').textContent = conn.offline ? '● OFFLINE' : '● ONLINE';
  $('mode').className = conn.offline ? 'offline' : 'online';
  if (conn.offline) log('sys', 'No server found — playing in a simulated world with AI adventurers. Run the Node server for real multiplayer.');
  conn.onclose = () => $('disconnected').classList.remove('hidden');
  requestAnimationFrame(frame);
}

// ---------------- network ----------------

function onMessage(msg) {
  if (msg.t !== 's') return;
  st.you = msg.you;
  st.others = msg.pl;
  st.online = msg.n;

  const seen = new Set();
  for (const [id, kind, x, y, hp, maxHp, level, flags, name, say] of msg.e) {
    seen.add(id);
    let o = st.ents.get(id);
    if (!o) { o = { id, rx: x, ry: y, swing: 0 }; st.ents.set(id, o); }
    o.kind = kind; o.x = x; o.y = y; o.hp = hp; o.maxHp = maxHp; o.level = level; o.flags = flags;
    o.name = name || ''; o.say = say || null;
    o.mobName = MONSTERS[kind]?.name || '';
  }
  for (const id of st.ents.keys()) if (!seen.has(id)) st.ents.delete(id);

  if (!st.pred || msg.you.snap) st.pred = { x: msg.you.x, y: msg.you.y, r: PLAYER_RADIUS };

  for (const ev of msg.ev) handleEvent(ev);
}

function float(x, y, text, color, life = 1) { st.floats.push({ x, y, text, color, t: 0, life }); }

function handleEvent(ev) {
  const me = st.you?.id;
  const ent = st.ents.get(ev.id);
  switch (ev.k) {
    case 'dmg':
      if (ent) float(ent.rx, ent.ry, (ev.c ? '✦' : '') + ev.n, ev.id === me ? '#ff6050' : ev.c ? '#ffd040' : '#ffffff', 0.9);
      break;
    case 'heal':
      if (ent) float(ent.rx, ent.ry, '+' + ev.n, '#70ff90');
      break;
    case 'sw':
      if (ent) ent.swing = 0.18;
      break;
    case 'xp': { const m = st.ents.get(me); if (m) float(m.rx, m.ry - 0.5, `+${ev.n} XP`, '#b9a2ff', 1.4); break; }
    case 'gold': { const m = st.ents.get(me); if (m) float(m.rx + 0.4, m.ry - 0.2, `+${ev.n}g`, '#ffd24a', 1.4); break; }
    case 'die':
      st.puffs.push({ x: ev.x, y: ev.y, t: 0 });
      break;
    case 'lvl':
      if (ent) float(ent.rx, ent.ry - 0.8, 'LEVEL UP!', '#ffd24a', 2);
      if (ev.id === me) toast(`Level ${ev.level}`, 'Your strength grows.');
      break;
    case 'dead':
      toast('You have fallen', `Slain by ${ev.by}. Lost ${ev.lost} XP.`);
      log('bad', `You were slain by ${ev.by} and lost ${ev.lost} XP.`);
      break;
    case 'chat':
      log(ev.bot ? 'bot' : '', ev.text, ev.from);
      break;
    case 'sys':
      log('sys', ev.text);
      break;
  }
}

function log(cls, text, who) {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  if (who) {
    const w = document.createElement('span');
    w.className = 'who';
    w.textContent = who + ': ';
    el.append(w);
  }
  el.append(document.createTextNode(text));
  const box = $('log');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.append(el);
  while (box.children.length > 120) box.firstChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
}

let toastTimer = 0;
function toast(big, small) {
  const t = $('toast');
  t.textContent = big;
  const s = document.createElement('small');
  s.textContent = small;
  t.append(s);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------- input ----------------

const keys = new Set();
const typing = () => document.activeElement === $('chatin');

addEventListener('keydown', e => {
  if (!conn) return;
  if (typing()) {
    if (e.key === 'Escape') $('chatin').blur();
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); $('chatin').focus(); return; }
  if (e.key === 'Tab') { e.preventDefault(); cycleTarget(); return; }
  if (e.key === '1') return conn.send({ t: 'ab', k: 'heal' });
  if (e.key === '2') return conn.send({ t: 'ab', k: 'strike' });
  if (e.key === 'Escape') return conn.send({ t: 'tgt', id: 0 });
  keys.add(e.key.toLowerCase());
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

$('chatform').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('chatin').value.trim();
  if (text) conn.send({ t: 'chat', text });
  $('chatin').value = '';
  $('chatin').blur();
});

$('ab-heal').addEventListener('click', () => conn?.send({ t: 'ab', k: 'heal' }));
$('ab-strike').addEventListener('click', () => conn?.send({ t: 'ab', k: 'strike' }));

function cycleTarget() {
  const me = st.ents.get(st.you?.id);
  if (!me) return;
  const mobs = [...st.ents.values()].filter(o => o.kind !== 'pc')
    .map(o => [o, Math.hypot(o.rx - me.rx, o.ry - me.ry)]).filter(([, d]) => d < 12).sort((a, b) => a[1] - b[1]);
  if (!mobs.length) return;
  const i = mobs.findIndex(([o]) => o.id === st.you.tgt);
  conn.send({ t: 'tgt', id: mobs[(i + 1) % Math.min(mobs.length, 5)][0].id });
}

function clickAt(clientX, clientY) {
  if (!renderer) return;
  const [wx, wy] = renderer.toWorld(clientX, clientY);
  let best = null, bd = 0.9;
  for (const o of st.ents.values()) {
    if (o.kind === 'pc') continue;
    const h = o.kind === 'ogre' ? 1.1 : 0.5;  // sprites are drawn above their feet
    const d = Math.hypot(o.rx - wx, o.ry - h - wy);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) conn.send({ t: 'tgt', id: best.id });
  else {
    conn.send({ t: 'go', x: wx, y: wy });
    st.marker = { x: wx, y: wy, t: 1 };
  }
}

// Pointer: mouse click / tap selects; touch drag on the left side = joystick.
const stick = { id: null, ox: 0, oy: 0, dx: 0, dy: 0, active: false };
const canvas = $('game');
let down = null;
canvas.addEventListener('pointerdown', e => {
  if (typing()) $('chatin').blur();
  down = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
  if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.5 && stick.id === null) {
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.dx = stick.dy = 0; stick.active = false;
  }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== stick.id) return;
  const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
  const l = Math.hypot(dx, dy);
  if (!stick.active && l > 12) {
    stick.active = true;
    const el = $('stick');
    el.style.left = stick.ox + 'px'; el.style.top = stick.oy + 'px';
    el.classList.remove('hidden');
  }
  if (stick.active) {
    const k = Math.min(l, 50) / (l || 1);
    $('stick').firstElementChild.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    stick.dx = l > 14 ? dx / l : 0; stick.dy = l > 14 ? dy / l : 0;
  }
});
const endPointer = e => {
  if (e.pointerId === stick.id) {
    const wasActive = stick.active;
    stick.id = null; stick.active = false; stick.dx = stick.dy = 0;
    $('stick').classList.add('hidden');
    $('stick').firstElementChild.style.transform = '';
    if (wasActive) { down = null; return; }
  }
  if (down && down.id === e.pointerId && e.type === 'pointerup') {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) clickAt(e.clientX, e.clientY);
  }
  down = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());

function inputDir() {
  let x = 0, y = 0;
  if (!typing()) {
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    if (keys.has('w') || keys.has('arrowup')) y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) y += 1;
  }
  if (stick.active) { x = stick.dx; y = stick.dy; }
  const l = Math.hypot(x, y);
  if (l < 0.1) return [0, 0];
  // Quantise to 16 directions so we only send when the direction really changes.
  const a = Math.round(Math.atan2(y, x) / (Math.PI / 8)) * (Math.PI / 8);
  return [Math.round(Math.cos(a) * 1000) / 1000, Math.round(Math.sin(a) * 1000) / 1000];
}

// ---------------- frame loop ----------------

let last = performance.now(), sent = '0,0', hudKey = '';

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const [ix, iy] = inputDir();
  const key = ix + ',' + iy;
  if (key !== sent) { sent = key; conn.send({ t: 'in', dx: ix, dy: iy }); if (ix || iy) st.marker = null; }

  // Client-side prediction for keyboard/joystick movement; server stays authoritative.
  const p = st.pred, you = st.you;
  if (p && you) {
    if (ix || iy) {
      let left = dt;
      while (left > 0) {
        const h = Math.min(left, 0.03);
        moveEntity(map, p, ix * PLAYER_SPEED * h, iy * PLAYER_SPEED * h, false);
        left -= h;
      }
    }
    const ex = you.x - p.x, ey = you.y - p.y, err = Math.hypot(ex, ey);
    if (err > 3) { p.x = you.x; p.y = you.y; }
    else if (ix || iy) {
      // While moving the server lags behind us; only pull back when we drift too far.
      if (err > 1.2) { const k = Math.min(1, dt * 4) * (err - 1.2) / err; p.x += ex * k; p.y += ey * k; }
    } else {
      const k = Math.min(1, dt * 10);
      p.x += ex * k; p.y += ey * k;
    }
  }

  for (const o of st.ents.values()) {
    if (you && o.id === you.id && p) { o.rx = p.x; o.ry = p.y; }
    else {
      const k = Math.min(1, dt * 12);
      if (Math.hypot(o.x - o.rx, o.y - o.ry) > 4) { o.rx = o.x; o.ry = o.y; }
      o.rx += (o.x - o.rx) * k; o.ry += (o.y - o.ry) * k;
    }
    if (o.swing > 0) o.swing -= dt;
  }
  for (const f of st.floats) f.t += dt;
  st.floats = st.floats.filter(f => f.t < f.life);
  for (const q of st.puffs) q.t += dt;
  st.puffs = st.puffs.filter(q => q.t < 0.6);
  if (st.marker) { st.marker.t -= dt * 1.5; if (st.marker.t <= 0) st.marker = null; }

  renderer.draw(st, dt);
  updateHud();
  requestAnimationFrame(frame);
}

function setBar(id, v, max, label) {
  const el = $(id);
  el.firstElementChild.style.width = Math.max(0, Math.min(100, (v / max) * 100)) + '%';
  el.lastElementChild.textContent = label;
}

function updateHud() {
  const y = st.you;
  if (!y) return;
  const t = st.ents.get(y.tgt);
  const k = [y.hp, y.maxHp, y.level, y.xp, y.gold, y.kills, st.online, t?.id, t?.hp, y.cd.join()].join('|');
  if (k === hudKey) return;
  hudKey = k;
  $('mylvl').textContent = 'Lv ' + y.level;
  setBar('hpbar', y.hp, y.maxHp, `${y.hp} / ${y.maxHp}`);
  setBar('xpbar', y.xp, y.xpNext, `${y.xp} / ${y.xpNext} XP`);
  $('gold').textContent = y.gold;
  $('kills').textContent = y.kills;
  $('online').textContent = `${st.online} online`;
  if (t) {
    $('target').classList.remove('hidden');
    $('tname').textContent = `${t.mobName} · Lv ${t.level}`;
    setBar('tbar', t.hp, t.maxHp, `${t.hp} / ${t.maxHp}`);
  } else $('target').classList.add('hidden');
  const cd = (id, v, max) => { $(id).querySelector('.cd').style.height = (v > 0 ? (v / max) * 100 : 0) + '%'; };
  cd('ab-heal', y.cd[1], y.cdMax[1]);
  cd('ab-strike', y.cd[2], y.cdMax[2]);
}
