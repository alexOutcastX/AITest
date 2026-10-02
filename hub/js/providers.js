// Provider catalog, shared-transcript builder and streaming adapters.
// Pure ES module: no DOM access, so it can be unit-tested under Node.

// kind: which wire protocol the provider speaks.
//   openai    — OpenAI-compatible /chat/completions (most providers)
//   anthropic — Anthropic Messages API
//   gemini    — Google Generative Language API
export const PROVIDERS = [
  {
    // Only inside the Claude app: answers come from the viewer's own claude.ai
    // plan through the artifact `sample` capability. No API key involved.
    id: 'claudeai', label: 'Claude', vendor: 'your claude.ai plan', kind: 'sample', color: '#d97757',
    embeddedOnly: true, keyOptional: true, noModelList: true,
    models: ['default', 'complex', 'quick'],
    keyUrl: '',
  },
  {
    id: 'anthropic', label: 'Claude', vendor: 'Anthropic', kind: 'anthropic', color: '#d97757',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini', label: 'Gemini', vendor: 'Google', kind: 'gemini', color: '#4f8cff',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'xai', label: 'Grok', vendor: 'xAI', kind: 'openai', color: '#94a3b8',
    baseUrl: 'https://api.x.ai/v1', streamUsage: true,
    models: ['grok-4', 'grok-3-mini'],
    keyUrl: 'https://console.x.ai',
  },
  {
    id: 'openai', label: 'ChatGPT', vendor: 'OpenAI', kind: 'openai', color: '#10a37f',
    baseUrl: 'https://api.openai.com/v1', streamUsage: true,
    models: ['gpt-5', 'gpt-5-mini'],
    modelFilter: /^(gpt|o\d|chatgpt)/,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek', label: 'DeepSeek', vendor: 'DeepSeek', kind: 'openai', color: '#4d6bfe',
    baseUrl: 'https://api.deepseek.com/v1', streamUsage: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'mistral', label: 'Mistral', vendor: 'Mistral AI', kind: 'openai', color: '#ff7000',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'perplexity', label: 'Perplexity', vendor: 'Perplexity', kind: 'openai', color: '#20b8cd',
    baseUrl: 'https://api.perplexity.ai', noModelList: true,
    models: ['sonar', 'sonar-pro', 'sonar-reasoning'],
    keyUrl: 'https://www.perplexity.ai/settings/api',
  },
  {
    id: 'groq', label: 'Groq', vendor: 'Groq', kind: 'openai', color: '#f55036',
    baseUrl: 'https://api.groq.com/openai/v1', streamUsage: true,
    models: ['llama-3.3-70b-versatile'],
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter', label: 'OpenRouter', vendor: 'OpenRouter', kind: 'openai', color: '#8b5cf6',
    baseUrl: 'https://openrouter.ai/api/v1', streamUsage: true, hasCredits: true,
    models: ['openrouter/auto'],
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'custom', label: 'Custom', vendor: 'OpenAI-compatible', kind: 'openai', color: '#a3a3a3',
    baseUrl: 'http://localhost:11434/v1', keyOptional: true,
    models: [],
    keyUrl: '',
  },
];

export const providerById = id => PROVIDERS.find(p => p.id === id);

export function displayName(providerId, model) {
  const p = providerById(providerId);
  return `${p ? p.label : providerId}${model ? ` · ${model}` : ''}`;
}

export function systemPromptFor(providerId, model, extra = '') {
  const me = displayName(providerId, model);
  const base =
    `You are ${me}, one of several AI assistants taking part in one shared conversation with a single user (in an app called AI Hub). ` +
    `The user picks which assistant answers each turn. Replies written by other assistants appear inside user turns, ` +
    `tagged like "[Gemini · gemini-2.5-pro replied]:". Treat them as shared context: you may build on, check or correct them. ` +
    `Never prefix your own reply with a name tag and never pretend to be another assistant.`;
  return extra && extra.trim() ? `${base}\n\n${extra.trim()}` : base;
}

