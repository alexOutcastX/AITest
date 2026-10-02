import {
  PROVIDERS, providerById, displayName, systemPromptFor, buildTranscript, streamChat, listModels, fetchCredits,
} from './providers.js';
import * as S from './store.js';
import * as G from './google.js';
import { renderMarkdown } from './markdown.js';
import { GOOGLE_CLIENT_ID } from '../config.js';

// ---------- helpers ----------

const $ = sel => document.querySelector(sel);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (typeof v !== 'string' && k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const storage = (() => {
  try { const s = window.localStorage; s.getItem('x'); return s; } catch {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  }
})();

const fmtNum = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0));
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = ts => {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString() ? fmtTime(ts) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const estTokens = s => Math.ceil((s || '').length / 4);

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const clientId = () => (storage.getItem('aihub:clientId') || GOOGLE_CLIENT_ID || '').trim();

// ---------- app state ----------

let account = null;   // { id, email, name, picture }
let state = null;     // see store.js
let currentId = null; // open session
let active = null;    // in-flight reply: { sessionId, msgId, controller }
const credits = {};   // providerId -> { remaining, limit, usage } | { error }
const pstatus = {};   // providerId -> { ok, text } (settings feedback)

const isGoogle = () => account && account.id.startsWith('google:');
const current = () => state.sessions.find(s => s.id === currentId) || null;
const cfgOf = id => state.providers[id];
const isReady = p => { const c = cfgOf(p.id); return c.enabled && (c.apiKey || p.keyOptional); };
const readyProviders = () => PROVIDERS.filter(isReady);

function persist({ settings = false } = {}) {
  if (settings) state.settingsUpdatedAt = Date.now();
  S.saveState(storage, account.id, state);
  scheduleSync();
}

// ---------- Google sync ----------

let syncTimer;
function setSync(kind, text) {
  const b = $('#syncBtn');
  b.hidden = !isGoogle();
  b.className = `sync ${kind}`;
  b.textContent = text;
}

function scheduleSync() {
  if (!isGoogle()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow({ interactive: false }), 2500);
}

async function syncNow({ interactive }) {
  if (!isGoogle()) return;
  if (active) { scheduleSync(); return; } // don't swap state under a streaming reply
  if (!G.hasValidToken()) {
    if (!interactive) { setSync('paused', '⟳ Sync paused — tap to reconnect Google'); return; }
    try { await G.requestToken(clientId(), { hint: account.email, silent: true }); }
    catch (e) { setSync('error', `⚠ ${e.message}`); return; }
  }
  setSync('busy', '⟳ Syncing with Google Drive…');
  try {
    const remote = await G.pullState();
    if (active) { scheduleSync(); return; }
    if (remote) state = S.mergeStates(state, remote);
    if (!current()) currentId = state.sessions[0]?.id || null;
    S.saveState(storage, account.id, state);
    await G.pushState(state);
    setSync('ok', `✓ Synced to Google Drive · ${fmtTime(Date.now())}`);
    if (!$('#settings').open) renderAll();
  } catch (e) {
    if (e.expired) setSync('paused', '⟳ Sync paused — tap to reconnect Google');
    else setSync('error', `⚠ Sync failed: ${e.message}`);
  }
}

// ---------- sign-in ----------

function showLogin(msg = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginMsg').textContent = msg;
  $('#originHint').textContent = location.origin;
  $('#clientIdInput').value = clientId();
}

async function signInGoogle() {
  if (!clientId()) {
    if (!$('#login').hidden) {
      $('#clientSetup').open = true;
      $('#loginMsg').textContent = 'Google sign-in needs a one-time setup first (below).';
    } else {
      toast('Add a Google Client ID under Account in settings first.');
    }
    return;
  }
  try {
    $('#loginMsg').textContent = 'Waiting for Google…';
    G.resetFileCache();
    await G.requestToken(clientId());
    const profile = await G.getProfile();
    // First Google sign-in on this device: carry over what was set up as a guest.
    if (!S.hasState(storage, profile.id) && S.hasState(storage, 'local')) {
      S.saveState(storage, profile.id, S.loadState(storage, 'local'));
    }
    account = profile;
    S.saveAccount(storage, account);
    boot();
    await syncNow({ interactive: true });
  } catch (e) {
    $('#loginMsg').textContent = e.message;
    if ($('#login').hidden) toast(e.message);
  }
}

function useGuest() {
  account = { id: 'local', name: 'Guest', email: '' };
  S.saveAccount(storage, account);
  boot();
}

function signOut() {
  if (active) active.controller.abort();
  if (isGoogle() && confirm('Remove this account\'s data from this device too? (Your sessions stay in your Google Drive.)')) {
    storage.removeItem(`aihub:state:${account.id}`);
  }
  G.signOut();
  S.saveAccount(storage, null);
  account = null; state = null; currentId = null;
  $('#settings').close();
  showLogin();
}

function boot() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  state = S.loadState(storage, account.id);
  currentId = state.sessions[0]?.id || null;
  if (isGoogle()) setSync(G.hasValidToken() ? 'ok' : 'paused', G.hasValidToken() ? '✓ Connected to Google Drive' : '⟳ Tap to sync with Google Drive');
  else setSync('', '');
  renderAll();
  for (const p of readyProviders()) if (p.hasCredits) refreshCredits(p.id);
}

