'use strict';
/**
 * strategies.js — Algorithmic Trading Strategy Library
 * =====================================================
 * Each strategy:
 *   Input  : { timestamps[], opens[], highs[], lows[], closes[], volumes[] }
 *   Config : strategy-specific parameters
 *   Output : { signals[], trades[], config }
 *
 * Signal object: { index, time, action: 'buy'|'sell'|'close', price, reason, strength }
 */

const Strategies = (() => {

  const I = Indicators; // shorthand

  /* ── Utility ─────────────────────────────────────────────────────────── */
  function crossAbove(a, b, i) {
    if (i < 1) return false;
    return (a[i-1] == null || b[i-1] == null) ? false : a[i-1] <= b[i-1] && a[i] > b[i];
  }
  function crossBelow(a, b, i) {
    if (i < 1) return false;
    return (a[i-1] == null || b[i-1] == null) ? false : a[i-1] >= b[i-1] && a[i] < b[i];
  }

  /* ═══════════════════════════════════════════════════════════════════════
     1. BOLLINGER BAND MEAN REVERSION
     Buy lower band touch + RSI oversold; sell upper band touch + RSI overbought
     ═══════════════════════════════════════════════════════════════════════ */
  function bollingerMeanReversion(data, cfg = {}) {
    const { period = 20, mult = 2, rsiPeriod = 14, rsiOB = 70, rsiOS = 30 } = cfg;
    const { timestamps, closes } = data;

    const bb  = I.bollingerBands(closes, period, mult);
    const rsiV = I.rsi(closes, rsiPeriod);

    const signals = [];
    let   pos = 0;

    for (let i = period + rsiPeriod; i < closes.length; i++) {
      if (bb.upper[i] == null || rsiV[i] == null) continue;
      const px = closes[i];

      if (pos === 0) {
        if (px <= bb.lower[i] && rsiV[i] < rsiOS) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: px, reason: `Price at lower BB + RSI=${rsiV[i].toFixed(1)} (oversold)`, strength: (rsiOS - rsiV[i]) / rsiOS });
          pos = 1;
        } else if (px >= bb.upper[i] && rsiV[i] > rsiOB) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: px, reason: `Price at upper BB + RSI=${rsiV[i].toFixed(1)} (overbought)`, strength: (rsiV[i] - rsiOB) / (100 - rsiOB) });
          pos = -1;
        }
      } else if (pos === 1 && px >= bb.middle[i]) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: px, reason: 'Price reverted to middle BB', strength: 0.5 });
        pos = 0;
      } else if (pos === -1 && px <= bb.middle[i]) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: px, reason: 'Price reverted to middle BB', strength: 0.5 });
        pos = 0;
      }
    }
    return { signals, name: 'Bollinger Mean Reversion', config: { period, mult, rsiPeriod, rsiOB, rsiOS } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     2. MACD CROSSOVER with trend filter
     Long: MACD crosses above signal AND price above 200 SMA
     Short: MACD crosses below signal AND price below 200 SMA
     ═══════════════════════════════════════════════════════════════════════ */
  function macdCrossover(data, cfg = {}) {
    const { fast = 12, slow = 26, signal = 9, trendPeriod = 200 } = cfg;
    const { timestamps, closes } = data;

    const macdData  = I.macd(closes, fast, slow, signal);
    const trend     = I.ema(closes, trendPeriod);

    const signals = [];
    let   pos = 0;

    for (let i = slow + signal; i < closes.length; i++) {
      const { macd: ml, signal: sl } = macdData;
      if (ml[i] == null || sl[i] == null) continue;

      const aboveTrend = trend[i] == null || closes[i] > trend[i];
      const belowTrend = trend[i] == null || closes[i] < trend[i];

      if (pos === 0) {
        if (crossAbove(ml, sl, i) && aboveTrend) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `MACD(${fast},${slow}) crossed above signal` });
          pos = 1;
        } else if (crossBelow(ml, sl, i) && belowTrend) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `MACD(${fast},${slow}) crossed below signal` });
          pos = -1;
        }
      } else if (pos === 1 && crossBelow(ml, sl, i)) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'MACD crossed below signal — exit long' });
        pos = 0;
      } else if (pos === -1 && crossAbove(ml, sl, i)) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'MACD crossed above signal — exit short' });
        pos = 0;
      }
    }
    return { signals, name: 'MACD Crossover', config: { fast, slow, signal, trendPeriod } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     3. MOVING AVERAGE CROSSOVER (Golden/Death Cross)
     ═══════════════════════════════════════════════════════════════════════ */
  function maCrossover(data, cfg = {}) {
    const { fast = 50, slow = 200, maType = 'ema' } = cfg;
    const { timestamps, closes } = data;

    const calcMA = maType === 'sma' ? I.sma : I.ema;
    const fastMA = calcMA(closes, fast);
    const slowMA = calcMA(closes, slow);

    const signals = [];
    let   pos = 0;

    for (let i = slow + 1; i < closes.length; i++) {
      if (fastMA[i] == null || slowMA[i] == null) continue;

      if (pos !== 1 && crossAbove(fastMA, slowMA, i)) {
        if (pos === -1) signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Golden cross — covering short' });
        signals.push({ index: i, time: timestamps[i], action: 'buy', price: closes[i], reason: `Golden Cross: ${maType.toUpperCase()}(${fast}) crossed above ${maType.toUpperCase()}(${slow})`, strength: 0.8 });
        pos = 1;
      } else if (pos !== -1 && crossBelow(fastMA, slowMA, i)) {
        if (pos === 1) signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Death cross — selling long' });
        signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Death Cross: ${maType.toUpperCase()}(${fast}) crossed below ${maType.toUpperCase()}(${slow})`, strength: 0.8 });
        pos = -1;
      }
    }
    return { signals, name: `MA Crossover (${fast}/${slow})`, config: { fast, slow, maType } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     4. RSI MEAN REVERSION
     Long: RSI crosses from below oversold threshold back above it
     Short: RSI crosses from above overbought threshold back below it
     ═══════════════════════════════════════════════════════════════════════ */
  function rsiMeanReversion(data, cfg = {}) {
    const { period = 14, oversold = 30, overbought = 70 } = cfg;
    const { timestamps, closes } = data;

    const rsiV = I.rsi(closes, period);
    const signals = [];
    let   pos = 0;

    for (let i = period + 1; i < closes.length; i++) {
      if (rsiV[i] == null || rsiV[i-1] == null) continue;

      if (pos === 0) {
        // Buy when RSI crosses back above oversold
        if (rsiV[i-1] <= oversold && rsiV[i] > oversold) {
          signals.push({ index: i, time: timestamps[i], action: 'buy', price: closes[i], reason: `RSI(${period}) crossed above ${oversold} from oversold`, strength: (oversold - rsiV[i-1]) / oversold });
          pos = 1;
        }
        // Sell when RSI crosses back below overbought
        else if (rsiV[i-1] >= overbought && rsiV[i] < overbought) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `RSI(${period}) crossed below ${overbought} from overbought`, strength: (rsiV[i-1] - overbought) / (100 - overbought) });
          pos = -1;
        }
      } else if (pos === 1 && rsiV[i] > 50) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'RSI reached 50 — exit long' });
        pos = 0;
      } else if (pos === -1 && rsiV[i] < 50) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'RSI reached 50 — exit short' });
        pos = 0;
      }
    }
    return { signals, name: `RSI Mean Reversion (${period})`, config: { period, oversold, overbought } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     5. TURTLE TRADING (Donchian Breakout)
     Donchian rules: enter on N-day high/low breakout, exit on M-day opposite
     ═══════════════════════════════════════════════════════════════════════ */
  function turtleTrading(data, cfg = {}) {
    const { entryPeriod = 20, exitPeriod = 10 } = cfg;
    const { timestamps, highs, lows, closes } = data;

    const entryHigh = I.highestHigh(highs, entryPeriod);
    const entryLow  = I.lowestLow  (lows,  entryPeriod);
    const exitHigh  = I.highestHigh(highs, exitPeriod);
    const exitLow   = I.lowestLow  (lows,  exitPeriod);

    const signals = [];
    let   pos = 0;

    for (let i = entryPeriod + 1; i < closes.length; i++) {
      if (entryHigh[i] == null) continue;
      const px = closes[i];

      if (pos === 0) {
        // Breakout long: price exceeds previous entryPeriod high
        if (px > entryHigh[i-1]) {
          signals.push({ index: i, time: timestamps[i], action: 'buy', price: px, reason: `Turtle long: price broke ${entryPeriod}-day high ($${entryHigh[i-1].toFixed(2)})`, strength: 0.7 });
          pos = 1;
        }
        // Breakout short: price falls below previous entryPeriod low
        else if (px < entryLow[i-1]) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: px, reason: `Turtle short: price broke ${entryPeriod}-day low ($${entryLow[i-1].toFixed(2)})`, strength: 0.7 });
          pos = -1;
        }
      } else if (pos === 1 && exitLow[i] != null && px < exitLow[i]) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: px, reason: `Turtle exit long: price below ${exitPeriod}-day low` });
        pos = 0;
      } else if (pos === -1 && exitHigh[i] != null && px > exitHigh[i]) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: px, reason: `Turtle exit short: price above ${exitPeriod}-day high` });
        pos = 0;
      }
    }
    return { signals, name: `Turtle Trading (${entryPeriod}/${exitPeriod})`, config: { entryPeriod, exitPeriod } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     6. VWAP DEVIATION
     Mean-revert when price deviates significantly from VWAP
     ═══════════════════════════════════════════════════════════════════════ */
  function vwapDeviation(data, cfg = {}) {
    const { deviationPct = 1.5, exitDeviationPct = 0.3 } = cfg;
    const { timestamps, highs, lows, closes, volumes } = data;

    const vwapV = I.vwap(highs, lows, closes, volumes);
    const signals = [];
    let   pos = 0;

    for (let i = 1; i < closes.length; i++) {
      if (vwapV[i] == null) continue;
      const dev = ((closes[i] - vwapV[i]) / vwapV[i]) * 100;

      if (pos === 0) {
        if (dev < -deviationPct) {
          signals.push({ index: i, time: timestamps[i], action: 'buy', price: closes[i], reason: `Price ${dev.toFixed(2)}% below VWAP — mean reversion long`, strength: Math.min(Math.abs(dev) / deviationPct, 1) });
          pos = 1;
        } else if (dev > deviationPct) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Price ${dev.toFixed(2)}% above VWAP — mean reversion short`, strength: Math.min(dev / deviationPct, 1) });
          pos = -1;
        }
      } else if (pos === 1 && dev > -exitDeviationPct) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Price returned to VWAP — exit long' });
        pos = 0;
      } else if (pos === -1 && dev < exitDeviationPct) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Price returned to VWAP — exit short' });
        pos = 0;
      }
    }
    return { signals, name: 'VWAP Deviation', config: { deviationPct, exitDeviationPct } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     7. SUPERTREND FOLLOWING
     ═══════════════════════════════════════════════════════════════════════ */
  function supertrendFollow(data, cfg = {}) {
    const { period = 10, mult = 3 } = cfg;
    const { timestamps, highs, lows, closes } = data;

    const st  = I.supertrend(highs, lows, closes, period, mult);
    const signals = [];
    let   pos = 0;

    for (let i = period + 1; i < closes.length; i++) {
      if (st.direction[i] == null || st.direction[i-1] == null) continue;

      const turned_bull = st.direction[i] === 1  && st.direction[i-1] === -1;
      const turned_bear = st.direction[i] === -1 && st.direction[i-1] === 1;

      if (turned_bull && pos !== 1) {
        if (pos === -1) signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Supertrend flipped bullish — cover short' });
        signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `Supertrend(${period},${mult}) flipped bullish`, strength: 0.75 });
        pos = 1;
      } else if (turned_bear && pos !== -1) {
        if (pos === 1)  signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Supertrend flipped bearish — close long' });
        signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Supertrend(${period},${mult}) flipped bearish`, strength: 0.75 });
        pos = -1;
      }
    }
    return { signals, name: `Supertrend (${period}, ${mult})`, config: { period, mult } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     8. STOCHASTIC CROSSOVER
     ═══════════════════════════════════════════════════════════════════════ */
  function stochasticCrossover(data, cfg = {}) {
    const { kPeriod = 14, dPeriod = 3, oversold = 20, overbought = 80 } = cfg;
    const { timestamps, highs, lows, closes } = data;

    const stoch = I.stochastic(highs, lows, closes, kPeriod, dPeriod);
    const signals = [];
    let   pos = 0;

    for (let i = kPeriod + dPeriod + 1; i < closes.length; i++) {
      const { k, d } = stoch;
      if (k[i] == null || d[i] == null) continue;

      if (pos === 0) {
        if (k[i] < oversold && d[i] < oversold && crossAbove(k, d, i)) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `Stoch K crossed above D in oversold zone (K=${k[i].toFixed(1)})`, strength: (oversold - k[i]) / oversold });
          pos = 1;
        } else if (k[i] > overbought && d[i] > overbought && crossBelow(k, d, i)) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Stoch K crossed below D in overbought zone (K=${k[i].toFixed(1)})`, strength: (k[i] - overbought) / (100 - overbought) });
          pos = -1;
        }
      } else if (pos === 1 && k[i] > overbought) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: `Stochastic overbought (K=${k[i].toFixed(1)}) — exit long` });
        pos = 0;
      } else if (pos === -1 && k[i] < oversold) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: `Stochastic oversold (K=${k[i].toFixed(1)}) — exit short` });
        pos = 0;
      }
    }
    return { signals, name: 'Stochastic Crossover', config: { kPeriod, dPeriod, oversold, overbought } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     9. MOMENTUM BREAKOUT (price + volume confirmation)
     ═══════════════════════════════════════════════════════════════════════ */
  function momentumBreakout(data, cfg = {}) {
    const { lookback = 20, volMultiplier = 1.5, rocPeriod = 10, rocThreshold = 2 } = cfg;
    const { timestamps, highs, lows, closes, volumes } = data;

    const highestH = I.highestHigh(highs, lookback);
    const lowestL  = I.lowestLow  (lows,  lookback);
    const rocV     = I.roc(closes, rocPeriod);
    const avgVol   = I.sma(volumes, lookback);
    const atrV     = I.atr(highs, lows, closes, 14);

    const signals = [];
    let   pos = 0;
    let   extreme = 0;   // best close since entry (for the 2-ATR trailing stop)

    for (let i = lookback + rocPeriod; i < closes.length; i++) {
      if (highestH[i-1] == null || rocV[i] == null || avgVol[i] == null) continue;
      const highVolume = volumes[i] > avgVol[i] * volMultiplier;

      if (pos === 0) {
        extreme = closes[i];
        // Bullish breakout: new N-day high + strong volume + positive momentum
        if (closes[i] > highestH[i-1] && highVolume && rocV[i] > rocThreshold) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `Momentum breakout: new ${lookback}d high + ${(volumes[i]/avgVol[i]).toFixed(1)}x avg volume`, strength: Math.min(rocV[i] / (rocThreshold * 2), 1) });
          pos = 1;
        }
        // Bearish breakdown
        else if (closes[i] < lowestL[i-1] && highVolume && rocV[i] < -rocThreshold) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Bearish breakdown: new ${lookback}d low + ${(volumes[i]/avgVol[i]).toFixed(1)}x avg volume`, strength: Math.min(-rocV[i] / (rocThreshold * 2), 1) });
          pos = -1;
        }
      } else if (pos === 1) {
        extreme = Math.max(extreme, closes[i]);
        if (atrV[i] && closes[i] < extreme - 2 * atrV[i]) {
          signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: '2-ATR trailing stop hit — exit long' });
          pos = 0;
        }
      } else if (pos === -1) {
        extreme = Math.min(extreme, closes[i]);
        if (atrV[i] && closes[i] > extreme + 2 * atrV[i]) {
          signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: '2-ATR trailing stop hit — exit short' });
          pos = 0;
        }
      }
    }
    return { signals, name: 'Momentum Breakout', config: { lookback, volMultiplier, rocPeriod, rocThreshold } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     10. ADX TREND FOLLOWING
     Only enter when trend is strong (ADX > threshold)
     ═══════════════════════════════════════════════════════════════════════ */
  function adxTrendFollowing(data, cfg = {}) {
    const { adxPeriod = 14, adxThreshold = 25, emaPeriod = 20 } = cfg;
    const { timestamps, highs, lows, closes } = data;

    const adxData = I.adx(highs, lows, closes, adxPeriod);
    const trend   = I.ema(closes, emaPeriod);

    const signals = [];
    let   pos = 0;

    for (let i = adxPeriod * 2; i < closes.length; i++) {
      const { adx: adxLine, plusDI, minusDI } = adxData;
      if (adxLine[i] == null || trend[i] == null) continue;

      const strongTrend = adxLine[i] > adxThreshold;

      if (pos === 0 && strongTrend) {
        if (plusDI[i] > minusDI[i] && closes[i] > trend[i] && crossAbove(plusDI, minusDI, i)) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `ADX=${adxLine[i].toFixed(1)} > ${adxThreshold} (+DI > -DI) — strong uptrend`, strength: Math.min(adxLine[i] / 50, 1) });
          pos = 1;
        } else if (minusDI[i] > plusDI[i] && closes[i] < trend[i] && crossBelow(plusDI, minusDI, i)) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `ADX=${adxLine[i].toFixed(1)} > ${adxThreshold} (-DI > +DI) — strong downtrend`, strength: Math.min(adxLine[i] / 50, 1) });
          pos = -1;
        }
      } else if (pos === 1 && (adxLine[i] < 20 || minusDI[i] > plusDI[i])) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'ADX weakened or DI crossed — exit long' });
        pos = 0;
      } else if (pos === -1 && (adxLine[i] < 20 || plusDI[i] > minusDI[i])) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'ADX weakened or DI crossed — exit short' });
        pos = 0;
      }
    }
    return { signals, name: `ADX Trend Following (${adxPeriod})`, config: { adxPeriod, adxThreshold, emaPeriod } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     11. KELTNER CHANNEL BREAKOUT
     ═══════════════════════════════════════════════════════════════════════ */
  function keltnerBreakout(data, cfg = {}) {
    const { period = 20, mult = 2 } = cfg;
    const { timestamps, highs, lows, closes } = data;

    const kc = I.keltnerChannels(highs, lows, closes, period, mult);
    const signals = [];
    let   pos = 0;

    for (let i = period + 1; i < closes.length; i++) {
      if (kc.upper[i] == null) continue;

      if (pos === 0) {
        if (closes[i] > kc.upper[i] && closes[i-1] <= kc.upper[i-1]) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `Keltner Channel breakout above upper band ($${kc.upper[i].toFixed(2)})`, strength: 0.65 });
          pos = 1;
        } else if (closes[i] < kc.lower[i] && closes[i-1] >= kc.lower[i-1]) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Keltner Channel breakdown below lower band ($${kc.lower[i].toFixed(2)})`, strength: 0.65 });
          pos = -1;
        }
      } else if (pos === 1 && closes[i] < kc.middle[i]) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Price fell below Keltner midline — exit long' });
        pos = 0;
      } else if (pos === -1 && closes[i] > kc.middle[i]) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Price rose above Keltner midline — exit short' });
        pos = 0;
      }
    }
    return { signals, name: `Keltner Breakout (${period}, ${mult})`, config: { period, mult } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     12. TRIPLE MA SYSTEM (fast/mid/slow)
     All three aligned for entry; any misalignment = exit
     ═══════════════════════════════════════════════════════════════════════ */
  function tripleMA(data, cfg = {}) {
    const { fast = 5, mid = 20, slow = 60, maType = 'ema' } = cfg;
    const { timestamps, closes } = data;

    const calc = maType === 'sma' ? I.sma : I.ema;
    const fMA  = calc(closes, fast);
    const mMA  = calc(closes, mid);
    const sMA  = calc(closes, slow);

    const signals = [];
    let   pos = 0;

    for (let i = slow + 1; i < closes.length; i++) {
      if (fMA[i] == null || mMA[i] == null || sMA[i] == null) continue;

      const bullAligned = fMA[i] > mMA[i] && mMA[i] > sMA[i];
      const bearAligned = fMA[i] < mMA[i] && mMA[i] < sMA[i];

      if (pos === 0) {
        if (bullAligned && !( fMA[i-1] > mMA[i-1] && mMA[i-1] > sMA[i-1] )) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `Triple MA aligned bullish: F(${fast}) > M(${mid}) > S(${slow})`, strength: 0.7 });
          pos = 1;
        } else if (bearAligned && !( fMA[i-1] < mMA[i-1] && mMA[i-1] < sMA[i-1] )) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Triple MA aligned bearish: F(${fast}) < M(${mid}) < S(${slow})`, strength: 0.7 });
          pos = -1;
        }
      } else if (pos === 1 && !bullAligned) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Triple MA alignment broken — exit long' });
        pos = 0;
      } else if (pos === -1 && !bearAligned) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'Triple MA alignment broken — exit short' });
        pos = 0;
      }
    }
    return { signals, name: `Triple MA (${fast}/${mid}/${slow})`, config: { fast, mid, slow, maType } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     13. CCI REVERSAL
     ═══════════════════════════════════════════════════════════════════════ */
  function cciReversal(data, cfg = {}) {
    const { period = 20, extreme = 100 } = cfg;
    const { timestamps, highs, lows, closes } = data;

    const cciV = I.cci(highs, lows, closes, period);
    const signals = [];
    let   pos = 0;

    for (let i = period + 1; i < closes.length; i++) {
      if (cciV[i] == null || cciV[i-1] == null) continue;

      if (pos === 0) {
        // Long: CCI comes back above -100 after being below
        if (cciV[i-1] <= -extreme && cciV[i] > -extreme) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `CCI(${period}) crossed above -${extreme} — oversold reversal`, strength: Math.min(Math.abs(cciV[i-1]) / 200, 1) });
          pos = 1;
        }
        // Short: CCI comes back below +100
        else if (cciV[i-1] >= extreme && cciV[i] < extreme) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `CCI(${period}) crossed below +${extreme} — overbought reversal`, strength: Math.min(cciV[i-1] / 200, 1) });
          pos = -1;
        }
      } else if (pos === 1 && cciV[i] >= extreme) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: `CCI reached +${extreme} — exit long` });
        pos = 0;
      } else if (pos === -1 && cciV[i] <= -extreme) {
        signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: `CCI reached -${extreme} — exit short` });
        pos = 0;
      }
    }
    return { signals, name: `CCI Reversal (${period})`, config: { period, extreme } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     14. PARABOLIC SAR FOLLOW
     ═══════════════════════════════════════════════════════════════════════ */
  function parabolicSARFollow(data, cfg = {}) {
    const { step = 0.02, maxStep = 0.2 } = cfg;
    const { timestamps, highs, lows, closes } = data;

    const sarV = I.parabolicSAR(highs, lows, step, maxStep);
    const signals = [];
    let   pos = 0;

    for (let i = 2; i < closes.length; i++) {
      if (sarV[i] == null || sarV[i-1] == null) continue;

      const wasBelow = sarV[i-1] > closes[i-1];  // SAR above price = bearish
      const isAbove  = sarV[i]   < closes[i];     // SAR below price = bullish

      if (pos !== 1 && !wasBelow && isAbove) {
        if (pos === -1) signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'SAR flipped — cover short' });
        signals.push({ index: i, time: timestamps[i], action: 'buy', price: closes[i], reason: 'Parabolic SAR flipped bullish (SAR now below price)', strength: 0.6 });
        pos = 1;
      } else if (pos !== -1 && wasBelow && !isAbove) {
        if (pos === 1) signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: 'SAR flipped — close long' });
        signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: 'Parabolic SAR flipped bearish (SAR now above price)', strength: 0.6 });
        pos = -1;
      }
    }
    return { signals, name: 'Parabolic SAR', config: { step, maxStep } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     15. Z-SCORE MEAN REVERSION (statistical arbitrage style)
     ═══════════════════════════════════════════════════════════════════════ */
  function zScoreMeanReversion(data, cfg = {}) {
    const { period = 30, entryZ = 2.0, exitZ = 0.5, stopZ = 3.5 } = cfg;
    const { timestamps, closes } = data;

    const zsV = I.zScore(closes, period);
    const signals = [];
    let   pos = 0;

    for (let i = period; i < closes.length; i++) {
      if (zsV[i] == null) continue;
      const z = zsV[i];

      if (pos === 0) {
        if (z < -entryZ) {
          signals.push({ index: i, time: timestamps[i], action: 'buy',  price: closes[i], reason: `Z-score = ${z.toFixed(2)} < -${entryZ} — statistically oversold`, strength: Math.min(Math.abs(z) / (entryZ * 2), 1) });
          pos = 1;
        } else if (z > entryZ) {
          signals.push({ index: i, time: timestamps[i], action: 'sell', price: closes[i], reason: `Z-score = ${z.toFixed(2)} > +${entryZ} — statistically overbought`, strength: Math.min(z / (entryZ * 2), 1) });
          pos = -1;
        }
      } else if (pos === 1) {
        if (z > -exitZ || z < -stopZ) {
          signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: z > -exitZ ? `Z-score reverted to ${z.toFixed(2)}` : `Stop loss: Z=${z.toFixed(2)} < -${stopZ}` });
          pos = 0;
        }
      } else if (pos === -1) {
        if (z < exitZ || z > stopZ) {
          signals.push({ index: i, time: timestamps[i], action: 'close', price: closes[i], reason: z < exitZ ? `Z-score reverted to ${z.toFixed(2)}` : `Stop loss: Z=${z.toFixed(2)} > ${stopZ}` });
          pos = 0;
        }
      }
    }
    return { signals, name: `Z-Score Mean Reversion (${period})`, config: { period, entryZ, exitZ, stopZ } };
  }

  /* ── Strategy Registry ───────────────────────────────────────────────── */
  const REGISTRY = [
    { id: 'bollinger-mr',     label: 'Bollinger Mean Reversion',    fn: bollingerMeanReversion,
      params: [
        { key: 'period',    label: 'BB Period',   type: 'range', min: 10, max: 50,  step: 1,   def: 20  },
        { key: 'mult',      label: 'BB Mult',     type: 'range', min: 1,  max: 4,   step: 0.1, def: 2   },
        { key: 'rsiPeriod', label: 'RSI Period',  type: 'range', min: 5,  max: 30,  step: 1,   def: 14  },
        { key: 'rsiOS',     label: 'RSI OS',      type: 'range', min: 10, max: 40,  step: 1,   def: 30  },
        { key: 'rsiOB',     label: 'RSI OB',      type: 'range', min: 60, max: 90,  step: 1,   def: 70  },
      ]},
    { id: 'macd-cross',       label: 'MACD Crossover',              fn: macdCrossover,
      params: [
        { key: 'fast',         label: 'Fast EMA',    type: 'range', min: 5,  max: 30,  step: 1,   def: 12  },
        { key: 'slow',         label: 'Slow EMA',    type: 'range', min: 15, max: 60,  step: 1,   def: 26  },
        { key: 'signal',       label: 'Signal',      type: 'range', min: 3,  max: 20,  step: 1,   def: 9   },
        { key: 'trendPeriod',  label: 'Trend Filter',type: 'range', min: 50, max: 300, step: 10,  def: 200 },
      ]},
    { id: 'ma-cross',         label: 'MA Golden/Death Cross',       fn: maCrossover,
      params: [
        { key: 'fast',   label: 'Fast MA',  type: 'range', min: 10,  max: 100, step: 5,  def: 50  },
        { key: 'slow',   label: 'Slow MA',  type: 'range', min: 50,  max: 400, step: 10, def: 200 },
      ]},
    { id: 'rsi-mr',           label: 'RSI Mean Reversion',          fn: rsiMeanReversion,
      params: [
        { key: 'period',     label: 'RSI Period', type: 'range', min: 5,  max: 30, step: 1, def: 14 },
        { key: 'oversold',   label: 'Oversold',   type: 'range', min: 10, max: 40, step: 1, def: 30 },
        { key: 'overbought', label: 'Overbought', type: 'range', min: 60, max: 90, step: 1, def: 70 },
      ]},
    { id: 'turtle',           label: 'Turtle Trading (Donchian)',   fn: turtleTrading,
      params: [
        { key: 'entryPeriod', label: 'Entry N',  type: 'range', min: 5,  max: 60, step: 1, def: 20 },
        { key: 'exitPeriod',  label: 'Exit N',   type: 'range', min: 3,  max: 30, step: 1, def: 10 },
      ]},
    { id: 'vwap-dev',         label: 'VWAP Deviation',              fn: vwapDeviation,
      params: [
        { key: 'deviationPct',     label: 'Entry Dev %', type: 'range', min: 0.5, max: 4,   step: 0.1, def: 1.5 },
        { key: 'exitDeviationPct', label: 'Exit Dev %',  type: 'range', min: 0,   max: 1,   step: 0.1, def: 0.3 },
      ]},
    { id: 'supertrend',       label: 'Supertrend',                  fn: supertrendFollow,
      params: [
        { key: 'period', label: 'ATR Period', type: 'range', min: 5,   max: 30, step: 1,   def: 10 },
        { key: 'mult',   label: 'Multiplier', type: 'range', min: 1.5, max: 5,  step: 0.1, def: 3  },
      ]},
    { id: 'stoch-cross',      label: 'Stochastic Crossover',        fn: stochasticCrossover,
      params: [
        { key: 'kPeriod',    label: '%K Period',  type: 'range', min: 5,  max: 30, step: 1, def: 14 },
        { key: 'dPeriod',    label: '%D Period',  type: 'range', min: 1,  max: 10, step: 1, def: 3  },
        { key: 'oversold',   label: 'Oversold',   type: 'range', min: 10, max: 30, step: 1, def: 20 },
        { key: 'overbought', label: 'Overbought', type: 'range', min: 70, max: 90, step: 1, def: 80 },
      ]},
    { id: 'momentum-bo',      label: 'Momentum Breakout',           fn: momentumBreakout,
      params: [
        { key: 'lookback',      label: 'Lookback',    type: 'range', min: 10, max: 60,  step: 1,   def: 20  },
        { key: 'volMultiplier', label: 'Vol Mult',    type: 'range', min: 1,  max: 3,   step: 0.1, def: 1.5 },
        { key: 'rocPeriod',     label: 'ROC Period',  type: 'range', min: 5,  max: 30,  step: 1,   def: 10  },
        { key: 'rocThreshold',  label: 'ROC Thresh%', type: 'range', min: 0.5,max: 5,   step: 0.1, def: 2   },
      ]},
    { id: 'adx-trend',        label: 'ADX Trend Following',         fn: adxTrendFollowing,
      params: [
        { key: 'adxPeriod',    label: 'ADX Period',  type: 'range', min: 10, max: 30, step: 1, def: 14 },
        { key: 'adxThreshold', label: 'ADX Thresh',  type: 'range', min: 15, max: 40, step: 1, def: 25 },
        { key: 'emaPeriod',    label: 'Trend EMA',   type: 'range', min: 10, max: 50, step: 1, def: 20 },
      ]},
    { id: 'keltner-bo',       label: 'Keltner Channel Breakout',    fn: keltnerBreakout,
      params: [
        { key: 'period', label: 'Period', type: 'range', min: 10, max: 50, step: 1,   def: 20 },
        { key: 'mult',   label: 'Mult',   type: 'range', min: 1,  max: 4,  step: 0.1, def: 2  },
      ]},
    { id: 'triple-ma',        label: 'Triple MA System',            fn: tripleMA,
      params: [
        { key: 'fast', label: 'Fast MA',  type: 'range', min: 3,  max: 20,  step: 1, def: 5  },
        { key: 'mid',  label: 'Mid MA',   type: 'range', min: 10, max: 50,  step: 1, def: 20 },
        { key: 'slow', label: 'Slow MA',  type: 'range', min: 30, max: 120, step: 1, def: 60 },
      ]},
    { id: 'cci-rev',          label: 'CCI Reversal',                fn: cciReversal,
      params: [
        { key: 'period',  label: 'CCI Period',  type: 'range', min: 10, max: 50,  step: 1, def: 20  },
        { key: 'extreme', label: 'Extreme ±',   type: 'range', min: 50, max: 200, step: 5, def: 100 },
      ]},
    { id: 'psar',             label: 'Parabolic SAR',               fn: parabolicSARFollow,
      params: [
        { key: 'step',    label: 'Step',     type: 'range', min: 0.01, max: 0.1,  step: 0.01, def: 0.02 },
        { key: 'maxStep', label: 'Max Step', type: 'range', min: 0.1,  max: 0.5,  step: 0.05, def: 0.2  },
      ]},
    { id: 'zscore-mr',        label: 'Z-Score Mean Reversion',      fn: zScoreMeanReversion,
      params: [
        { key: 'period',  label: 'Period',   type: 'range', min: 10, max: 60, step: 1,   def: 30  },
        { key: 'entryZ',  label: 'Entry |Z|',type: 'range', min: 1,  max: 3,  step: 0.1, def: 2.0 },
        { key: 'exitZ',   label: 'Exit |Z|', type: 'range', min: 0,  max: 1,  step: 0.1, def: 0.5 },
        { key: 'stopZ',   label: 'Stop |Z|', type: 'range', min: 2,  max: 5,  step: 0.1, def: 3.5 },
      ]},
  ];

  return {
    REGISTRY,
    run: (strategyId, data, userConfig = {}) => {
      const entry = REGISTRY.find(s => s.id === strategyId);
      if (!entry) throw new Error(`Unknown strategy: ${strategyId}`);
      // Merge defaults with user config
      const cfg = {};
      entry.params.forEach(p => { cfg[p.key] = p.key in userConfig ? userConfig[p.key] : p.def; });
      return entry.fn(data, cfg);
    },
    // Individual exports for direct use
    bollingerMeanReversion, macdCrossover, maCrossover, rsiMeanReversion,
    turtleTrading, vwapDeviation, supertrendFollow, stochasticCrossover,
    momentumBreakout, adxTrendFollowing, keltnerBreakout, tripleMA,
    cciReversal, parabolicSARFollow, zScoreMeanReversion,
  };
})();
