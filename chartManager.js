'use strict';
/**
 * chartManager.js — Lightweight Charts Integration
 * =================================================
 * Manages the main candlestick chart and synchronized indicator sub-panes.
 * Uses TradingView's Lightweight Charts (free, open-source).
 */

const ChartManager = (() => {

  let mainChart    = null;
  let candleSeries = null;
  let volumeSeries = null;
  let chartType    = 'candlestick';

  // Active overlay series on the main chart
  const overlaySeries = new Map();  // id → series

  // Sub-pane charts (RSI, MACD, etc.)
  const paneCharts  = new Map();    // id → chart
  const paneData    = new Map();    // id → data arrays (for re-render)

  let currentCandles = [];          // raw candle data
  let tooltipEl      = null;

  const COLORS = {
    bg:        '#131722',
    bgPanel:   '#131722',
    grid:      '#363a4a',
    border:    '#363a4a',
    text:      '#787b86',
    bull:      '#26a69a',
    bear:      '#ef5350',
    bullDim:   'rgba(38,166,154,0.3)',
    bearDim:   'rgba(239,83,80,0.3)',
    accent:    '#2962ff',
    sma20:     '#26a69a',
    sma50:     '#ef5350',
    sma200:    '#ffb74d',
    ema:       '#7986cb',
    bb_up:     'rgba(41,98,255,0.7)',
    bb_mid:    '#2962ff',
    bb_lo:     'rgba(41,98,255,0.7)',
    vwap:      '#ff6d00',
    supertrend:'#e040fb',
    sar:       '#ffeb3b',
    rsi:       '#7986cb',
    macd_l:    '#2962ff',
    macd_s:    '#ef5350',
    macd_h_pos:'#26a69a',
    macd_h_neg:'#ef5350',
    obv:       '#26a69a',
    cmf:       '#7986cb',
  };

  const CHART_OPTS = {
    layout: {
      background: { type: 'solid', color: COLORS.bg },
      textColor:  COLORS.text,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize:   11,
    },
    grid: {
      vertLines: { color: COLORS.grid, style: 0 },
      horzLines: { color: COLORS.grid, style: 0 },
    },
    crosshair: {
      mode: 1, // Normal
      vertLine: { color: '#758696', width: 1, style: 3, labelVisible: true },
      horzLine: { color: '#758696', width: 1, style: 3, labelVisible: true },
    },
    rightPriceScale: { borderColor: COLORS.border },
    timeScale: {
      borderColor:    COLORS.border,
      timeVisible:    true,
      secondsVisible: false,
      tickMarkFormatter: ts => {
        const d = new Date(ts * 1000);
        return `${d.getMonth()+1}/${d.getDate()}`;
      },
    },
  };

  /* ── Initialise main chart ───────────────────────────────────────────── */
  function init() {
    const container = document.getElementById('chart-main');
    if (!container || typeof LightweightCharts === 'undefined') return;
    if (mainChart) { try { mainChart.remove(); } catch {} }

    const h = container.clientHeight || Math.floor(window.innerHeight * 0.5);
    mainChart = LightweightCharts.createChart(container, { ...CHART_OPTS, width: container.clientWidth, height: h });

    // Candlestick series
    candleSeries = mainChart.addCandlestickSeries({
      upColor:          COLORS.bull,
      downColor:        COLORS.bear,
      borderUpColor:    COLORS.bull,
      borderDownColor:  COLORS.bear,
      wickUpColor:      COLORS.bull,
      wickDownColor:    COLORS.bear,
    });

    // Volume histogram (separate price scale)
    volumeSeries = mainChart.addHistogramSeries({
      color:       COLORS.bullDim,
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    mainChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    // Tooltip
    buildTooltip(container);

    mainChart.subscribeCrosshairMove(onCrosshairMove);

    // Handle resize
    new ResizeObserver(() => {
      if (mainChart && container.clientWidth) {
        mainChart.resize(container.clientWidth, container.clientHeight || h);
        for (const [, pc] of paneCharts) {
          const c = pc.container;
          if (c && pc.chart) pc.chart.resize(c.clientWidth, c.clientHeight);
        }
      }
    }).observe(container);
  }

  /* ── Load candle data ────────────────────────────────────────────────── */
  function setData(candles) {
    if (!candleSeries) return;
    currentCandles = candles;

    const candleData = candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const volData    = candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? COLORS.bullDim : COLORS.bearDim }));

    if (chartType === 'candlestick') {
      candleSeries.setData(candleData);
    } else if (chartType === 'line') {
      candleSeries.setData(candles.map(c => ({ time: c.time, value: c.close })));
    } else if (chartType === 'area') {
      candleSeries.setData(candles.map(c => ({ time: c.time, value: c.close })));
    }

    volumeSeries.setData(volData);

    // Re-render active overlays/panes with new data (iterate over SNAPSHOTS —
    // add*() mutates the maps, so iterating them directly would never terminate)
    for (const id of [...overlaySeries.keys()].filter(k => !k.includes('_'))) addIndicator(id);
    for (const id of [...paneCharts.keys()]) addPane(id);

    mainChart.timeScale().fitContent();
  }

  /* ── Chart type switch ───────────────────────────────────────────────── */
  function setChartType(type) {
    chartType = type;
    if (!mainChart || !currentCandles.length) return;

    mainChart.removeSeries(candleSeries);

    if (type === 'candlestick') {
      candleSeries = mainChart.addCandlestickSeries({ upColor: COLORS.bull, downColor: COLORS.bear, borderUpColor: COLORS.bull, borderDownColor: COLORS.bear, wickUpColor: COLORS.bull, wickDownColor: COLORS.bear });
      candleSeries.setData(currentCandles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (type === 'line') {
      candleSeries = mainChart.addLineSeries({ color: COLORS.bull, lineWidth: 1.5 });
      candleSeries.setData(currentCandles.map(c => ({ time: c.time, value: c.close })));
    } else if (type === 'area') {
      candleSeries = mainChart.addAreaSeries({ lineColor: COLORS.bull, topColor: 'rgba(38,166,154,0.28)', bottomColor: 'rgba(38,166,154,0.02)', lineWidth: 1.5 });
      candleSeries.setData(currentCandles.map(c => ({ time: c.time, value: c.close })));
    }

    mainChart.unsubscribeCrosshairMove(onCrosshairMove);
    mainChart.subscribeCrosshairMove(onCrosshairMove);
  }

  /* ── Add / remove overlays ───────────────────────────────────────────── */
  function addIndicator(id) {
    if (!currentCandles.length || !mainChart) return;

    const ts  = currentCandles.map(c => c.time);
    const cl  = currentCandles.map(c => c.close);
    const hi  = currentCandles.map(c => c.high);
    const lo  = currentCandles.map(c => c.low);
    const vol = currentCandles.map(c => c.volume);
    const I   = Indicators;

    // Remove existing if present
    removeIndicatorById(id);

    switch (id) {
      case 'sma20': {
        const vals = I.sma(cl, 20);
        const s = mainChart.addLineSeries({ color: COLORS.sma20, lineWidth: 1, title: 'SMA 20', priceLineVisible: false });
        s.setData(I.toLWCLine(ts, vals));
        overlaySeries.set(id, s);
        break;
      }
      case 'sma50': {
        const vals = I.sma(cl, 50);
        const s = mainChart.addLineSeries({ color: COLORS.sma50, lineWidth: 1, title: 'SMA 50', priceLineVisible: false });
        s.setData(I.toLWCLine(ts, vals));
        overlaySeries.set(id, s);
        break;
      }
      case 'sma200': {
        const vals = I.sma(cl, 200);
        const s = mainChart.addLineSeries({ color: COLORS.sma200, lineWidth: 1, title: 'SMA 200', priceLineVisible: false });
        s.setData(I.toLWCLine(ts, vals));
        overlaySeries.set(id, s);
        break;
      }
      case 'ema20': {
        const vals = I.ema(cl, 20);
        const s = mainChart.addLineSeries({ color: COLORS.ema, lineWidth: 1, lineStyle: 1, title: 'EMA 20', priceLineVisible: false });
        s.setData(I.toLWCLine(ts, vals));
        overlaySeries.set(id, s);
        break;
      }
      case 'ema50': {
        const vals = I.ema(cl, 50);
        const s = mainChart.addLineSeries({ color: '#e91e63', lineWidth: 1, lineStyle: 1, title: 'EMA 50', priceLineVisible: false });
        s.setData(I.toLWCLine(ts, vals));
        overlaySeries.set(id, s);
        break;
      }
      case 'bb': {
        const bb  = I.bollingerBands(cl, 20, 2);
        const up  = mainChart.addLineSeries({ color: COLORS.bb_up,  lineWidth: 1, title: 'BB Upper', priceLineVisible: false });
        const mid = mainChart.addLineSeries({ color: COLORS.bb_mid, lineWidth: 1, lineStyle: 1, title: 'BB Mid', priceLineVisible: false });
        const dn  = mainChart.addLineSeries({ color: COLORS.bb_lo,  lineWidth: 1, title: 'BB Lower', priceLineVisible: false });
        up.setData(I.toLWCLine(ts, bb.upper));
        mid.setData(I.toLWCLine(ts, bb.middle));
        dn.setData(I.toLWCLine(ts, bb.lower));
        overlaySeries.set(id + '_up', up);
        overlaySeries.set(id + '_mid', mid);
        overlaySeries.set(id + '_dn', dn);
        overlaySeries.set(id, { _group: true });
        break;
      }
      case 'vwap': {
        const vals = I.vwap(hi, lo, cl, vol);
        const s = mainChart.addLineSeries({ color: COLORS.vwap, lineWidth: 1.5, lineStyle: 0, title: 'VWAP', priceLineVisible: false });
        s.setData(I.toLWCLine(ts, vals));
        overlaySeries.set(id, s);
        break;
      }
      case 'supertrend': {
        const st   = I.supertrend(hi, lo, cl, 10, 3);
        const bullData = [], bearData = [];
        ts.forEach((t, i) => {
          if (st.value[i] == null) return;
          if (st.direction[i] === 1)  bullData.push({ time: t, value: st.value[i] });
          else                        bearData.push({ time: t, value: st.value[i] });
        });
        const sb = mainChart.addLineSeries({ color: COLORS.bull,       lineWidth: 1.5, title: 'ST Bull', priceLineVisible: false });
        const sr = mainChart.addLineSeries({ color: COLORS.bear,       lineWidth: 1.5, title: 'ST Bear', priceLineVisible: false });
        sb.setData(bullData);
        sr.setData(bearData);
        overlaySeries.set(id + '_bull', sb);
        overlaySeries.set(id + '_bear', sr);
        overlaySeries.set(id, { _group: true });
        break;
      }
      case 'parabolicsar': {
        const sarVals = I.parabolicSAR(hi, lo);
        const s = mainChart.addLineSeries({ color: COLORS.sar, lineWidth: 0, title: 'SAR', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData(I.toLWCLine(ts, sarVals));
        overlaySeries.set(id, s);
        break;
      }
      default: break;
    }
  }

  /* ── Sub-pane indicators ─────────────────────────────────────────────── */
  function addPane(id) {
    if (!currentCandles.length) return;

    const panesEl = document.getElementById('indicator-panes');
    if (!panesEl) return;

    removePane(id);

    const cl  = currentCandles.map(c => c.close);
    const hi  = currentCandles.map(c => c.high);
    const lo  = currentCandles.map(c => c.low);
    const vol = currentCandles.map(c => c.volume);
    const ts  = currentCandles.map(c => c.time);
    const I   = Indicators;

    // Create pane element
    const paneEl = document.createElement('div');
    paneEl.className    = 'indicator-pane';
    paneEl.dataset.pane = id;
    paneEl.innerHTML    = `<div class="pane-label" id="pane-label-${id}"></div>`;
    panesEl.appendChild(paneEl);

    const paneChart = LightweightCharts.createChart(paneEl, {
      ...CHART_OPTS,
      width:  paneEl.clientWidth,
      height: 100,
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: { visible: false },
    });

    // Sync time scale with main chart
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      try { if (range && paneCharts.has(id)) paneChart.timeScale().setVisibleLogicalRange(range); } catch {}
    });
    paneChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      try { if (range && paneCharts.has(id)) mainChart.timeScale().setVisibleLogicalRange(range); } catch {}
    });

    paneCharts.set(id, { chart: paneChart, container: paneEl });

    switch (id) {
      case 'rsi': {
        const rsiV = I.rsi(cl, 14);
        const s    = paneChart.addLineSeries({ color: COLORS.rsi, lineWidth: 1.5, priceLineVisible: false });
        s.setData(I.toLWCLine(ts, rsiV));
        // Overbought / oversold reference lines
        paneChart.addLineSeries({ color: '#ef5350', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 70 })));
        paneChart.addLineSeries({ color: '#26a69a', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 30 })));
        paneChart.addLineSeries({ color: '#363a4a', lineWidth: 1, lineStyle: 3, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 50 })));
        document.getElementById(`pane-label-${id}`).textContent = 'RSI(14)';
        break;
      }
      case 'macd': {
        const { macd: ml, signal: sl, histogram: hl } = I.macd(cl, 12, 26, 9);
        const hist = paneChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        hist.setData(I.toLWCHistogram(ts, hl));
        paneChart.addLineSeries({ color: COLORS.macd_l, lineWidth: 1.5, priceLineVisible: false }).setData(I.toLWCLine(ts, ml));
        paneChart.addLineSeries({ color: COLORS.macd_s, lineWidth: 1.5, priceLineVisible: false }).setData(I.toLWCLine(ts, sl));
        paneChart.addLineSeries({ color: '#363a4a', lineWidth: 1, lineStyle: 3, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 0 })));
        document.getElementById(`pane-label-${id}`).textContent = 'MACD(12,26,9)';
        break;
      }
      case 'stoch': {
        const { k, d } = I.stochastic(hi, lo, cl, 14, 3);
        paneChart.addLineSeries({ color: '#2962ff', lineWidth: 1.5, priceLineVisible: false }).setData(I.toLWCLine(ts, k));
        paneChart.addLineSeries({ color: '#ef5350', lineWidth: 1, priceLineVisible: false }).setData(I.toLWCLine(ts, d));
        paneChart.addLineSeries({ color: '#363a4a', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 80 })));
        paneChart.addLineSeries({ color: '#363a4a', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 20 })));
        document.getElementById(`pane-label-${id}`).textContent = 'Stochastic(14,3)';
        break;
      }
      case 'cci': {
        const cciV = I.cci(hi, lo, cl, 20);
        paneChart.addLineSeries({ color: '#7986cb', lineWidth: 1.5, priceLineVisible: false }).setData(I.toLWCLine(ts, cciV));
        paneChart.addLineSeries({ color: '#ef5350', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 100  })));
        paneChart.addLineSeries({ color: '#26a69a', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: -100 })));
        document.getElementById(`pane-label-${id}`).textContent = 'CCI(20)';
        break;
      }
      case 'williamsr': {
        const wrV = I.williamsR(hi, lo, cl, 14);
        paneChart.addLineSeries({ color: '#ab47bc', lineWidth: 1.5, priceLineVisible: false }).setData(I.toLWCLine(ts, wrV));
        document.getElementById(`pane-label-${id}`).textContent = 'Williams %R(14)';
        break;
      }
      case 'mfi': {
        const mfiV = I.mfi(hi, lo, cl, vol, 14);
        paneChart.addLineSeries({ color: '#26c6da', lineWidth: 1.5, priceLineVisible: false }).setData(I.toLWCLine(ts, mfiV));
        paneChart.addLineSeries({ color: '#ef5350', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 80 })));
        paneChart.addLineSeries({ color: '#26a69a', lineWidth: 1, lineStyle: 2, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 20 })));
        document.getElementById(`pane-label-${id}`).textContent = 'MFI(14)';
        break;
      }
      case 'obv': {
        const obvV = I.obv(cl, vol);
        paneChart.addLineSeries({ color: COLORS.obv, lineWidth: 1, priceLineVisible: false }).setData(I.toLWCLine(ts, obvV));
        document.getElementById(`pane-label-${id}`).textContent = 'OBV';
        break;
      }
      case 'cmf': {
        const cmfV = I.cmf(hi, lo, cl, vol, 20);
        const cmfHist = paneChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        cmfHist.setData(I.toLWCHistogram(ts, cmfV));
        paneChart.addLineSeries({ color: '#363a4a', lineWidth: 1, lineStyle: 3, lastValueVisible: false }).setData(ts.map(t => ({ time: t, value: 0 })));
        document.getElementById(`pane-label-${id}`).textContent = 'CMF(20)';
        break;
      }
    }
  }

  function removePane(id) {
    const entry = paneCharts.get(id);
    if (!entry) return;
    try { entry.chart.remove(); } catch {}
    if (entry.container?.parentNode) entry.container.parentNode.removeChild(entry.container);
    paneCharts.delete(id);
  }

  function removeIndicatorById(id) {
    if (overlaySeries.has(id)) {
      const s = overlaySeries.get(id);
      if (s && !s._group) { try { mainChart.removeSeries(s); } catch {} }
      overlaySeries.delete(id);
    }
    // Remove group members
    for (const key of [...overlaySeries.keys()]) {
      if (key.startsWith(id + '_')) {
        try { mainChart.removeSeries(overlaySeries.get(key)); } catch {}
        overlaySeries.delete(key);
      }
    }
  }

  function removeIndicator(id) {
    removeIndicatorById(id);
    removePane(id);
  }

  /* ── Tooltip ─────────────────────────────────────────────────────────── */
  function buildTooltip(container) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'chart-tooltip';
    tooltipEl.style.cssText = 'display:none;';
    container.style.position = 'relative';
    container.appendChild(tooltipEl);
  }

  function onCrosshairMove(param) {
    if (!tooltipEl || !param.time || !param.point) { if (tooltipEl) tooltipEl.style.display = 'none'; return; }
    const data = param.seriesData.get(candleSeries);
    if (!data) { tooltipEl.style.display = 'none'; return; }

    const isCandle = 'open' in data;
    if (isCandle) {
      const chg    = data.close - data.open;
      const chgPct = ((chg / data.open) * 100).toFixed(2);
      const cls    = chg >= 0 ? 'up' : 'dn';
      tooltipEl.style.display = 'flex';
      tooltipEl.innerHTML = `
        <span class="ct-val">O <span class="${cls}">${data.open.toFixed(2)}</span></span>
        <span class="ct-val">H <span class="${cls}">${data.high.toFixed(2)}</span></span>
        <span class="ct-val">L <span class="${cls}">${data.low.toFixed(2)}</span></span>
        <span class="ct-val">C <span class="${cls}">${data.close.toFixed(2)}</span></span>
        <span class="ct-val"><span class="${cls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)} (${chgPct}%)</span></span>
      `;
    } else if ('value' in data) {
      tooltipEl.style.display = 'flex';
      tooltipEl.innerHTML = `<span class="ct-val">${data.value.toFixed(4)}</span>`;
    }
  }

  /* ── Update single price (WebSocket) ─────────────────────────────────── */
  function updateLastCandle(price) {
    if (!candleSeries || !currentCandles.length) return;
    const last = currentCandles[currentCandles.length - 1];
    const updated = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
    currentCandles[currentCandles.length - 1] = updated;
    try {
      if (chartType === 'candlestick') {
        candleSeries.update({ time: updated.time, open: updated.open, high: updated.high, low: updated.low, close: updated.close });
      } else {
        candleSeries.update({ time: updated.time, value: updated.close });
      }
    } catch {}
  }

  return { init, setData, setChartType, addIndicator, addPane, removeIndicator, updateLastCandle, get candles() { return currentCandles; } };
})();
