/**
 * QuantForge Terminal — Backend Server
 * =====================================
 * Express + WebSocket server providing:
 *   - Real-time market data via Yahoo Finance (free, no API key needed)
 *   - Historical OHLCV for any timeframe
 *   - Options chain data
 *   - WebSocket streaming for live quote updates
 *   - Paper trading engine (in-memory portfolio management)
 *   - Symbol search
 */

import 'dotenv/config';
import express          from 'express';
import cors             from 'cors';
import rateLimit        from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yahooFinance     from 'yahoo-finance2';
import {
  newPortfolio, submitOrder, cancelOrder, matchOpenOrders, snapshot, sanitizeSession, HttpError,
} from './shared/paper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app       = express();
const httpServer = createServer(app);
const wss       = new WebSocketServer({ server: httpServer });
const PORT      = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60_000,
  max:      120,
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/api/', limiter);

// ── Quote Cache (avoid hammering Yahoo Finance) ───────────────────────────
const quoteCache = new Map();
const QUOTE_TTL  = 8_000; // 8 seconds

async function fetchQuote(symbol) {
  const now    = Date.now();
  const cached = quoteCache.get(symbol);
  if (cached && now - cached.ts < QUOTE_TTL) return cached.data;

  const raw = await yahooFinance.quote(symbol, {}, { validateResult: false });
  const data = {
    symbol:        raw.symbol,
    shortName:     raw.shortName || raw.longName || symbol,
    price:         raw.regularMarketPrice,
    open:          raw.regularMarketOpen,
    prevClose:     raw.regularMarketPreviousClose,
    change:        raw.regularMarketChange,
    changePct:     raw.regularMarketChangePercent,
    high:          raw.regularMarketDayHigh,
    low:           raw.regularMarketDayLow,
    volume:        raw.regularMarketVolume,
    avgVolume:     raw.averageDailyVolume3Month,
    bid:           raw.bid,
    ask:           raw.ask,
    bidSize:       raw.bidSize,
    askSize:       raw.askSize,
    mktCap:        raw.marketCap,
    pe:            raw.trailingPE,
    eps:           raw.epsTrailingTwelveMonths,
    fiftyTwoHigh:  raw.fiftyTwoWeekHigh,
    fiftyTwoLow:   raw.fiftyTwoWeekLow,
    exchange:      raw.fullExchangeName,
    currency:      raw.currency,
    quoteType:     raw.quoteType,
    marketState:   raw.marketState,   // REGULAR | PRE | POST | CLOSED
    ts:            now,
  };
  quoteCache.set(symbol, { data, ts: now });
  return data;
}

// ── Historical Data Cache ─────────────────────────────────────────────────
const historyCache = new Map();
const HISTORY_TTL  = 60_000; // 1 minute for short intervals, 5 min for daily+

async function fetchHistory(symbol, interval = '1d', range = '1y') {
  const key    = `${symbol}:${interval}:${range}`;
  const now    = Date.now();
  const ttl    = ['1m','5m','15m','30m'].includes(interval) ? 60_000 : 300_000;
  const cached = historyCache.get(key);
  if (cached && now - cached.ts < ttl) return cached.data;

  // Map range string to period1
  const rangeMs = {
    '1d':  1   * 86400_000,
    '5d':  5   * 86400_000,
    '1mo': 30  * 86400_000,
    '3mo': 90  * 86400_000,
    '6mo': 180 * 86400_000,
    '1y':  365 * 86400_000,
    '2y':  730 * 86400_000,
    '5y':  1825* 86400_000,
    'ytd': null, // handled below
  };

  let period1;
  if (range === 'ytd') {
    const d = new Date();
    period1 = new Date(d.getFullYear(), 0, 1);
  } else {
    period1 = new Date(now - (rangeMs[range] || 365 * 86400_000));
  }

  const chart = await yahooFinance.chart(symbol, {
    period1,
    interval,
  }, { validateResult: false });

  // Normalise to Lightweight Charts format (Unix seconds)
  const candles = (chart.quotes || [])
    .filter(q => q.open && q.high && q.low && q.close)
    .map(q => ({
      time:   Math.floor(new Date(q.date).getTime() / 1000),
      open:   +q.open .toFixed(4),
      high:   +q.high .toFixed(4),
      low:    +q.low  .toFixed(4),
      close:  +q.close.toFixed(4),
      volume: q.volume || 0,
    }));

  const data = { symbol, interval, range, candles };
  historyCache.set(key, { data, ts: now });
  return data;
}

