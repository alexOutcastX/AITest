// Optional Cloudflare Worker that forwards AI API calls for providers that
// refuse direct browser requests (CORS). It stores nothing and logs nothing;
// your API key passes through in the request headers, as it would anyway.
//
// Deploy: `npx wrangler deploy hub/proxy/cors-worker.js --name ai-hub-proxy`
// Then in AI Hub → Linked AIs → <provider> → Advanced → Base URL, enter e.g.
//   https://ai-hub-proxy.<you>.workers.dev/api.x.ai/v1
// (proxy URL + the provider's normal base URL without "https://").
//
// Set ALLOWED_ORIGIN below to the origin you serve AI Hub from so the proxy
// can't be used by other sites.

const ALLOWED_ORIGIN = '*';
const ALLOWED_HOSTS = new Set([
  'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.x.ai', 'api.openai.com',
  'api.deepseek.com', 'api.mistral.ai', 'api.perplexity.ai', 'api.groq.com', 'openrouter.ai',
]);

const cors = {
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const [host, ...rest] = url.pathname.replace(/^\/+/, '').split('/');
    if (!ALLOWED_HOSTS.has(host)) return new Response('Host not allowed', { status: 403, headers: cors });
    const target = `https://${host}/${rest.join('/')}${url.search}`;
    const headers = new Headers(request.headers);
    for (const h of ['origin', 'referer', 'host', 'cf-connecting-ip', 'x-forwarded-for']) headers.delete(h);
    const upstream = await fetch(target, { method: request.method, headers, body: request.body });
    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
