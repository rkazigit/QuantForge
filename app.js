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
    // Build the request OUTSIDE the try block: a bug here must surface as a bug, not as a fake "network error".
    const init = {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Session': App.session },
      body: body ? JSON.stringify(body) : undefined,
    };
    let res;
    try { res = await fetch(url, init); }
    catch { throw new Error('Cannot reach the server (network error)'); }

    const isJSON = (res.headers.get('content-type') || '').includes('application/json');
    if (!isJSON) {
      // Static hosts (Cloudflare Pages, GitHub Pages) answer unknown URLs with index.html + HTTP 200.
      throw new Error(res.ok
        ? 'The server sent back a web page instead of data. This host serves static files only, so there is no backend.'
        : `${res.status} ${res.statusText}`);
    }
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

  /* ── Live feed: WebSocket first, HTTP polling as automatic fallback ──── */
  let wsFailures = 0, pollTimer = null;

  function connectWS() {
    clearTimeout(retryTimer);
    if (!('WebSocket' in window) || wsFailures >= 3) { startPolling(); return; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let opened = false;
    // dedicated /ws path: static hosts and Workers refuse it instantly instead of serving index.html
    try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch { wsFailures = 3; startPolling(); return; }
    const giveUp = setTimeout(() => { if (!opened) startPolling(); }, 4000);   // keep data flowing while we wait

    ws.onopen = () => {
      opened = true; clearTimeout(giveUp); wsOpen = true; retry = 0; wsFailures = 0;
      stopPolling();
      setWS('live', 'LIVE FEED');
      sendSubscribe([...subs]);
    };
    ws.onmessage = ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'quote') dispatchQuote(msg);
    };
    ws.onclose = () => {
      clearTimeout(giveUp); wsOpen = false;
      if (!opened) wsFailures++;
      startPolling();
      if (wsFailures < 3) scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function scheduleReconnect() {
    retry++;
    retryTimer = setTimeout(connectWS, Math.min(1000 * 2 ** Math.min(retry, 5), 30_000));
  }

  function startPolling() {
    if (pollTimer) return;
    setWS('pre', 'POLLING 6s');
    pollOnce();
    pollTimer = setInterval(pollOnce, 6000);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  async function pollOnce() {
    if (document.hidden) return;                                   // no polling in background tabs
    const symbols = [...new Set([...MARKET_BAR, ...[...subs].slice(-33)])];
    try {
      const data = await API.post('/api/quotes', { symbols });
      for (const q of Object.values(data))
        dispatchQuote({ type: 'quote', symbol: q.symbol, price: q.price, change: q.change, changePct: q.changePct,
                        bid: q.bid, ask: q.ask, volume: q.volume, marketState: q.marketState });
      setWS('pre', 'POLLING 6s');
    } catch { setWS('error', 'DATA ERROR'); }
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
    window.__qfBooted = true;                    // tells the startup watchdog in index.html we are alive
    try {
      progress(10, 'Checking files…');
      if (typeof LightweightCharts === 'undefined')
        throw new Error('The chart library did not load (/vendor/lightweight-charts.standalone.production.js is missing).');
      progress(20, 'Checking backend…');
      const health = await API.get('/api/health');
      if (!health || health.status !== 'ok') throw new Error('Unexpected reply from /api/health.');
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
      const el = $('load-status');
      $('load-bar').style.width = '100%'; $('load-bar').style.background = 'var(--bear)';
      el.style.cssText = 'color:var(--bear);max-width:560px;text-align:center;line-height:1.7;font-size:12px';
      el.innerHTML = `<b>QuantForge could not start.</b><br/>${Fmt.esc(e.message)}<br/><br/>` +
        'Hosting on Cloudflare Pages or GitHub Pages? Those serve static files only. Deploy the Cloudflare Worker included in this repo ' +
        '(README &rarr; "Deploy on Cloudflare"), or run <code>npm start</code> to use the Node server.';
    }
  }

  // If the page has already finished parsing (a host that defers scripts, e.g. Cloudflare Rocket Loader),
  // run on the next tick — NOT synchronously: `App` is still being initialised right here, so boot() would
  // hit it in its temporal dead zone.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);

  return { session, subscribe, showPage, get currentPage() { return currentPage; } };
})();