// ---------- sessions ----------

function pickDefaultProvider() {
  const ready = readyProviders();
  const last = ready.find(p => p.id === state.prefs.lastProvider);
  const p = last || ready[0];
  return p ? { provider: p.id, model: cfgOf(p.id).model || p.models[0] } : {};
}

function newSession() {
  const cur = current();
  if (cur && !cur.messages.length) { $('#input').focus(); closeDrawer(); return; }
  const s = S.newSession(pickDefaultProvider());
  state.sessions.unshift(s);
  currentId = s.id;
  persist();
  renderAll();
  closeDrawer();
  $('#input').focus();
}

function ensureSession() {
  let s = current();
  if (!s) {
    s = S.newSession(pickDefaultProvider());
    state.sessions.unshift(s);
    currentId = s.id;
  }
  return s;
}

function deleteSession(id) {
  const s = state.sessions.find(x => x.id === id);
  if (!s || !confirm(`Delete "${s.title}"?`)) return;
  if (active && active.sessionId === id) active.controller.abort();
  state.sessions = state.sessions.filter(x => x.id !== id);
  state.deleted[id] = Date.now();
  if (currentId === id) currentId = state.sessions[0]?.id || null;
  persist();
  renderAll();
}

function selectProvider(pid) {
  const s = ensureSession();
  const p = providerById(pid);
  s.provider = pid;
  s.model = cfgOf(pid).model || p.models[0] || '';
  persist();
  renderComposer();
}

function sessionParticipants(s) {
  const ids = [];
  for (const m of s.messages) if (m.role === 'assistant' && m.author && m.content && !ids.includes(m.author.provider)) ids.push(m.author.provider);
  return ids;
}

