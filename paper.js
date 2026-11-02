/**
 * shared/paper.js — Paper-trading engine (pure logic, no I/O of its own)
 * ======================================================================
 * Used by BOTH runtimes so they behave identically:
 *   - server.js        (Node / Replit / Render)   -> state in memory
 *   - worker/*.js      (Cloudflare Workers)       -> state in a Durable Object
 *
 * Rules: long-only cash account, whole shares, 5 bps commission (min $0.01),
 * 1 bp slippage on market orders, limit orders fill only when marketable.
 *
 * Every function that needs prices takes a `getQuote(symbol)` callback returning
 * { price, bid, ask, marketState } so the engine never touches the network itself.
 */

export const COMMISSION_RATE = 0.0005;
export const MARKET_SLIPPAGE = 0.0001;
export const START_CASH      = 100_000;
const MAX_OPEN_ORDERS = 50, MAX_TRADES = 200, MAX_ORDERS = 100;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function newPortfolio() {
  return {
    cash: START_CASH, startCash: START_CASH,
    positions: {},          // symbol -> { qty, avgCost }
    orders: [],             // open + recently closed orders (newest first)
    trades: [],             // fills (newest first)
    realizedPnL: 0,
    createdAt: Date.now(), lastSeen: Date.now(),
  };
}

/** Apply a fill. Throws HttpError(400) when it can't be afforded / held. */
export function applyFill(pf, { symbol, side, qty, price, orderType, marketState }) {
  const total      = price * qty;
  const commission = Math.max(0.01, total * COMMISSION_RATE);
  let realized = 0;

  if (side === 'buy') {
    if (pf.cash < total + commission)
      throw new HttpError(400, `Insufficient buying power. Need $${(total + commission).toFixed(2)}, have $${pf.cash.toFixed(2)}`);
    pf.cash -= total + commission;
    const pos = pf.positions[symbol] || (pf.positions[symbol] = { qty: 0, avgCost: 0 });
    pos.avgCost = (pos.avgCost * pos.qty + price * qty + commission) / (pos.qty + qty);   // commission capitalised into cost basis
    pos.qty    += qty;
  } else {
    const pos = pf.positions[symbol];
    if (!pos || pos.qty < qty)
      throw new HttpError(400, `Insufficient shares. Long-only account: hold ${pos?.qty || 0}, selling ${qty}`);
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
  if (pf.trades.length > MAX_TRADES) pf.trades.length = MAX_TRADES;
  return trade;
}

/** Fill price if a limit order is immediately executable against the quote, else null. */
export function limitFillPrice(q, side, limit) {
  const ask = q.ask > 0 ? q.ask : q.price;
  const bid = q.bid > 0 ? q.bid : q.price;
  if (side === 'buy'  && limit >= ask) return Math.min(limit, ask);    // price improvement allowed
  if (side === 'sell' && limit <= bid) return Math.max(limit, bid);
  return null;
}

/** Validate + execute (or rest) an order. Returns {status:'filled',trade,cash} | {status:'open',order}. */
export async function submitOrder(pf, body, getQuote) {
  const { symbol, side, orderType = 'market' } = body || {};
  const qty = Number(body?.qty), limitPrice = Number(body?.limitPrice);

  if (!symbol || !['buy', 'sell'].includes(side)) throw new HttpError(400, 'symbol and side (buy|sell) required');
  if (!Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) throw new HttpError(400, 'qty must be a positive whole number (max 1,000,000)');
  if (!['market', 'limit'].includes(orderType)) throw new HttpError(400, 'orderType must be market or limit');
  if (orderType === 'limit' && !(limitPrice > 0)) throw new HttpError(400, 'limitPrice > 0 required for limit orders');

  const sym = String(symbol).toUpperCase();
  const q   = await getQuote(sym);
  if (!(q?.price > 0)) throw new HttpError(400, `No tradable price for ${sym}`);

  if (orderType === 'market') {
    const base = side === 'buy' ? (q.ask > 0 ? q.ask : q.price) : (q.bid > 0 ? q.bid : q.price);
    const px   = side === 'buy' ? base * (1 + MARKET_SLIPPAGE) : base * (1 - MARKET_SLIPPAGE);
    const trade = applyFill(pf, { symbol: sym, side, qty, price: px, orderType, marketState: q.marketState });
    return { status: 'filled', trade, cash: pf.cash };
  }

  const fillPx = limitFillPrice(q, side, limitPrice);
  if (fillPx != null) {
    const trade = applyFill(pf, { symbol: sym, side, qty, price: fillPx, orderType, marketState: q.marketState });
    return { status: 'filled', trade, cash: pf.cash };
  }
  if (side === 'sell' && (pf.positions[sym]?.qty || 0) < qty)
    throw new HttpError(400, `Insufficient shares for resting sell. Hold ${pf.positions[sym]?.qty || 0}`);
  if (pf.orders.filter(o => o.status === 'open').length >= MAX_OPEN_ORDERS)
    throw new HttpError(400, `Too many open orders (max ${MAX_OPEN_ORDERS})`);

  const order = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, symbol: sym, side, qty, limitPrice, orderType, status: 'open', ts: Date.now() };
  pf.orders.unshift(order);
  if (pf.orders.length > MAX_ORDERS) pf.orders.length = MAX_ORDERS;
  return { status: 'open', order };
}

export function cancelOrder(pf, id) {
  const o = pf.orders.find(x => x.id === id && x.status === 'open');
  if (!o) return false;
  o.status = 'cancelled';
  return true;
}

export const hasOpenOrders = pf => pf.orders.some(o => o.status === 'open');

/** Fill any resting limit orders the market has reached (regular session only). Returns #filled. */
export async function matchOpenOrders(pf, getQuote) {
  let filled = 0;
  for (const o of pf.orders) {
    if (o.status !== 'open') continue;
    try {
      const q = await getQuote(o.symbol);
      if (q.marketState && q.marketState !== 'REGULAR') continue;
      const px = limitFillPrice(q, o.side, o.limitPrice);
      if (px == null) continue;
      applyFill(pf, { symbol: o.symbol, side: o.side, qty: o.qty, price: px, orderType: 'limit', marketState: q.marketState });
      o.status = 'filled'; o.filledAt = Date.now(); o.fillPrice = +px.toFixed(4); filled++;
    } catch (e) {
      o.status = 'rejected'; o.reason = e.message;
    }
  }
  return filled;
}

/** Portfolio view with live P&L. */
export async function snapshot(pf, getQuote) {
  const symbols = Object.keys(pf.positions);
  const prices = {};
  await Promise.all(symbols.map(async s => { try { prices[s] = (await getQuote(s)).price; } catch { /* keep cost basis */ } }));
  let marketValue = 0, unrealized = 0;
  const positions = {};
  for (const [sym, pos] of Object.entries(pf.positions)) {
    const price = prices[sym] || pos.avgCost;
    const mktVal = price * pos.qty, pnl = (price - pos.avgCost) * pos.qty;
    marketValue += mktVal; unrealized += pnl;
    positions[sym] = { ...pos, price, mktVal, unrealPnL: pnl, pnLPct: ((price - pos.avgCost) / pos.avgCost) * 100 };
  }
  const totalEquity = pf.cash + marketValue;
  return {
    ...pf, positions, marketValue, unrealizedPnL: unrealized,
    totalEquity, totalPnL: totalEquity - pf.startCash,
    totalPnLPct: ((totalEquity - pf.startCash) / pf.startCash) * 100,
    trades: pf.trades.slice(0, 100), orders: pf.orders.slice(0, 50),
  };
}

export function sanitizeSession(raw) {
  return String(raw || 'default').slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
}
