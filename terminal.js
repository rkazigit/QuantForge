'use strict';
/**
 * terminal.js — Terminal page controller
 * ======================================
 * Wires the chart, quote panel, depth ladder, watchlist and bottom panels
 * to the REST + WebSocket market data feed.
 *
 * DATA HONESTY NOTES (also surfaced in the UI):
 *  - Prices come from Yahoo Finance. They can be delayed (up to ~15 min on some venues).
 *  - Yahoo provides top-of-book (bid/ask) only — NOT full Level-2 depth.
 *    The depth ladder here is MODELED around the real bid/ask and is labelled as such.
 */

const Terminal = (() => {

  const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM'];

  // Intraday history on Yahoo is capped (1m ≈ 7d, 5m–30m ≈ 60d), so pick a sane range per interval.
  const RANGE_FOR = { '1m': '5d', '5m': '1mo', '15m': '1mo', '30m': '1mo', '1d': '2y', '1wk': '5y', '1mo': '5y' };

  const PANE_IDS = ['rsi', 'macd', 'stoch', 'cci', 'williamsr', 'mfi', 'obv', 'cmf'];
  const IND_LABEL = {
    sma20: 'SMA 20', sma50: 'SMA 50', sma200: 'SMA 200', ema20: 'EMA 20', ema50: 'EMA 50',
    bb: 'BB(20,2)', vwap: 'VWAP', supertrend: 'Supertrend', parabolicsar: 'PSAR',
    rsi: 'RSI 14', macd: 'MACD', stoch: 'Stoch', cci: 'CCI 20', williamsr: '%R 14', mfi: 'MFI 14',
    obv: 'OBV', cmf: 'CMF 20',
  };

  const state = {
    symbol:    localStorage.getItem('qf_symbol') || 'AAPL',
    interval:  '1d',
    quote:     null,
    watchlist: safeJSON(localStorage.getItem('qf_watchlist')) || [...DEFAULT_WATCHLIST],
    wl:        {},        // symbol -> latest quote
    indicators: [],
    bottom:    'positions',
    token:     0,         // guards against out-of-order async responses
  };

  function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }
  const $ = id => document.getElementById(id);

  /* ══════════════════════════════════════════════════════════════════════
     LOADING
     ══════════════════════════════════════════════════════════════════════ */

  /** Sort ascending and drop duplicate timestamps — Lightweight Charts throws on either. */
  function normalize(candles) {
    const map = new Map();
    for (const c of candles || []) {
      if ([c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) map.set(c.time, c);
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  async function loadSymbol(raw) {
    const sym = String(raw || '').toUpperCase().trim();
    if (!sym) return;
    const token = ++state.token;
    setChartMessage(`Loading ${Fmt.esc(sym)}…`);
    try {
      const [q, h] = await Promise.all([
        API.get(`/api/quote/${encodeURIComponent(sym)}`),
        API.get(`/api/history/${encodeURIComponent(sym)}?interval=${state.interval}&range=${RANGE_FOR[state.interval]}`),
      ]);
      if (token !== state.token) return;                 // a newer request superseded this one
      state.symbol = q.symbol || sym;
      state.quote  = q;
      localStorage.setItem('qf_symbol', state.symbol);
      $('symbol-input').value = state.symbol;
      renderQuote(q);
      renderBook(q);
      ChartManager.setData(normalize(h.candles));
      setChartMessage('');
      App.subscribe([state.symbol]);
      renderBottom();
    } catch (e) {
      if (token !== state.token) return;
      setChartMessage(`Could not load ${Fmt.esc(sym)}: ${Fmt.esc(e.message)}`, true);
    }
  }

  async function loadHistory() {
    const token = ++state.token;
    try {
      const h = await API.get(`/api/history/${encodeURIComponent(state.symbol)}?interval=${state.interval}&range=${RANGE_FOR[state.interval]}`);
      if (token !== state.token) return;
      ChartManager.setData(normalize(h.candles));
      setChartMessage('');
    } catch (e) {
      setChartMessage(`History unavailable: ${Fmt.esc(e.message)}`, true);
    }
  }

  function setChartMessage(msg, isError) {
    let el = $('chart-msg');
    const host = $('chart-main');
    if (!host) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'chart-msg';
      el.style.cssText = 'position:absolute;top:44px;left:50%;transform:translateX(-50%);z-index:6;font-family:var(--font-mono);font-size:11px;padding:6px 12px;border-radius:3px;background:var(--bg-0);border:1px solid var(--bg-4);pointer-events:none;';
      host.appendChild(el);
    }
    el.style.display = msg ? 'block' : 'none';
    el.style.color   = isError ? 'var(--bear)' : 'var(--t-2)';
    el.innerHTML     = msg;
  }

  /* ══════════════════════════════════════════════════════════════════════
     QUOTE PANEL
     ══════════════════════════════════════════════════════════════════════ */

  function renderQuote(q) {
    const up = (q.change || 0) >= 0;
    $('qp-symbol').textContent = q.symbol;
    $('qp-name').textContent   = `${q.shortName || ''}${q.exchange ? ' · ' + q.exchange : ''}`;
    const priceEl = $('qp-price');
    priceEl.textContent = Fmt.num(q.price, 2);
    priceEl.className   = `qp-price ${q.change == null ? 'neu' : up ? 'up' : 'dn'}`;
    const chEl = $('qp-change');
    chEl.textContent = q.change == null ? '--' : `${up ? '+' : ''}${Fmt.num(q.change)}  (${up ? '+' : ''}${Fmt.num(q.changePct)}%)`;
    chEl.className   = `qp-change ${up ? 'up' : 'dn'}`;

    $('qp-open').textContent   = Fmt.num(q.open);
    $('qp-prev').textContent   = Fmt.num(q.prevClose);
    $('qp-high').textContent   = Fmt.num(q.high);
    $('qp-low').textContent    = Fmt.num(q.low);
    $('qp-vol').textContent    = Fmt.compact(q.volume);
    $('qp-avgvol').textContent = Fmt.compact(q.avgVolume);
    $('qp-mktcap').textContent = Fmt.compact(q.mktCap);
    $('qp-pe').textContent     = q.pe ? Fmt.num(q.pe, 1) : '--';
    $('qp-52h').textContent    = Fmt.num(q.fiftyTwoHigh);
    $('qp-52l').textContent    = Fmt.num(q.fiftyTwoLow);
    $('qp-bid').textContent    = q.bid > 0 ? Fmt.num(q.bid) : '--';
    $('qp-ask').textContent    = q.ask > 0 ? Fmt.num(q.ask) : '--';
  }

  /* ══════════════════════════════════════════════════════════════════════
     DEPTH LADDER  (real top-of-book, MODELED depth)
     ══════════════════════════════════════════════════════════════════════ */

  function hash01(str) {                       // deterministic pseudo-random in [0,1)
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }

  function renderBook(q) {
    const px = q.price;
    if (!(px > 0)) return;
    const haveBA = q.bid > 0 && q.ask > 0 && q.ask > q.bid;
    const tick   = px >= 1 ? 0.01 : 0.0001;
    const bid    = haveBA ? q.bid : px - tick / 2;
    const ask    = haveBA ? q.ask : px + tick / 2;

    const base   = Math.max(100, Math.round((q.avgVolume || 1e6) / 40000 / 100) * 100);
    const LEVELS = 8;
    const bids = [], asks = [];
    let cb = 0, ca = 0;
    for (let i = 0; i < LEVELS; i++) {
      const sb = Math.round(base * (0.5 + hash01(`${q.symbol}b${i}`)) * (1 + i * 0.18) / 100) * 100 || 100;
      const sa = Math.round(base * (0.5 + hash01(`${q.symbol}a${i}`)) * (1 + i * 0.18) / 100) * 100 || 100;
      cb += sb; ca += sa;
      bids.push({ p: +(bid - i * tick).toFixed(4), s: sb, c: cb });
      asks.push({ p: +(ask + i * tick).toFixed(4), s: sa, c: ca });
    }
    const maxC = Math.max(cb, ca);
    const row = (l, side) => `
      <div class="ob-row ${side}">
        <div class="ob-bg" style="width:${(l.c / maxC * 100).toFixed(0)}%"></div>
        <span class="ob-price ${side}">${Fmt.num(l.p, px >= 1 ? 2 : 4)}</span>
        <span class="ob-qty">${Fmt.num(l.s, 0)}</span>
        <span class="ob-total">${Fmt.num(l.c, 0)}</span>
      </div>`;

    $('ob-asks').innerHTML = [...asks].reverse().map(l => row(l, 'ask')).join('');
    $('ob-bids').innerHTML = bids.map(l => row(l, 'bid')).join('');
    const spread = ask - bid;
    $('ob-spread-row').textContent = `SPREAD ${Fmt.num(spread, px >= 1 ? 2 : 4)}  (${Fmt.num(spread / px * 100, 3)}%)`;
    $('ob-spread').textContent = haveBA ? 'L1 LIVE · DEPTH MODELED' : 'NO QUOTE · MODELED';
    $('ob-spread').title = 'Best bid/ask come from the data feed. Deeper levels are synthesized (the free feed has no Level-2 data).';
  }

  /* ══════════════════════════════════════════════════════════════════════
     WATCHLIST
     ══════════════════════════════════════════════════════════════════════ */

  function persistWatchlist() { localStorage.setItem('qf_watchlist', JSON.stringify(state.watchlist)); }

  function renderWatchlist(flash = {}) {
    const el = $('watchlist');
    el.innerHTML = state.watchlist.map(sym => {
      const q  = state.wl[sym];
      const up = (q?.change || 0) >= 0;
      return `
        <div class="wl-row ${sym === state.symbol ? 'selected' : ''}" data-sym="${Fmt.esc(sym)}">
          <div>
            <div class="wl-sym">${Fmt.esc(sym)}</div>
            <div class="wl-name">${Fmt.esc(q?.shortName || '')}</div>
          </div>
          <div style="text-align:right">
            <div class="wl-price ${flash[sym] || ''}">${q ? Fmt.num(q.price) : '--'}</div>
            <div class="wl-chg ${q ? (up ? 'up' : 'dn') : ''}">${q?.changePct != null ? `${up ? '+' : ''}${Fmt.num(q.changePct)}%` : ''}</div>
          </div>
          <span class="wl-del" data-del="${Fmt.esc(sym)}" title="Remove">×</span>
        </div>`;
    }).join('');
  }

  async function refreshWatchlist() {
    try {
      const data = await API.post('/api/quotes', { symbols: state.watchlist });
      for (const [sym, q] of Object.entries(data)) state.wl[sym] = q;
      renderWatchlist();
    } catch { /* transient network error — next tick will retry */ }
  }

  function addToWatchlist(raw) {
    const sym = String(raw || '').toUpperCase().trim();
    if (!sym || !/^[A-Z0-9.\-^=]{1,12}$/.test(sym) || state.watchlist.includes(sym)) return;
    state.watchlist.push(sym);
    persistWatchlist();
    renderWatchlist();            // show the row immediately; price fills in when the quote arrives
    App.subscribe([sym]);
    refreshWatchlist();
  }

  /* ══════════════════════════════════════════════════════════════════════
     LIVE UPDATES (WebSocket → here)
     ══════════════════════════════════════════════════════════════════════ */

  function onQuote(msg) {
    const flash = {};
    if (state.wl[msg.symbol]) {
      const prev = state.wl[msg.symbol].price;
      Object.assign(state.wl[msg.symbol], { price: msg.price, change: msg.change, changePct: msg.changePct, bid: msg.bid, ask: msg.ask, volume: msg.volume });
      if (prev != null && msg.price !== prev) flash[msg.symbol] = msg.price > prev ? 'flash-bull' : 'flash-bear';
      renderWatchlist(flash);
    }
    if (msg.symbol === state.symbol && state.quote) {
      Object.assign(state.quote, { price: msg.price, change: msg.change, changePct: msg.changePct, bid: msg.bid, ask: msg.ask, volume: msg.volume });
      renderQuote(state.quote);
      renderBook(state.quote);
      ChartManager.updateLastCandle(msg.price);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     BOTTOM PANEL
     ══════════════════════════════════════════════════════════════════════ */

  async function renderBottom() {
    const host = $('bottom-content');
    if (!host) return;
    host.innerHTML = `<div class="empty-state">Loading…</div>`;
    const which = state.bottom;
    try {
      if (which === 'fundamentals') {
        const d = await API.get(`/api/fundamentals/${encodeURIComponent(state.symbol)}`);
        if (state.bottom === which) host.innerHTML = fundamentalsHTML(d);
        return;
      }
      const pf = await API.get('/api/paper/portfolio');
      if (state.bottom !== which) return;
      host.innerHTML = which === 'positions' ? positionsHTML(pf) : tradesHTML(pf);
    } catch (e) {
      host.innerHTML = `<div class="empty-state" style="color:var(--bear)">${Fmt.esc(e.message)}</div>`;
    }
  }

  function positionsHTML(pf) {
    const rows = Object.entries(pf.positions);
    if (!rows.length) return `<div class="empty-state">NO OPEN POSITIONS — USE THE PAPER TRADE TAB TO PLACE ORDERS</div>`;
    return `<table class="data-table"><thead><tr>
      <th>Symbol</th><th>Qty</th><th>Avg Cost</th><th>Last</th><th>Mkt Value</th><th>Unrealized P&amp;L</th><th>Return</th>
    </tr></thead><tbody>${rows.map(([s, p]) => `
      <tr style="cursor:pointer" data-sym="${Fmt.esc(s)}">
        <td><b>${Fmt.esc(s)}</b></td><td>${Fmt.num(p.qty, 0)}</td><td>${Fmt.price(p.avgCost)}</td><td>${Fmt.price(p.price)}</td>
        <td>${Fmt.price(p.mktVal)}</td>
        <td class="${p.unrealPnL >= 0 ? 'up' : 'dn'}">${Fmt.signedPrice(p.unrealPnL)}</td>
        <td class="${p.pnLPct >= 0 ? 'up' : 'dn'}">${Fmt.signed(p.pnLPct)}%</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function tradesHTML(pf) {
    if (!pf.trades.length) return `<div class="empty-state">NO TRADES YET</div>`;
    return `<table class="data-table"><thead><tr>
      <th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Total</th><th>Fee</th><th>Realized</th>
    </tr></thead><tbody>${pf.trades.slice(0, 40).map(t => `
      <tr><td class="muted">${new Date(t.ts).toLocaleTimeString()}</td><td><b>${Fmt.esc(t.symbol)}</b></td>
      <td class="${t.side === 'buy' ? 'up' : 'dn'}">${t.side.toUpperCase()}</td><td>${Fmt.num(t.qty, 0)}</td>
      <td>${Fmt.price(t.execPrice)}</td><td>${Fmt.price(t.total)}</td><td class="muted">${Fmt.price(t.commission)}</td>
      <td class="${t.realizedPnL >= 0 ? 'up' : 'dn'}">${t.side === 'sell' ? Fmt.signedPrice(t.realizedPnL) : '--'}</td></tr>`).join('')}</tbody></table>`;
  }

  function fundamentalsHTML(d) {
    const p = d.summaryProfile || {}, f = d.financialData || {}, k = d.defaultKeyStatistics || {};
    const cell = (label, val) => `<div style="padding:8px 14px;border-right:1px solid var(--bg-4);border-bottom:1px solid var(--bg-4)">
      <div class="qp-stat-label">${label}</div><div class="qp-stat-value">${val ?? '--'}</div></div>`;
    const pct = v => v == null ? '--' : `${(v * 100).toFixed(1)}%`;
    const n   = (v, d = 2) => v == null ? '--' : Fmt.num(v, d);
    const grid = [
      cell('Sector', Fmt.esc(p.sector || '--')), cell('Industry', Fmt.esc(p.industry || '--')),
      cell('Employees', p.fullTimeEmployees ? Fmt.compact(p.fullTimeEmployees) : '--'),
      cell('Revenue (TTM)', Fmt.compact(f.totalRevenue)), cell('Revenue Growth', pct(f.revenueGrowth)),
      cell('Gross Margin', pct(f.grossMargins)), cell('Operating Margin', pct(f.operatingMargins)), cell('Net Margin', pct(f.profitMargins)),
      cell('ROE', pct(f.returnOnEquity)), cell('Debt / Equity', n(f.debtToEquity)), cell('Free Cash Flow', Fmt.compact(f.freeCashflow)),
      cell('Beta', n(k.beta)), cell('Forward P/E', n(k.forwardPE, 1)), cell('PEG', n(k.pegRatio)), cell('Price / Book', n(k.priceToBook)),
      cell('Analyst Target', f.targetMeanPrice ? Fmt.price(f.targetMeanPrice) : '--'),
      cell('Consensus', Fmt.esc(f.recommendationKey || '--')),
    ].join('');
    if (!p.sector && !f.totalRevenue && !k.beta) return `<div class="empty-state">NO FUNDAMENTAL DATA FOR THIS INSTRUMENT (ETF / INDEX / CRYPTO)</div>`;
    const summary = p.longBusinessSummary ? `<div style="padding:10px 14px;font-size:11px;color:var(--t-2);line-height:1.6;border-bottom:1px solid var(--bg-4)">${Fmt.esc(p.longBusinessSummary.slice(0, 420))}${p.longBusinessSummary.length > 420 ? '…' : ''}</div>` : '';
    return `${summary}<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${grid}</div>`;
  }

  /* ══════════════════════════════════════════════════════════════════════
     INDICATOR PILLS
     ══════════════════════════════════════════════════════════════════════ */

  function renderPills() {
    $('active-indicators').innerHTML = state.indicators.map(id =>
      `<span class="ind-pill">${IND_LABEL[id] || id}<span class="remove" data-ind="${id}">×</span></span>`).join('');
  }

  function addIndicator(id) {
    if (!id || state.indicators.includes(id)) return;
    state.indicators.push(id);
    PANE_IDS.includes(id) ? ChartManager.addPane(id) : ChartManager.addIndicator(id);
    renderPills();
  }

  function removeIndicator(id) {
    state.indicators = state.indicators.filter(x => x !== id);
    ChartManager.removeIndicator(id);
    renderPills();
  }

  /* ══════════════════════════════════════════════════════════════════════
     SYMBOL SEARCH
     ══════════════════════════════════════════════════════════════════════ */

  let searchTimer = null;
  function bindSearch() {
    const input = $('symbol-input'), dd = $('symbol-dropdown');
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (q.length < 1) { dd.style.display = 'none'; return; }
      searchTimer = setTimeout(async () => {
        try {
          const res = await API.get(`/api/search/${encodeURIComponent(q)}`);
          if (!res.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = res.map(r => `
            <div class="symbol-option" data-sym="${Fmt.esc(r.symbol)}">
              <div><div class="so-sym">${Fmt.esc(r.symbol)}</div><div class="so-name">${Fmt.esc(r.name)}</div></div>
              <div class="so-type">${Fmt.esc(r.type)} ${Fmt.esc(r.exchange)}</div>
            </div>`).join('');
          dd.style.display = 'block';
        } catch { dd.style.display = 'none'; }
      }, 250);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { dd.style.display = 'none'; input.blur(); loadSymbol(input.value); }
      if (e.key === 'Escape') { dd.style.display = 'none'; input.value = state.symbol; }
    });
    input.addEventListener('focus', () => input.select());
    dd.addEventListener('mousedown', e => {
      const opt = e.target.closest('.symbol-option');
      if (opt) { dd.style.display = 'none'; loadSymbol(opt.dataset.sym); }
    });
    input.addEventListener('blur', () => setTimeout(() => { dd.style.display = 'none'; }, 150));
  }

  /* ══════════════════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════════════════ */

  function init() {
    ChartManager.init();
    bindSearch();

    // Timeframe
    $('tf-group').addEventListener('click', e => {
      const b = e.target.closest('.tf-btn'); if (!b) return;
      document.querySelectorAll('#tf-group .tf-btn').forEach(x => x.classList.toggle('active', x === b));
      state.interval = b.dataset.tf;
      loadHistory();
    });

    // Chart type
    document.querySelector('.chart-type-group').addEventListener('click', e => {
      const b = e.target.closest('.ct-btn'); if (!b) return;
      document.querySelectorAll('.ct-btn').forEach(x => x.classList.toggle('active', x === b));
      ChartManager.setChartType(b.dataset.type);
    });

    // Indicators
    $('indicator-select').addEventListener('change', e => { addIndicator(e.target.value); e.target.value = ''; });
    $('active-indicators').addEventListener('click', e => {
      const r = e.target.closest('.remove'); if (r) removeIndicator(r.dataset.ind);
    });

    // Watchlist
    $('wl-add').addEventListener('click', () => { addToWatchlist($('wl-input').value); $('wl-input').value = ''; });
    $('wl-input').addEventListener('keydown', e => { if (e.key === 'Enter') { addToWatchlist(e.target.value); e.target.value = ''; } });
    $('watchlist').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) {
        state.watchlist = state.watchlist.filter(s => s !== del.dataset.del);
        persistWatchlist(); renderWatchlist(); return;
      }
      const row = e.target.closest('.wl-row');
      if (row) loadSymbol(row.dataset.sym);
    });

    // Bottom tabs
    document.querySelector('.bottom-tabs').addEventListener('click', e => {
      const b = e.target.closest('.bot-tab'); if (!b) return;
      document.querySelectorAll('.bot-tab').forEach(x => x.classList.toggle('active', x === b));
      state.bottom = b.dataset.panel === 'orders' ? 'trades' : b.dataset.panel;
      renderBottom();
    });
    $('bottom-content').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-sym]'); if (tr) loadSymbol(tr.dataset.sym);
    });

    $('symbol-input').value = state.symbol;
    renderWatchlist();
    refreshWatchlist();
    setInterval(refreshWatchlist, 20_000);
    setInterval(() => { if (state.bottom !== 'fundamentals' && App.currentPage === 'terminal') renderBottom(); }, 15_000);
    App.subscribe(state.watchlist);
    loadSymbol(state.symbol);
  }

  return { init, loadSymbol, onQuote, refreshBottom: renderBottom, get symbol() { return state.symbol; } };
})();