const titleFrom = text => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 46)}…` : t || 'New session';
};

// ---------- talking to the AIs ----------

async function send() {
  if (active) { active.controller.abort(); return; }
  const input = $('#input');
  const text = input.value.trim();
  const s = ensureSession();
  if (!text && !s.messages.length) { input.focus(); return; }

  const p = providerById(s.provider);
  if (!p || !isReady(p)) {
    const ready = readyProviders();
    if (!ready.length) { toast('Link at least one AI first.'); openSettings(); }
    else toast('Pick which AI should answer.');
    renderComposer();
    return;
  }
  input.value = '';
  autosize();
  await generate(s, text);
}

async function generate(s, userText) {
  const pid = s.provider;
  const p = providerById(pid);
  const cfg = cfgOf(pid);
  const model = s.model || cfg.model || p.models[0];
  if (!model) { toast(`Choose a ${p.label} model in settings.`); openSettings(pid); return; }

  if (userText) {
    s.messages.push({ id: S.uid(), role: 'user', content: userText, ts: Date.now() });
    if (s.title === 'New session') s.title = titleFrom(userText);
  }
  const history = buildTranscript(s.messages, pid);
  const system = systemPromptFor(pid, model, state.prefs.systemPrompt);
  const msg = { id: S.uid(), role: 'assistant', author: { provider: pid, model }, content: '', ts: Date.now(), pending: true };
  s.messages.push(msg);
  s.updatedAt = Date.now();
  state.prefs.lastProvider = pid;
  persist();

  const controller = new AbortController();
  active = { sessionId: s.id, msgId: msg.id, controller };
  renderAll();

  let usage = null;
  try {
    for await (const ev of streamChat({
      provider: p, cfg, model, system, messages: history, signal: controller.signal,
      maxTokens: Number(state.prefs.maxTokens) || 8192,
    })) {
      if (ev.type === 'text') { msg.content += ev.text; queueMsgUpdate(msg); }
      else if (ev.type === 'usage') usage = { input: ev.input ?? usage?.input ?? 0, output: ev.output ?? usage?.output ?? 0 };
    }
    if (!msg.content.trim()) msg.error = 'The AI returned an empty reply.';
  } catch (e) {
    if (e.name === 'AbortError') msg.stopped = true;
    else { msg.error = e.message || String(e); if (e.hint) msg.hint = e.hint; }
  }

  delete msg.pending;
  if (!usage && (msg.content || !msg.error)) {
    usage = { input: estTokens(system) + history.reduce((n, m) => n + estTokens(m.content), 0), output: estTokens(msg.content), estimated: true };
  }
  if (usage) { msg.usage = usage; S.addUsage(cfg, usage.input, usage.output); }
  if (msg.stopped && !msg.content) s.messages = s.messages.filter(m => m !== msg);
  s.updatedAt = Date.now();
  active = null;
  persist();
  renderAll();
  if (p.hasCredits) refreshCredits(pid);
}

function retryLast() {
  const s = current();
  if (!s || active) return;
  const last = s.messages[s.messages.length - 1];
  if (last && last.role === 'assistant') s.messages.pop();
  const p = providerById(s.provider);
  if (!p || !isReady(p)) { toast('Pick which AI should answer.'); return; }
  generate(s, '');
}

function deleteMessage(id) {
  const s = current();
  if (!s || active) return;
  s.messages = s.messages.filter(m => m.id !== id);
  s.updatedAt = Date.now();
  persist();
  renderAll();
}

async function refreshCredits(pid) {
  const p = providerById(pid);
  try { credits[pid] = await fetchCredits({ provider: p, cfg: cfgOf(pid) }); }
  catch (e) { credits[pid] = { error: e.message }; }
  if (state) { renderComposer(); if ($('#settings').open) renderSettings(); }
}

// ---------- rendering ----------

function renderAll() {
  renderSidebar();
  renderHeader();
  renderMessages();
  renderComposer();
}

function renderSidebar() {
  const list = $('#sessionList');
  list.replaceChildren();
  if (!state.sessions.length) list.append(h('div', { class: 'side-empty' }, 'No sessions yet.'));
  for (const s of state.sessions) {
    list.append(h('div', {
      class: `sess${s.id === currentId ? ' on' : ''}`, role: 'button', tabindex: '0',
      onclick: () => { currentId = s.id; renderAll(); closeDrawer(); },
      onkeydown: e => { if (e.key === 'Enter') { currentId = s.id; renderAll(); closeDrawer(); } },
    },
      h('span', { class: 't', title: s.title }, s.title),
      h('span', { class: 'dots' }, sessionParticipants(s).map(id => h('i', { class: 'dot', style: `--ai:${providerById(id)?.color}` }))),
      h('span', { class: 'muted', style: 'font-size:11.5px' }, fmtDay(s.updatedAt)),
      h('span', { class: 'x', title: 'Delete session', onclick: e => { e.stopPropagation(); deleteSession(s.id); } }, '✕'),
    ));
  }

  const box = $('#accountBox');
  box.replaceChildren(
    account.picture
      ? h('img', { src: account.picture, alt: '', referrerpolicy: 'no-referrer' })
      : h('span', { class: 'avatar' }, isGoogle() ? (account.name || '?')[0] : '👤'),
    h('div', { class: 'who' },
      h('div', {}, account.name || 'Guest'),
      h('div', { class: 'muted' }, account.email || 'This device only')),
  );
}

function renderHeader() {
  const s = current();
  const t = $('#titleInput');
  t.value = s ? s.title : 'New session';
  t.disabled = !s;
  const parts = s ? sessionParticipants(s) : [];
  $('#participants').replaceChildren(...parts.map(id => {
    const p = providerById(id);
    return h('span', { class: 'pill', style: `--ai:${p?.color}` }, h('i', { class: 'dot' }), h('span', {}, p?.label || id));
  }));
}

const msgEls = new Map();

function renderMessages() {
  const box = $('#messages');
  const s = current();
  msgEls.clear();
  box.replaceChildren();
  if (!s || !s.messages.length) { box.append(welcome()); return; }
  s.messages.forEach((m, i) => box.append(messageEl(m, i === s.messages.length - 1)));
  box.scrollTop = box.scrollHeight;
}

function welcome() {
  const ready = readyProviders();
  return h('div', { class: 'welcome' },
    h('h2', {}, 'One session, every AI'),
    h('p', {}, 'Everything you and the AIs write here is shared. Whichever AI you pick reads the whole session, including what the other AIs said, and answers.'),
    h('ol', {},
      h('li', {}, ready.length ? `Linked: ${ready.map(p => p.label).join(', ')}` : 'Link your AIs with their API keys'),
      h('li', {}, 'Pick who answers, under the message box'),
      h('li', {}, 'Switch on any turn: compare answers, or have one AI check another\'s work')),
    ready.length ? null : h('div', {}, h('button', { class: 'btn primary', onclick: () => openSettings() }, 'Link an AI')),
  );
}

function messageEl(m, isLast) {
  const user = m.role === 'user';
  const p = !user && m.author ? providerById(m.author.provider) : null;
  const body = h('div', { class: `body${user ? '' : ' md'}` });
  fillBody(body, m);
  const u = m.usage;
  const el = h('div', { class: `msg ${user ? 'user' : 'ai'}${isLast ? ' last' : ''}`, style: p ? `--ai:${p.color}` : null },
    h('div', { class: 'meta' },
      user
        ? h('span', { class: 'who' }, (account.name || 'You').split(' ')[0])
        : h('span', { class: 'who' }, h('i', { class: 'dot' }), displayName(m.author.provider, m.author.model)),
      h('span', {}, fmtTime(m.ts)),
      u ? h('span', { class: 'tok', title: u.estimated ? 'Estimated (provider did not report usage)' : 'Tokens reported by the provider' },
        `${u.estimated ? '~' : ''}${fmtNum(u.input)} in · ${fmtNum(u.output)} out`) : null),
    body,
    m.error ? h('div', { class: 'err' }, `⚠ ${m.error}`, m.hint ? h('span', { class: 'err-hint' }, m.hint) : null) : null,
    m.stopped ? h('div', { class: 'stopped' }, 'Stopped') : null,
    m.pending ? null : h('div', { class: 'acts' },
      h('button', { onclick: () => copyText(m.content) }, 'Copy'),
      isLast && !user ? h('button', { onclick: retryLast, title: 'Discard this reply and ask the AI selected below' }, '↻ Retry with selected AI') : null,
      h('button', { onclick: () => deleteMessage(m.id) }, 'Delete')),
  );
  msgEls.set(m.id, body);
  return el;
}

function fillBody(body, m) {
  if (m.role === 'user') { body.textContent = m.content; return; }
  body.hidden = !m.pending && !m.content;
  body.innerHTML = renderMarkdown(m.content);
  body.classList.toggle('cursor', !!m.pending);
  if (m.pending && !m.content) body.innerHTML = '<p class="muted">Thinking…</p>';
}

let rafPending = new Set();
function queueMsgUpdate(m) {
  if (!rafPending.size) requestAnimationFrame(() => {
    const box = $('#messages');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    for (const msg of rafPending) { const b = msgEls.get(msg.id); if (b) fillBody(b, msg); }
    rafPending = new Set();
    if (stick) box.scrollTop = box.scrollHeight;
  });
  rafPending.add(m);
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Copy failed'); }
}

function renderComposer() {
  const bar = $('#aiBar');
  const s = current();
  const ready = readyProviders();
  const sel = s?.provider || pickDefaultProvider().provider;
  // Hint at the provider with the most self-budget left, when budgets are set.
  let best = null, bestLeft = -1;
  for (const p of ready) {
    const left = S.budgetLeft(cfgOf(p.id));
    if (left != null && left > bestLeft) { best = p.id; bestLeft = left; }
  }

  const chips = ready.map(p => {
    const cfg = cfgOf(p.id);
    const left = S.budgetLeft(cfg);
    const mu = S.monthUsage(cfg);
    const cr = credits[p.id];
    const tip = [
      `${p.label} — this month: ${fmtNum(mu.input)} in / ${fmtNum(mu.output)} out tokens, ${mu.requests} requests`,
      cfg.budget ? `Budget: ${fmtNum(cfg.budget)} tokens (${Math.round((left || 0) * 100)}% left)` : 'No monthly budget set',
      cr && cr.remaining != null ? `Credits left: $${cr.remaining.toFixed(2)}` : '',
    ].filter(Boolean).join('\n');
    return h('button', {
      class: `chip${p.id === sel ? ' on' : ''}`, style: `--ai:${p.color}`, title: tip,
      onclick: () => selectProvider(p.id), disabled: !!active,
    },
      h('i', { class: 'dot' }), p.label,
      left != null ? h('span', { class: `meter${left < 0.1 ? ' out' : left < 0.3 ? ' low' : ''}` }, h('i', { style: `width:${Math.round(left * 100)}%` })) : null,
      cr && cr.remaining != null ? h('span', { class: 'cred' }, `$${cr.remaining.toFixed(2)}`) : null,
      best === p.id && ready.length > 1 ? h('span', { class: 'star', title: 'Most budget left' }, '★') : null,
    );
  });

  const selP = ready.find(p => p.id === sel);
  let modelSel = null;
  if (selP) {
    const cfg = cfgOf(selP.id);
    const models = [...new Set([...(cfg.models.length ? cfg.models : selP.models), cfg.model, s?.model].filter(Boolean))];
    const curModel = (s && s.provider === selP.id && s.model) || cfg.model || models[0];
    modelSel = h('select', {
      class: 'model-select', 'aria-label': `${selP.label} model`, disabled: !!active,
      onchange: e => {
        const ss = ensureSession();
        ss.provider = selP.id; ss.model = e.target.value;
        cfgOf(selP.id).model = e.target.value;
        persist({ settings: true });
      },
    }, models.map(m => h('option', { value: m, selected: m === curModel }, m)));
  }

  bar.replaceChildren(...chips, ...(modelSel ? [modelSel] : []),
    h('button', { class: 'chip add', title: 'Link another AI', onclick: () => openSettings() }, ready.length ? '＋' : '＋ Link an AI to start'));

  const btn = $('#sendBtn');
  btn.classList.toggle('stop', !!active);
  updateSendLabel();
}

function updateSendLabel() {
  const btn = $('#sendBtn');
  if (active) { btn.textContent = 'Stop'; return; }
  const s = current();
  const p = s && providerById(s.provider);
  const empty = !$('#input').value.trim();
  btn.textContent = empty && s?.messages.length && p ? `${p.label}, reply` : 'Send';
}

function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, window.innerHeight * 0.4)}px`;
}

