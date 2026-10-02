// Run: node --test hub/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, sseEvents, streamChat, providerById, systemPromptFor } from '../js/providers.js';
import { mergeStates, emptyState, addUsage, monthUsage, budgetLeft, monthKey } from '../js/store.js';
import { renderMarkdown } from '../js/markdown.js';

const msgs = [
  { role: 'user', content: 'Plan a trip to Rome' },
  { role: 'assistant', author: { provider: 'anthropic', model: 'claude-opus-5-5' }, content: 'Day 1: Colosseum' },
  { role: 'user', content: 'Gemini, anything missing?' },
  { role: 'assistant', author: { provider: 'gemini', model: 'gemini-2.5-pro' }, content: 'Add the Vatican' },
];

test('each AI sees only its own replies as assistant turns', () => {
  const forClaude = buildTranscript(msgs, 'anthropic');
  assert.deepEqual(forClaude.map(m => m.role), ['user', 'assistant', 'user']);
  assert.match(forClaude[2].content, /^\[User\]:\nGemini, anything missing\?\n\n\[Gemini · gemini-2\.5-pro replied\]:\nAdd the Vatican$/);

  const forGrok = buildTranscript(msgs, 'xai');
  assert.equal(forGrok.length, 1);
  assert.equal(forGrok[0].role, 'user');
  assert.match(forGrok[0].content, /\[Claude · claude-opus-5-5 replied\]:\nDay 1/);
  assert.match(forGrok[0].content, /\[Gemini · gemini-2\.5-pro replied\]/);
});

test('transcript always alternates, starts and ends with user', () => {
  const t = buildTranscript(msgs.slice(0, 2), 'anthropic');
  assert.deepEqual(t.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(t[2].content, '(Please continue.)');
  const lead = buildTranscript([msgs[1]], 'anthropic');
  assert.equal(lead[0].role, 'user');
  assert.equal(buildTranscript([], 'anthropic').length, 1);
});

test('failed, pending and empty messages are skipped', () => {
  const t = buildTranscript([
    msgs[0],
    { role: 'assistant', author: { provider: 'xai', model: 'grok-4' }, content: 'partial', error: 'boom' },
    { role: 'assistant', author: { provider: 'xai', model: 'grok-4' }, content: '', pending: true },
  ], 'anthropic');
  assert.deepEqual(t, [{ role: 'user', content: 'Plan a trip to Rome' }]);
});

const sseBody = text => new ReadableStream({
  start(c) {
    const enc = new TextEncoder();
    // Split at awkward points to exercise buffering.
    for (let i = 0; i < text.length; i += 7) c.enqueue(enc.encode(text.slice(i, i + 7)));
    c.close();
  },
});

test('sseEvents parses events split across chunks', async () => {
  const out = [];
  for await (const e of sseEvents(sseBody('event: a\ndata: {"x":1}\n\n: comment\ndata: line1\ndata: line2\r\n\r\ndata: tail'))) out.push(e);
  assert.deepEqual(out, [
    { event: 'a', data: '{"x":1}' },
    { event: 'message', data: 'line1\nline2' },
    { event: 'message', data: 'tail' },
  ]);
});

const fakeFetch = (sse, capture) => async (url, init) => {
  capture.url = url; capture.init = init;
  return new Response(sseBody(sse), { status: 200 });
};
const collect = async gen => { const out = []; for await (const e of gen) out.push(e); return out; };

test('anthropic stream adapter', async () => {
  const cap = {};
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}',
  ].join('\n\n') + '\n\n';
  const ev = await collect(streamChat({
    provider: providerById('anthropic'), cfg: { apiKey: 'k' }, model: 'claude-opus-5-5', system: 'sys',
    messages: [{ role: 'user', content: 'hi' }], fetchImpl: fakeFetch(sse, cap),
  }));
  assert.equal(ev.filter(e => e.type === 'text').map(e => e.text).join(''), 'Hello');
  assert.deepEqual(ev.filter(e => e.type === 'usage').at(-1), { type: 'usage', input: 12, output: 5 });
  assert.equal(cap.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(cap.init.headers['x-api-key'], 'k');
  assert.equal(cap.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(cap.init.body);
  assert.equal(body.system, 'sys');
  assert.equal(body.stream, true);
});

test('gemini stream adapter', async () => {
  const cap = {};
  const sse = [
    'data: {"candidates":[{"content":{"parts":[{"text":"thinking","thought":true},{"text":"Ci"}]}}]}',
    'data: {"candidates":[{"content":{"parts":[{"text":"ao"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":3,"thoughtsTokenCount":4}}',
  ].join('\n\n') + '\n\n';
  const ev = await collect(streamChat({
    provider: providerById('gemini'), cfg: { apiKey: 'g' }, model: 'gemini-2.5-pro', system: 'sys',
    messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
    fetchImpl: fakeFetch(sse, cap),
  }));
  assert.equal(ev.filter(e => e.type === 'text').map(e => e.text).join(''), 'Ciao');
  assert.deepEqual(ev.at(-1), { type: 'usage', input: 9, output: 7 });
  assert.match(cap.url, /models\/gemini-2\.5-pro:streamGenerateContent\?alt=sse$/);
  const body = JSON.parse(cap.init.body);
  assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
});

test('openai-compatible adapter (Grok) with base URL override', async () => {
  const cap = {};
  const sse = [
    'data: {"choices":[{"delta":{"content":"Yo"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
    'data: [DONE]',
  ].join('\n\n') + '\n\n';
  const ev = await collect(streamChat({
    provider: providerById('xai'), cfg: { apiKey: 'x', baseUrl: 'https://proxy.example/api.x.ai/v1/' }, model: 'grok-4',
    system: 'sys', messages: [{ role: 'user', content: 'hi' }], fetchImpl: fakeFetch(sse, cap),
  }));
  assert.equal(cap.url, 'https://proxy.example/api.x.ai/v1/chat/completions');
  assert.equal(cap.init.headers.authorization, 'Bearer x');
  const body = JSON.parse(cap.init.body);
  assert.equal(body.messages[0].role, 'system');
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual(ev, [{ type: 'text', text: 'Yo' }, { type: 'usage', input: 4, output: 2 }]);
});

test('HTTP errors carry provider message and a hint', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429 });
  await assert.rejects(
    collect(streamChat({ provider: providerById('openai'), cfg: { apiKey: 'k' }, model: 'gpt-5', system: '', messages: [], fetchImpl })),
    e => e.message === 'Rate limit reached' && e.status === 429 && /switch to another AI/.test(e.hint),
  );
  const netFail = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(
    collect(streamChat({ provider: providerById('xai'), cfg: { apiKey: 'k' }, model: 'grok-4', system: '', messages: [], fetchImpl: netFail })),
    e => /CORS proxy/.test(e.hint),
  );
});

