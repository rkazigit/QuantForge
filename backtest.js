'use strict';
/**
 * backtest.js — Event-Driven Backtesting Engine + UI
 * ====================================================
 * Metrics: Total Return, CAGR, Sharpe, Sortino, Calmar,
 *          Max Drawdown, Win Rate, Profit Factor, Avg Win/Loss,
 *          Avg Hold Days, Total Trades, Expectancy
 */

/* ══════════════════════════════════════════════════════════════════════════
   BACKTESTING ENGINE
   ══════════════════════════════════════════════════════════════════════════ */

const BacktestEngine = (() => {

  /**
   * Run a backtest given OHLCV data and pre-computed signals.
   *
   * @param {object} data        - { timestamps, opens, highs, lows, closes, volumes }
   * @param {Array}  signals     - Output from a Strategies.run() call
   * @param {object} config      - { initialCapital, commission, slippage, positionSizePct }
   */
  function run(data, signals, config = {}) {
    const {
      initialCapital   = 100_000,
      commission       = 0.001,   // 0.1% per trade (realistic for retail)
      slippage         = 0.0005,  // 0.05% slippage
      positionSizePct  = 0.95,    // deploy 95% of available capital
      rfRate           = 0.05,    // risk-free rate for Sharpe
    } = config;

    const { timestamps, opens, closes } = data;
    const n = closes.length;

    // A signal is computed from the CLOSE of bar `index`, so it can only be acted on at the
    // OPEN of the next bar. Keying by index+1 removes same-bar look-ahead bias.
    const sigMap = new Map();
    signals.forEach(s => sigMap.set(s.index + 1, s));

    let cash        = initialCapital;
    let shares      = 0;
    let position    = 0;   // 1=long, -1=short, 0=flat
    let entryPrice  = 0;
    let entryIndex  = 0;
    let entryTime   = 0;
    let shortValue  = 0;   // cash received from short sale

    const equity     = new Float64Array(n).fill(initialCapital);
    const trades     = [];

    for (let i = 0; i < n; i++) {
      const px  = (opens && Number.isFinite(opens[i])) ? opens[i] : closes[i];   // execution price
      const sig = sigMap.get(i);

      if (sig) {
        const action = sig.action;

        /* ── Close existing position ───────────────────────────────────── */
        if (position !== 0 && (action === 'close' || (action === 'buy' && position === -1) || (action === 'sell' && position === 1))) {
          let execPx, proceeds, cost, pnl;

          if (position === 1) {    // close long
            execPx   = px * (1 - slippage);
            proceeds = shares * execPx;
            cost     = proceeds * commission;
            pnl      = (execPx - entryPrice) * shares - cost - (shares * entryPrice * commission);
            cash     = cash + proceeds - cost;
          } else {                  // close short
            execPx   = px * (1 + slippage);
            const buyback = shares * execPx;
            cost     = buyback * commission;
            pnl      = shortValue - buyback - cost;
            cash     = cash + shortValue - buyback - cost;
          }

          const holdDays = timestamps[i] && entryTime
            ? Math.round((timestamps[i] - entryTime) / 86400)
            : i - entryIndex;

          trades.push({
            entryIndex, exitIndex: i,
            entryTime, exitTime: timestamps[i],
            side:       position === 1 ? 'long' : 'short',
            entryPrice, exitPrice: execPx,
            shares,
            pnl,
            pnlPct:     (pnl / (entryPrice * shares)) * 100,
            holdDays,
            commission: cost,
            reason:     sig.reason || '',
          });

          position = 0;
          shares   = 0;
        }

        /* ── Open new position ─────────────────────────────────────────── */
        if ((action === 'buy' || action === 'sell') && position === 0) {
          const isBuy   = action === 'buy';
          const execPx  = isBuy ? px * (1 + slippage) : px * (1 - slippage);
          const notional = cash * positionSizePct;
          shares         = Math.floor(notional / execPx);

          if (shares > 0) {
            const cost    = shares * execPx;
            const commFee = cost * commission;

            if (isBuy) {
              cash     -= (cost + commFee);
              position  = 1;
            } else {
              shortValue = cost - commFee;   // proceeds from short
              cash      -= commFee;
              position   = -1;
            }

            entryPrice = execPx;
            entryIndex = i;
            entryTime  = timestamps[i];
          }
        }
      }

      /* ── Mark-to-market ──────────────────────────────────────────────── */
      if (position === 1)  equity[i] = cash + shares * closes[i];
      else if (position === -1) equity[i] = cash + shortValue - shares * closes[i];
      else                equity[i] = cash;
    }

    /* ── Force-close any open position at the end ─────────────────────── */
    if (position !== 0) {
      const px     = closes[n - 1];
      const execPx = position === 1 ? px * (1 - slippage) : px * (1 + slippage);
      let   pnl;
      if (position === 1) {
        pnl  = (execPx - entryPrice) * shares - shares * execPx * commission;
        cash = cash + shares * execPx * (1 - commission);
      } else {
        const buyback = shares * execPx;
        pnl  = shortValue - buyback * (1 + commission);
        cash = cash + shortValue - buyback * (1 + commission);
      }
      trades.push({
        entryIndex, exitIndex: n - 1,
        entryTime,  exitTime: timestamps[n - 1],
        side:       position === 1 ? 'long' : 'short',
        entryPrice, exitPrice: execPx,
        shares, pnl, pnlPct: (pnl / (entryPrice * shares)) * 100,
        holdDays: n - 1 - entryIndex, commission: 0,
        reason: 'End of data — forced close',
      });
      equity[n - 1] = cash;
    }

    const metrics = computeMetrics(equity, trades, initialCapital, rfRate, timestamps);
    return { equity, trades, metrics, initialCapital };
  }

  /* ── Metrics ─────────────────────────────────────────────────────────── */
  function computeMetrics(equity, trades, initialCapital, rfRate, timestamps) {
    const n       = equity.length;
    const final   = equity[n - 1];
    const totalRet = (final / initialCapital - 1) * 100;

    // CAGR
    const days  = timestamps && timestamps[n-1] && timestamps[0]
      ? (timestamps[n-1] - timestamps[0]) / 86400
      : n;
    const years = days / 365.25;
    const cagr  = years > 0 ? ((final / initialCapital) ** (1 / years) - 1) * 100 : 0;

    // Daily returns
    const rets = [];
    for (let i = 1; i < n; i++) rets.push(equity[i] / equity[i-1] - 1);

    const meanRet   = rets.reduce((a, b) => a + b, 0) / rets.length;
    const rfDaily   = rfRate / 252;
    const excess    = rets.map(r => r - rfDaily);
    const exMean    = excess.reduce((a, b) => a + b, 0) / excess.length;
    const exStd     = Math.sqrt(excess.reduce((s, r) => s + (r - exMean) ** 2, 0) / excess.length);
    const sharpe    = exStd > 0 ? (exMean / exStd) * Math.sqrt(252) : 0;

    const downRets  = rets.filter(r => r < rfDaily);
    const downStd   = downRets.length > 0
      ? Math.sqrt(downRets.reduce((s, r) => s + (r - rfDaily) ** 2, 0) / downRets.length)
      : 0;
    const sortino   = downStd > 0 ? (exMean / downStd) * Math.sqrt(252) : 0;

    // Max Drawdown
    let peak = equity[0], maxDD = 0, ddStart = 0, ddEnd = 0, tempStart = 0;
    for (let i = 1; i < n; i++) {
      if (equity[i] > peak) { peak = equity[i]; tempStart = i; }
      const dd = (peak - equity[i]) / peak;
      if (dd > maxDD) { maxDD = dd; ddStart = tempStart; ddEnd = i; }
    }
    const maxDDPct  = maxDD * 100;
    const calmar    = maxDDPct !== 0 ? cagr / maxDDPct : 0;

    // Trade metrics
    const wins      = trades.filter(t => t.pnl > 0);
    const losses    = trades.filter(t => t.pnl <= 0);
    const winRate   = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const avgWin    = wins.length > 0   ? wins  .reduce((s, t) => s + t.pnl, 0) / wins.length   : 0;
    const avgLoss   = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? Infinity : 0;
    const expectancy   = trades.length > 0 ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;
    const avgHoldDays  = trades.length > 0 ? trades.reduce((s, t) => s + (t.holdDays || 0), 0) / trades.length : 0;
    const totalCommission = trades.reduce((s, t) => s + (t.commission || 0), 0);
    const annualVol    = Math.sqrt(252) * exStd * 100;

    return {
      totalReturn:    +totalRet.toFixed(2),
      cagr:           +cagr.toFixed(2),
      sharpe:         +sharpe.toFixed(3),
      sortino:        +sortino.toFixed(3),
      calmar:         +calmar.toFixed(3),
      maxDrawdown:    +maxDDPct.toFixed(2),
      annualVol:      +annualVol.toFixed(2),
      winRate:        +winRate.toFixed(1),
      profitFactor:   +profitFactor.toFixed(3),
      expectancy:     +expectancy.toFixed(2),
      avgWin:         +avgWin.toFixed(2),
      avgLoss:        +avgLoss.toFixed(2),
      avgHoldDays:    +avgHoldDays.toFixed(1),
      totalTrades:    trades.length,
      totalCommission: +totalCommission.toFixed(2),
      finalEquity:    +final.toFixed(2),
    };
  }

  return { run, computeMetrics };
})();

