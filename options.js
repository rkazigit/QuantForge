'use strict';
/**
 * options.js — Options Pricing Engine + UI
 * =========================================
 * Models: Black-Scholes-Merton, Monte Carlo, CRR Binomial
 * Greeks: Delta, Gamma, Vega, Theta, Rho, Vanna, Volga, Charm
 * Tools:  Implied Volatility (Newton-Raphson), Options Chain display
 */

/* ══════════════════════════════════════════════════════════════════════════
   MATH ENGINE
   ══════════════════════════════════════════════════════════════════════════ */

const OptionsEngine = (() => {

  /** Cumulative standard normal — Abramowitz & Stegun 26.2.17 (error < 7.5e-8) */
  function N(x) {
    const a = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    let poly = t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4]))));
    poly     = 1 - 0.3989422804 * Math.exp(-0.5 * x * x) * poly;
    return x >= 0 ? poly : 1 - poly;
  }

  /** Standard normal PDF */
  function n(x) { return Math.exp(-0.5 * x * x) / 2.5066282746; }

  /* ── Black-Scholes-Merton ────────────────────────────────────────────── */
  function bsm(S, K, T, r, sigma, q = 0) {
    if (T <= 0) {
      return { call: Math.max(S - K, 0), put: Math.max(K - S, 0), d1: 0, d2: 0 };
    }
    const sqrtT = Math.sqrt(T);
    const d1    = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2    = d1 - sigma * sqrtT;
    const eqT   = Math.exp(-q * T);
    const erT   = Math.exp(-r * T);
    return {
      call: S * eqT * N(d1) - K * erT * N(d2),
      put:  K * erT * N(-d2) - S * eqT * N(-d1),
      d1, d2,
    };
  }

  /** Full Greeks — analytical closed form */
  function greeks(S, K, T, r, sigma, q = 0) {
    if (T <= 0 || sigma <= 0) return { delta_c:0, delta_p:0, gamma:0, vega:0, theta_c:0, theta_p:0, rho_c:0, rho_p:0, vanna:0, volga:0, charm:0 };
    const sqrtT = Math.sqrt(T);
    const d1    = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2    = d1 - sigma * sqrtT;
    const eqT   = Math.exp(-q * T);
    const erT   = Math.exp(-r * T);
    const nd1   = n(d1);

    const delta_c = eqT * N(d1);
    const delta_p = eqT * (N(d1) - 1);
    const gamma   = eqT * nd1 / (S * sigma * sqrtT);
    const vega    = S * eqT * nd1 * sqrtT;                          // per unit σ
    const theta_c = (-(S * eqT * nd1 * sigma) / (2 * sqrtT) - r * K * erT * N(d2)  + q * S * eqT * N(d1))  / 365;
    const theta_p = (-(S * eqT * nd1 * sigma) / (2 * sqrtT) + r * K * erT * N(-d2) - q * S * eqT * N(-d1)) / 365;
    const rho_c   =  K * T * erT * N(d2);
    const rho_p   = -K * T * erT * N(-d2);

    // Second-order Greeks
    const vanna  = -eqT * nd1 * d2 / sigma;                        // ∂²V/∂S∂σ
    const volga  = vega * d1 * d2 / sigma;                         // ∂²V/∂σ² (Vomma)
    const charm_c = -eqT * (nd1 * ((r - q) / (sigma * sqrtT) - d2 / (2 * T)) + q * N(d1));
    const charm_p = -eqT * (nd1 * ((r - q) / (sigma * sqrtT) - d2 / (2 * T)) - q * N(-d1));

    return { delta_c, delta_p, gamma, vega, theta_c, theta_p, rho_c, rho_p, vanna, volga, charm_c, charm_p };
  }

  /* ── Monte Carlo ─────────────────────────────────────────────────────── */
  /** Box-Muller standard normal sample */
  function randn() {
    let u, v, s;
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    return u * Math.sqrt(-2 * Math.log(s) / s);
  }

  function monteCarlo(S, K, T, r, sigma, q = 0, paths = 40000, isCall = true) {
    const drift   = (r - q - 0.5 * sigma * sigma) * T;
    const vol     = sigma * Math.sqrt(T);
    const disc    = Math.exp(-r * T);
    let   sum = 0, sumSq = 0;

    for (let i = 0; i < paths; i++) {
      // Antithetic variate — use z and -z
      const z   = randn();
      const ST1 = S * Math.exp(drift + vol *  z);
      const ST2 = S * Math.exp(drift + vol * -z);
      const p1  = Math.max(isCall ? ST1 - K : K - ST1, 0);
      const p2  = Math.max(isCall ? ST2 - K : K - ST2, 0);
      const p   = (p1 + p2) / 2;
      sum       += p;
      sumSq     += p * p;
    }

    const mean  = sum / paths;
    const price = disc * mean;
    const var_  = (sumSq / paths - mean * mean) / paths;
    const se    = disc * Math.sqrt(var_);
    return { price, se, ci95lo: price - 1.96 * se, ci95hi: price + 1.96 * se, paths };
  }

  /* ── Binomial Tree (CRR) ─────────────────────────────────────────────── */
  function binomial(S, K, T, r, sigma, q = 0, N = 150, isCall = true, isAmerican = false) {
    const dt    = T / N;
    const u     = Math.exp(sigma * Math.sqrt(dt));
    const d     = 1 / u;
    const p     = (Math.exp((r - q) * dt) - d) / (u - d);
    const disc  = Math.exp(-r * dt);

    // Terminal payoffs
    const V = new Float64Array(N + 1);
    for (let j = 0; j <= N; j++) {
      const ST = S * Math.pow(u, j) * Math.pow(d, N - j);
      V[j] = Math.max(isCall ? ST - K : K - ST, 0);
    }

    // Backward induction
    for (let i = N - 1; i >= 0; i--) {
      for (let j = 0; j <= i; j++) {
        V[j] = disc * (p * V[j + 1] + (1 - p) * V[j]);
        if (isAmerican) {
          const ST = S * Math.pow(u, j) * Math.pow(d, i - j);
          V[j]    = Math.max(V[j], isCall ? ST - K : K - ST);
        }
      }
    }
    return V[0];
  }

  /* ── Implied Volatility (safeguarded Newton / bisection) ─────────────── */
  /**
   * Plain Newton fails for OTM options: a low initial guess has ~zero vega so the step is
   * undefined. We keep a bracket [lo, hi] around the root, take Newton steps while they stay
   * inside it, and fall back to bisection otherwise. Returns null if no solution exists.
   */
  function impliedVol(marketPrice, S, K, T, r, q = 0, isCall = true, maxIter = 100, tol = 1e-8) {
    const fS = S * Math.exp(-q * T), fK = K * Math.exp(-r * T);
    const lower = Math.max(isCall ? fS - fK : fK - fS, 0);     // no-arbitrage bounds
    const upper = isCall ? fS : fK;
    if (!(marketPrice > lower + 1e-12) || marketPrice >= upper) return null;

    const f = s => { const o = bsm(S, K, T, r, s, q); return (isCall ? o.call : o.put) - marketPrice; };
    let lo = 1e-4, hi = 5;
    if (f(lo) > 0 || f(hi) < 0) return null;

    let sigma = Math.min(Math.max(Math.sqrt(2 * Math.PI / T) * marketPrice / S, 0.05), 2);
    for (let i = 0; i < maxIter; i++) {
      const fv = f(sigma);
      if (Math.abs(fv) < tol) return sigma;
      if (fv > 0) hi = sigma; else lo = sigma;
      const vega = greeks(S, K, T, r, sigma, q).vega;
      let next = vega > 1e-10 ? sigma - fv / vega : NaN;
      if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
      sigma = next;
    }
    return Math.abs(f(sigma)) < 1e-5 ? sigma : null;
  }

  return { bsm, greeks, monteCarlo, binomial, impliedVol, N, n };
})();

