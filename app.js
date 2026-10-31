'use strict';
/**
 * app.js — Application bootstrap
 * Shared formatting helpers, API client, WebSocket feed, navigation, header market bar.
 */

/* ══════════════════════════════════════════════════════════════════════════
   FORMATTERS  (Fmt.esc MUST wrap every string that came from an API before it
   goes into innerHTML — symbol names and descriptions are third-party data.)
   ══════════════════════════════════════════════════════════════════════════ */
const Fmt = {
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  num: (n, d = 2) => (n == null || !Number.isFinite(+n)) ? '--'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
  price: n => (n == null || !Number.isFinite(+n)) ? '--' : '$' + Fmt.num(n, 2),
  signed: (n, d = 2) => (n == null || !Number.isFinite(+n)) ? '--' : (n >= 0 ? '+' : '') + Fmt.num(n, d),
  signedPrice: n => (n == null || !Number.isFinite(+n)) ? '--' : (n >= 0 ? '+' : '−') + '$' + Fmt.num(Math.abs(n), 2),
  compact: n => {
    if (n == null || !Number.isFinite(+n)) return '--';
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3)  return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   API CLIENT
   ══════════════════════════════════════════════════════════════════════════ */
function makeSessionId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const API = {
  async _req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Session': App.session },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
    return data;
  },
  get:  url        => API._req('GET', url),
  post: (url, b)   => API._req('POST', url, b),
  del:  url        => API._req('DELETE', url),
};

/* ══════════════════════════════════════════════════════════════════════════
   APP
   ══════════════════════════════════════════════════════════════════════════ */
const App = (() => {
  const MARKET_BAR = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX', 'GLD', 'BTC-USD'];
  const BAR_LABEL  = { '^VIX': 'VIX', 'BTC-USD': 'BTC' };

  let session = localStorage.getItem('qf_session');
  if (!session) { session = makeSessionId(); localStorage.setItem('qf_session', session); }

  let ws = null, wsOpen = false, retry = 0, retryTimer = null;
  const subs = new Set();
  const barQuotes = {};
  let currentPage = 'terminal';

  const $ = id => document.getElementById(id);

  /* ── WebSocket ─────────────────────────────────────────────────────── */
  function connectWS() {
    clearTimeout(retryTimer);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { ws = new WebSocket(`${proto}://${location.host}`); } catch { scheduleReconnect(); return; }

    ws.onopen = () => {
      wsOpen = true; retry = 0;
      setWS('live', 'LIVE FEED');
      sendSubscribe([...subs]);
    };
    ws.onmessage = ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'quote') dispatchQuote(msg);
    };
    ws.onclose = () => { wsOpen = false; setWS('error', 'RECONNECTING'); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function scheduleReconnect() {
    retry++;
    retryTimer = setTimeout(connectWS, Math.min(1000 * 2 ** Math.min(retry, 5), 30_000));
  }

  function sendSubscribe(symbols) {
    if (!wsOpen || !symbols.length) return;
    for (let i = 0; i < symbols.length; i += 20)
      ws.send(JSON.stringify({ action: 'subscribe', symbols: symbols.slice(i, i + 20) }));
  }

  function subscribe(symbols) {
    const fresh = symbols.map(s => String(s).toUpperCase()).filter(s => !subs.has(s));
    fresh.forEach(s => subs.add(s));
    sendSubscribe(fresh);
  }

  function setWS(cls, label) {
    const dot = $('ws-dot'), lab = $('ws-label');
    dot.className = `status-dot ${cls}`;
    lab.textContent = label;
    lab.title = 'Quotes are polled from Yahoo Finance every few seconds and may be delayed up to ~15 minutes depending on the exchange.';
  }

  /* ── Quote fan-out ─────────────────────────────────────────────────── */
  function dispatchQuote(msg) {
    if (MARKET_BAR.includes(msg.symbol)) { Object.assign(barQuotes[msg.symbol] ||= {}, msg); renderBar(); }
    if (msg.symbol === 'SPY' && msg.marketState) setMarketState(msg.marketState);
    Terminal.onQuote(msg);
    PaperTrade.onQuote(msg);
  }

  /* ── Header market bar + status ────────────────────────────────────── */
  function renderBar() {
    $('market-bar').innerHTML = MARKET_BAR.map(sym => {
      const q = barQuotes[sym];
      if (!q || q.price == null) return `<div class="mbar-item" data-sym="${Fmt.esc(sym)}"><span class="mbar-sym">${BAR_LABEL[sym] || sym}</span><span class="mbar-price">--</span></div>`;
      const up = (q.changePct || 0) >= 0;
      return `<div class="mbar-item" data-sym="${Fmt.esc(sym)}">
        <span class="mbar-sym">${BAR_LABEL[sym] || sym}</span>
        <span class="mbar-price">${Fmt.num(q.price)}</span>
        <span class="mbar-chg ${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Fmt.num(Math.abs(q.changePct || 0))}%</span>
      </div>`;
    }).join('');
  }

  function setMarketState(state) {
    const map = {
      REGULAR:  ['live',   'MARKET OPEN'],
      PRE:      ['pre',    'PRE-MARKET'],
      PREPRE:   ['closed', 'MARKET CLOSED'],
      POST:     ['pre',    'AFTER HOURS'],
      POSTPOST: ['closed', 'MARKET CLOSED'],
      CLOSED:   ['closed', 'MARKET CLOSED'],
    };
    const [cls, label] = map[state] || ['closed', String(state).toUpperCase()];
    $('market-dot').className = `status-dot ${cls}`;
    $('market-label').textContent = label;
  }

  async function loadBar() {
    try {
      const data = await API.post('/api/quotes', { symbols: MARKET_BAR });
      Object.assign(barQuotes, data);
      renderBar();
      if (data.SPY?.marketState) setMarketState(data.SPY.marketState);
    } catch { renderBar(); }
  }

  function tickClock() {
    $('clock').textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) + ' ET';
  }

  /* ── Navigation ────────────────────────────────────────────────────── */
  function showPage(id) {
    currentPage = id;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.page === id));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${id}`));
    if (id === 'paper')     PaperTrade.init();
    if (id === 'options')   OptionsModule.init();
    if (id === 'backtest')  BacktestModule.init();
    if (id === 'quant-lab') QuantLab.init();
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */
  function progress(pct, text) {
    $('load-bar').style.width = pct + '%';
    $('load-status').textContent = text;
  }

  async function boot() {
    try {
      progress(15, 'Checking backend…');
      await API.get('/api/health');
      progress(40, 'Connecting market data…');

      $('app').style.display = 'flex';          // chart needs real dimensions to initialize
      document.querySelector('.nav-tabs').addEventListener('click', e => {
        const t = e.target.closest('.nav-tab'); if (t) showPage(t.dataset.page);
      });
      $('market-bar').addEventListener('click', e => {
        const it = e.target.closest('.mbar-item'); if (!it) return;
        showPage('terminal'); Terminal.loadSymbol(it.dataset.sym);
      });

      subscribe(MARKET_BAR);
      renderBar();
      tickClock(); setInterval(tickClock, 1000);

      progress(65, 'Initializing terminal…');
      Terminal.init();
      connectWS();
      loadBar();
      setInterval(loadBar, 30_000);

      progress(100, 'Ready');
      setTimeout(() => { $('loading').style.display = 'none'; }, 250);
    } catch (e) {
      progress(100, `Backend unreachable: ${e.message}. Start the server with "npm start".`);
      $('load-status').style.color = 'var(--bear)';
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { session, subscribe, showPage, get currentPage() { return currentPage; } };
})();