// ---------- settings ----------

function openSettings(focusPid) {
  renderSettings(focusPid);
  const d = $('#settings');
  if (!d.open) d.showModal();
  if (focusPid) d.querySelector(`[data-pid="${focusPid}"]`)?.scrollIntoView({ block: 'nearest' });
}

function field(label, ...children) {
  return h('label', { class: 'field' }, h('span', {}, label), ...children);
}

function providerCard(p, open) {
  const c = cfgOf(p.id);
  const mu = S.monthUsage(c);
  const ready = isReady(p);
  const st = pstatus[p.id];
  const cr = credits[p.id];
  const rerender = () => { renderSettings(); renderComposer(); };
  const models = [...new Set([...(c.models.length ? c.models : p.models), c.model].filter(Boolean))];

  return h('details', { class: 'pcard', open, 'data-pid': p.id, style: `--ai:${p.color}` },
    h('summary', {},
      h('i', { class: 'dot' }), h('b', {}, p.label), h('span', { class: 'muted vendor' }, p.vendor),
      h('span', { class: 'grow' }),
      ready ? h('span', { class: 'badge ok' }, 'Linked')
        : c.apiKey ? h('span', { class: 'badge' }, 'Off')
          : h('span', { class: 'badge' }, 'Not linked')),
    h('div', { class: 'pbody' },
      field(p.keyOptional ? 'API key (optional)' : 'API key',
        h('input', {
          type: 'password', value: c.apiKey, autocomplete: 'off', spellcheck: false,
          placeholder: p.keyOptional ? 'Leave empty for local servers like Ollama' : `Paste your ${p.vendor} API key`,
          onchange: e => {
            const cfg = cfgOf(p.id);
            cfg.apiKey = e.target.value.trim();
            if (cfg.apiKey) cfg.enabled = true;
            persist({ settings: true }); rerender();
            if (cfg.apiKey) testProvider(p.id);
          },
        }),
        p.keyUrl ? h('span', { class: 'help' }, h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, `Get a ${p.label} API key ↗`)) : null),
      h('label', { class: 'switch' },
        h('input', {
          type: 'checkbox', checked: c.enabled,
          onchange: e => { cfgOf(p.id).enabled = e.target.checked; persist({ settings: true }); rerender(); },
        }),
        'Show in "Who answers"'),
      field('Default model',
        h('div', { class: 'row' },
          h('input', {
            value: c.model, list: `models-${p.id}`, spellcheck: false, placeholder: 'model id',
            onchange: e => { cfgOf(p.id).model = e.target.value.trim(); persist({ settings: true }); renderComposer(); },
          }),
          h('button', { class: 'btn small', onclick: e => { e.preventDefault(); testProvider(p.id); } }, 'Test key & load models')),
        h('datalist', { id: `models-${p.id}` }, models.map(m => h('option', { value: m })))),
      st ? h('div', { class: `pstatus ${st.ok ? 'ok' : 'err'}` }, st.text) : null,
      field('Monthly token budget',
        h('input', {
          type: 'number', min: '0', step: '10000', value: c.budget ? String(c.budget) : '', placeholder: 'No limit',
          onchange: e => { cfgOf(p.id).budget = Math.max(0, Number(e.target.value) || 0); persist({ settings: true }); rerender(); },
        }),
        h('span', { class: 'help' }, 'Your own cap. AI Hub counts the tokens it sends and receives, and the meter on each AI\'s button shows what\'s left.')),
      h('div', { class: 'usage-line' },
        h('span', {}, `This month: ${fmtNum(mu.input)} in · ${fmtNum(mu.output)} out · ${mu.requests} requests`),
        c.budget ? h('span', { class: 'bar' }, h('i', { style: `width:${Math.min(100, (mu.total / c.budget) * 100)}%` })) : null,
        mu.requests ? h('button', {
          class: 'btn small ghost', onclick: e => {
            e.preventDefault();
            if (!confirm(`Reset ${p.label}'s usage counter for this month?`)) return;
            delete cfgOf(p.id).usage[S.monthKey()]; persist({ settings: true }); rerender();
          },
        }, 'Reset') : null),
      p.hasCredits ? h('div', { class: 'usage-line' },
        h('span', {}, cr?.error ? `Credits: ${cr.error}`
          : cr ? `Credits: ${cr.remaining != null ? `$${cr.remaining.toFixed(2)} left` : 'no limit'}${cr.usage != null ? ` · $${cr.usage.toFixed(2)} used` : ''}`
            : 'Credits: not checked yet'),
        h('button', { class: 'btn small', onclick: e => { e.preventDefault(); refreshCredits(p.id); } }, 'Check credits')) : null,
      h('details', {},
        h('summary', {}, 'Advanced'),
        field('Base URL',
          h('input', {
            value: c.baseUrl, placeholder: p.baseUrl, spellcheck: false,
            onchange: e => { cfgOf(p.id).baseUrl = e.target.value.trim(); persist({ settings: true }); },
          }),
          h('span', { class: 'help' }, 'Change this to use a CORS proxy or your own gateway. Leave it empty for the default.'))),
    ));
}

