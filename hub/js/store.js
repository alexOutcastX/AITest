// Per-account app state, usage accounting and device-merge logic.
// Pure apart from the optional `storage` argument (localStorage in the app).

import { PROVIDERS } from './providers.js';

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export function defaultProviderCfg(p) {
  return { enabled: false, apiKey: '', baseUrl: '', model: p.models[0] || '', models: [], budget: 0, usage: {} };
}

export function emptyState() {
  const providers = {};
  for (const p of PROVIDERS) providers[p.id] = defaultProviderCfg(p);
  return {
    version: 1,
    settingsUpdatedAt: 0,
    providers,
    prefs: { systemPrompt: '', maxTokens: 8192 },
    sessions: [],
    deleted: {}, // sessionId -> deletedAt, so deletions survive a sync
  };
}

// Fill in anything a stored/remote state is missing (new providers, fields).
export function normalize(s) {
  const base = emptyState();
  if (!s || typeof s !== 'object') return base;
  const out = { ...base, ...s, prefs: { ...base.prefs, ...(s.prefs || {}) } };
  out.providers = {};
  for (const p of PROVIDERS) out.providers[p.id] = { ...defaultProviderCfg(p), ...((s.providers || {})[p.id] || {}) };
  out.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  out.deleted = s.deleted || {};
  return out;
}

export function newSession({ provider, model } = {}) {
  const now = Date.now();
  return { id: uid(), title: 'New session', createdAt: now, updatedAt: now, provider, model, messages: [] };
}

export function addUsage(cfg, input, output, when = new Date()) {
  const k = monthKey(when);
  const u = cfg.usage[k] || { input: 0, output: 0, requests: 0 };
  cfg.usage[k] = { input: u.input + (input || 0), output: u.output + (output || 0), requests: u.requests + 1 };
}

export function monthUsage(cfg, when = new Date()) {
  const u = cfg.usage?.[monthKey(when)] || { input: 0, output: 0, requests: 0 };
  return { ...u, total: u.input + u.output };
}

// Fraction of this month's self-set token budget still left (null = no budget).
export function budgetLeft(cfg, when) {
  if (!cfg.budget) return null;
  return Math.max(0, 1 - monthUsage(cfg, when).total / cfg.budget);
}

// Merge two copies of the state (this device + Google Drive).
// Sessions: newest copy of each wins; deletions win over older copies.
// Settings: whole block from whichever side changed them last.
// Usage: per month, the larger counter wins (each side only ever grows).
export function mergeStates(a, b) {
  a = normalize(a); b = normalize(b);
  const newer = (b.settingsUpdatedAt || 0) > (a.settingsUpdatedAt || 0) ? b : a;
  const out = normalize(JSON.parse(JSON.stringify(newer)));

  for (const p of PROVIDERS) {
    const ua = a.providers[p.id].usage || {}, ub = b.providers[p.id].usage || {};
    const usage = {};
    for (const k of new Set([...Object.keys(ua), ...Object.keys(ub)])) {
      const x = ua[k] || {}, y = ub[k] || {};
      usage[k] = {
        input: Math.max(x.input || 0, y.input || 0),
        output: Math.max(x.output || 0, y.output || 0),
        requests: Math.max(x.requests || 0, y.requests || 0),
      };
    }
    out.providers[p.id].usage = usage;
  }

  const deleted = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] || 0, t);

  const byId = new Map();
  for (const s of [...a.sessions, ...b.sessions]) {
    const cur = byId.get(s.id);
    if (!cur || (s.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(s.id, s);
  }
  out.sessions = [...byId.values()]
    .filter(s => !(deleted[s.id] && deleted[s.id] >= (s.updatedAt || 0)))
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  out.deleted = deleted;
  return out;
}

// ---------- persistence ----------

const ACCOUNT_KEY = 'aihub:account';
const stateKey = accountId => `aihub:state:${accountId}`;

export function loadAccount(storage) {
  try { return JSON.parse(storage.getItem(ACCOUNT_KEY)) || null; } catch { return null; }
}
export function saveAccount(storage, account) {
  try {
    if (account) storage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    else storage.removeItem(ACCOUNT_KEY);
  } catch { /* storage unavailable */ }
}
export function loadState(storage, accountId) {
  try { return normalize(JSON.parse(storage.getItem(stateKey(accountId)))); } catch { return emptyState(); }
}
export function hasState(storage, accountId) {
  try { return storage.getItem(stateKey(accountId)) != null; } catch { return false; }
}
export function saveState(storage, accountId, state) {
  try { storage.setItem(stateKey(accountId), JSON.stringify(state)); } catch { /* quota or disabled */ }
}
