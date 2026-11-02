/**
 * worker/index.js — QuantForge on Cloudflare Workers
 * ==================================================
 * Serves the static site (public/) through the ASSETS binding and implements the same /api/*
 * contract as server.js, so the front end runs unchanged on either backend.
 *
 *   /api/health, /api/quote, /api/quotes, /api/history, /api/search, /api/options, /api/fundamentals
 *   /api/paper/*  -> forwarded to the session's PaperAccount Durable Object
 *
 * There is no WebSocket here (Workers would need a Durable Object per socket plus a polling loop
 * for a free data feed); the front end detects that and polls /api/quotes every 6 s instead.
 */
import { createYahoo, UpstreamError } from './yahoo.js';
import { sanitizeSession } from '../shared/paper.js';

export { PaperAccount } from './paperAccount.js';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,15}$/;

function symbolParam(raw) {
  const s = decodeURIComponent(raw || '');
  if (!SYMBOL_RE.test(s)) throw new UpstreamError(400, 'Invalid symbol');
  return s.toUpperCase();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // The front end tries a WebSocket first; refuse quickly so it falls back to polling.
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket')
      return new Response('WebSockets are not available on this deployment; use HTTP polling.', { status: 426 });

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    const yahoo = createYahoo(env);
    try {
      /* ── paper trading → Durable Object ────────────────────────────── */
      if (path.startsWith('/api/paper/')) {
        const session = sanitizeSession(request.headers.get('x-session'));
        const stub = env.PAPER.get(env.PAPER.idFromName(session));
        const inner = new URL(request.url);
        inner.pathname = path.slice('/api/paper'.length);
        return await stub.fetch(new Request(inner, { method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body }));
      }

      /* ── market data ───────────────────────────────────────────────── */
      if (path === '/api/health')
        return json({ status: 'ok', runtime: 'cloudflare-worker', ts: new Date().toISOString() });

      let m;
      if ((m = path.match(/^\/api\/quote\/([^/]+)$/))) {
        const sym = symbolParam(m[1]);
        try { return json(await yahoo.fetchQuote(sym)); }
        catch (e) { throw e.status === 404 ? new UpstreamError(404, `Symbol not found: ${sym}`) : e; }
      }
      if (path === '/api/quotes' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const symbols = (Array.isArray(body.symbols) ? body.symbols : []).filter(s => typeof s === 'string' && SYMBOL_RE.test(s)).slice(0, 40);
        return json(symbols.length ? await yahoo.fetchQuotes(symbols) : {});
      }
      if ((m = path.match(/^\/api\/history\/([^/]+)$/)))
        return json(await yahoo.fetchHistory(symbolParam(m[1]), url.searchParams.get('interval') || '1d', url.searchParams.get('range') || '1y'));
      if ((m = path.match(/^\/api\/search\/(.+)$/)))
        return json(await yahoo.search(decodeURIComponent(m[1]).slice(0, 40)));
      if ((m = path.match(/^\/api\/options\/([^/]+)$/)))
        return json(await yahoo.fetchOptions(symbolParam(m[1]), url.searchParams.get('date')));
      if ((m = path.match(/^\/api\/fundamentals\/([^/]+)$/)))
        return json(await yahoo.fetchFundamentals(symbolParam(m[1])));

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message || 'Internal error' }, e.status && e.status >= 400 && e.status < 600 ? e.status : 500);
    }
  },
};