// Turn a shared session into the chat history *as seen by one provider*.
// Only that provider's own past replies are "assistant" turns; the human's
// messages and every other AI's replies become (labelled) "user" turns. That
// keeps strict role alternation (required by Anthropic) and avoids one model
// being handed another model's words as if it had said them.
export function buildTranscript(messages, providerId) {
  const parts = [];
  for (const m of messages) {
    if (m.error || m.pending || !m.content || !m.content.trim()) continue;
    if (m.role === 'assistant' && m.author && m.author.provider === providerId) {
      parts.push({ role: 'assistant', kind: 'self', text: m.content });
    } else if (m.role === 'assistant') {
      const who = m.author ? displayName(m.author.provider, m.author.model) : 'Another AI';
      parts.push({ role: 'user', kind: 'ai', text: `[${who} replied]:\n${m.content}` });
    } else {
      parts.push({ role: 'user', kind: 'human', text: m.content });
    }
  }

  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && last.role === p.role) last.parts.push(p);
    else merged.push({ role: p.role, parts: [p] });
  }

  const out = merged.map(g => {
    const mixed = g.role === 'user' && g.parts.some(p => p.kind === 'ai');
    const content = g.parts
      .map(p => (mixed && p.kind === 'human' ? `[User]:\n${p.text}` : p.text))
      .join('\n\n');
    return { role: g.role, content };
  });

  if (out.length && out[0].role === 'assistant') {
    out.unshift({ role: 'user', content: '(Conversation start.)' });
  }
  // The user asked this AI to speak again without typing anything new.
  if (!out.length || out[out.length - 1].role === 'assistant') {
    out.push({ role: 'user', content: '(Please continue.)' });
  }
  return out;
}

// ---------- streaming ----------

// Parse a Server-Sent Events byte stream into {event, data} records.
export async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rec = parseSseRecord(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (rec) yield rec;
    }
  }
  buf += decoder.decode();
  const rec = parseSseRecord(buf.replace(/\r\n?/g, '\n'));
  if (rec) yield rec;
}

function parseSseRecord(chunk) {
  let event = 'message';
  const data = [];
  for (const line of chunk.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    const val = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'event') event = val;
    else if (field === 'data') data.push(val);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

export class ProviderError extends Error {
  constructor(message, { status, hint } = {}) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

async function httpError(res, provider) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const e = Array.isArray(j) ? j[0]?.error : j.error;
      msg = (e && (e.message || (typeof e === 'string' ? e : ''))) || j.message || j.detail || text || msg;
    } catch { if (text) msg = text.slice(0, 400); }
  } catch { /* body unreadable */ }
  let hint;
  if (res.status === 401 || res.status === 403) hint = `Check the ${provider.label} API key in Linked AIs.`;
  else if (res.status === 429) hint = `${provider.label} says you hit a rate or usage limit — switch to another AI for this turn.`;
  else if (res.status === 402) hint = `${provider.label} reports no remaining credits.`;
  return new ProviderError(msg, { status: res.status, hint });
}

async function doFetch(url, init, provider, fetchImpl) {
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ProviderError(`Could not reach ${provider.label} (${e.message}).`, {
      hint: `If you are online, ${provider.label} may block direct browser calls (CORS). ` +
        `Set its Base URL to a CORS proxy — see hub/proxy/cors-worker.js.`,
    });
  }
}

function trimBase(u) { return (u || '').replace(/\/+$/, ''); }

function parseJson(s) { try { return JSON.parse(s); } catch { return null; } }

// The artifact `sample` function, set by the app when it runs inside Claude.
let sampler = null;
export function setSampler(fn) { sampler = fn; }

const SAMPLE_HINTS = {
  not_granted: 'Allow Claude to answer when the app asks. Reload the page to be asked again.',
  rate_limited: 'Your claude.ai plan is busy or at its limit. Wait a moment, or let another AI answer.',
  session_expired: 'Your claude.ai session expired. Reload the page.',
  sampling_disabled: 'Claude answers are turned off for this page or your organization.',
  prompt_too_large: 'This session is too long for one request. Start a new session.',
};

// Callback-style sample() → the same async-generator shape as the HTTP adapters.
async function* streamSample({ system, messages, model, signal }) {
  if (!sampler) throw new ProviderError('Claude is only available when AI Hub runs inside the Claude app.');
  // There is no page-controlled system prompt: put it in the first user turn.
  const turns = messages.map((m, i) => (i === 0 ? { role: m.role, content: `${system}\n\n---\n\n${m.content}` } : m));
  const queue = [];
  let wake = null, done = false, failure = null;
  const push = () => { if (wake) { wake(); wake = null; } };
  sampler(turns, {
    signal, cache: false, modelTier: model || 'default',
    onText: ({ delta }) => { if (delta) { queue.push(delta); push(); } },
  }).then(() => { done = true; push(); }, e => { failure = e; done = true; push(); });

  for (;;) {
    while (queue.length) yield { type: 'text', text: queue.shift() };
    if (done) break;
    await new Promise(r => { wake = r; });
  }
  if (failure) {
    if (failure.code === 'cancelled') throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
    throw new ProviderError(failure.message || failure.code || 'Claude could not answer.', { hint: SAMPLE_HINTS[failure.code] });
  }
}

