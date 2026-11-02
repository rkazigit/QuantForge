# QuantForge Terminal

A browser-based quantitative finance workstation: live market data, charting with technical
indicators, a paper-trading engine, an options pricing lab, a strategy backtester, and a
quant education module. It runs two ways from the same code:

- **On Cloudflare Workers** (recommended): website, API and persistent paper accounts all on Cloudflare, served from your own domain.
- **On any Node.js host** (Replit, Render, Railway, your laptop): `npm start`.

> Educational and research software. Not financial advice. See [Data and limitations](#data-and-limitations).

## Features

| Module | What it does |
|---|---|
| **Terminal** | Candlestick / line / area charts, 7 timeframes, symbol search, watchlist, live quote panel, fundamentals, 17 chart indicators (9 overlays, 8 oscillator panes) |
| **Paper Trade** | $100k simulated cash account. Market and limit orders, resting limit orders that fill only when the market reaches them, cancel, positions, realized/unrealized P&L, equity curve |
| **Options** | Black-Scholes-Merton, Monte Carlo (antithetic variates), CRR binomial tree (European and American). Eight Greeks. Live options chain with an expiry picker and per-maturity deltas |
| **Backtest** | 15 strategies on any symbol with configurable costs. Sharpe, Sortino, Calmar, drawdown, profit factor, expectancy, trade log, equity curve vs buy-and-hold. Signals fill at the *next bar's open* |
| **Quant Lab** | 12 lessons, 18 interview-style problems with worked solutions, Monty Hall and Kelly simulators, reading list |

Strategies: Bollinger mean reversion, MACD crossover, MA golden/death cross, RSI mean reversion, Turtle breakout,
VWAP deviation, Supertrend, Stochastic crossover, momentum breakout, ADX trend following, Keltner breakout,
triple-MA, CCI reversal, Parabolic SAR, Z-score mean reversion. 39 indicator functions in `public/js/indicators.js`.

---

## Deploy on Cloudflare (step by step)

### Why this matters: Pages vs Workers

QuantForge is **not** a static website. It needs a small backend for market data, paper trading and
options chains. **Cloudflare Pages serves static files only**, so a Pages deployment loads the page but has
no backend. (Older versions of this project sat on "Initializing..." in that situation; it now says
*"This host serves static files only"* instead.) The fix is to deploy it as a **Cloudflare Worker with static assets**,
which is what `wrangler.jsonc` in this repo configures. It uses the same GitHub auto-deploy workflow as Pages.

### 1. Get the files into GitHub correctly

The repository **root** must contain these files and folders directly (open your repo on github.com and check):

```
wrangler.jsonc    package.json    package-lock.json    server.js
public/           worker/         shared/              test/
```

- Upload the **contents** of the project folder, not the folder itself. If the repo shows a single folder
  (e.g. `quantforge2/`) and `wrangler.jsonc` is inside it, either move the files up, or later set
  **Settings -> Build -> Root directory** to that folder name in Cloudflare.
- **Do not upload `node_modules`.** It is not needed; Cloudflare installs dependencies itself.
- The GitHub web uploader accepts about 100 files per upload. The project has fewer than 50, but if you drag in a
  folder that contains `node_modules`, remove that first.

### 2. Create the Worker from your repo

1. Cloudflare dashboard -> **Workers & Pages** -> **Create** -> choose **Import a repository** (the "Workers" option, *not* the Pages / "Upload assets" option).
2. Authorize GitHub if asked, pick your repo and the `main` branch.
3. **Project name: `quantforge`.** It must match the `"name"` in `wrangler.jsonc`, or the build will complain.
4. Leave the build command empty and leave the deploy command as `npx wrangler deploy`.
5. Click **Save and Deploy**, then watch the build log. A successful run ends with a line like
   `Deployed quantforge ... https://quantforge.<your-subdomain>.workers.dev`.

Open that `workers.dev` address. You should see the terminal load and quotes appear within a few seconds.

### 3. Put it on your own domain

1. Open the Worker -> **Settings** -> **Domains & Routes** -> **Add** -> **Custom domain**.
2. Enter the hostname, e.g. `quant.yourdomain.com` (the domain must already be on this Cloudflare account).
3. Cloudflare creates the DNS record and the HTTPS certificate for you. Allow a minute or two.

If that hostname is currently attached to an old **Pages** project, remove it there first (Pages project -> Custom domains). A hostname can only point to one thing.

### 4. Updating

Commit to `main` on GitHub (web upload works). Cloudflare rebuilds and redeploys automatically.

### What is different on Cloudflare vs a Node server

| | Node server (`npm start`) | Cloudflare Worker |
|---|---|---|
| Live quotes | WebSocket push | HTTP polling every 6 s (the UI switches automatically and shows `POLLING 6s`) |
| Paper accounts | In server memory, lost on restart | Durable Object storage, **survives restarts and redeploys** |
| Limit-order fills | Background timer every 10 s | Durable Object alarm every 15 s (and on every portfolio refresh) |
| Cost | Whatever the host charges | Workers free plan should be enough for personal use; see note below |

Note on plans: paper accounts use SQLite-backed Durable Objects, which Cloudflare offers on the Workers free plan.
If the deploy step ever reports that Durable Objects require a paid plan, your account's limits differ from what
this guide assumes; check **Workers & Pages -> Plans**.

### Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| "QuantForge could not start. ... This host serves static files only" | Deployed as a Pages site (no backend) | Follow step 2 above, using the Workers import |
| "QuantForge could not start. These files failed to load: ..." (followed by a list of file names) | Files are missing, or in a sub-folder | Check step 1: the repo root must contain `public/`, `wrangler.jsonc`, etc. Set the Root directory if needed |
| "QuantForge could not start. A script crashed on startup" | A script was replaced by an HTML page (wrong folder), or an edited file has a typo | Open the browser console (F12) and look at the first red error |
| Page loads, but quotes say "Yahoo is rate-limiting this server" | Yahoo throttles some cloud IP ranges | Wait a minute and refresh. If it persists, use the Node-host option below or swap the data provider (see Data and limitations) |
| Build fails: "name mismatch" or "project not found" | Project name differs from `"name"` in `wrangler.jsonc` | Rename one so they match |
| Domain shows a Cloudflare error page | DNS record not created yet, or old Pages domain still attached | Re-check step 3 |
| Paper account "reset" | A new browser or cleared site data creates a new anonymous account (the id lives in localStorage) | Expected; there are no logins |

### Alternative: keep the Node server, use Cloudflare for the domain

If Yahoo blocks Cloudflare's network for you, run the Node server somewhere whose IPs Yahoo accepts
(Replit worked in earlier testing) and keep Cloudflare for DNS only: deploy the repo to Replit/Render/Railway
with start command `npm start`, then add a `CNAME` record in Cloudflare DNS pointing your hostname at that host.
WebSockets work through the Cloudflare proxy.

---

## Run locally

```bash
npm install
npm start          # Node server at http://localhost:3000
npm test           # 16 numerical tests

npm run cf:dev     # OR: run the Cloudflare Worker locally at http://localhost:8787
```

Requires Node.js 18+. No API keys needed.

## Architecture

```
wrangler.jsonc            Cloudflare config (static assets + Worker + Durable Object)
worker/
  index.js                API router (quotes, history, options, search, fundamentals, paper trading)
  yahoo.js                Yahoo Finance adapter: cookie+crumb handshake, batching, caching, fallbacks
  paperAccount.js         Durable Object: one persistent paper account per session
server.js                 Same API as a Node/Express server (+ WebSocket quote push)
shared/paper.js           Paper-trading engine, shared by BOTH runtimes
public/
  index.html              App shell + startup watchdog
  css/terminal.css        Design system
  vendor/                 TradingView Lightweight Charts (self-hosted) + license
  js/
    indicators.js         39 technical-analysis functions
    strategies.js         Strategy registry: data -> signals
    backtest.js           Backtest engine + metrics + UI
    options.js            Pricing engine (BSM / MC / binomial / IV solver) + UI
    chartManager.js       Chart wrapper: overlays and synced indicator panes
    terminal.js / paperTrade.js / quantLab.js / quantContent.js / app.js
test/engines.test.mjs     Numerical test suite
```

### API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/quote/:symbol` | Quote (price, bid/ask, volume, market state) |
| POST | `/api/quotes` | Bulk quotes `{symbols: []}` |
| GET | `/api/history/:symbol?interval=&range=` | OHLCV candles (unix-second timestamps) |
| GET | `/api/search/:query` | Symbol search |
| GET | `/api/options/:symbol[?date=<unix>]` | Options chain (expiries as unix seconds) |
| GET | `/api/fundamentals/:symbol` | Profile and key statistics |
| GET | `/api/paper/portfolio` | Portfolio with live P&L (header `X-Session`) |
| POST | `/api/paper/order` | Place market or limit order |
| DELETE | `/api/paper/order/:id` | Cancel open order |
| DELETE | `/api/paper/portfolio` | Reset account |
| WS | `/ws` | Node server only. Send `{action:"subscribe", symbols:[...]}`, receive `{type:"quote", ...}` |

## Testing

`npm test` runs `test/engines.test.mjs`: Black-Scholes prices/Greeks against reference values, put-call parity,
Greeks vs finite differences, implied-vol round trips, Monte Carlo vs closed form, binomial convergence and
American early exercise, indicator regressions, backtester accounting to the cent, and all 15 strategies end to end.

The server and Worker were additionally verified with end-to-end suites (not included in this repo): REST routes,
the paper engine, limit-order matching, concurrent orders, Durable Object persistence across a restart, the
alarm-driven background fill, Yahoo fallback and 429 handling, and a scripted click-through of every page.
Those ran against a stand-in for Yahoo's API, so **live Yahoo behavior from Cloudflare's network is the one thing
not verified**; see below.

## Data and limitations

- **Market data is from Yahoo Finance** through unofficial endpoints. It is polled, not a true exchange stream,
  can be delayed (up to ~15 minutes on some venues), and may be rate-limited or change without notice. Yahoo
  sometimes throttles cloud IP ranges, including Cloudflare's. Its terms restrict commercial redistribution:
  fine for a portfolio or educational project, but use a licensed provider (Polygon, Alpaca, Twelve Data, ...)
  for anything commercial. Only `worker/yahoo.js` (Worker) and `fetchQuote`/`fetchHistory` in `server.js` (Node) need replacing.
- **No Level-2 order book.** The free feed has only the best bid/ask. The depth ladder is modeled around the real top of book and labelled as such.
- **Paper trading** is long-only, whole shares, no margin, with simulated fills against bid/ask. No user accounts.
- **Backtests** fill at the next bar's open with percentage costs, one position at a time. No borrow cost, market impact, or survivorship-bias handling. A good backtest here is a hypothesis, not evidence of an edge.
- **Options** models are European-style with constant volatility; listed US equity options are American.

## Credits

Charts: [TradingView Lightweight Charts](https://www.tradingview.com/), Copyright (c) 2024 TradingView, Inc., Apache-2.0
(license text in `public/vendor/`). Market data: Yahoo Finance.

## License

MIT (see `LICENSE`). The vendored charting library keeps its own Apache-2.0 license.
