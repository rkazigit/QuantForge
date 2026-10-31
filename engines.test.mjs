/**
 * Engine tests — run with:  npm test
 * Loads the browser scripts in a sandbox and checks them against known reference values.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');
const ctx = vm.createContext({ console, Math, Float64Array, Map, Set, Number, Infinity, NaN });
for (const f of ['indicators.js', 'strategies.js', 'options.js', 'backtest.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
const get = name => vm.runInContext(name, ctx);
const I = get('Indicators'), S = get('Strategies'), E = get('OptionsEngine'), B = get('BacktestEngine');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

// deterministic RNG so tests are reproducible
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function synth(n = 1500, seed = 7) {
  const r = rng(seed), gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const d = { timestamps: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  let px = 100, t = 1_600_000_000;
  for (let i = 0; i < n; i++) {
    const drift = 0.0004 * Math.sin(i / 120), o = px * (1 + 0.002 * gauss());
    const c = o * (1 + drift + 0.013 * gauss());
    d.timestamps.push(t += 86400); d.opens.push(o); d.closes.push(c);
    d.highs.push(Math.max(o, c) * (1 + Math.abs(gauss()) * 0.004));
    d.lows.push(Math.min(o, c) * (1 - Math.abs(gauss()) * 0.004));
    d.volumes.push(1e6 * (0.6 + r()));
    px = c;
  }
  return d;
}

/* ── Options ─────────────────────────────────────────────────────────── */
test('Black-Scholes matches textbook values (S=K=100, r=5%, σ=20%, T=1)', () => {
  const p = E.bsm(100, 100, 1, 0.05, 0.2);
  near(p.call, 10.4506, 1e-3, 'call'); near(p.put, 5.5735, 1e-3, 'put');
});
test('put-call parity holds with dividends', () => {
  const p = E.bsm(120, 100, 0.7, 0.04, 0.3, 0.02);
  near(p.call - p.put, 120 * Math.exp(-0.02 * 0.7) - 100 * Math.exp(-0.04 * 0.7), 1e-6);
});
test('Greeks match reference values', () => {
  const g = E.greeks(100, 100, 1, 0.05, 0.2);
  near(g.delta_c, 0.6368, 1e-3, 'delta'); near(g.gamma, 0.018762, 1e-5, 'gamma');
  near(g.vega, 37.524, 0.01, 'vega'); near(g.theta_c * 365, -6.414, 0.01, 'theta'); near(g.rho_c, 53.232, 0.02, 'rho');
});
test('Greeks agree with finite differences of the price', () => {
  const f = (S, s = 0.2) => E.bsm(S, 100, 0.5, 0.03, s, 0.01).call, h = 0.01;
  const g = E.greeks(105, 100, 0.5, 0.03, 0.2, 0.01);
  near(g.delta_c, (f(105 + h) - f(105 - h)) / (2 * h), 1e-5, 'delta fd');
  near(g.gamma, (f(105 + h) - 2 * f(105) + f(105 - h)) / (h * h), 1e-4, 'gamma fd');
  near(g.vega, (f(105, 0.2 + 1e-4) - f(105, 0.2 - 1e-4)) / 2e-4, 1e-2, 'vega fd');
});
test('implied vol round-trips', () => {
  for (const sig of [0.1, 0.25, 0.6, 1.2]) {
    const px = E.bsm(100, 110, 0.4, 0.03, sig).call, iv = E.impliedVol(px, 100, 110, 0.4, 0.03, 0, true);
    near(iv, sig, 1e-4, `σ=${sig}`);
  }
});
test('Monte Carlo is statistically consistent with Black-Scholes', () => {
  const ref = E.bsm(100, 100, 1, 0.05, 0.2).call, mc = E.monteCarlo(100, 100, 1, 0.05, 0.2, 0, 200000, true);
  assert.ok(Math.abs(mc.price - ref) < 4 * mc.se, `MC ${mc.price} vs ${ref} (se ${mc.se})`);
});
test('binomial converges to BSM; American put carries an early-exercise premium', () => {
  near(E.binomial(100, 100, 1, 0.05, 0.2, 0, 800, true, false), 10.4506, 0.02);
  const eu = E.binomial(100, 110, 1, 0.08, 0.25, 0, 400, false, false), am = E.binomial(100, 110, 1, 0.08, 0.25, 0, 400, false, true);
  assert.ok(am > eu + 1e-3, `American ${am} should exceed European ${eu}`);
  const cEu = E.binomial(100, 100, 1, 0.05, 0.2, 0, 400, true, false), cAm = E.binomial(100, 100, 1, 0.05, 0.2, 0, 400, true, true);
  near(cAm, cEu, 1e-9, 'American call on non-dividend stock == European');
});

