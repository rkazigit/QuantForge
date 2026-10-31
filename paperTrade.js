'use strict';
/**
 * paperTrade.js — Paper trading interface
 * =======================================
 * Order ticket + portfolio, backed by the server-side paper engine.
 *
 * Rules (shown to the user in the UI):
 *   - $100,000 starting cash, long-only, no margin, whole shares
 *   - Market orders fill at the current ask/bid with 1 bp slippage
 *   - Limit orders fill only when the market reaches them (regular session)
 *   - Commission 5 bps (min $0.01)
 *   - Fills are simulated against Yahoo quotes that may be delayed
 */

const PaperTrade = (() => {
  let initialized = false;
  let side = 'buy';
  let orderType = 'market';
  let symbol = 'AAPL';
  let quote = null;
  let pf = null;
  let tab = 'positions';
  let eqChart = null, eqSeries = null;
  let refreshTimer = null;

  const $ = id => document.getElementById(id);
  const eqKey = () => `qf_equity_${App.session}`;

  /* ══════════════════════════════════════════════════════════════════════
     LAYOUT
     ══════════════════════════════════════════════════════════════════════ */
  function build() {
    $('paper-sidebar').innerHTML = `
      <div class="section-header"><span class="section-label">ORDER ENTRY</span></div>
      <div class="order-form">
        <div class="form-field">
          <label class="field-label">Symbol</label>
          <div style="display:flex;gap:6px">
            <input id="pt-symbol" class="field-input" value="${Fmt.esc(symbol)}" maxlength="12" style="text-transform:uppercase"/>
            <button class="btn" id="pt-load">Quote</button>
          </div>
          <div id="pt-quote" style="margin-top:8px;font-family:var(--font-mono);font-size:11px;color:var(--t-3)">--</div>
        </div>

        <div class="side-selector">
          <button class="side-btn buy active" id="pt-buy">BUY</button>
          <button class="side-btn sell" id="pt-sell">SELL</button>
        </div>

        <div class="form-field">
          <label class="field-label">Order Type</label>
          <select id="pt-type" class="field-select">
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </div>

        <div class="form-field" id="pt-limit-wrap" style="display:none">
          <label class="field-label">Limit Price</label>
          <input id="pt-limit" type="number" step="0.01" min="0" class="field-input" placeholder="0.00"/>
        </div>

        <div class="form-field">
          <label class="field-label">Quantity (whole shares)</label>
          <div style="display:flex;gap:6px">
            <input id="pt-qty" type="number" step="1" min="1" class="field-input" placeholder="0"/>
            <button class="btn" id="pt-max" title="Maximum affordable (buy) or full position (sell)">MAX</button>
          </div>
        </div>

        <div class="order-preview" id="pt-preview"></div>
        <button class="order-submit buy" id="pt-submit">PLACE BUY ORDER</button>
        <div id="pt-msg" style="min-height:34px;margin-top:8px;font-family:var(--font-mono);font-size:10.5px;line-height:1.5"></div>

        <div class="divider"></div>
        <div style="font-size:10px;color:var(--t-3);line-height:1.7">
          Long-only cash account · whole shares · 5 bps commission<br/>
          Limit orders rest until the market reaches them (regular session).<br/>
          Fills are simulated against feed quotes that may be delayed.
        </div>
      </div>`;

    $('paper-main').innerHTML = `
      <div class="metrics-grid" id="pt-tiles" style="grid-template-columns:repeat(5,1fr)"></div>
      <div style="height:220px;border-bottom:1px solid var(--bg-4);position:relative;background:var(--bg-1)">
        <div class="pane-label" style="top:6px;left:10px">PORTFOLIO EQUITY (this session, sampled while the app is open)</div>
        <div id="pt-eq-chart" style="height:100%"></div>
      </div>
      <div class="bottom-tabs">
        <button class="bot-tab active" data-t="positions">POSITIONS</button>
        <button class="bot-tab" data-t="orders">OPEN ORDERS</button>
        <button class="bot-tab" data-t="history">TRADE HISTORY</button>
        <span style="flex:1"></span>
        <button class="btn danger" id="pt-reset" style="margin-right:8px">Reset account</button>
      </div>
      <div id="pt-table" style="flex:1;overflow:auto"></div>`;

    bind();
    updateSideUI();
    updatePreview();
  }

  function bind() {
    $('pt-buy').onclick  = () => { side = 'buy';  updateSideUI(); };
    $('pt-sell').onclick = () => { side = 'sell'; updateSideUI(); };
    $('pt-type').onchange = e => { orderType = e.target.value; $('pt-limit-wrap').style.display = orderType === 'limit' ? 'block' : 'none'; updatePreview(); };
    $('pt-load').onclick = () => loadQuote($('pt-symbol').value);
    $('pt-symbol').addEventListener('keydown', e => { if (e.key === 'Enter') loadQuote(e.target.value); });
    ['pt-qty', 'pt-limit'].forEach(id => $(id).addEventListener('input', updatePreview));
    $('pt-max').onclick = () => {
      const px = refPrice();
      if (!px) return;
      const max = side === 'buy'
        ? Math.floor((pf?.cash ?? 0) / (px * (1 + 0.0005 + 0.0001)))
        : (pf?.positions?.[symbol]?.qty ?? 0);
      $('pt-qty').value = Math.max(0, max);
      updatePreview();
    };
    $('pt-submit').onclick = submit;
    $('pt-reset').onclick  = resetAccount;
    document.querySelector('#paper-main .bottom-tabs').addEventListener('click', e => {
      const b = e.target.closest('.bot-tab'); if (!b) return;
      document.querySelectorAll('#paper-main .bot-tab').forEach(x => x.classList.toggle('active', x === b));
      tab = b.dataset.t; renderTable();
    });
    $('pt-table').addEventListener('click', async e => {
      const c = e.target.closest('[data-cancel]');
      if (c) { await API.del(`/api/paper/order/${encodeURIComponent(c.dataset.cancel)}`).catch(() => {}); refresh(); return; }
      const s = e.target.closest('[data-close]');
      if (s) { symbol = s.dataset.close; side = 'sell'; $('pt-symbol').value = symbol; $('pt-qty').value = pf.positions[symbol].qty; updateSideUI(); loadQuote(symbol); }
    });
  }

  function updateSideUI() {
    $('pt-buy').classList.toggle('active',  side === 'buy');
    $('pt-sell').classList.toggle('active', side === 'sell');
    const b = $('pt-submit');
    b.className = `order-submit ${side}`;
    b.textContent = `PLACE ${side.toUpperCase()} ORDER`;
    updatePreview();
  }

  /* ══════════════════════════════════════════════════════════════════════
     QUOTE + PREVIEW
     ══════════════════════════════════════════════════════════════════════ */
  async function loadQuote(raw) {
    const sym = String(raw || '').toUpperCase().trim();
    if (!sym) return;
    try {
      quote  = await API.get(`/api/quote/${encodeURIComponent(sym)}`);
      symbol = quote.symbol;
      $('pt-symbol').value = symbol;
      renderQuoteLine();
      App.subscribe([symbol]);
      updatePreview();
    } catch (e) {
      quote = null;
      $('pt-quote').innerHTML = `<span style="color:var(--bear)">${Fmt.esc(e.message)}</span>`;
    }
  }

  function renderQuoteLine() {
    if (!quote) return;
    const up = (quote.change || 0) >= 0;
    $('pt-quote').innerHTML = `
      <span style="color:var(--t-1);font-weight:700">${Fmt.esc(quote.shortName || quote.symbol)}</span><br/>
      LAST <b class="${up ? 'num-up' : 'num-dn'}">${Fmt.num(quote.price)}</b>
      &nbsp;BID <b>${quote.bid > 0 ? Fmt.num(quote.bid) : '--'}</b>
      &nbsp;ASK <b>${quote.ask > 0 ? Fmt.num(quote.ask) : '--'}</b>
      &nbsp;<span class="tag ${quote.marketState === 'REGULAR' ? 'bull' : 'muted'}">${Fmt.esc(quote.marketState || '--')}</span>`;
  }

  function refPrice() {
    if (!quote) return null;
    if (orderType === 'limit') { const l = parseFloat($('pt-limit').value); if (l > 0) return l; }
    return side === 'buy' ? (quote.ask > 0 ? quote.ask : quote.price) : (quote.bid > 0 ? quote.bid : quote.price);
  }

  function updatePreview() {
    const el = $('pt-preview'); if (!el) return;
    const qty = parseInt($('pt-qty')?.value, 10) || 0;
    const px  = refPrice();
    if (!px || !qty) { el.innerHTML = `<div class="op-row"><span class="op-label">Enter a symbol and quantity</span></div>`; return; }
    const notional = px * qty, fee = Math.max(0.01, notional * 0.0005);
    const cashAfter = (pf?.cash ?? 0) + (side === 'buy' ? -(notional + fee) : notional - fee);
    el.innerHTML = `
      <div class="op-row"><span class="op-label">Est. price</span><span class="op-value">${Fmt.price(px)}</span></div>
      <div class="op-row"><span class="op-label">Notional</span><span class="op-value">${Fmt.price(notional)}</span></div>
      <div class="op-row"><span class="op-label">Commission</span><span class="op-value">${Fmt.price(fee)}</span></div>
      <div class="op-row"><span class="op-label">Cash after</span><span class="op-value" style="color:${cashAfter < 0 ? 'var(--bear)' : 'var(--t-1)'}">${Fmt.price(cashAfter)}</span></div>`;
  }

  /* ══════════════════════════════════════════════════════════════════════
     ORDERS
     ══════════════════════════════════════════════════════════════════════ */
  async function submit() {
    const msg = $('pt-msg'), btn = $('pt-submit');
    const qty = parseInt($('pt-qty').value, 10);
    const limitPrice = parseFloat($('pt-limit').value);
    if (!symbol || !qty || qty < 1) { msg.innerHTML = `<span style="color:var(--bear)">Enter a valid whole-share quantity.</span>`; return; }
    if (orderType === 'limit' && !(limitPrice > 0)) { msg.innerHTML = `<span style="color:var(--bear)">Enter a limit price.</span>`; return; }

    btn.disabled = true;
    try {
      const r = await API.post('/api/paper/order', { symbol, side, qty, orderType, limitPrice: orderType === 'limit' ? limitPrice : undefined });
      if (r.status === 'filled') {
        const t = r.trade;
        msg.innerHTML = `<span style="color:var(--bull)">FILLED ${t.side.toUpperCase()} ${Fmt.num(t.qty, 0)} ${Fmt.esc(t.symbol)} @ ${Fmt.price(t.execPrice)}</span>`;
      } else {
        msg.innerHTML = `<span style="color:var(--warn)">LIMIT ORDER WORKING — fills when the market reaches ${Fmt.price(r.order.limitPrice)}</span>`;
      }
      $('pt-qty').value = '';
      await refresh();
    } catch (e) {
      msg.innerHTML = `<span style="color:var(--bear)">${Fmt.esc(e.message)}</span>`;
    } finally {
      btn.disabled = false;
      updatePreview();
    }
  }

  async function resetAccount() {
    if (!confirm('Reset your paper account to $100,000? All positions and history will be cleared.')) return;
    await API.del('/api/paper/portfolio');
    localStorage.removeItem(eqKey());
    await refresh();
    drawEquity();
  }

  /* ══════════════════════════════════════════════════════════════════════
     PORTFOLIO RENDERING
     ══════════════════════════════════════════════════════════════════════ */
  async function refresh() {
    try {
      pf = await API.get('/api/paper/portfolio');
      recordEquity(pf.totalEquity);
      renderTiles();
      renderTable();
      drawEquity();
      updatePreview();
    } catch { /* keep last good state */ }
  }

  function renderTiles() {
    const tile = (k, v, sub, cls = '') => `<div class="metric-cell"><div class="mc-key">${k}</div><div class="mc-val ${cls}">${v}</div><div class="mc-sub">${sub}</div></div>`;
    const up = pf.totalPnL >= 0;
    $('pt-tiles').innerHTML =
      tile('Total Equity', Fmt.price(pf.totalEquity), `Start ${Fmt.price(pf.startCash)}`) +
      tile('Total P&L', Fmt.signedPrice(pf.totalPnL), `${Fmt.signed(pf.totalPnLPct)}%`, up ? 'pos' : 'neg') +
      tile('Cash', Fmt.price(pf.cash), `${Fmt.num(pf.cash / pf.totalEquity * 100, 1)}% of equity`) +
      tile('Positions', Fmt.price(pf.marketValue), `Unrealized ${Fmt.signedPrice(pf.unrealizedPnL)}`, pf.unrealizedPnL >= 0 ? '' : '') +
      tile('Realized P&L', Fmt.signedPrice(pf.realizedPnL), `${pf.trades.length} fills`, pf.realizedPnL >= 0 ? 'pos' : 'neg');
  }

  function renderTable() {
    const el = $('pt-table'); if (!el || !pf) return;
    if (tab === 'positions') {
      const rows = Object.entries(pf.positions);
      el.innerHTML = rows.length ? `<table class="data-table"><thead><tr>
        <th>Symbol</th><th>Qty</th><th>Avg Cost</th><th>Last</th><th>Mkt Value</th><th>Unrealized</th><th>Return</th><th>Weight</th><th></th></tr></thead><tbody>
        ${rows.map(([s, p]) => `<tr><td><b>${Fmt.esc(s)}</b></td><td>${Fmt.num(p.qty, 0)}</td><td>${Fmt.price(p.avgCost)}</td><td>${Fmt.price(p.price)}</td>
          <td>${Fmt.price(p.mktVal)}</td><td class="${p.unrealPnL >= 0 ? 'up' : 'dn'}">${Fmt.signedPrice(p.unrealPnL)}</td>
          <td class="${p.pnLPct >= 0 ? 'up' : 'dn'}">${Fmt.signed(p.pnLPct)}%</td><td class="muted">${Fmt.num(p.mktVal / pf.totalEquity * 100, 1)}%</td>
          <td><button class="btn" data-close="${Fmt.esc(s)}">Close</button></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state">NO OPEN POSITIONS</div>`;
    } else if (tab === 'orders') {
      const open = pf.orders.filter(o => o.status === 'open');
      const recent = pf.orders.filter(o => o.status !== 'open').slice(0, 10);
      const all = [...open, ...recent];
      el.innerHTML = all.length ? `<table class="data-table"><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Limit</th><th>Status</th><th></th></tr></thead><tbody>
        ${all.map(o => `<tr><td class="muted">${new Date(o.ts).toLocaleTimeString()}</td><td><b>${Fmt.esc(o.symbol)}</b></td>
          <td class="${o.side === 'buy' ? 'up' : 'dn'}">${o.side.toUpperCase()}</td><td>${Fmt.num(o.qty, 0)}</td><td>${Fmt.price(o.limitPrice)}</td>
          <td><span class="tag ${o.status === 'open' ? 'accent' : o.status === 'filled' ? 'bull' : 'muted'}">${o.status.toUpperCase()}</span>${o.reason ? ` <span class="muted">${Fmt.esc(o.reason)}</span>` : ''}</td>
          <td>${o.status === 'open' ? `<button class="btn" data-cancel="${Fmt.esc(o.id)}">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state">NO ORDERS</div>`;
    } else {
      el.innerHTML = pf.trades.length ? `<table class="data-table"><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Total</th><th>Fee</th><th>Realized</th><th>Type</th></tr></thead><tbody>
        ${pf.trades.map(t => `<tr><td class="muted">${new Date(t.ts).toLocaleString()}</td><td><b>${Fmt.esc(t.symbol)}</b></td>
          <td class="${t.side === 'buy' ? 'up' : 'dn'}">${t.side.toUpperCase()}</td><td>${Fmt.num(t.qty, 0)}</td><td>${Fmt.price(t.execPrice)}</td>
          <td>${Fmt.price(t.total)}</td><td class="muted">${Fmt.price(t.commission)}</td>
          <td class="${t.realizedPnL >= 0 ? 'up' : 'dn'}">${t.side === 'sell' ? Fmt.signedPrice(t.realizedPnL) : '--'}</td><td class="muted">${Fmt.esc(t.orderType)}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state">NO TRADES YET</div>`;
    }
  }

  /* ── equity curve (client-sampled) ─────────────────────────────────── */
  function recordEquity(v) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(eqKey()) || '[]'); } catch {}
    const t = Math.floor(Date.now() / 1000);
    if (arr.length && t <= arr[arr.length - 1].t) return;
    if (arr.length && t - arr[arr.length - 1].t < 20 && Math.abs(arr[arr.length - 1].v - v) < 0.01) return;
    arr.push({ t, v: +v.toFixed(2) });
    if (arr.length > 3000) arr = arr.slice(-3000);
    localStorage.setItem(eqKey(), JSON.stringify(arr));
  }

  function drawEquity() {
    const host = $('pt-eq-chart'); if (!host || typeof LightweightCharts === 'undefined') return;
    if (!eqChart) {
      eqChart = LightweightCharts.createChart(host, {
        layout: { background: { type: 'solid', color: '#131722' }, textColor: '#787b86', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
        grid: { vertLines: { color: '#2a2e3d' }, horzLines: { color: '#2a2e3d' } },
        rightPriceScale: { borderColor: '#363a4a' }, timeScale: { borderColor: '#363a4a', timeVisible: true, secondsVisible: false },
        width: host.clientWidth, height: host.clientHeight || 220,
      });
      eqSeries = eqChart.addAreaSeries({ lineColor: '#26a69a', topColor: 'rgba(38,166,154,0.25)', bottomColor: 'rgba(38,166,154,0.02)', lineWidth: 2 });
      new ResizeObserver(() => eqChart.resize(host.clientWidth, host.clientHeight || 220)).observe(host);
    }
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(eqKey()) || '[]'); } catch {}
    if (arr.length === 1) arr = [{ t: arr[0].t - 60, v: arr[0].v }, arr[0]];
    eqSeries.setData(arr.map(p => ({ time: p.t, value: p.v })));
    eqChart.timeScale().fitContent();
  }

  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC
     ══════════════════════════════════════════════════════════════════════ */
  return {
    init() {
      if (!initialized) {
        symbol = Terminal.symbol || symbol;
        build();
        initialized = true;
        loadQuote(symbol);
      }
      refresh();
      clearInterval(refreshTimer);
      refreshTimer = setInterval(() => { if (App.currentPage === 'paper') refresh(); }, 10_000);
    },
    onQuote(msg) {
      if (!initialized || !quote || msg.symbol !== symbol) return;
      Object.assign(quote, { price: msg.price, change: msg.change, bid: msg.bid, ask: msg.ask, marketState: msg.marketState || quote.marketState });
      renderQuoteLine();
      updatePreview();
    },
  };
})();