test('system prompt names the speaker', () => {
  assert.match(systemPromptFor('xai', 'grok-4', 'Be brief'), /You are Grok · grok-4[\s\S]*Be brief$/);
});

test('usage accounting and budget', () => {
  const s = emptyState();
  const c = s.providers.anthropic;
  addUsage(c, 100, 50);
  addUsage(c, 10, 5);
  assert.deepEqual(monthUsage(c), { input: 110, output: 55, requests: 2, total: 165 });
  assert.equal(budgetLeft(c), null);
  c.budget = 330;
  assert.equal(budgetLeft(c), 0.5);
});

test('mergeStates: newest session wins, deletions stick, usage keeps max, settings from newer side', () => {
  const a = emptyState(), b = emptyState();
  a.settingsUpdatedAt = 1; a.providers.xai.apiKey = 'old';
  b.settingsUpdatedAt = 2; b.providers.xai.apiKey = 'new';
  const k = monthKey();
  a.providers.xai.usage[k] = { input: 10, output: 1, requests: 1 };
  b.providers.xai.usage[k] = { input: 5, output: 9, requests: 3 };
  a.sessions = [{ id: 's1', title: 'A', updatedAt: 5, messages: [] }, { id: 's2', title: 'gone', updatedAt: 3, messages: [] }];
  b.sessions = [{ id: 's1', title: 'B', updatedAt: 7, messages: [] }];
  b.deleted = { s2: 4 };
  const m = mergeStates(a, b);
  assert.equal(m.providers.xai.apiKey, 'new');
  assert.deepEqual(m.providers.xai.usage[k], { input: 10, output: 9, requests: 3 });
  assert.deepEqual(m.sessions.map(s => s.title), ['B']);
  // A session edited after its deletion elsewhere survives.
  a.sessions[1].updatedAt = 10;
  assert.deepEqual(mergeStates(a, b).sessions.map(s => s.id), ['s2', 's1']);
});

test('markdown renderer escapes HTML', () => {
  const html = renderMarkdown('# Hi <script>\n\n**b** `x<y`\n\n```js\na<b\n```\n- one\n- two\n\n[l](javascript:alert(1)) [ok](https://a.b)');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>b</strong>'));
  assert.ok(html.includes('<code>x&lt;y</code>'));
  assert.ok(html.includes('<pre data-lang="js"><code>a&lt;b</code></pre>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('href="https://a.b"'));
});