/* ══════════════════════════════════════════════════════════════════════════
   OPTIONS PAGE UI
   ══════════════════════════════════════════════════════════════════════════ */

const OptionsModule = (() => {
  let initialized = false;
  let currentSymbol = 'SPY';
  let optionChain   = null;
  let currentExpiry = 0;

  const state = { S: 100, K: 100, T: 0.25, r: 0.05, sigma: 0.20, q: 0.0, isCall: true };

  /* ── Render controls ─────────────────────────────────────────────────── */
  function buildControls() {
    const el = document.getElementById('options-controls');
    el.innerHTML = `
      <div class="section-header"><span class="section-label">PARAMETERS</span></div>

      <div style="padding:12px 14px;">

        <div class="form-field" style="margin-bottom:10px;">
          <label class="field-label">UNDERLYING SYMBOL</label>
          <div style="display:flex;gap:6px;">
            <input type="text" id="opt-symbol" class="field-input" value="${currentSymbol}" style="text-transform:uppercase;" maxlength="8"/>
            <button class="btn" id="opt-load-btn">Load</button>
          </div>
        </div>

        <div class="form-field" style="margin-bottom:10px;">
          <label class="field-label">OPTION TYPE</label>
          <div class="side-selector">
            <button class="side-btn buy active" id="opt-call-btn">CALL</button>
            <button class="side-btn sell" id="opt-put-btn">PUT</button>
          </div>
        </div>

        ${buildSlider('S',     'Spot Price ($)',         state.S,     1,   500,  0.5,  '$')}
        ${buildSlider('K',     'Strike Price ($)',       state.K,     1,   500,  0.5,  '$')}
        ${buildSlider('T',     'Time to Expiry (days)', state.T*365, 1,   730,  1,    'd')}
        ${buildSlider('r',     'Risk-Free Rate (%)',     state.r*100, 0,   15,   0.1,  '%')}
        ${buildSlider('sigma', 'Volatility (%)',         state.sigma*100, 1, 200, 0.5,  '%')}
        ${buildSlider('q',     'Dividend Yield (%)',     state.q*100, 0,   10,   0.1,  '%')}

        <div class="divider"></div>
        <div style="font-size:10px;color:var(--t-3);line-height:1.7;">
          Live options chain loaded from market.<br/>
          Theoretical prices assume European-style BSM.<br/>
          MC uses antithetic variates (40k paths).<br/>
          Binomial: CRR tree, N=150 steps.
        </div>
      </div>
    `;

    // Attach events
    el.querySelector('#opt-call-btn').onclick = () => { state.isCall = true;  updateType(); };
    el.querySelector('#opt-put-btn').onclick  = () => { state.isCall = false; updateType(); };
    el.querySelector('#opt-load-btn').onclick = () => {
      currentSymbol = document.getElementById('opt-symbol').value.toUpperCase();
      loadChain();
    };

    // Slider events
    ['S','K','T','r','sigma','q'].forEach(key => {
      const input = document.getElementById(`sl-${key}`);
      const disp  = document.getElementById(`sv-${key}`);
      if (!input) return;
      input.addEventListener('input', () => {
        let raw = parseFloat(input.value);
        if (key === 'T')     { state.T     = raw / 365; disp.textContent = `${Math.round(raw)}d`; }
        else if (key === 'r') { state.r    = raw / 100; disp.textContent = `${raw.toFixed(1)}%`; }
        else if (key === 'sigma') { state.sigma = raw / 100; disp.textContent = `${raw.toFixed(1)}%`; }
        else if (key === 'q') { state.q    = raw / 100; disp.textContent = `${raw.toFixed(1)}%`; }
        else                  { state[key] = raw;        disp.textContent = `$${raw.toFixed(2)}`; }
        renderResults();
      });
    });
  }

  function buildSlider(key, label, val, min, max, step, unit) {
    const disp = unit === '$' ? `$${val.toFixed(2)}` : unit === 'd' ? `${Math.round(val)}d` : `${val.toFixed(1)}%`;
    return `
      <div class="slider-group">
        <div class="slider-header">
          <span class="slider-label">${label}</span>
          <span class="slider-value" id="sv-${key}">${disp}</span>
        </div>
        <input type="range" id="sl-${key}" min="${min}" max="${max}" step="${step}" value="${val}"/>
      </div>`;
  }

  function updateType() {
    document.getElementById('opt-call-btn').classList.toggle('active', state.isCall);
    document.getElementById('opt-put-btn').classList.toggle('active', !state.isCall);
    renderResults();
  }

  /* ── Render main results ─────────────────────────────────────────────── */
  function buildMain() {
    const el = document.getElementById('options-main');
    el.innerHTML = `
      <!-- Model price row -->
      <div class="model-results" id="opt-model-results"></div>

      <!-- Greeks row -->
      <div class="greeks-grid" id="opt-greeks"></div>

      <!-- Options chain -->
      <div class="chain-header" id="opt-expiry-bar">
        <span class="section-label" style="margin-right:8px;">EXPIRY DATES</span>
        <span style="font-size:10px;color:var(--t-3);">Loading chain for ${currentSymbol}...</span>
      </div>
      <div class="chain-table-wrap" id="opt-chain-wrap" style="display:flex;align-items:center;justify-content:center;color:var(--t-3);font-size:11px;">
        Loading options chain...
      </div>
    `;
  }

  function renderResults() {
    const { S, K, T, r, sigma, q, isCall } = state;
    const E   = OptionsEngine;

    const bsmRes = E.bsm(S, K, T, r, sigma, q);
    const mcRes  = E.monteCarlo(S, K, T, r, sigma, q, 30000, isCall);
    const binEur = E.binomial(S, K, T, r, sigma, q, 150, isCall, false);
    const binAme = E.binomial(S, K, T, r, sigma, q, 150, isCall, true);
    const g      = E.greeks(S, K, T, r, sigma, q);

    const bsmPrice = isCall ? bsmRes.call : bsmRes.put;
    const delta    = isCall ? g.delta_c : g.delta_p;
    const theta    = isCall ? g.theta_c : g.theta_p;
    const rho      = isCall ? g.rho_c   : g.rho_p;
    const charm    = isCall ? g.charm_c  : g.charm_p;

    // ── Model cards ───────────────────────────────────────────────────────
    const mr = document.getElementById('opt-model-results');
    if (mr) mr.innerHTML = `
      <div class="model-card">
        <div class="mc-model">Black-Scholes-Merton</div>
        <div class="mc-price">${fmt4(bsmPrice)}</div>
        <div class="mc-vs">d₁=${bsmRes.d1.toFixed(3)}  d₂=${bsmRes.d2.toFixed(3)}</div>
        <div class="mc-vs" style="margin-top:4px;">IV check: ${(sigma*100).toFixed(1)}%</div>
      </div>
      <div class="model-card">
        <div class="mc-model">Monte Carlo (30k paths, AV)</div>
        <div class="mc-price">${fmt4(mcRes.price)}</div>
        <div class="mc-vs">SE: ±${fmt4(mcRes.se)}</div>
        <div class="mc-vs">95% CI: [${fmt4(mcRes.ci95lo)}, ${fmt4(mcRes.ci95hi)}]</div>
      </div>
      <div class="model-card">
        <div class="mc-model">Binomial CRR N=150</div>
        <div class="mc-price">${fmt4(binEur)}</div>
        <div class="mc-vs">European: ${fmt4(binEur)}</div>
        <div class="mc-vs">American: ${fmt4(binAme)}${binAme > binEur ? ' <span style="color:var(--bull)">+EEP</span>' : ''}</div>
      </div>
    `;

    // ── Greeks ────────────────────────────────────────────────────────────
    const gr = document.getElementById('opt-greeks');
    if (gr) gr.innerHTML = [
      { sym:'Δ', name:'Delta',  val: delta,   desc:'∂V/∂S — spot sensitivity', colr: Math.abs(delta) > 0.5 ? 'var(--bull)' : 'var(--t-1)' },
      { sym:'Γ', name:'Gamma',  val: g.gamma, desc:'∂²V/∂S² — delta curvature', colr:'var(--t-1)' },
      { sym:'ν', name:'Vega',   val: g.vega,  desc:'∂V/∂σ — vol sensitivity', colr:'var(--t-1)' },
      { sym:'Θ', name:'Theta',  val: theta,   desc:'∂V/∂t — daily decay', colr: theta < 0 ? 'var(--bear)' : 'var(--bull)' },
      { sym:'ρ', name:'Rho',    val: rho,     desc:'∂V/∂r — rate sensitivity', colr:'var(--t-1)' },
      { sym:'Λ', name:'Vanna',  val: g.vanna, desc:'∂²V/∂S∂σ', colr:'var(--t-2)' },
      { sym:'Ω', name:'Volga',  val: g.volga, desc:'∂²V/∂σ² (Vomma)', colr:'var(--t-2)' },
      { sym:'ψ', name:'Charm',  val: charm,   desc:'∂²V/∂S∂t', colr:'var(--t-2)' },
    ].map(g => `
      <div class="greek-cell">
        <div class="gc-name">${g.name}</div>
        <div class="gc-symbol">${g.sym}</div>
        <div class="gc-val" style="color:${g.colr}">${g.val.toFixed(5)}</div>
        <div class="gc-desc">${g.desc}</div>
      </div>
    `).join('');
  }

  /* ── Options chain ───────────────────────────────────────────────────── */
  async function loadChain() {
    const wrap = document.getElementById('opt-chain-wrap');
    const bar  = document.getElementById('opt-expiry-bar');
    if (!wrap) return;
    wrap.innerHTML = '<div style="padding:20px;color:var(--t-3);font-size:11px;">Loading options chain...</div>';

    try {
      const res  = await fetch(`/api/options/${currentSymbol}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      // Also fetch spot price to update S
      const q2 = await fetch(`/api/quote/${currentSymbol}`);
      const qt  = await q2.json();
      if (qt.price) {
        state.S = qt.price;
        state.K = Math.round(qt.price / 5) * 5;  // ATM strike
        // Update sliders
        const slS = document.getElementById('sl-S');
        const slK = document.getElementById('sl-K');
        const svS = document.getElementById('sv-S');
        const svK = document.getElementById('sv-K');
        if (slS) { slS.value = state.S; svS.textContent = `$${state.S.toFixed(2)}`; }
        if (slK) { slK.value = state.K; svK.textContent = `$${state.K.toFixed(2)}`; }
      }

      optionChain   = data;
      currentExpiry = 0;

      // Expiry buttons
      const dates = data.expirationDates || [];
      if (bar) {
        bar.innerHTML = `<span class="section-label" style="margin-right:8px;">EXPIRY</span>` +
          dates.slice(0, 8).map((d, i) => {
            const label = new Date(d * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' });
            return `<button class="expiry-btn${i === 0 ? ' active' : ''}" data-idx="${i}">${label}</button>`;
          }).join('');

        bar.querySelectorAll('.expiry-btn').forEach(btn => {
          btn.onclick = () => {
            bar.querySelectorAll('.expiry-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentExpiry = parseInt(btn.dataset.idx);
            renderChain();
          };
        });
      }

      renderChain();
    } catch (e) {
      if (wrap) wrap.innerHTML = `<div style="padding:20px;color:var(--bear);font-size:11px;">Failed to load chain: ${e.message}</div>`;
    }
  }

  function renderChain() {
    const wrap = document.getElementById('opt-chain-wrap');
    if (!wrap || !optionChain) return;

    const options = optionChain.options?.[currentExpiry];
    if (!options) { wrap.innerHTML = '<div style="padding:20px;color:var(--t-3);">No options data</div>'; return; }

    const calls = options.calls || [];
    const puts  = options.puts  || [];
    const spot  = state.S;

    // Merge by strike
    const strikeMap = new Map();
    calls.forEach(c => strikeMap.set(c.strike, { call: c }));
    puts .forEach(p => {
      const entry = strikeMap.get(p.strike) || {};
      entry.put = p;
      strikeMap.set(p.strike, entry);
    });

    const strikes = [...strikeMap.keys()].sort((a,b) => a - b);

    wrap.innerHTML = `
      <table class="chain-table" style="width:100%;">
        <thead>
          <tr>
            <th class="call-side">IV</th>
            <th class="call-side">Delta</th>
            <th class="call-side">Bid</th>
            <th class="call-side">Ask</th>
            <th class="call-side">OI</th>
            <th class="strike">STRIKE</th>
            <th class="put-side">Bid</th>
            <th class="put-side">Ask</th>
            <th class="put-side">OI</th>
            <th class="put-side">Delta</th>
            <th class="put-side">IV</th>
          </tr>
        </thead>
        <tbody>
          ${strikes.map(strike => {
            const { call: c, put: p } = strikeMap.get(strike);
            const itmCall = strike < spot;
            const itmPut  = strike > spot;
            const cIV = c?.impliedVolatility ? (c.impliedVolatility * 100).toFixed(1) + '%' : '--';
            const pIV = p?.impliedVolatility ? (p.impliedVolatility * 100).toFixed(1) + '%' : '--';
            const cDelta = c?.impliedVolatility ? OptionsEngine.greeks(spot, strike, state.T, state.r, c.impliedVolatility || state.sigma).delta_c.toFixed(3) : '--';
            const pDelta = p?.impliedVolatility ? OptionsEngine.greeks(spot, strike, state.T, state.r, p.impliedVolatility || state.sigma).delta_p.toFixed(3) : '--';
            const isATM  = Math.abs(strike - spot) / spot < 0.01;
            return `
              <tr class="${itmCall ? 'itm-call' : ''} ${itmPut ? 'itm-put' : ''}" style="${isATM ? 'font-weight:700;border-left:2px solid var(--bull);border-right:2px solid var(--bull)' : ''}">
                <td class="call-side" style="color:var(--t-2)">${cIV}</td>
                <td class="call-side green">${cDelta}</td>
                <td class="call-side">${fmt2(c?.bid)}</td>
                <td class="call-side">${fmt2(c?.ask)}</td>
                <td class="call-side" style="color:var(--t-2)">${fmtK(c?.openInterest)}</td>
                <td class="strike-col">${strike.toFixed(2)}</td>
                <td class="put-side">${fmt2(p?.bid)}</td>
                <td class="put-side">${fmt2(p?.ask)}</td>
                <td class="put-side" style="color:var(--t-2)">${fmtK(p?.openInterest)}</td>
                <td class="put-side red">${pDelta}</td>
                <td class="put-side" style="color:var(--t-2)">${pIV}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function fmt2(v)  { return v != null ? `$${parseFloat(v).toFixed(2)}` : '--'; }
  function fmt4(v)  { return `$${v.toFixed(4)}`; }
  function fmtK(v)  { if (!v) return '--'; return v > 1000 ? `${(v/1000).toFixed(1)}k` : v; }

  /* ── Public ──────────────────────────────────────────────────────────── */
  return {
    init() {
      if (!initialized) {
        buildControls();
        buildMain();
        initialized = true;
      }
      renderResults();
      if (!optionChain) loadChain();
    }
  };
})();
