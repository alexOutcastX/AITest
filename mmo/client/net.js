// Connects to a game server, or falls back to running the world locally.
//
//   ?server=wss://host/ws   connect to a specific server
//   ?offline                skip the network and play the simulated world

export async function connect(name, onMsg) {
  const params = new URLSearchParams(location.search);
  let url = params.get('server');
  if (!url && !params.has('offline') && location.protocol.startsWith('http')) {
    url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  if (url) {
    try {
      return await openSocket(url, name, onMsg);
    } catch (e) {
      if (e.fatal) throw e;          // server answered with a real error (e.g. name taken)
      if (params.get('server')) throw new Error(`Could not reach ${url}`);
    }
  }
  return openLocal(name, onMsg);
}

function openSocket(url, name, onMsg) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return reject(e); }
    let welcomed = false;
    let conn = null;
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 3000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name }));
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!welcomed) {
        if (msg.t === 'error') {
          clearTimeout(timer); ws.close();
          return reject(Object.assign(new Error(msg.msg), { fatal: true }));
        }
        if (msg.t === 'welcome') {
          welcomed = true; clearTimeout(timer);
          conn = {
            welcome: msg,
            offline: false,
            send: m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
            onclose: null,
          };
          resolve(conn);
          return;
        }
      }
      onMsg(msg);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(timer);
      if (!welcomed) reject(new Error('closed'));
      else conn?.onclose?.();
    };
  });
}

async function openLocal(name, onMsg) {
  const { World, TICK } = await import('../game/sim.js');
  const store = {
    load: n => { try { return JSON.parse(localStorage.getItem('tv.save.' + n.toLowerCase())); } catch { return null; } },
    save: (n, d) => { try { localStorage.setItem('tv.save.' + n.toLowerCase(), JSON.stringify(d)); } catch { /* private mode */ } },
  };
  const world = new World({ seed: 1337, store, bots: 8 });
  const r = world.join(name);
  if (r.err) throw Object.assign(new Error(r.err), { fatal: true });
  let ticks = 0;
  setInterval(() => {
    world.tick(TICK);
    if (++ticks % 2 === 0) onMsg(world.snapshot(r.id));
  }, TICK * 1000);
  addEventListener('pagehide', () => world.saveAll());
  return {
    welcome: { t: 'welcome', id: r.id, seed: world.seed, offline: true },
    offline: true,
    send: m => world.handle(r.id, m),
    onclose: null,
  };
}