/* ══════════════════════════════════════════════════════════════════════════
   BACKTEST PAGE UI
   ══════════════════════════════════════════════════════════════════════════ */

const BacktestModule = (() => {
  let initialized = false;
  let btChart     = null;
  let btResult    = null;

  function buildControls() {
    const el = document.getElementById('bt-controls');
    el.innerHTML = `
      <div class="section-header"><span class="section-label">BACKTEST CONFIGURATION</span></div>
      <div style="padding:12px 14px;">

        <div class="form-field">
          <label class="field-label">SYMBOL</label>
          <input type="text" id="bt-symbol" class="field-input" value="SPY" style="text-transform:uppercase;"/>
        </div>

        <div class="form-field">
          <label class="field-label">STRATEGY</label>
          <select id="bt-strategy" class="field-select">
            ${Strategies.REGISTRY.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
          </select>
        </div>

        <div class="form-field">
          <label class="field-label">TIMEFRAME</label>
          <select id="bt-interval" class="field-select">
            <option value="1d" selected>Daily</option>
            <option value="1wk">Weekly</option>
            <option value="1h">Hourly</option>
          </select>
        </div>

        <div class="form-field">
          <label class="field-label">LOOKBACK</label>
          <select id="bt-range" class="field-select">
            <option value="1y" selected>1 Year</option>
            <option value="2y">2 Years</option>
            <option value="5y">5 Years</option>
            <option value="6mo">6 Months</option>
          </select>
        </div>

        <div class="divider"></div>
        <div class="section-label" style="margin-bottom:10px;">EXECUTION</div>

        <div class="form-field">
          <label class="field-label">INITIAL CAPITAL ($)</label>
          <input type="number" id="bt-capital" class="field-input" value="100000" min="1000"/>
        </div>

        <div class="form-field">
          <label class="field-label">COMMISSION (%)</label>
          <input type="number" id="bt-commission" class="field-input" value="0.1" min="0" max="2" step="0.01"/>
        </div>

        <div class="form-field">
          <label class="field-label">SLIPPAGE (%)</label>
          <input type="number" id="bt-slippage" class="field-input" value="0.05" min="0" max="1" step="0.01"/>
        </div>

        <div class="form-field">
          <label class="field-label">POSITION SIZE (%)</label>
          <input type="number" id="bt-pos-size" class="field-input" value="95" min="1" max="100"/>
        </div>

        <div class="divider"></div>
        <div id="bt-params"></div>

        <button class="run-btn" id="bt-run">RUN BACKTEST</button>
        <div style="font-size:9.5px;color:var(--t-3);margin-top:10px;line-height:1.6">
          Signals are generated at a bar's close and filled at the <b>next bar's open</b> (no same-bar look-ahead).
          One position at a time; no borrow cost or market impact. Educational tool — not evidence of profitability.
        </div>
        <div id="bt-status" style="font-size:10px;color:var(--t-3);margin-top:6px;min-height:16px;"></div>
      </div>
    `;

    document.getElementById('bt-strategy').addEventListener('change', buildParamInputs);
    document.getElementById('bt-run').addEventListener('click', runBacktest);
    buildParamInputs();
  }

  function buildParamInputs() {
    const stratId = document.getElementById('bt-strategy').value;
    const entry   = Strategies.REGISTRY.find(s => s.id === stratId);
    const el      = document.getElementById('bt-params');
    if (!entry || !el) return;

    el.innerHTML = `<div class="section-label" style="margin-bottom:8px;">STRATEGY PARAMETERS</div>` +
      entry.params.map(p => `
        <div class="slider-group">
          <div class="slider-header">
            <span class="slider-label">${p.label}</span>
            <span class="slider-value" id="btp-disp-${p.key}">${p.def}</span>
          </div>
          <input type="range" id="btp-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}"
            oninput="document.getElementById('btp-disp-${p.key}').textContent=parseFloat(this.value).toFixed(this.step<1?2:0)"/>
        </div>
      `).join('');
  }

  function buildMain() {
    const el = document.getElementById('bt-main');
    el.innerHTML = `
      <div class="metrics-grid" id="bt-metrics">
        ${['Total Return','CAGR','Sharpe','Max Drawdown'].map(m =>
          `<div class="metric-cell"><div class="mc-key">${m}</div><div class="mc-val" id="bm-${m.replace(/\s/g,'')}">--</div><div class="mc-sub">--</div></div>`
        ).join('')}
      </div>
      <div class="metrics-grid" id="bt-metrics2" style="border-bottom:1px solid var(--bg-4);">
        ${['Sortino','Win Rate','Profit Factor','Trades'].map(m =>
          `<div class="metric-cell"><div class="mc-key">${m}</div><div class="mc-val" id="bm2-${m.replace(/\s/g,'')}">--</div><div class="mc-sub">--</div></div>`
        ).join('')}
      </div>
      <div id="bt-chart-wrap" style="flex:1;min-height:0;position:relative;background:var(--bg-1);">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--t-3);font-size:11px;font-family:var(--font-mono);">
          Configure parameters and click RUN BACKTEST
        </div>
        <div id="bt-chart" style="height:100%;"></div>
      </div>
      <div id="bt-trades-wrap" style="height:200px;overflow-y:auto;border-top:1px solid var(--bg-4);">
        <table class="data-table" id="bt-trades-table">
          <thead>
            <tr>
              <th>#</th><th>Side</th><th>Entry Date</th><th>Exit Date</th>
              <th>Entry $</th><th>Exit $</th><th>Shares</th><th>P&amp;L</th>
              <th>P&amp;L %</th><th>Hold Days</th><th>Reason</th>
            </tr>
          </thead>
          <tbody id="bt-trades-body"><tr><td colspan="11" style="text-align:center;color:var(--t-3);">No trades yet</td></tr></tbody>
        </table>
      </div>
    `;
  }

  async function runBacktest() {
    const btn    = document.getElementById('bt-run');
    const status = document.getElementById('bt-status');
    const symbol = document.getElementById('bt-symbol').value.toUpperCase();
    const stratId = document.getElementById('bt-strategy').value;
    const interval = document.getElementById('bt-interval').value;
    const range    = document.getElementById('bt-range').value;
    const capital  = parseFloat(document.getElementById('bt-capital').value) || 100000;
    const comm     = parseFloat(document.getElementById('bt-commission').value) / 100 || 0.001;
    const slip     = parseFloat(document.getElementById('bt-slippage').value) / 100 || 0.0005;
    const posSize  = parseFloat(document.getElementById('bt-pos-size').value) / 100 || 0.95;

    // Collect strategy params
    const entry   = Strategies.REGISTRY.find(s => s.id === stratId);
    const userCfg = {};
    entry.params.forEach(p => {
      const el = document.getElementById(`btp-${p.key}`);
      if (el) userCfg[p.key] = parseFloat(el.value);
    });

    btn.disabled    = true;
    btn.textContent = 'RUNNING...';
    status.textContent = `Fetching ${symbol} ${interval} (${range})...`;

    try {
      const res  = await fetch(`/api/history/${symbol}?interval=${interval}&range=${range}`);
      const hist = await res.json();
      if (!hist.candles?.length) throw new Error('No data returned');

      const candles = hist.candles;
      const data = {
        timestamps: candles.map(c => c.time),
        opens:      candles.map(c => c.open),
        highs:      candles.map(c => c.high),
        lows:       candles.map(c => c.low),
        closes:     candles.map(c => c.close),
        volumes:    candles.map(c => c.volume),
      };

      status.textContent = `Running ${entry.label} on ${candles.length} bars...`;
      await new Promise(r => setTimeout(r, 0)); // let UI update

      const stratResult = Strategies.run(stratId, data, userCfg);
      btResult = BacktestEngine.run(data, stratResult.signals, { initialCapital: capital, commission: comm, slippage: slip, positionSizePct: posSize });

      renderMetrics(btResult.metrics);
      renderEquityChart(btResult.equity, data.timestamps, data.closes, btResult.trades, capital);
      renderTradesTable(btResult.trades);

      status.textContent = `Done — ${btResult.trades.length} trades, ${btResult.metrics.totalReturn > 0 ? '+' : ''}${btResult.metrics.totalReturn}% return`;
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'RUN BACKTEST';
    }
  }

  function renderMetrics(m) {
    const setM = (id, val, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      el.className   = `mc-val ${cls || ''}`;
    };

    setM('bm-TotalReturn',   `${m.totalReturn > 0 ? '+' : ''}${m.totalReturn}%`, m.totalReturn >= 0 ? 'pos' : 'neg');
    setM('bm-CAGR',          `${m.cagr > 0 ? '+' : ''}${m.cagr}%`,              m.cagr >= 0 ? 'pos' : 'neg');
    setM('bm-Sharpe',        m.sharpe,         m.sharpe >= 1 ? 'pos' : m.sharpe >= 0 ? '' : 'neg');
    setM('bm-MaxDrawdown',  `-${m.maxDrawdown}%`, 'neg');
    setM('bm2-Sortino',      m.sortino,         m.sortino >= 1 ? 'pos' : '');
    setM('bm2-WinRate',      `${m.winRate}%`,    m.winRate >= 50 ? 'pos' : 'neg');
    setM('bm2-ProfitFactor', m.profitFactor,    m.profitFactor >= 1.5 ? 'pos' : m.profitFactor >= 1 ? '' : 'neg');
    setM('bm2-Trades',       m.totalTrades,     '');

    // Update subtitles
    const cells = document.querySelectorAll('#bt-metrics .metric-cell, #bt-metrics2 .metric-cell');
    const subs  = [`Vol: ${m.annualVol}%`, `${m.avgHoldDays}d avg hold`, `Sortino: ${m.sortino}`, `Calmar: ${m.calmar}`,
                   `Calmar: ${m.calmar}`, `${m.totalTrades} trades`, `Exp: $${m.expectancy}`, `Comm: $${m.totalCommission}`];
    cells.forEach((cell, i) => {
      const sub = cell.querySelector('.mc-sub');
      if (sub && subs[i]) sub.textContent = subs[i];
    });
  }

  function renderEquityChart(equity, timestamps, closes, trades, initialCapital) {
    const container = document.getElementById('bt-chart');
    if (!container) return;
    container.innerHTML = '';

    if (typeof LightweightCharts === 'undefined') return;

    if (btChart) { try { btChart.remove(); } catch {} }

    btChart = LightweightCharts.createChart(container, {
      layout: { background: { type: 'solid', color: '#131722' }, textColor: '#787b86' },
      grid: { vertLines: { color: '#363a4a' }, horzLines: { color: '#363a4a' } },
      rightPriceScale: { borderColor: '#363a4a' },
      timeScale: { borderColor: '#363a4a', timeVisible: true },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      width:  container.clientWidth,
      height: container.clientHeight || 300,
    });

    // Strategy equity line
    const equitySeries = btChart.addLineSeries({ color: '#26a69a', lineWidth: 1.5, title: 'Strategy' });
    const eqData = timestamps.map((t, i) => ({ time: t, value: +equity[i].toFixed(2) })).filter(d => d.value > 0);
    equitySeries.setData(eqData);

    // Buy & hold reference
    const bh = btChart.addLineSeries({ color: '#363a4a', lineWidth: 1, lineStyle: 2, title: 'Buy & Hold' });
    bh.setData(timestamps.map((t, i) => ({ time: t, value: +(initialCapital * closes[i] / closes[0]).toFixed(2) })));

    // Trade markers
    const markers = [];
    trades.forEach(t => {
      if (timestamps[t.entryIndex]) markers.push({ time: timestamps[t.entryIndex], position: t.side === 'long' ? 'belowBar' : 'aboveBar', color: t.side === 'long' ? '#26a69a' : '#ef5350', shape: t.side === 'long' ? 'arrowUp' : 'arrowDown', text: t.side === 'long' ? 'BUY' : 'SELL', size: 0.8 });
      if (timestamps[t.exitIndex])  markers.push({ time: timestamps[t.exitIndex],  position: t.pnl >= 0 ? 'aboveBar' : 'belowBar', color: t.pnl >= 0 ? '#26a69a' : '#ef5350', shape: 'circle', text: `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(0)}`, size: 0.6 });
    });
    markers.sort((a, b) => a.time - b.time);
    equitySeries.setMarkers(markers);

    btChart.timeScale().fitContent();
  }

  function renderTradesTable(trades) {
    const tbody = document.getElementById('bt-trades-body');
    if (!tbody) return;

    if (!trades.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--t-3);">No trades generated</td></tr>';
      return;
    }

    const fmtDate = ts => ts ? new Date(ts * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }) : '--';

    tbody.innerHTML = trades.slice().reverse().map((t, i) => `
      <tr>
        <td class="muted">${trades.length - i}</td>
        <td class="${t.side === 'long' ? 'up' : 'dn'}">${t.side.toUpperCase()}</td>
        <td class="muted">${fmtDate(t.entryTime)}</td>
        <td class="muted">${fmtDate(t.exitTime)}</td>
        <td>$${t.entryPrice.toFixed(2)}</td>
        <td>$${t.exitPrice.toFixed(2)}</td>
        <td class="muted">${t.shares}</td>
        <td class="${t.pnl >= 0 ? 'up' : 'dn'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
        <td class="${t.pnlPct >= 0 ? 'up' : 'dn'}">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%</td>
        <td class="muted">${t.holdDays}d</td>
        <td class="muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${t.reason}">${t.reason}</td>
      </tr>
    `).join('');
  }

  return {
    init() {
      if (!initialized) {
        buildControls();
        buildMain();
        initialized = true;
      }
    }
  };
})();
