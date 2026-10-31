# QuantForge Terminal

A browser-based quantitative finance workstation: live market data, charting with technical
indicators, a paper-trading engine, an options pricing lab, a strategy backtester, and a
quant education module. Node.js backend, no build step, no API keys required.

> Educational and research software. Not financial advice. See [Data and limitations](#data-and-limitations).

## Features

| Module | What it does |
|---|---|
| **Terminal** | Candlestick / line / area charts (TradingView Lightweight Charts), 7 timeframes, symbol search, watchlist, live quote panel, 52-week range, fundamentals, 17 chart indicators (9 overlays, 8 oscillator panes) |
| **Paper Trade** | $100k simulated cash account. Market and limit orders, resting limit orders that fill only when the market reaches them, cancel, positions, realized/unrealized P&L, equity curve |
| **Options** | Black-Scholes-Merton, Monte Carlo (antithetic variates), CRR binomial tree (European and American). Eight Greeks (Delta, Gamma, Vega, Theta, Rho, Vanna, Volga, Charm). Live options chain with quoted IV |
| **Backtest** | 15 strategies on any symbol, with configurable costs. Sharpe, Sortino, Calmar, max drawdown, profit factor, expectancy, trade log, equity curve vs buy-and-hold |
| **Quant Lab** | 12 lessons (Black-Scholes derivation, Greeks, implied vol, Monte Carlo, trees, microstructure, cointegration, Kelly, honest backtesting, ML/RL, stochastic calculus, VaR/ES), 18 interview-style problems with worked solutions, Monty Hall and Kelly simulators, reading list |

### Strategies
Bollinger mean reversion, MACD crossover, MA golden/death cross, RSI mean reversion, Turtle (Donchian) breakout,
VWAP deviation, Supertrend, Stochastic crossover, momentum breakout (volume-confirmed, ATR trailing stop),
ADX trend following, Keltner breakout, triple-MA alignment, CCI reversal, Parabolic SAR, Z-score mean reversion.

### Indicators
39 indicator functions in `public/js/indicators.js` (moving averages incl. HMA/ALMA/DEMA/TEMA, RSI, MACD, Stochastic,
CCI, ADX/DI, ATR, Bollinger, Keltner, Donchian, Supertrend, PSAR, Ichimoku, VWAP, OBV, CMF, MFI, pivots, Fibonacci, z-score, ...).

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/quantforge.git
cd quantforge
npm install
npm start          # http://localhost:3000
npm test           # 16 numerical tests
```

Requires Node.js 18+. Market data comes from Yahoo Finance with no key.

## Architecture

```
server.js                 Express + WebSocket server
                          - Yahoo Finance quote/history/options/fundamentals proxy with caching
                          - Paper-trading engine (in-memory, per anonymous session)
                          - Quote broadcaster (polls subscribed symbols, pushes over WebSocket)
public/
  index.html              App shell
  css/terminal.css        Design system
  js/
    indicators.js         Technical-analysis library (pure functions)
    strategies.js         Strategy registry: data -> signals
    backtest.js           Backtest engine + metrics + UI
    options.js            Pricing engine (BSM / MC / binomial / IV solver) + UI
    chartManager.js       Lightweight Charts wrapper, overlays and synced indicator panes
    terminal.js           Terminal page controller
    paperTrade.js         Paper-trading page
    quantContent.js       Lessons and problem bank
    quantLab.js           Quant Lab page + simulations
    app.js                Bootstrap, API client, WebSocket feed, navigation
test/engines.test.mjs     Numerical test suite
```

Strategies are pure functions `(ohlcv, config) -> signals`, and the backtester consumes signals without
knowing which strategy made them. To add a strategy, write one function and add one entry to `REGISTRY` in
`strategies.js`; the UI builds its parameter sliders from that entry automatically.

### API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/quote/:symbol` | Quote (price, bid/ask, volume, market state, ...) |
| POST | `/api/quotes` | Bulk quotes `{symbols: []}` |
| GET | `/api/history/:symbol?interval=&range=` | OHLCV candles (unix-second timestamps) |
| GET | `/api/search/:query` | Symbol search |
| GET | `/api/options/:symbol` | Options chain |
| GET | `/api/fundamentals/:symbol` | Profile and key statistics |
| GET | `/api/paper/portfolio` | Portfolio with live P&L (header `X-Session`) |
| POST | `/api/paper/order` | Place market or limit order |
| DELETE | `/api/paper/order/:id` | Cancel open order |
| DELETE | `/api/paper/portfolio` | Reset account |
| WS | `/` | Send `{action:"subscribe", symbols:[...]}`; receive `{type:"quote", ...}` |

## Testing

`npm test` runs `test/engines.test.mjs`, which checks:

- Black-Scholes prices and Greeks against reference values, put-call parity, Greeks vs. finite differences
- Implied-vol round trips (including out-of-the-money), Monte Carlo vs. closed form (within 4 standard errors)
- Binomial convergence; American put early-exercise premium; American call on a non-dividend stock equals European
- Indicator correctness and regression tests (MACD signal line, ADX seeding)
- Backtester accounting to the cent for long, short, reversal and cost scenarios
- All 15 strategies run end-to-end and produce well-formed signals

## Deployment

The app needs a long-running Node process (WebSockets and in-memory paper accounts), so a static host
such as GitHub Pages will not work on its own. Any Node host does:

**Render / Railway / Fly.io**: connect the GitHub repo, build command `npm install`, start command `npm start`.
No environment variables are required (`PORT` is injected by the host).

**Custom domain**: add the domain in your host's dashboard, then create the DNS record it asks for
(typically a CNAME). If you use Cloudflare for DNS, WebSockets work through its proxy; use "Full (strict)" SSL.

## Data and limitations

- **Market data is from Yahoo Finance** through the unofficial `yahoo-finance2` library. It is polled, not a
  true exchange stream, can be delayed (up to ~15 minutes on some venues), and may be rate-limited or change
  without notice. Yahoo's terms restrict commercial redistribution: fine for a portfolio or educational project,
  but use a licensed provider (Polygon, Alpaca, Twelve Data, ...) for anything commercial. Only
  `fetchQuote` and `fetchHistory` in `server.js` need replacing.
- **No Level-2 order book.** The free feed has only the best bid/ask. The depth ladder is modeled around the
  real top of book and labelled as such in the UI.
- **Paper trading** is long-only, whole shares, no margin, with simulated fills against bid/ask. State lives
  in server memory and resets on restart. There are no user accounts.
- **Backtests** fill at the next bar's open with percentage costs, one position at a time. No borrow cost, market
  impact, or survivorship-bias handling. A good backtest here is a hypothesis, not evidence of an edge.
- **Options** models are European-style with constant volatility; listed US equity options are American.

## Roadmap

- Licensed real-time data adapter and true Level-2 depth
- Multi-asset competitive trading-case simulator (Rotman Interactive Trader style) with scripted news and liquidity
- Persistent accounts and storage; leaderboard
- Pairs/cointegration scanner and walk-forward optimizer in the UI
- Heston and local-volatility pricing, volatility-surface viewer
- AI tutor (bring-your-own API key)
- Research notes section

## License

MIT
