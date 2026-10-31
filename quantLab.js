'use strict';
/**
 * quantLab.js — Quant Lab page controller
 * Lessons · Interview-style problems · Interactive simulations · Reading list · Data notes
 */

const QuantLab = (() => {
  let initialized = false;
  let section = 'lesson:bsm';
  let probCat = 'All';

  const $ = id => document.getElementById(id);

  const SHORT = {
    bsm: 'Black-Scholes-Merton', greeks: 'The Greeks', iv: 'Implied Vol & Skew', mc: 'Monte Carlo',
    tree: 'Binomial Trees', micro: 'Order Books & Impact', statarb: 'Pairs & Cointegration',
    portfolio: 'Portfolio & Kelly', backtest: 'Honest Backtesting', rl: 'ML & RL in Trading',
    stoch: 'Stochastic Calculus', risk: 'VaR & Expected Shortfall',
  };

  /* ══════════════════════════════════════════════════════════════════════
     NAV
     ══════════════════════════════════════════════════════════════════════ */
  function buildNav() {
    const L = QuantContent.LESSONS;
    const item = (sec, num, label) =>
      `<div class="quant-nav-item${sec === section ? ' active' : ''}" data-sec="${sec}"><span class="nav-num">${num}</span>${Fmt.esc(label)}</div>`;
    $('quant-nav').innerHTML = `
      <div class="quant-nav-section">Lessons</div>
      ${L.map((l, i) => item(`lesson:${l.id}`, String(i + 1).padStart(2, '0'), SHORT[l.id] || l.title)).join('')}
      <div class="quant-nav-section">Practice</div>
      ${item('problems', '', `Interview Problems (${QuantContent.PROBLEMS.length})`)}
      <div class="quant-nav-section">Simulations</div>
      ${item('sim:monty', '', 'Monty Hall')}
      ${item('sim:kelly', '', 'Kelly Sizing')}
      <div class="quant-nav-section">Reference</div>
      ${item('reading', '', 'Reading List')}
      ${item('about', '', 'Data & Limitations')}`;
    $('quant-nav').onclick = e => {
      const it = e.target.closest('.quant-nav-item'); if (!it) return;
      section = it.dataset.sec;
      document.querySelectorAll('#quant-nav .quant-nav-item').forEach(x => x.classList.toggle('active', x === it));
      render();
      $('quant-content').scrollTop = 0;
    };
  }

  function render() {
    const host = $('quant-content');
    if (section.startsWith('lesson:')) host.innerHTML = lessonHTML(section.slice(7));
    else if (section === 'problems')   { host.innerHTML = problemsHTML(); bindProblems(); }
    else if (section === 'sim:monty')  { host.innerHTML = montyHTML(); bindMonty(); }
    else if (section === 'sim:kelly')  { host.innerHTML = kellyHTML(); bindKelly(); }
    else if (section === 'reading')    host.innerHTML = readingHTML();
    else                               host.innerHTML = aboutHTML();
  }

  /* ══════════════════════════════════════════════════════════════════════
     LESSONS
     ══════════════════════════════════════════════════════════════════════ */
  function lessonHTML(id) {
    const l = QuantContent.LESSONS.find(x => x.id === id);
    if (!l) return '';
    return `
      <div class="ql-section-title">${Fmt.esc(l.area)}</div>
      <div class="ql-title">${l.title}</div>
      <div class="ql-meta"><span>LEVEL: ${Fmt.esc(l.level.toUpperCase())}</span><span>${l.mins} MIN READ</span></div>
      <div class="ql-body">${l.html}</div>`;
  }

  /* ══════════════════════════════════════════════════════════════════════
     PROBLEMS
     ══════════════════════════════════════════════════════════════════════ */
  function problemsHTML() {
    const P = QuantContent.PROBLEMS;
    const cats = ['All', ...new Set(P.map(p => p.cat))];
    const list = P.map((p, i) => ({ ...p, i })).filter(p => probCat === 'All' || p.cat === probCat);
    return `
      <div class="ql-section-title">Practice</div>
      <div class="ql-title">Interview-Style Problems</div>
      <div class="ql-meta"><span>${P.length} PROBLEMS</span><span>TRY IT FIRST — THEN REVEAL</span></div>
      <p style="font-size:12.5px;color:var(--t-2);line-height:1.7;margin-bottom:16px">
        Original problems on the standard topics tested in quantitative trading and research interviews.
        Work each one on paper before opening the solution. Interviewers care about structure of thought as much as the final number.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px" id="prob-cats">
        ${cats.map(c => `<button class="btn${c === probCat ? ' primary' : ''}" data-cat="${Fmt.esc(c)}">${Fmt.esc(c)}</button>`).join('')}
      </div>
      ${list.map(p => `
        <div class="question-card" data-i="${p.i}">
          <div class="qc-header">
            <div class="qc-meta">
              <span class="difficulty-tag ${p.diff.toLowerCase()}">${p.diff.toUpperCase()}</span>
              <span class="category-tag">${Fmt.esc(p.cat.toUpperCase())}</span>
            </div>
            <div class="qc-text">${p.q}</div>
            <div class="qc-toggle">SHOW ▾</div>
          </div>
          <div class="qc-answer" style="display:none"><div style="padding-top:12px">${p.a}</div></div>
        </div>`).join('')}`;
  }

  function bindProblems() {
    const host = $('quant-content');
    host.querySelector('#prob-cats').onclick = e => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      probCat = b.dataset.cat; render();
    };
    host.querySelectorAll('.question-card .qc-header').forEach(h => {
      h.onclick = () => {
        const card = h.parentElement, ans = card.querySelector('.qc-answer');
        const open = ans.style.display === 'none';
        ans.style.display = open ? 'block' : 'none';
        card.classList.toggle('revealed', open);
        h.querySelector('.qc-toggle').textContent = open ? 'HIDE ▴' : 'SHOW ▾';
      };
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     CANVAS LINE PLOT HELPER
     ══════════════════════════════════════════════════════════════════════ */
  function drawLines(canvas, series, { logY = false, yLabel = '' } = {}) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 56, r: 12, t: 12, b: 24 };
    const tf = v => logY ? Math.log10(Math.max(v, 1e-9)) : v;
    let lo = Infinity, hi = -Infinity, n = 0;
    series.forEach(s => { n = Math.max(n, s.data.length); s.data.forEach(v => { const t = tf(v); if (t < lo) lo = t; if (t > hi) hi = t; }); });
    if (!isFinite(lo) || lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo; lo -= span * 0.05; hi += span * 0.05;

    const X = i => pad.l + (i / Math.max(n - 1, 1)) * (W - pad.l - pad.r);
    const Y = v => pad.t + (1 - (tf(v) - lo) / (hi - lo)) * (H - pad.t - pad.b);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#787b86'; ctx.strokeStyle = '#2a2e3d'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const tv = lo + (hi - lo) * k / 4, y = pad.t + (1 - k / 4) * (H - pad.t - pad.b);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      const val = logY ? Math.pow(10, tv) : tv;
      ctx.textAlign = 'right';
      ctx.fillText(val >= 100 ? val.toFixed(0) : val >= 1 ? val.toFixed(2) : val.toFixed(3), pad.l - 6, y + 3);
    }
    ctx.textAlign = 'center';
    ctx.fillText('bets', W / 2, H - 6);

    series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.beginPath();
      s.data.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     SIM 1 — MONTY HALL
     ══════════════════════════════════════════════════════════════════════ */
  function montyHTML() {
    return `
      <div class="ql-section-title">Simulation</div>
      <div class="ql-title">Monty Hall</div>
      <div class="ql-meta"><span>PROBABILITY</span><span>CONDITIONING ON INFORMATION</span></div>
      <div class="ql-body"><p>You pick a door. The host, who <strong>knows</strong> where the car is, opens every other door except one, always revealing goats. Do you stay or switch? Run the experiment and compare with theory.</p></div>
      <div class="card-like" style="background:var(--bg-0);border:1px solid var(--bg-4);border-radius:3px;padding:16px;margin-top:8px">
        <div class="slider-group"><div class="slider-header"><span class="slider-label">Number of doors</span><span class="slider-value" id="mh-n-v">3</span></div>
          <input type="range" id="mh-n" min="3" max="100" step="1" value="3"/></div>
        <div class="form-field"><label class="field-label">Trials</label>
          <select id="mh-trials" class="field-select"><option>1000</option><option selected>10000</option><option>100000</option><option>1000000</option></select></div>
        <button class="run-btn" id="mh-run" style="margin-top:0">RUN SIMULATION</button>
        <div id="mh-out" style="margin-top:16px"></div>
      </div>
      <div class="ql-body" style="margin-top:16px">
        ${'<div class="info-box"><strong>Why switching wins.</strong> Your first pick is right with probability 1/N and the host\'s move does not change that. The remaining (N−1)/N probability collapses onto the single other unopened door. If the host opened doors <em>at random</em> (and just happened to reveal goats), switching would be no better than staying, because the information content of his action is what changes the odds.</div>'}
      </div>`;
  }

  function bindMonty() {
    const n = $('mh-n');
    n.oninput = () => { $('mh-n-v').textContent = n.value; };
    $('mh-run').onclick = () => {
      const N = parseInt(n.value, 10), T = parseInt($('mh-trials').value, 10);
      let stay = 0, sw = 0;
      for (let i = 0; i < T; i++) {
        const car = (Math.random() * N) | 0, pick = (Math.random() * N) | 0;
        // The host removes every other goat door, so switching wins exactly when the first pick was wrong.
        if (pick === car) stay++; else sw++;
      }
      const bar = (label, emp, theo, color) => `
        <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;margin-bottom:4px">
          <span>${label}</span><span><b style="color:${color}">${(emp * 100).toFixed(2)}%</b> <span style="color:var(--t-3)">theory ${(theo * 100).toFixed(2)}%</span></span></div>
          <div style="height:8px;background:var(--bg-3);border-radius:2px"><div style="height:100%;width:${(emp * 100).toFixed(1)}%;background:${color};border-radius:2px"></div></div></div>`;
      $('mh-out').innerHTML = bar('STAY', stay / T, 1 / N, '#ef5350') + bar('SWITCH', sw / T, (N - 1) / N, '#26a69a') +
        `<div style="font-size:10px;color:var(--t-3);font-family:var(--font-mono)">${T.toLocaleString()} trials · sampling error ≈ ±${(100 * Math.sqrt(0.25 / T)).toFixed(2)}% at most</div>`;
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     SIM 2 — KELLY SIZING
     ══════════════════════════════════════════════════════════════════════ */
  function kellyHTML() {
    return `
      <div class="ql-section-title">Simulation</div>
      <div class="ql-title">Kelly Sizing: How Much to Bet</div>
      <div class="ql-meta"><span>PORTFOLIO THEORY</span><span>GROWTH VS. RISK</span></div>
      <div class="ql-body"><p>A repeated bet with a real edge. Bet too little and you grow slowly; bet too much and you go broke despite the edge. Each line below is the <strong>median</strong> wealth path across 400 simulated bankrolls that all face the same sequence of coin flips (log scale).</p></div>
      <div style="background:var(--bg-0);border:1px solid var(--bg-4);border-radius:3px;padding:16px;margin-top:8px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
          <div class="slider-group"><div class="slider-header"><span class="slider-label">Win probability p</span><span class="slider-value" id="k-p-v">0.55</span></div>
            <input type="range" id="k-p" min="0.51" max="0.70" step="0.01" value="0.55"/></div>
          <div class="slider-group"><div class="slider-header"><span class="slider-label">Payout b (win b per 1 risked)</span><span class="slider-value" id="k-b-v">1.0</span></div>
            <input type="range" id="k-b" min="0.5" max="3" step="0.1" value="1"/></div>
          <div class="slider-group"><div class="slider-header"><span class="slider-label">Number of bets</span><span class="slider-value" id="k-n-v">300</span></div>
            <input type="range" id="k-n" min="50" max="1000" step="50" value="300"/></div>
        </div>
        <button class="run-btn" id="k-run" style="margin-top:4px">RE-ROLL SIMULATION</button>
        <div id="k-info" style="margin:14px 0 6px;font-family:var(--font-mono);font-size:11px;color:var(--t-2)"></div>
        <canvas id="k-canvas" style="width:100%;height:300px;display:block"></canvas>
        <div id="k-legend" style="display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 14px;font-family:var(--font-mono);font-size:10.5px"></div>
        <div id="k-table"></div>
      </div>
      <div class="ql-body" style="margin-top:16px"><div class="warn-box"><strong>Read the lesson on caveats:</strong> this simulation <em>knows</em> the true edge. In reality your estimate of p is noisy, and overestimating it is far more costly than underestimating it. That asymmetry is the practical case for fractional Kelly.</div></div>`;
  }

  function bindKelly() {
    const ids = ['k-p', 'k-b', 'k-n'];
    const fmt = { 'k-p': v => (+v).toFixed(2), 'k-b': v => (+v).toFixed(1), 'k-n': v => v };
    ids.forEach(id => { $(id).oninput = () => { $(`${id}-v`).textContent = fmt[id]($(id).value); runKelly(); }; });
    $('k-run').onclick = runKelly;
    runKelly();
  }

  function runKelly() {
    const p = +$('k-p').value, b = +$('k-b').value, N = +$('k-n').value, PATHS = 400;
    const q = 1 - p, fStar = (b * p - q) / b;
    const mults = [0.25, 0.5, 1, 2];
    const colors = ['#2962ff', '#26a69a', '#ffb74d', '#ef5350'];
    const info = $('k-info');
    if (fStar <= 0) { info.textContent = 'No edge at these parameters (Kelly fraction ≤ 0). Increase p or b.'; return; }
    info.innerHTML = `Kelly fraction f* = (b·p − q)/b = <b style="color:var(--t-1)">${(fStar * 100).toFixed(1)}%</b> of bankroll per bet`;

    // Common random numbers: every strategy faces identical outcomes
    const wins = Array.from({ length: PATHS }, () => Float64Array.from({ length: N }, () => Math.random() < p));

    const median = arr => { const a = [...arr].sort((x, y) => x - y); return a[a.length >> 1]; };
    const rows = [], series = [];

    mults.forEach((k, mi) => {
      const f = Math.min(k * fStar, 0.99);
      const W = Array.from({ length: PATHS }, () => new Float64Array(N + 1).fill(1));
      const maxDD = new Float64Array(PATHS);
      for (let a = 0; a < PATHS; a++) {
        let w = 1, peak = 1, dd = 0;
        for (let t = 0; t < N; t++) {
          w *= wins[a][t] ? 1 + f * b : 1 - f;
          if (w > peak) peak = w; dd = Math.max(dd, 1 - w / peak);
          W[a][t + 1] = w;
        }
        maxDD[a] = dd;
      }
      const med = new Array(N + 1);
      for (let t = 0; t <= N; t++) { const col = new Array(PATHS); for (let a = 0; a < PATHS; a++) col[a] = W[a][t]; med[t] = median(col); }
      series.push({ data: med, color: colors[mi], width: k === 1 ? 2.4 : 1.6 });
      const finals = W.map(path => path[N]);
      const g = p * Math.log(1 + f * b) + q * Math.log(1 - f);
      rows.push({ k, f, g, medFinal: median(finals), pLoss: finals.filter(v => v < 1).length / PATHS, medDD: median(Array.from(maxDD)) });
    });

    series.push({ data: new Array(N + 1).fill(1), color: '#363a4a', width: 1 });
    drawLines($('k-canvas'), series, { logY: true });

    $('k-legend').innerHTML = mults.map((k, i) => `<span><span style="display:inline-block;width:10px;height:3px;background:${colors[i]};margin-right:6px;vertical-align:middle"></span>${k}× Kelly</span>`).join('');
    $('k-table').innerHTML = `<table class="data-table"><thead><tr><th>Bet size</th><th>Fraction</th><th>Theoretical growth / bet</th><th>Median final wealth</th><th>P(end below start)</th><th>Median max drawdown</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td><span style="color:${colors[i]}">■</span> ${r.k}× Kelly</td><td>${(r.f * 100).toFixed(1)}%</td>
        <td class="${r.g >= 0 ? 'up' : 'dn'}">${(r.g * 100).toFixed(3)}%</td><td>${r.medFinal >= 1000 ? r.medFinal.toExponential(2) : r.medFinal.toFixed(2)}×</td>
        <td>${(r.pLoss * 100).toFixed(1)}%</td><td class="dn">${(r.medDD * 100).toFixed(0)}%</td></tr>`).join('')}</tbody></table>`;
  }

  /* ══════════════════════════════════════════════════════════════════════
     READING + ABOUT
     ══════════════════════════════════════════════════════════════════════ */
  function readingHTML() {
    return `
      <div class="ql-section-title">Reference</div>
      <div class="ql-title">Reading List</div>
      <div class="ql-meta"><span>BOOKS · PAPERS</span></div>
      <div class="ql-body">${QuantContent.READING.map(g => `<h3>${Fmt.esc(g.area)}</h3><ul>${g.items.map(i => `<li>${i}</li>`).join('')}</ul>`).join('')}</div>`;
  }

  function aboutHTML() {
    return `
      <div class="ql-section-title">Reference</div>
      <div class="ql-title">Data &amp; Limitations</div>
      <div class="ql-meta"><span>READ THIS BEFORE TRUSTING ANY NUMBER</span></div>
      <div class="ql-body">
        <h3>Market data</h3>
        <ul>
          <li>Quotes and history come from <strong>Yahoo Finance</strong> through an unofficial library, polled every few seconds. They are <strong>not</strong> an exchange feed and can be delayed by up to ~15 minutes depending on the venue, and Yahoo may throttle or change the service without notice.</li>
          <li>Yahoo's terms restrict commercial redistribution. This is fine for personal, educational and portfolio use. If you deploy this publicly at scale, move to a licensed provider (for example Polygon, Alpaca or Twelve Data) by replacing the two functions <code>fetchQuote</code> and <code>fetchHistory</code> in <code>server.js</code>.</li>
          <li><strong>No Level-2 data.</strong> Only the best bid and ask are available. The depth ladder is modeled around them and labelled as such.</li>
        </ul>
        <h3>Paper trading</h3>
        <ul>
          <li>Long-only cash account, whole shares, no margin, 5 bps commission, 1 bp slippage on market orders.</li>
          <li>Fills are simulated against the feed's bid/ask. They do not model queue position, partial fills or market impact.</li>
          <li>State is held in server memory and keyed by an anonymous browser id: it resets when the server restarts. There are no accounts.</li>
        </ul>
        <h3>Backtesting</h3>
        <ul>
          <li>Signals are computed at a bar's close and filled at the next bar's open, one position at a time, with percentage slippage and commission.</li>
          <li>Uses adjusted historical prices. No borrow cost, no market impact, no survivorship-bias correction.</li>
          <li>Strategies are textbook implementations for learning. A good-looking backtest here is a hypothesis, not evidence of an edge. See <em>Honest Backtesting</em>.</li>
        </ul>
        <h3>Options</h3>
        <ul>
          <li>Pricing models assume European exercise unless stated, constant volatility and a flat rate. Listed US equity options are American-style, so model prices are approximations.</li>
        </ul>
        ${'<div class="warn-box"><strong>Not financial advice.</strong> Everything on this site is for education and research. Never trade real money on the strength of a simulator.</div>'}
      </div>`;
  }

  return {
    init() {
      if (!initialized) { buildNav(); render(); initialized = true; }
    },
  };
})();