/* ── Indicators ──────────────────────────────────────────────────────── */
test('SMA / EMA basics and null-safety', () => {
  assert.deepEqual(Array.from(I.sma([1, 2, 3, 4, 5], 3)), [null, null, 2, 3, 4]);
  assert.deepEqual(Array.from(I.sma([null, null, 1, 2, 3, 4], 3)), [null, null, null, null, 2, 3]);   // window must be fully valid
  const e = I.ema([1, 2, 3, 4, 5, 6], 3);
  near(e[2], 2, 1e-12); near(e[3], 3, 1e-12);                                            // seeded with SMA; linear series
  const withNaN = I.ema([NaN, NaN, 1, 2, 3, 4], 3);
  near(withNaN[4], 2, 1e-12, 'EMA must skip NaN warm-up');
});
test('RSI bounds and extremes', () => {
  const up = I.rsi(Array.from({ length: 40 }, (_, i) => 100 + i), 14);
  assert.equal(up[39], 100);
  const d = synth(400); const r = I.rsi(d.closes, 14).filter(v => v != null);
  assert.ok(r.every(v => v >= 0 && v <= 100));
});
test('MACD signal and histogram are actually computed (regression: NaN propagation)', () => {
  const d = synth(400), m = I.macd(d.closes, 12, 26, 9);
  assert.ok(m.signal.filter(v => v != null && Number.isFinite(v)).length > 300, 'signal line populated');
  const i = 300; near(m.histogram[i], m.macd[i] - m.signal[i], 1e-12);
});
test('ADX is computed, bounded, and DI lines exist (regression: Wilder seeding)', () => {
  const d = synth(500), a = I.adx(d.highs, d.lows, d.closes, 14);
  const vals = a.adx.filter(v => v != null);
  assert.ok(vals.length > 400, `ADX populated (${vals.length})`);
  assert.ok(vals.every(v => v >= 0 && v <= 100), 'ADX within 0..100');
});
test('Bollinger, Stochastic, ATR sanity', () => {
  const d = synth(300), bb = I.bollingerBands(d.closes, 20, 2);
  for (let i = 19; i < 300; i++) assert.ok(bb.upper[i] > bb.middle[i] && bb.middle[i] > bb.lower[i]);
  const st = I.stochastic(d.highs, d.lows, d.closes, 14, 3);
  assert.ok(st.k.filter(v => v != null).every(v => v >= -1e-9 && v <= 100 + 1e-9));
  assert.ok(st.d.filter(v => v != null).length > 250, 'stochastic %D populated');
  assert.ok(I.atr(d.highs, d.lows, d.closes, 14).filter(v => v != null).every(v => v > 0));
});

/* ── Backtest accounting ─────────────────────────────────────────────── */
const flat = { timestamps: [1, 2, 3, 4, 5].map(x => x * 86400), opens: [100, 100, 110, 120, 120], closes: [100, 100, 110, 120, 120] };
test('long trade accounting is exact (fills at NEXT bar open, zero costs)', () => {
  const r = B.run(flat, [{ index: 0, action: 'buy' }, { index: 2, action: 'close' }], { initialCapital: 10000, commission: 0, slippage: 0, positionSizePct: 1 });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].entryPrice, 100); assert.equal(r.trades[0].exitPrice, 120);   // signal@0 → fill open[1]; signal@2 → fill open[3]
  near(r.trades[0].pnl, 2000, 1e-9); near(r.equity[r.equity.length - 1], 12000, 1e-9);
});
test('short trade accounting is exact', () => {
  const d = { ...flat, opens: [100, 100, 90, 80, 80], closes: [100, 100, 90, 80, 80] };
  const r = B.run(d, [{ index: 0, action: 'sell' }, { index: 2, action: 'close' }], { initialCapital: 10000, commission: 0, slippage: 0, positionSizePct: 1 });
  near(r.trades[0].pnl, 2000, 1e-9); near(r.equity[r.equity.length - 1], 12000, 1e-9);
});
test('costs reduce P&L and reversal signals flip the position', () => {
  const free = B.run(flat, [{ index: 0, action: 'buy' }, { index: 2, action: 'close' }], { initialCapital: 10000, commission: 0, slippage: 0, positionSizePct: 1 });
  const paid = B.run(flat, [{ index: 0, action: 'buy' }, { index: 2, action: 'close' }], { initialCapital: 10000, commission: 0.001, slippage: 0.0005, positionSizePct: 1 });
  assert.ok(paid.trades[0].pnl < free.trades[0].pnl);
  const flip = B.run(flat, [{ index: 0, action: 'buy' }, { index: 1, action: 'sell' }], { initialCapital: 10000, commission: 0, slippage: 0, positionSizePct: 1 });
  assert.equal(flip.trades[0].side, 'long'); assert.equal(flip.trades[1].side, 'short');
});

/* ── All strategies run end-to-end ───────────────────────────────────── */
test('every registered strategy runs and produces finite, well-formed output', () => {
  const d = synth(1500); let withSignals = 0;
  for (const s of S.REGISTRY) {
    const res = S.run(s.id, d);
    assert.ok(Array.isArray(res.signals), s.id);
    for (const sig of res.signals) {
      assert.ok(['buy', 'sell', 'close'].includes(sig.action), `${s.id} action`);
      assert.ok(Number.isInteger(sig.index) && sig.index >= 0 && sig.index < 1500 && Number.isFinite(sig.price), `${s.id} signal shape`);
    }
    const bt = B.run(d, res.signals, { initialCapital: 100000, commission: 0.001, slippage: 0.0005, positionSizePct: 0.95 });
    assert.ok([...bt.equity].every(Number.isFinite), `${s.id} equity finite`);
    assert.ok(Number.isFinite(bt.metrics.sharpe) && Number.isFinite(bt.metrics.maxDrawdown), `${s.id} metrics finite`);
    if (res.signals.length) withSignals++;
    console.log(`  ${s.id.padEnd(14)} signals=${String(res.signals.length).padStart(3)} trades=${String(bt.metrics.totalTrades).padStart(3)} ret=${bt.metrics.totalReturn.toFixed(1).padStart(7)}% sharpe=${bt.metrics.sharpe.toFixed(2)}`);
  }
  assert.ok(withSignals >= 13, `only ${withSignals}/15 strategies produced any signal`);
  const macd = S.run('macd-cross', d).signals.length, adx = S.run('adx-trend', d).signals.length;
  assert.ok(macd > 0, 'MACD strategy must trade (regression: NaN signal line)');
  assert.ok(adx > 0, 'ADX strategy must trade (regression: Wilder seeding)');
});