// Stream one reply. Yields {type:'text', text} chunks and {type:'usage',
// input, output} snapshots (cumulative — the last one wins).
export async function* streamChat({ provider, cfg, model, system, messages, signal, maxTokens = 8192, fetchImpl = fetch }) {
  if (provider.kind === 'sample') {
    yield* streamSample({ system, messages, model, signal });
    return;
  }
  const base = trimBase(cfg.baseUrl || provider.baseUrl);
  const key = cfg.apiKey || '';

  if (provider.kind === 'anthropic') {
    const res = await doFetch(`${base}/messages`, {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true }),
    }, provider, fetchImpl);
    if (!res.ok) throw await httpError(res, provider);
    let input, output;
    for await (const { data } of sseEvents(res.body)) {
      const j = parseJson(data);
      if (!j) continue;
      if (j.type === 'message_start') {
        const u = j.message?.usage || {};
        input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        output = u.output_tokens || 0;
        yield { type: 'usage', input, output };
      } else if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
        yield { type: 'text', text: j.delta.text };
      } else if (j.type === 'message_delta' && j.usage) {
        output = j.usage.output_tokens ?? output;
        yield { type: 'usage', input, output };
      } else if (j.type === 'error') {
        throw new ProviderError(j.error?.message || 'Stream error', {
          hint: j.error?.type === 'overloaded_error' ? 'Claude is overloaded — try another AI for this turn.' : undefined,
        });
      }
    }
    return;
  }

  if (provider.kind === 'gemini') {
    const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const res = await doFetch(`${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents }),
    }, provider, fetchImpl);
    if (!res.ok) throw await httpError(res, provider);
    for await (const { data } of sseEvents(res.body)) {
      const j = parseJson(data);
      if (!j) continue;
      if (j.error) throw new ProviderError(j.error.message || 'Stream error');
      const parts = j.candidates?.[0]?.content?.parts || [];
      const text = parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
      if (text) yield { type: 'text', text };
      const u = j.usageMetadata;
      if (u) yield { type: 'usage', input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
    }
    return;
  }

  // OpenAI-compatible
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  if (provider.id === 'openrouter') {
    if (typeof location !== 'undefined') headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'AI Hub';
  }
  const body = { model, stream: true, messages: [{ role: 'system', content: system }, ...messages] };
  if (provider.streamUsage) body.stream_options = { include_usage: true };
  const res = await doFetch(`${base}/chat/completions`, {
    method: 'POST', signal, headers, body: JSON.stringify(body),
  }, provider, fetchImpl);
  if (!res.ok) throw await httpError(res, provider);
  for await (const { data } of sseEvents(res.body)) {
    if (data === '[DONE]') break;
    const j = parseJson(data);
    if (!j) continue;
    if (j.error) throw new ProviderError(j.error.message || 'Stream error');
    const text = j.choices?.[0]?.delta?.content;
    if (text) yield { type: 'text', text };
    if (j.usage) yield { type: 'usage', input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 };
  }
}

// List the models this key can use. Falls back to the catalog defaults.
export async function listModels({ provider, cfg, fetchImpl = fetch }) {
  if (provider.noModelList) return provider.models.slice();
  const base = trimBase(cfg.baseUrl || provider.baseUrl);
  const key = cfg.apiKey || '';
  let res;
  if (provider.kind === 'anthropic') {
    res = await doFetch(`${base}/models?limit=100`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    }, provider, fetchImpl);
    if (!res.ok) throw await httpError(res, provider);
    return (await res.json()).data.map(m => m.id);
  }
  if (provider.kind === 'gemini') {
    res = await doFetch(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, provider, fetchImpl);
    if (!res.ok) throw await httpError(res, provider);
    return (await res.json()).models
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''));
  }
  res = await doFetch(`${base}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} }, provider, fetchImpl);
  if (!res.ok) throw await httpError(res, provider);
  let ids = ((await res.json()).data || []).map(m => m.id);
  if (provider.modelFilter) ids = ids.filter(id => provider.modelFilter.test(id));
  return ids.sort();
}

// Real remaining balance, for the providers whose API exposes it.
export async function fetchCredits({ provider, cfg, fetchImpl = fetch }) {
  if (!provider.hasCredits || !cfg.apiKey) return null;
  const base = trimBase(cfg.baseUrl || provider.baseUrl);
  const res = await doFetch(`${base}/key`, { headers: { authorization: `Bearer ${cfg.apiKey}` } }, provider, fetchImpl);
  if (!res.ok) throw await httpError(res, provider);
  const d = (await res.json()).data || {};
  return { usage: d.usage ?? null, limit: d.limit ?? null, remaining: d.limit_remaining ?? null };
}
