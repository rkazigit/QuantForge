/**
 * worker/yahoo.js — Yahoo Finance client for Cloudflare Workers
 * =============================================================
 * The Node server uses the `yahoo-finance2` package, which does not run on Workers,
 * so this talks to Yahoo's public JSON endpoints directly with fetch().
 *
 * Output shapes match server.js exactly, so the front end cannot tell the two backends apart.
 *
 * Resilience:
 *   - Quotes: batched v7 call (needs a cookie+crumb) -> falls back to the crumb-free v8 chart
 *     endpoint if v7 is blocked (it has no bid/ask, so the UI shows last price for both).
 *   - 5 s quote cache and 1-5 min history cache (per Worker isolate) to stay well under rate limits.
 *   - 429s surface as a clear message instead of a stack trace.
 *
 * `env.YAHOO_BASE` / `env.YAHOO_COOKIE_URL` can redirect everything to a test double.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const QUOTE_TTL = 5_000;

export class UpstreamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Module-level state is shared by every request that lands on the same isolate.
let crumbState = null;            // { crumb, cookie, ts }
let crumbInflight = null;
const quoteCache = new Map();     // symbol -> { data, ts }
const historyCache = new Map();   // key -> { data, ts }

export function createYahoo(env = {}) {
  const BASE1  = env.YAHOO_BASE || 'https://query1.finance.yahoo.com';
  const BASE2  = env.YAHOO_BASE || 'https://query2.finance.yahoo.com';
  const COOKIE = env.YAHOO_COOKIE_URL || (env.YAHOO_BASE ? `${env.YAHOO_BASE}/__cookie` : 'https://fc.yahoo.com');

  /* ── crumb / cookie handshake ────────────────────────────────────────── */
  async function getCrumb() {
    if (crumbState && Date.now() - crumbState.ts < 55 * 60_000) return crumbState;
    if (crumbInflight) return crumbInflight;
    crumbInflight = (async () => {
      const r1 = await fetch(COOKIE, { headers: { 'User-Agent': UA }, redirect: 'manual' });
      const setCookies = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
      const cookie = setCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
      if (!cookie) throw new UpstreamError(502, 'Yahoo Finance did not issue a session cookie');
      const r2 = await fetch(`${BASE1}/v1/test/getcrumb`, { headers: { 'User-Agent': UA, Cookie: cookie } });
      if (r2.status === 429) throw new UpstreamError(429, 'Yahoo Finance is rate-limiting this server right now. Try again in a minute.');
      const crumb = (await r2.text()).trim();
      if (!r2.ok || !crumb || crumb.includes('<')) throw new UpstreamError(502, 'Could not obtain a Yahoo Finance session crumb');
      crumbState = { crumb, cookie, ts: Date.now() };
      return crumbState;
    })().finally(() => { crumbInflight = null; });
    return crumbInflight;
  }

  /** GET JSON from Yahoo; `crumb:true` adds the session cookie + crumb and retries once if rejected. */
  async function yget(url, { crumb = false } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
      let finalUrl = url;
      if (crumb) {
        const c = await getCrumb();
        headers.Cookie = c.cookie;
        finalUrl += (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(c.crumb);
      }
      const res = await fetch(finalUrl, { headers });
      if (crumb && (res.status === 401 || res.status === 403) && attempt === 0) { crumbState = null; continue; }
      if (res.status === 429) throw new UpstreamError(429, 'Yahoo Finance is rate-limiting this server right now. Try again in a minute.');
      if (res.status === 404) throw new UpstreamError(404, 'Not found');
      if (!res.ok) throw new UpstreamError(502, `Yahoo Finance returned HTTP ${res.status}`);
      try { return await res.json(); } catch { throw new UpstreamError(502, 'Yahoo Finance returned an unreadable response'); }
    }
    throw new UpstreamError(502, 'Yahoo Finance rejected the session');
  }

  /* ── quotes ──────────────────────────────────────────────────────────── */
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  function normalizeQuote(r) {
    return {
      symbol: r.symbol, shortName: r.shortName || r.longName || r.symbol,
      price: r.regularMarketPrice, open: r.regularMarketOpen, prevClose: r.regularMarketPreviousClose,
      change: r.regularMarketChange, changePct: r.regularMarketChangePercent,
      high: r.regularMarketDayHigh, low: r.regularMarketDayLow,
      volume: r.regularMarketVolume, avgVolume: r.averageDailyVolume3Month,
      bid: r.bid, ask: r.ask, bidSize: r.bidSize, askSize: r.askSize,
      mktCap: r.marketCap, pe: r.trailingPE, eps: r.epsTrailingTwelveMonths,
      fiftyTwoHigh: r.fiftyTwoWeekHigh, fiftyTwoLow: r.fiftyTwoWeekLow,
      exchange: r.fullExchangeName, currency: r.currency, quoteType: r.quoteType,
      marketState: r.marketState, ts: Date.now(),
    };
  }

  /** Crumb-free fallback: build a quote from the v8 chart metadata. No bid/ask available. */
  async function quoteFromChart(symbol) {
    const j = await yget(`${BASE1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`);
    const res = j?.chart?.result?.[0];
    const m = res?.meta;
    if (!m || !(m.regularMarketPrice > 0)) throw new UpstreamError(404, 'Not found');
    const prev = num(m.chartPreviousClose) ?? num(m.previousClose);
    const change = prev != null ? m.regularMarketPrice - prev : undefined;
    const now = Date.now() / 1000, tp = m.currentTradingPeriod || {};
    const within = p => p && now >= p.start && now < p.end;
    const marketState = within(tp.regular) ? 'REGULAR' : within(tp.pre) ? 'PRE' : within(tp.post) ? 'POST' : 'CLOSED';
    return {
      symbol: m.symbol, shortName: m.shortName || m.longName || m.symbol,
      price: m.regularMarketPrice, open: undefined, prevClose: prev, change,
      changePct: change != null && prev ? (change / prev) * 100 : undefined,
      high: m.regularMarketDayHigh, low: m.regularMarketDayLow, volume: m.regularMarketVolume,
      fiftyTwoHigh: m.fiftyTwoWeekHigh, fiftyTwoLow: m.fiftyTwoWeekLow,
      exchange: m.fullExchangeName || m.exchangeName, currency: m.currency, quoteType: m.instrumentType,
      marketState, ts: Date.now(),
    };
  }

  /** Fetch many quotes with one upstream call. Returns { SYMBOL: quote } (unknown symbols omitted). */
  async function fetchQuotes(symbols) {
    const want = [...new Set(symbols.map(s => s.toUpperCase()))];
    const out = {}, miss = [];
    const now = Date.now();
    for (const s of want) {
      const c = quoteCache.get(s);
      if (c && now - c.ts < QUOTE_TTL) out[s] = c.data; else miss.push(s);
    }
    if (!miss.length) return out;

    let results = [];
    try {
      const j = await yget(`${BASE1}/v7/finance/quote?symbols=${encodeURIComponent(miss.join(','))}`, { crumb: true });
      results = (j?.quoteResponse?.result || []).filter(r => r && r.symbol && r.regularMarketPrice != null).map(normalizeQuote);
    } catch (e) {
      if (e.status === 429) throw e;
      results = [];                                         // v7 blocked -> fall back per symbol below
    }
    const got = new Set(results.map(r => r.symbol.toUpperCase()));
    const stillMissing = miss.filter(s => !got.has(s));
    if (stillMissing.length && stillMissing.length <= 12) {
      const fb = await Promise.allSettled(stillMissing.map(quoteFromChart));
      fb.forEach(r => { if (r.status === 'fulfilled') results.push(r.value); });
    }
    for (const q of results) {
      const key = q.symbol.toUpperCase();
      quoteCache.set(key, { data: q, ts: Date.now() });
      // the caller may have used a different spelling (e.g. brk-b); index by what they asked for
      const asked = miss.find(m => m === key) || miss.find(m => m.replace(/[-.]/g, '') === key.replace(/[-.]/g, ''));
      out[asked || key] = q;
      if (asked && asked !== key) quoteCache.set(asked, { data: q, ts: Date.now() });
    }
    if (quoteCache.size > 2000) quoteCache.clear();
    return out;
  }

  async function fetchQuote(symbol) {
    const sym = symbol.toUpperCase();
    const q = (await fetchQuotes([sym]))[sym];
    if (!q) throw new UpstreamError(404, `Symbol not found: ${symbol}`);
    return q;
  }

  /* ── history ─────────────────────────────────────────────────────────── */
  const RANGE_MS = { '1d': 1, '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825 };
  const INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo']);

  async function fetchHistory(symbol, interval = '1d', range = '1y') {
    if (!INTERVALS.has(interval)) throw new UpstreamError(400, `Unsupported interval: ${interval}`);
    const key = `${symbol}:${interval}:${range}`;
    const ttl = ['1m', '2m', '5m', '15m', '30m'].includes(interval) ? 60_000 : 300_000;
    const hit = historyCache.get(key);
    if (hit && Date.now() - hit.ts < ttl) return hit.data;

    const nowS = Math.floor(Date.now() / 1000);
    let p1;
    if (range === 'ytd') p1 = Math.floor(new Date(new Date().getUTCFullYear(), 0, 1).getTime() / 1000);
    else p1 = nowS - (RANGE_MS[range] || 365) * 86400;

    const j = await yget(`${BASE1}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${nowS + 86400}&interval=${interval}&includePrePost=false`);
    const r = j?.chart?.result?.[0];
    if (!r) throw new UpstreamError(404, `No chart data for ${symbol}`);
    const q = r.indicators?.quote?.[0] || {}, ts = r.timestamp || [];
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({ time: ts[i], open: +o.toFixed(4), high: +h.toFixed(4), low: +l.toFixed(4), close: +c.toFixed(4), volume: q.volume?.[i] || 0 });
    }
    const data = { symbol, interval, range, candles };
    historyCache.set(key, { data, ts: Date.now() });
    if (historyCache.size > 300) historyCache.clear();
    return data;
  }

  /* ── search / options / fundamentals ─────────────────────────────────── */
  async function search(query) {
    const j = await yget(`${BASE2}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`);
    return (j?.quotes || []).slice(0, 10).map(q => ({
      symbol: q.symbol, name: q.shortname || q.longname || q.symbol, type: q.quoteType || '', exchange: q.exchDisp || q.exchange || '',
    }));
  }

  async function fetchOptions(symbol, date) {
    const j = await yget(`${BASE2}/v7/finance/options/${encodeURIComponent(symbol)}${date ? `?date=${Number(date)}` : ''}`, { crumb: true });
    const r = j?.optionChain?.result?.[0];
    if (!r) return { expirationDates: [], options: [] };
    const leg = c => ({ contractSymbol: c.contractSymbol, strike: c.strike, lastPrice: c.lastPrice, bid: c.bid, ask: c.ask,
      volume: c.volume, openInterest: c.openInterest, impliedVolatility: c.impliedVolatility, inTheMoney: c.inTheMoney });
    return {
      expirationDates: r.expirationDates || [],
      options: (r.options || []).map(o => ({ expirationDate: o.expirationDate, calls: (o.calls || []).map(leg), puts: (o.puts || []).map(leg) })),
    };
  }

  /** Yahoo's quoteSummary wraps numbers as {raw, fmt}; flatten to plain values like yahoo-finance2 does. */
  const unwrap = v => {
    if (Array.isArray(v)) return v.map(unwrap);
    if (v && typeof v === 'object') {
      if ('raw' in v) return v.raw;
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
    }
    return v;
  };

  async function fetchFundamentals(symbol) {
    const j = await yget(`${BASE2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryProfile,financialData,defaultKeyStatistics`, { crumb: true });
    return unwrap(j?.quoteSummary?.result?.[0] || {});
  }

  return { fetchQuote, fetchQuotes, fetchHistory, search, fetchOptions, fetchFundamentals };
}
