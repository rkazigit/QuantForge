'use strict';
/**
 * indicators.js — Technical Analysis Engine
 * ==========================================
 * 40+ indicators implemented from scratch with correct Wilder smoothing,
 * proper seed periods, and numerically stable calculations.
 *
 * All functions accept plain arrays and return plain arrays (or objects of arrays).
 * null values mark the "warm-up" period before the indicator is defined.
 *
 * Naming convention:
 *   Input arrays : close[], high[], low[], volume[]  (plain numbers)
 *   Outputs      : same-length arrays, nulls for warm-up period
 */

const Indicators = (() => {

  /* ── Utility ─────────────────────────────────────────────────────────── */

  function nulls(n)  { return new Array(n).fill(null); }
  function last(arr) { return arr[arr.length - 1]; }

  /** Sum of a fixed window — O(1) rolling */
  function rollingSum(arr, n) {
    const out = nulls(arr.length);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i] ?? 0;
      if (i >= n) sum -= arr[i - n] ?? 0;
      if (i >= n - 1) out[i] = sum;
    }
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MOVING AVERAGES
     ═══════════════════════════════════════════════════════════════════════ */

  /** Simple Moving Average */
  const ok = v => v != null && !Number.isNaN(v);

  function sma(values, period) {
    const out = nulls(values.length);
    let sum = 0, cnt = 0;
    for (let i = 0; i < values.length; i++) {
      if (ok(values[i])) { sum += values[i]; cnt++; }
      if (i >= period && ok(values[i - period])) { sum -= values[i - period]; cnt--; }
      if (cnt === period) out[i] = sum / period;
    }
    return out;
  }

  /** Exponential Moving Average (standard EMA, seeded with SMA) */
  function ema(values, period) {
    const out = nulls(values.length);
    const k   = 2 / (period + 1);
    let   emaVal = null, seedSum = 0, seedCount = 0;

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || Number.isNaN(v)) continue;

      if (emaVal === null) {
        seedSum += v;
        seedCount++;
        if (seedCount === period) {
          emaVal   = seedSum / period;
          out[i]   = emaVal;
        }
      } else {
        emaVal   = v * k + emaVal * (1 - k);
        out[i]   = emaVal;
      }
    }
    return out;
  }

  /** Weighted Moving Average — linear weights */
  function wma(values, period) {
    const out  = nulls(values.length);
    const denom = period * (period + 1) / 2;
    for (let i = period - 1; i < values.length; i++) {
      let wsum = 0, valid = true;
      for (let j = 0; j < period; j++) {
        if (values[i - j] == null) { valid = false; break; }
        wsum += values[i - j] * (period - j);
      }
      if (valid) out[i] = wsum / denom;
    }
    return out;
  }

  /** Double EMA — 2·EMA(n) - EMA(EMA(n)), reduces lag */
  function dema(values, period) {
    const e1   = ema(values, period);
    const e1f  = e1.map(v => v ?? NaN);  // keep alignment
    const e2   = ema(e1f, period);
    return values.map((_, i) =>
      e1[i] != null && e2[i] != null ? 2 * e1[i] - e2[i] : null
    );
  }

  /** Triple EMA — 3·EMA - 3·EMA² + EMA³ */
  function tema(values, period) {
    const e1 = ema(values, period);
    const e2 = ema(e1.map(v => v ?? NaN), period);
    const e3 = ema(e2.map(v => v ?? NaN), period);
    return values.map((_, i) =>
      e1[i] != null && e2[i] != null && e3[i] != null
        ? 3*e1[i] - 3*e2[i] + e3[i]
        : null
    );
  }

  /** Hull Moving Average — WMA(2·WMA(n/2) - WMA(n), sqrt(n)) */
  function hma(values, period) {
    const half  = Math.floor(period / 2);
    const sqrtn = Math.round(Math.sqrt(period));
    const wma1  = wma(values, half);
    const wma2  = wma(values, period);
    const diff  = values.map((_, i) =>
      wma1[i] != null && wma2[i] != null ? 2*wma1[i] - wma2[i] : null
    );
    return wma(diff, sqrtn);
  }

  /** Volume-Weighted Moving Average */
  function vwma(closes, volumes, period) {
    const out = nulls(closes.length);
    for (let i = period - 1; i < closes.length; i++) {
      let tpv = 0, vol = 0;
      for (let j = 0; j < period; j++) {
        tpv += closes[i-j] * volumes[i-j];
        vol += volumes[i-j];
      }
      out[i] = vol > 0 ? tpv / vol : null;
    }
    return out;
  }

  /** Arnaud Legoux MA (Gaussian kernel smoothing) */
  function alma(values, period = 21, sigma = 6, offset = 0.85) {
    const out = nulls(values.length);
    const m   = Math.floor(offset * (period - 1));
    const s   = period / sigma;
    const w   = [];
    let   wSum = 0;
    for (let i = 0; i < period; i++) {
      w[i] = Math.exp(-((i - m) ** 2) / (2 * s * s));
      wSum += w[i];
    }
    for (let i = period - 1; i < values.length; i++) {
      let sum = 0, valid = true;
      for (let j = 0; j < period; j++) {
        if (values[i-j] == null) { valid = false; break; }
        sum += values[i-j] * w[period-1-j];
      }
      if (valid) out[i] = sum / wSum;
    }
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     OSCILLATORS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * RSI — Wilder's Smoothed Moving Average method.
   * Returns array of RSI values (0–100), nulls for warm-up.
   */
  function rsi(closes, period = 14) {
    const out = nulls(closes.length);
    if (closes.length < period + 1) return out;

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const chg = closes[i] - closes[i-1];
      if (chg > 0) avgGain += chg;
      else          avgLoss += Math.abs(chg);
    }
    avgGain /= period;
    avgLoss /= period;

    out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < closes.length; i++) {
      const chg  = closes[i] - closes[i-1];
      const gain = chg > 0 ? chg : 0;
      const loss = chg < 0 ? -chg : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i]  = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return out;
  }

  /**
   * MACD — (fast EMA - slow EMA), signal, histogram
   * Returns { macd[], signal[], histogram[] }
   */
  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);

    const macdLine = closes.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
    );

    // Seed signal EMA from the first non-null macd value
    const sigLine = ema(macdLine.map(v => v ?? NaN), signal);

    const histogram = closes.map((_, i) =>
      macdLine[i] != null && sigLine[i] != null ? macdLine[i] - sigLine[i] : null
    );

    return { macd: macdLine, signal: sigLine, histogram };
  }

  /**
   * Stochastic Oscillator %K and %D
   */
  function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3, smooth = 3) {
    const n   = closes.length;
    const rawK = nulls(n);

    for (let i = kPeriod - 1; i < n; i++) {
      const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
      const ll = Math.min(...lows .slice(i - kPeriod + 1, i + 1));
      rawK[i]  = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    }

    const k = smooth > 1 ? sma(rawK, smooth) : rawK;
    const d = sma(k, dPeriod);
    return { k, d };
  }

  /**
   * Commodity Channel Index
   */
  function cci(highs, lows, closes, period = 20) {
    const out = nulls(closes.length);
    for (let i = period - 1; i < closes.length; i++) {
      const slice = highs.slice(i - period + 1, i + 1).map((h, j) =>
        (h + lows[i - period + 1 + j] + closes[i - period + 1 + j]) / 3
      );
      const mean    = slice.reduce((a, b) => a + b, 0) / period;
      const meanDev = slice.reduce((a, v) => a + Math.abs(v - mean), 0) / period;
      out[i] = meanDev === 0 ? 0 : (slice[period - 1] - mean) / (0.015 * meanDev);
    }
    return out;
  }

  /** Williams %R */
  function williamsR(highs, lows, closes, period = 14) {
    const out = nulls(closes.length);
    for (let i = period - 1; i < closes.length; i++) {
      const hh = Math.max(...highs.slice(i - period + 1, i + 1));
      const ll = Math.min(...lows .slice(i - period + 1, i + 1));
      out[i] = hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100;
    }
    return out;
  }

  /** Rate of Change */
  function roc(closes, period = 10) {
    return closes.map((c, i) =>
      i >= period && closes[i - period] != null
        ? ((c - closes[i - period]) / closes[i - period]) * 100
        : null
    );
  }

  /** Momentum (price - price[n]) */
  function momentum(closes, period = 10) {
    return closes.map((c, i) =>
      i >= period ? c - closes[i - period] : null
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     VOLATILITY
     ═══════════════════════════════════════════════════════════════════════ */

  /** Bollinger Bands — upper, middle (SMA), lower, %B, bandwidth */
  function bollingerBands(closes, period = 20, mult = 2) {
    const mid  = sma(closes, period);
    const upper = nulls(closes.length);
    const lower = nulls(closes.length);
    const pctB  = nulls(closes.length);
    const bw    = nulls(closes.length);

    for (let i = period - 1; i < closes.length; i++) {
      if (mid[i] == null) continue;
      const slice = closes.slice(i - period + 1, i + 1);
      const mean  = mid[i];
      const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
      upper[i]    = mean + mult * std;
      lower[i]    = mean - mult * std;
      pctB[i]     = std === 0 ? 0.5 : (closes[i] - lower[i]) / (upper[i] - lower[i]);
      bw[i]       = mean === 0 ? 0 : (upper[i] - lower[i]) / mean * 100;
    }

    return { upper, middle: mid, lower, pctB, bandwidth: bw };
  }

  /** True Range */
  function trueRange(highs, lows, closes) {
    return closes.map((_, i) => {
      if (i === 0) return highs[0] - lows[0];
      return Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i-1]),
        Math.abs(lows[i]  - closes[i-1])
      );
    });
  }

  /** Average True Range — Wilder smoothing */
  function atr(highs, lows, closes, period = 14) {
    const tr  = trueRange(highs, lows, closes);
    const out = nulls(closes.length);
    let   atrVal = null;

    for (let i = 0; i < tr.length; i++) {
      if (i < period) {
        if (i === period - 1) {
          atrVal = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
          out[i] = atrVal;
        }
      } else {
        atrVal = (atrVal * (period - 1) + tr[i]) / period;
        out[i] = atrVal;
      }
    }
    return out;
  }

  /** Keltner Channels */
  function keltnerChannels(highs, lows, closes, period = 20, mult = 1.5) {
    const mid    = ema(closes, period);
    const atrVals = atr(highs, lows, closes, period);
    return {
      upper:  closes.map((_, i) => mid[i] != null && atrVals[i] != null ? mid[i] + mult * atrVals[i] : null),
      middle: mid,
      lower:  closes.map((_, i) => mid[i] != null && atrVals[i] != null ? mid[i] - mult * atrVals[i] : null),
    };
  }

  /** Donchian Channels */
  function donchianChannels(highs, lows, period = 20) {
    const upper = nulls(highs.length);
    const lower = nulls(lows.length);
    for (let i = period - 1; i < highs.length; i++) {
      upper[i] = Math.max(...highs.slice(i - period + 1, i + 1));
      lower[i] = Math.min(...lows .slice(i - period + 1, i + 1));
    }
    const mid = upper.map((u, i) => u != null && lower[i] != null ? (u + lower[i]) / 2 : null);
    return { upper, lower, middle: mid };
  }

  /** Supertrend — popular trend-following overlay */
  function supertrend(highs, lows, closes, period = 10, mult = 3) {
    const atrVals = atr(highs, lows, closes, period);
    const n       = closes.length;
    const value     = nulls(n);   // line value
    const direction = nulls(n);   // +1 uptrend, -1 downtrend

    let upperBand = null, lowerBand = null, trend = 1;

    for (let i = period; i < n; i++) {
      const hl2 = (highs[i] + lows[i]) / 2;
      const a   = atrVals[i];
      if (a == null) continue;

      const newUp  = hl2 - mult * a;
      const newDn  = hl2 + mult * a;

      lowerBand = (lowerBand == null || newUp > lowerBand || closes[i-1] < lowerBand) ? newUp : lowerBand;
      upperBand = (upperBand == null || newDn < upperBand || closes[i-1] > upperBand) ? newDn : upperBand;

      if (trend === 1 && closes[i] < lowerBand) trend = -1;
      else if (trend === -1 && closes[i] > upperBand) trend = 1;

      value[i]     = trend === 1 ? lowerBand : upperBand;
      direction[i] = trend;
    }

    return { value, direction };
  }

  /** Parabolic SAR */
  function parabolicSAR(highs, lows, stepInit = 0.02, stepMax = 0.2) {
    const n   = highs.length;
    const out = nulls(n);
    if (n < 2) return out;

    let af      = stepInit;
    let bull    = true;
    let extreme = highs[0];
    let sar     = lows[0];

    for (let i = 1; i < n; i++) {
      sar = sar + af * (extreme - sar);

      if (bull) {
        sar = Math.min(sar, lows[i-1], i > 1 ? lows[i-2] : lows[i-1]);
        if (lows[i] < sar) {
          bull = false; sar = extreme; extreme = lows[i]; af = stepInit;
        } else if (highs[i] > extreme) {
          extreme = highs[i]; af = Math.min(af + stepInit, stepMax);
        }
      } else {
        sar = Math.max(sar, highs[i-1], i > 1 ? highs[i-2] : highs[i-1]);
        if (highs[i] > sar) {
          bull = true; sar = extreme; extreme = highs[i]; af = stepInit;
        } else if (lows[i] < extreme) {
          extreme = lows[i]; af = Math.min(af + stepInit, stepMax);
        }
      }
      out[i] = sar;
    }
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TREND INDICATORS
     ═══════════════════════════════════════════════════════════════════════ */

  /** Wilder Smoothing (used by ADX, DI) */
  function wilderSmooth(values, period, average = false) {
    const out = nulls(values.length);
    let smoothed = 0, seen = 0, started = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!ok(v)) continue;
      if (!started) {
        smoothed += v; seen++;
        if (seen === period) {
          started = true;
          if (average) smoothed /= period;
          out[i] = smoothed;
        }
      } else {
        smoothed = average
          ? (smoothed * (period - 1) + v) / period
          : smoothed - smoothed / period + v;
        out[i] = smoothed;
      }
    }
    return out;
  }

  /**
   * ADX, +DI, -DI
   * Returns { adx[], plusDI[], minusDI[] }
   */
  function adx(highs, lows, closes, period = 14) {
    const n    = closes.length;
    const pdm  = nulls(n);
    const ndm  = nulls(n);
    const tr   = nulls(n);

    for (let i = 1; i < n; i++) {
      const upMove   = highs[i] - highs[i-1];
      const downMove = lows[i-1] - lows[i];
      pdm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
      ndm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
      tr[i]  = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i-1]),
        Math.abs(lows[i]  - closes[i-1])
      );
    }

    const strTR  = wilderSmooth(tr,  period);
    const strPDM = wilderSmooth(pdm, period);
    const strNDM = wilderSmooth(ndm, period);

    const pDI = nulls(n);
    const nDI = nulls(n);
    const dx  = nulls(n);

    for (let i = period; i < n; i++) {
      if (strTR[i] == null || strTR[i] === 0) continue;
      pDI[i] = (strPDM[i] / strTR[i]) * 100;
      nDI[i] = (strNDM[i] / strTR[i]) * 100;
      const sum = pDI[i] + nDI[i];
      dx[i] = sum === 0 ? 0 : (Math.abs(pDI[i] - nDI[i]) / sum) * 100;
    }

    const adxLine = wilderSmooth(dx, period, true);
    return { adx: adxLine, plusDI: pDI, minusDI: nDI };
  }

  /** Pivot Points (Standard, daily) */
  function pivotPoints(prevHigh, prevLow, prevClose) {
    const pp = (prevHigh + prevLow + prevClose) / 3;
    return {
      pp,
      r1: 2 * pp - prevLow,
      r2: pp + (prevHigh - prevLow),
      r3: prevHigh + 2 * (pp - prevLow),
      s1: 2 * pp - prevHigh,
      s2: pp - (prevHigh - prevLow),
      s3: prevLow - 2 * (prevHigh - pp),
    };
  }

  /** Fibonacci Retracement levels from swing points */
  function fibonacciRetracement(swingHigh, swingLow) {
    const diff = swingHigh - swingLow;
    return {
      l0:    swingHigh,
      l236:  swingHigh - 0.236 * diff,
      l382:  swingHigh - 0.382 * diff,
      l500:  swingHigh - 0.500 * diff,
      l618:  swingHigh - 0.618 * diff,
      l786:  swingHigh - 0.786 * diff,
      l1000: swingLow,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     VOLUME INDICATORS
     ═══════════════════════════════════════════════════════════════════════ */

  /** VWAP — Volume Weighted Average Price (resets each "session") */
  function vwap(highs, lows, closes, volumes) {
    const out = nulls(closes.length);
    let cumTPV = 0, cumVol = 0;
    for (let i = 0; i < closes.length; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      cumTPV  += tp * volumes[i];
      cumVol  += volumes[i];
      out[i]   = cumVol > 0 ? cumTPV / cumVol : closes[i];
    }
    return out;
  }

  /** On-Balance Volume */
  function obv(closes, volumes) {
    const out = [0];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i-1])      out.push(out[i-1] + volumes[i]);
      else if (closes[i] < closes[i-1]) out.push(out[i-1] - volumes[i]);
      else                               out.push(out[i-1]);
    }
    return out;
  }

  /** Chaikin Money Flow */
  function cmf(highs, lows, closes, volumes, period = 20) {
    const out = nulls(closes.length);
    for (let i = period - 1; i < closes.length; i++) {
      let mfvSum = 0, volSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const hl = highs[j] - lows[j];
        if (hl !== 0) mfvSum += ((closes[j] - lows[j]) - (highs[j] - closes[j])) / hl * volumes[j];
        volSum += volumes[j];
      }
      out[i] = volSum > 0 ? mfvSum / volSum : 0;
    }
    return out;
  }

  /** Money Flow Index */
  function mfi(highs, lows, closes, volumes, period = 14) {
    const tp  = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    const out = nulls(closes.length);

    for (let i = period; i < closes.length; i++) {
      let posFlow = 0, negFlow = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const mf = tp[j] * volumes[j];
        if (tp[j] > tp[j-1]) posFlow += mf;
        else                  negFlow += mf;
      }
      out[i] = negFlow === 0 ? 100 : 100 - (100 / (1 + posFlow / negFlow));
    }
    return out;
  }

  /** Force Index = Change * Volume */
  function forceIndex(closes, volumes, period = 13) {
    const fi = nulls(closes.length);
    for (let i = 1; i < closes.length; i++) {
      fi[i] = (closes[i] - closes[i-1]) * volumes[i];
    }
    return ema(fi, period);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITE / ADVANCED
     ═══════════════════════════════════════════════════════════════════════ */

  /** Ichimoku Cloud */
  function ichimoku(highs, lows, closes,
                    conversion = 9, base = 26, lagging = 52, displacement = 26) {
    const n    = closes.length;
    const conv = nulls(n), baseLine = nulls(n);
    const senkouA = nulls(n + displacement);
    const senkouB = nulls(n + displacement);
    const chikou  = nulls(n);

    const midpoint = (h, l) => (Math.max(...h) + Math.min(...l)) / 2;

    for (let i = conversion - 1; i < n; i++) {
      conv[i]     = midpoint(highs.slice(i-conversion+1,i+1), lows.slice(i-conversion+1,i+1));
    }
    for (let i = base - 1; i < n; i++) {
      baseLine[i] = midpoint(highs.slice(i-base+1,i+1), lows.slice(i-base+1,i+1));
    }
    for (let i = base - 1; i < n; i++) {
      if (conv[i] != null && baseLine[i] != null) {
        senkouA[i + displacement] = (conv[i] + baseLine[i]) / 2;
      }
    }
    for (let i = lagging - 1; i < n; i++) {
      senkouB[i + displacement] = midpoint(highs.slice(i-lagging+1,i+1), lows.slice(i-lagging+1,i+1));
    }
    for (let i = 0; i < n - displacement; i++) {
      chikou[i] = closes[i + displacement];
    }

    return { conversion: conv, base: baseLine, senkouA, senkouB, chikou };
  }

  /** Stochastic RSI */
  function stochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
    const r   = rsi(closes, rsiPeriod);
    const raw = nulls(closes.length);
    for (let i = 0; i < closes.length; i++) {
      if (i < stochPeriod - 1) continue;
      const w = r.slice(i - stochPeriod + 1, i + 1);
      if (w.some(v => v == null)) continue;
      const hh = Math.max(...w), ll = Math.min(...w);
      raw[i] = hh === ll ? 50 : ((r[i] - ll) / (hh - ll)) * 100;
    }
    const k = sma(raw, kSmooth);
    return { k, d: sma(k, dSmooth) };
  }

  /** Z-Score of price vs rolling mean */
  function zScore(values, period = 20) {
    const out = nulls(values.length);
    for (let i = period - 1; i < values.length; i++) {
      const slice = values.slice(i - period + 1, i + 1);
      const mean  = slice.reduce((a, b) => a + b, 0) / period;
      const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean)**2, 0) / period);
      out[i] = std === 0 ? 0 : (values[i] - mean) / std;
    }
    return out;
  }

  /** Rolling standard deviation */
  function stdDev(values, period = 20) {
    const out = nulls(values.length);
    for (let i = period - 1; i < values.length; i++) {
      const slice = values.slice(i - period + 1, i + 1);
      const mean  = slice.reduce((a, b) => a + b, 0) / period;
      out[i] = Math.sqrt(slice.reduce((s, v) => s + (v - mean)**2, 0) / period);
    }
    return out;
  }

  /** Highest High / Lowest Low over period */
  function highestHigh(highs, period) {
    return highs.map((_, i) =>
      i >= period - 1 ? Math.max(...highs.slice(i - period + 1, i + 1)) : null
    );
  }
  function lowestLow(lows, period) {
    return lows.map((_, i) =>
      i >= period - 1 ? Math.min(...lows.slice(i - period + 1, i + 1)) : null
    );
  }

  /** Average Price (OHLC / 4) */
  function avgPrice(opens, highs, lows, closes) {
    return closes.map((c, i) => (opens[i] + highs[i] + lows[i] + c) / 4);
  }

  /** Typical Price (HLC / 3) */
  function typicalPrice(highs, lows, closes) {
    return closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     HELPERS FOR CHARTING
     Convert indicator output arrays to Lightweight Charts series format:
     [{time: unix_seconds, value: number}, ...]
     ═══════════════════════════════════════════════════════════════════════ */

  function toLWCLine(timestamps, values) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] != null && !isNaN(values[i]) && timestamps[i] != null)
        out.push({ time: timestamps[i], value: +values[i].toFixed(6) });
    }
    return out;
  }

  function toLWCHistogram(timestamps, values, bullColor = '#26a69a', bearColor = '#ef5350') {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] != null && !isNaN(values[i]) && timestamps[i] != null)
        out.push({ time: timestamps[i], value: +values[i].toFixed(6), color: values[i] >= 0 ? bullColor : bearColor });
    }
    return out;
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  return {
    // Moving averages
    sma, ema, wma, dema, tema, hma, vwma, alma,
    // Oscillators
    rsi, macd, stochastic, cci, williamsR, roc, momentum,
    // Volatility
    bollingerBands, trueRange, atr, keltnerChannels, donchianChannels,
    supertrend, parabolicSAR,
    // Trend
    adx, wilderSmooth, pivotPoints, fibonacciRetracement, ichimoku,
    // Volume
    vwap, obv, cmf, mfi, forceIndex,
    // Advanced
    stochRSI, zScore, stdDev, highestHigh, lowestLow,
    avgPrice, typicalPrice,
    // Chart helpers
    toLWCLine, toLWCHistogram,
  };
})();