async function testProvider(pid) {
  const p = providerById(pid);
  pstatus[pid] = { ok: true, text: 'Checking…' };
  renderSettings();
  try {
    const ids = await listModels({ provider: p, cfg: cfgOf(pid) });
    const cfg = cfgOf(pid);
    cfg.models = ids;
    if (ids.length && !ids.includes(cfg.model)) cfg.model = ids.find(id => p.models.includes(id)) || cfg.model || ids[0];
    pstatus[pid] = { ok: true, text: `✓ Key works. ${ids.length} models available.` };
    persist({ settings: true });
    if (p.hasCredits) refreshCredits(pid);
  } catch (e) {
    pstatus[pid] = { ok: false, text: `✗ ${e.message}${e.hint ? ` — ${e.hint}` : ''}` };
  }
  if ($('#settings').open) renderSettings();
  renderComposer();
}

function renderSettings(focusPid) {
  const body = $('#settingsBody');
  const openIds = new Set([...body.querySelectorAll('details.pcard[open]')].map(d => d.dataset.pid));
  const firstRender = !body.childElementCount;
  const scroll = body.scrollTop;

  const acct = isGoogle()
    ? h('div', { class: 'acct-row' },
      h('span', {}, `Signed in as ${account.email}. Your sessions, linked AIs and usage sync through your Google Drive (in a private app folder).`),
      h('button', { class: 'btn small', onclick: () => syncNow({ interactive: true }) }, 'Sync now'),
      h('button', { class: 'btn small danger', onclick: signOut }, 'Sign out'))
    : h('div', { class: 'acct-row' },
      h('span', {}, 'Guest mode: everything is saved on this device only.'),
      h('button', { class: 'btn small primary', onclick: signInGoogle }, 'Sign in with Google to sync'),
      h('button', { class: 'btn small ghost', onclick: signOut }, 'Back to start'));

  body.replaceChildren(
    h('h3', {}, 'Linked AIs'),
    h('p', { class: 'note' },
      'Paste an API key for each AI you use. Consumer plans (Claude Pro, Gemini Advanced, SuperGrok, ChatGPT Plus) can\'t be used by other apps, so each AI needs an API key, billed by that provider. ',
      'Keys go straight from your browser to the provider and are never sent anywhere else.'),
    ...PROVIDERS.map(p => providerCard(p, openIds.has(p.id) || p.id === focusPid)),

    h('h3', {}, 'Session behaviour'),
    field('Extra instructions for every AI',
      h('textarea', {
        rows: 3, placeholder: 'e.g. Be concise. Answer in English.', value: state.prefs.systemPrompt,
        onchange: e => { state.prefs.systemPrompt = e.target.value; persist({ settings: true }); },
      })),
    h('div', { style: 'height:10px' }),
    field('Max reply length (tokens, used by Claude)',
      h('input', {
        type: 'number', min: '256', step: '256', value: String(state.prefs.maxTokens),
        onchange: e => { state.prefs.maxTokens = Math.max(256, Number(e.target.value) || 8192); persist({ settings: true }); },
      })),

    h('h3', {}, 'Account'),
    acct,
    h('details', { class: 'client-setup', style: 'margin-top:10px' },
      h('summary', {}, 'Google sign-in setup'),
      h('p', {}, 'OAuth Client ID (Web application) authorised for ', h('code', {}, location.origin), '. See hub/README.md.'),
      h('div', { class: 'row' },
        h('input', { value: clientId(), placeholder: '….apps.googleusercontent.com', id: 'clientIdSettings' }),
        h('button', {
          class: 'btn small', onclick: () => {
            storage.setItem('aihub:clientId', $('#clientIdSettings').value.trim());
            toast('Saved Client ID');
          },
        }, 'Save'))),

    h('h3', {}, 'Data'),
    h('div', { class: 'acct-row' },
      h('button', { class: 'btn small', onclick: () => exportData(false) }, 'Export sessions'),
      h('button', { class: 'btn small', onclick: () => exportData(true) }, 'Export incl. API keys'),
      h('label', { class: 'btn small' }, 'Import…',
        h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData }))),
  );
  if (!firstRender) body.scrollTop = scroll;
}

