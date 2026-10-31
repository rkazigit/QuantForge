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

// ── Options chain ─────────────────────────────────────────────────────────
app.get('/api/options/:symbol', async (req, res) => {
  try {
    const data = await yahooFinance.options(req.params.symbol.toUpperCase(), {}, { validateResult: false });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

const portfolios     = new Map();   // sessionId -> portfolio
const MAX_PORTFOLIOS = 5000;
const COMMISSION_RATE = 0.0005;     // 5 bps, $0.01 minimum
const MARKET_SLIPPAGE = 0.0001;     // 1 bp on market orders

function newPortfolio() {
  return {
    cash: 100_000, startCash: 100_000,
    positions: {},            // symbol -> { qty, avgCost }
    orders: [],               // open + recently closed orders
    trades: [],               // fills, newest first
    realizedPnL: 0,
    createdAt: Date.now(), lastSeen: Date.now(),
  };
}

function sessionId(req) {
  const raw = String(req.headers['x-session'] || 'default').slice(0, 64);
  return raw.replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
}

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

/** Apply a fill to a portfolio. Long-only, cash account, no margin. Throws on rejection. */
function applyFill(pf, { symbol, side, qty, price, orderType, marketState }) {
  const total      = price * qty;
  const commission = Math.max(0.01, total * COMMISSION_RATE);
  let realized = 0;

  if (side === 'buy') {
    if (pf.cash < total + commission)
      throw new Error(`Insufficient buying power. Need $${(total + commission).toFixed(2)}, have $${pf.cash.toFixed(2)}`);
    pf.cash -= total + commission;
    const pos = pf.positions[symbol] || (pf.positions[symbol] = { qty: 0, avgCost: 0 });
    pos.avgCost = (pos.avgCost * pos.qty + price * qty + commission) / (pos.qty + qty);  // commission capitalised into cost basis
    pos.qty    += qty;
  } else {
    const pos = pf.positions[symbol];
    if (!pos || pos.qty < qty)
      throw new Error(`Insufficient shares. Long-only account: hold ${pos?.qty || 0}, selling ${qty}`);
    realized     = (price - pos.avgCost) * qty - commission;
    pos.qty     -= qty;
    pf.cash     += total - commission;
    pf.realizedPnL += realized;
    if (pos.qty <= 0) delete pf.positions[symbol];
  }

  const trade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    symbol, side, qty,
    execPrice: +price.toFixed(4), total: +total.toFixed(2),
    commission: +commission.toFixed(2), realizedPnL: +realized.toFixed(2),
    orderType, marketState: marketState || null,
    ts: Date.now(), isoTime: new Date().toISOString(),
  };
  pf.trades.unshift(trade);
  if (pf.trades.length > 500) pf.trades.length = 500;
  return trade;
}

/** Is a limit order immediately executable against the current quote? Returns fill price or null. */
function limitFillPrice(q, side, limit) {
  const ask = q.ask > 0 ? q.ask : q.price;
  const bid = q.bid > 0 ? q.bid : q.price;
  if (side === 'buy'  && limit >= ask) return Math.min(limit, ask);   // price improvement allowed
  if (side === 'sell' && limit <= bid) return Math.max(limit, bid);
  return null;
}

async function portfolioWithPnL(pf) {
  const symbols = Object.keys(pf.positions);
  const quotes  = {};
  if (symbols.length) {
    const fetched = await Promise.allSettled(symbols.map(fetchQuote));
    fetched.forEach((r, i) => { if (r.status === 'fulfilled') quotes[symbols[i]] = r.value.price; });
  }
  let marketValue = 0, unrealized = 0;
  const positions = {};
  for (const [sym, pos] of Object.entries(pf.positions)) {
    const price = quotes[sym] || pos.avgCost;
    const mktVal = price * pos.qty, pnl = (price - pos.avgCost) * pos.qty;
    marketValue += mktVal; unrealized += pnl;
    positions[sym] = { ...pos, price, mktVal, unrealPnL: pnl, pnLPct: ((price - pos.avgCost) / pos.avgCost) * 100 };
  }
  const totalEquity = pf.cash + marketValue;
  return {
    ...pf, positions, marketValue, unrealizedPnL: unrealized,
    totalEquity, totalPnL: totalEquity - pf.startCash,
    totalPnLPct: ((totalEquity - pf.startCash) / pf.startCash) * 100,
    trades: pf.trades.slice(0, 100),
    orders: pf.orders.slice(0, 50),
  };
}

app.get('/api/paper/portfolio', async (req, res) => {
  try { res.json(await portfolioWithPnL(getPortfolio(sessionId(req)))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/paper/order', async (req, res) => {
  try {
    const pf = getPortfolio(sessionId(req));
    const { symbol, side, orderType = 'market' } = req.body || {};
    const qty = Number(req.body?.qty);
    const limitPrice = Number(req.body?.limitPrice);

    if (!symbol || !['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'symbol and side (buy|sell) required' });
    if (!Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) return res.status(400).json({ error: 'qty must be a positive whole number (max 1,000,000)' });
    if (!['market', 'limit'].includes(orderType)) return res.status(400).json({ error: 'orderType must be market or limit' });
    if (orderType === 'limit' && !(limitPrice > 0)) return res.status(400).json({ error: 'limitPrice > 0 required for limit orders' });

    const sym = String(symbol).toUpperCase();
    const q   = await fetchQuote(sym);
    if (!(q.price > 0)) return res.status(400).json({ error: `No tradable price for ${sym}` });

    if (orderType === 'market') {
      const base = side === 'buy' ? (q.ask > 0 ? q.ask : q.price) : (q.bid > 0 ? q.bid : q.price);
      const px   = side === 'buy' ? base * (1 + MARKET_SLIPPAGE) : base * (1 - MARKET_SLIPPAGE);
      const trade = applyFill(pf, { symbol: sym, side, qty, price: px, orderType, marketState: q.marketState });
      return res.json({ status: 'filled', trade, cash: pf.cash });
    }

    // Limit order: fill now only if marketable, otherwise rest on the book
    const fillPx = limitFillPrice(q, side, limitPrice);
    if (fillPx != null) {
      const trade = applyFill(pf, { symbol: sym, side, qty, price: fillPx, orderType, marketState: q.marketState });
      return res.json({ status: 'filled', trade, cash: pf.cash });
    }
    if (side === 'sell' && (pf.positions[sym]?.qty || 0) < qty)
      return res.status(400).json({ error: `Insufficient shares for resting sell. Hold ${pf.positions[sym]?.qty || 0}` });
    if (pf.orders.filter(o => o.status === 'open').length >= 50)
      return res.status(400).json({ error: 'Too many open orders (max 50)' });

    const order = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, symbol: sym, side, qty, limitPrice, orderType, status: 'open', ts: Date.now() };
    pf.orders.unshift(order);
    res.json({ status: 'open', order });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/paper/order/:id', (req, res) => {
  const pf = getPortfolio(sessionId(req));
  const o  = pf.orders.find(x => x.id === req.params.id && x.status === 'open');
  if (!o) return res.status(404).json({ error: 'Open order not found' });
  o.status = 'cancelled';
  res.json({ success: true });
});

app.delete('/api/paper/portfolio', (req, res) => {
  portfolios.set(sessionId(req), newPortfolio());
  res.json({ success: true, message: 'Portfolio reset to $100,000' });
});

/** Background matcher: fills resting limit orders when the market reaches them (regular session only). */
async function matchOpenOrders() {
  for (const pf of portfolios.values()) {
    for (const o of pf.orders) {
      if (o.status !== 'open') continue;
      try {
        const q = await fetchQuote(o.symbol);
        if (q.marketState && q.marketState !== 'REGULAR') continue;
        const px = limitFillPrice(q, o.side, o.limitPrice);
        if (px == null) continue;
        applyFill(pf, { symbol: o.symbol, side: o.side, qty: o.qty, price: px, orderType: 'limit', marketState: q.marketState });
        o.status = 'filled'; o.filledAt = Date.now(); o.fillPrice = +px.toFixed(4);
      } catch (e) {
        o.status = 'rejected'; o.reason = e.message;
      }
    }
    if (pf.orders.length > 200) pf.orders.length = 200;
  }
}
setInterval(() => matchOpenOrders().catch(() => {}), 10_000);

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
