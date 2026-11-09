// End-to-end smoke test: boots the server, connects two WebSocket clients,
// and checks join, visibility, chat, movement, combat and name collisions.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['server.js'], {
  cwd: root, env: { ...process.env, PORT, BOTS: '0', DATA_FILE: path.join(os.tmpdir(), `tv-${PORT}.json`) }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise(r => srv.stdout.once('data', r));

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const c = { ws, snaps: [], events: [], send: m => ws.send(JSON.stringify(m)) };
    ws.onopen = () => c.send({ t: 'hello', name });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'welcome') { c.id = m.id; resolve(c); }
      else if (m.t === 'error') reject(new Error(m.msg));
      else if (m.t === 's') { c.snaps.push(m); c.events.push(...m.ev); c.last = m; }
    };
    ws.onerror = reject;
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
try {
  const a = await client('Alice');
  const b = await client('Bob');
  await assert.rejects(client('alice'), /already/);
  console.log('✓ join + duplicate-name rejection');

  await wait(300);
  assert.ok(a.last.e.some(e => e[0] === b.id), 'Alice should see Bob');
  assert.equal(a.last.n, 2);
  console.log('✓ players see each other');

  b.send({ t: 'chat', text: 'hello <b>world</b>' });
  await wait(300);
  assert.ok(a.events.some(e => e.k === 'chat' && e.from === 'Bob' && e.text === 'hello <b>world</b>'));
  console.log('✓ chat delivered');

  const x0 = a.last.you.x;
  a.send({ t: 'in', dx: 0, dy: 1 });   // walk south down the plaza
  await wait(500);
  a.send({ t: 'in', dx: 0, dy: 0 });
  await wait(200);
  assert.ok(Math.abs(a.last.you.y - a.snaps[0].you.y) > 1, 'Alice should have moved');
  assert.ok(Math.abs(a.last.you.x - x0) < 0.01);
  console.log('✓ movement');

  // Walk out of the south gate and fight whatever is nearest.
  a.send({ t: 'go', x: 96.5, y: 125 });
  let fought = false;
  for (let i = 0; i < 80 && !fought; i++) {
    await wait(250);
    const me = a.last.you;
    const mob = a.last.e.filter(e => e[1] !== 'pc').sort((p, q) => Math.hypot(p[2] - me.x, p[3] - me.y) - Math.hypot(q[2] - me.x, q[3] - me.y))[0];
    if (mob && i % 4 === 0) a.send({ t: 'tgt', id: mob[0] });
    fought = a.events.some(e => e.k === 'dmg');
  }
  assert.ok(fought, 'combat should happen');
  console.log('✓ combat');
  a.ws.close(); b.ws.close();
} catch (e) {
  failed = true;
  console.error('✗', e.message);
} finally {
  srv.kill();
}
process.exit(failed ? 1 : 0);
