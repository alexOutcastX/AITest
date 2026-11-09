// Thornvale Online server: static file host + WebSocket game server.
// Zero dependencies — the WebSocket protocol (RFC 6455) is implemented below.
//
//   node server.js            -> http://localhost:8080
//   PORT=3000 BOTS=0 node server.js

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { World, TICK } from './game/sim.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const BOTS = Number(process.env.BOTS ?? 4);
const SEED = Number(process.env.SEED) || 1337;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'players.json');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 200;

// ---------- persistence (JSON file, keyed by lowercase name) ----------

let saves = {};
try { saves = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* first run */ }
let dirty = false;
const store = {
  load: name => saves[name.toLowerCase()] ?? null,
  save: (name, data) => { saves[name.toLowerCase()] = data; dirty = true; },
};
function flush() {
  if (!dirty) return;
  dirty = false;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(saves));
  fs.renameSync(tmp, DATA_FILE);
}

const world = new World({ seed: SEED, store, bots: BOTS });

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/client') {
    res.writeHead(302, { Location: '/client/' });
    return res.end();
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, players: world.players.size }));
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  if (!rel.startsWith('/client/') && !rel.startsWith('/game/')) { res.writeHead(404); return res.end('Not found'); }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------- minimal WebSocket ----------

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    sock.on('data', d => this.data(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }

  data(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > 64 * 1024) return this.close(1002);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);

      if (op === 0x8) return this.close(1000);
      if (op === 0x9) { this.frame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        this.frags.push(payload);
        if (this.frags.reduce((n, f) => n + f.length, 0) > 64 * 1024) return this.close(1009);
        if (fin) {
          const msg = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          this.onmessage?.(msg);
        }
      }
    }
  }

  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(text) {
    // Drop clients that can't keep up instead of buffering forever.
    if (this.sock.writableLength > 1 << 20) return this.close(1008);
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this.frame(0x8, p);
    this.sock.end();
    this.closed();
  }

  closed() {
    if (!this.open) return;
    this.open = false;
    this.onclose?.();
  }
}

const clients = new Set();

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);

  const ws = new Socket(sock);
  const client = { ws, id: 0, msgs: 0, window: Date.now() };

  ws.onmessage = text => {
    const now = Date.now();
    if (now - client.window > 1000) { client.window = now; client.msgs = 0; }
    if (++client.msgs > 60) return ws.close(1008);
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!client.id) {
      if (msg?.t !== 'hello') return;
      if (world.players.size >= MAX_PLAYERS) return ws.send(JSON.stringify({ t: 'error', msg: 'The world is full, try again later.' }));
      const r = world.join(msg.name);
      if (r.err) return ws.send(JSON.stringify({ t: 'error', msg: r.err }));
      client.id = r.id;
      clients.add(client);
      ws.send(JSON.stringify({ t: 'welcome', id: r.id, seed: world.seed, offline: false }));
      return;
    }
    world.handle(client.id, msg);
  };

  ws.onclose = () => {
    if (client.id) world.leave(client.id);
    clients.delete(client);
  };
});

// ---------- main loop ----------

let ticks = 0;
setInterval(() => {
  world.tick(TICK);
  if (++ticks % 2 === 0) {
    for (const c of clients) {
      const snap = world.snapshot(c.id);
      if (snap) c.ws.send(JSON.stringify(snap));
    }
  }
}, TICK * 1000);
setInterval(() => { world.saveAll(); flush(); }, 15000);

function shutdown() {
  world.saveAll();
  flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Thornvale Online listening on http://localhost:${PORT}  (bots: ${BOTS}, seed: ${SEED})`);
});