// ══════════════════════════════════════════════════════════════════════════
// REST API ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── Single quote ──────────────────────────────────────────────────────────
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const data = await fetchQuote(req.params.symbol.toUpperCase());
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: `Symbol not found: ${req.params.symbol}`, detail: e.message });
  }
});

// ── Bulk quotes ───────────────────────────────────────────────────────────
app.post('/api/quotes', async (req, res) => {
  try {
    const { symbols = [] } = req.body;
    if (!symbols.length) return res.json({});
    const results = await Promise.allSettled(symbols.map(s => fetchQuote(s.toUpperCase())));
    const data = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') data[symbols[i].toUpperCase()] = r.value;
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Historical OHLCV ──────────────────────────────────────────────────────
app.get('/api/history/:symbol', async (req, res) => {
  try {
    const { interval = '1d', range = '1y' } = req.query;
    const data = await fetchHistory(req.params.symbol.toUpperCase(), interval, range);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, detail: e.message });
  }
});

// ── Symbol search ─────────────────────────────────────────────────────────
app.get('/api/search/:query', async (req, res) => {
  try {
    const raw = await yahooFinance.search(req.params.query, {}, { validateResult: false });
    const results = (raw.quotes || []).slice(0, 10).map(q => ({
      symbol:   q.symbol,
      name:     q.shortname || q.longname || q.symbol,
      type:     q.quoteType || '',
      exchange: q.exchDisp || q.exchange || '',
    }));
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Options chain (normalised to unix seconds; pass ?date=<unix> for a specific expiry) ──
app.get('/api/options/:symbol', async (req, res) => {
  try {
    const opts = {};
    if (req.query.date) opts.date = new Date(Number(req.query.date) * 1000);
    const raw = await yahooFinance.options(req.params.symbol.toUpperCase(), opts, { validateResult: false });
    const sec = d => (d instanceof Date ? d.getTime() : new Date(d).getTime()) / 1000;
    const leg = c => ({ contractSymbol: c.contractSymbol, strike: c.strike, lastPrice: c.lastPrice, bid: c.bid, ask: c.ask,
      volume: c.volume, openInterest: c.openInterest, impliedVolatility: c.impliedVolatility, inTheMoney: c.inTheMoney });
    res.json({
      expirationDates: (raw.expirationDates || []).map(sec),
      options: (raw.options || []).map(o => ({ expirationDate: sec(o.expirationDate), calls: (o.calls || []).map(leg), puts: (o.puts || []).map(leg) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Company fundamentals ──────────────────────────────────────────────────
app.get('/api/fundamentals/:symbol', async (req, res) => {
  try {
    const data = await yahooFinance.quoteSummary(
      req.params.symbol.toUpperCase(),
      { modules: ['summaryProfile', 'financialData', 'defaultKeyStatistics', 'incomeStatementHistory'] },
      { validateResult: false }
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PAPER TRADING ENGINE
// ══════════════════════════════════════════════════════════════════════════

const portfolios     = new Map();   // sessionId -> portfolio (in memory; resets on restart)
const MAX_PORTFOLIOS = 5000;

function getPortfolio(id) {
  if (!portfolios.has(id)) {
    if (portfolios.size >= MAX_PORTFOLIOS) {           // evict least-recently-seen
      let oldestKey = null, oldest = Infinity;
      for (const [k, v] of portfolios) if (v.lastSeen < oldest) { oldest = v.lastSeen; oldestKey = k; }
      if (oldestKey) portfolios.delete(oldestKey);
    }
    portfolios.set(id, newPortfolio());
  }
  const pf = portfolios.get(id);
  pf.lastSeen = Date.now();
  return pf;
}
const sid = req => sanitizeSession(req.headers['x-session']);
const fail = (res, e) => res.status(e instanceof HttpError ? e.status : 500).json({ error: e.message });

app.get('/api/paper/portfolio', async (req, res) => {
  try { res.json(await snapshot(getPortfolio(sid(req)), fetchQuote)); } catch (e) { fail(res, e); }
});
app.post('/api/paper/order', async (req, res) => {
  try { res.json(await submitOrder(getPortfolio(sid(req)), req.body, fetchQuote)); } catch (e) { fail(res, e); }
});
app.delete('/api/paper/order/:id', (req, res) => {
  cancelOrder(getPortfolio(sid(req)), req.params.id) ? res.json({ success: true }) : res.status(404).json({ error: 'Open order not found' });
});
app.delete('/api/paper/portfolio', (req, res) => {
  portfolios.set(sid(req), newPortfolio());
  res.json({ success: true, message: 'Portfolio reset to $100,000' });
});

/** Background matcher: fills resting limit orders when the market reaches them. */
setInterval(async () => {
  for (const pf of portfolios.values()) await matchOpenOrders(pf, fetchQuote).catch(() => {});
}, 10_000);

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({
  status: 'ok',
  portfolios: portfolios.size,
  cacheSize: quoteCache.size,
  ts: new Date().toISOString(),
}));

// ── SPA fallback ─────────────────────────────────────────────────────────
app.get('*', (_, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

// ══════════════════════════════════════════════════════════════════════════
// WEBSOCKET — Real-time quote streaming
// ══════════════════════════════════════════════════════════════════════════

const subscriptions = new Map(); // ws → Set<symbol>

wss.on('connection', ws => {
  subscriptions.set(ws, new Set(['SPY', 'QQQ', 'AAPL'])); // defaults

  ws.on('message', raw => {
    try {
      const msg  = JSON.parse(raw.toString());
      const subs = subscriptions.get(ws);
      if (msg.action === 'subscribe' && Array.isArray(msg.symbols)) {
        for (const s of msg.symbols.slice(0, 20)) {
          if (typeof s !== 'string' || !/^[A-Za-z0-9.\-^=]{1,12}$/.test(s)) continue;
          if (subs.size >= 60) break;                 // per-connection cap
          subs.add(s.toUpperCase());
        }
      } else if (msg.action === 'unsubscribe' && Array.isArray(msg.symbols)) {
        msg.symbols.forEach(s => subs.delete(s.toUpperCase()));
      }
    } catch {}
  });

  ws.on('close', () => subscriptions.delete(ws));
  ws.on('error', () => subscriptions.delete(ws));

  ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
});

// Poll market data and push updates to all subscribers
const POLL_INTERVAL = 8000; // 8 seconds — respectful of free API limits

async function pollAndBroadcast() {
  // Collect all unique subscribed symbols
  const all = new Set();
  for (const syms of subscriptions.values())
    for (const s of syms) all.add(s);

  if (!all.size) return;

  // Fetch in parallel (up to 10 at a time to avoid rate limits)
  const symbols = [...all];
  const chunks  = [];
  for (let i = 0; i < symbols.length; i += 10)
    chunks.push(symbols.slice(i, i + 10));

  for (const chunk of chunks) {
    const results = await Promise.allSettled(chunk.map(s => fetchQuote(s)));

    for (let i = 0; i < chunk.length; i++) {
      if (results[i].status !== 'fulfilled') continue;
      const q   = results[i].value;
      const msg = JSON.stringify({
        type:      'quote',
        symbol:    q.symbol,
        price:     q.price,
        change:    q.change,
        changePct: q.changePct,
        bid:       q.bid,
        ask:       q.ask,
        volume:    q.volume,
        marketState: q.marketState,
        ts:        Date.now(),
      });

      // Push to all clients subscribed to this symbol
      for (const [ws, syms] of subscriptions) {
        if (syms.has(q.symbol) && ws.readyState === WebSocket.OPEN) {
          try { ws.send(msg); } catch {}
        }
      }
    }
  }
}

setInterval(pollAndBroadcast, POLL_INTERVAL);

// ── Start ─────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log('\n  QuantForge Terminal');
  console.log(`  http://localhost:${PORT}`);
  console.log('  Market data: Yahoo Finance (free, no API key needed)');
  console.log(`  WebSocket:   ws://localhost:${PORT}\n`);
});