function exportData(withKeys) {
  const copy = JSON.parse(JSON.stringify(state));
  if (!withKeys) for (const c of Object.values(copy.providers)) c.apiKey = '';
  const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `ai-hub-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const incoming = JSON.parse(await f.text());
    const keepKeys = Object.fromEntries(PROVIDERS.map(p => [p.id, cfgOf(p.id).apiKey]));
    state = S.mergeStates(state, incoming);
    for (const p of PROVIDERS) if (!cfgOf(p.id).apiKey) cfgOf(p.id).apiKey = keepKeys[p.id];
    persist({ settings: true });
    renderAll(); renderSettings();
    toast('Imported');
  } catch (err) { toast(`Import failed: ${err.message}`); }
}

// ---------- drawer (mobile) ----------

const closeDrawer = () => $('#app').classList.remove('drawer');

// ---------- wiring ----------

function wire() {
  $('#googleBtn').addEventListener('click', signInGoogle);
  $('#guestBtn').addEventListener('click', useGuest);
  $('#clientIdSave').addEventListener('click', () => {
    storage.setItem('aihub:clientId', $('#clientIdInput').value.trim());
    $('#loginMsg').textContent = clientId() ? 'Saved. Now tap "Continue with Google".' : 'Client ID cleared.';
  });

  $('#newSession').addEventListener('click', newSession);
  $('#openSettings').addEventListener('click', () => { openSettings(); closeDrawer(); });
  $('#closeSettings').addEventListener('click', () => $('#settings').close());
  $('#settings').addEventListener('click', e => { if (e.target === $('#settings')) $('#settings').close(); });
  $('#settings').addEventListener('close', () => { $('#settingsBody').replaceChildren(); renderAll(); });
  $('#syncBtn').addEventListener('click', () => syncNow({ interactive: true }));
  $('#menuBtn').addEventListener('click', () => $('#app').classList.add('drawer'));
  $('#scrim').addEventListener('click', closeDrawer);

  $('#titleInput').addEventListener('change', e => {
    const s = current();
    if (!s) return;
    s.title = e.target.value.trim() || 'Untitled';
    s.updatedAt = Date.now();
    persist(); renderSidebar();
  });

  const input = $('#input');
  input.addEventListener('input', () => { autosize(); updateSendLabel(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!active) send(); }
  });
  $('#sendBtn').addEventListener('click', send);

  window.addEventListener('storage', e => {
    // Another tab changed this account's data: pick it up when idle.
    if (account && e.key === `aihub:state:${account.id}` && !active) {
      state = S.loadState(storage, account.id);
      if (!current()) currentId = state.sessions[0]?.id || null;
      if (!$('#settings').open) renderAll();
    }
  });
}

wire();
account = S.loadAccount(storage);
if (account) boot(); else showLogin();
