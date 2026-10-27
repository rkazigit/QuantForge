# ⚡ QuantForge — Quantitative Finance Platform

> **Where Mathematics Meets Markets**
> 
> An open-source, full-stack quantitative finance platform combining six pricing models, live market microstructure simulation, portfolio optimization, an AI quant mentor, financial education, and Green Book interview prep — all in one deployable web app.

---

## 🚀 Live Modules

| Module | Description | Key Concepts |
|--------|-------------|--------------|
| ⚡ **Options Lab** | BSM, Monte Carlo, Binomial pricing with live Greeks | d₁/d₂, Vega, Delta, Gamma, Theta, Rho |
| 📊 **Order Book Simulator** | Animated real-time LOB with bid/ask depth and trade tape | Price-time priority, spread, market impact |
| 📈 **Strategy Backtester** | Bollinger Bands mean-reversion with equity curve | SMA, σ-bands, Sharpe ratio, drawdown |
| 🎯 **Portfolio Optimizer** | Markowitz efficient frontier via 3,000 simulations | MPT, Sharpe, Min-Variance, covariance |
| 🤖 **AI Quant Coach** | Streaming Claude AI — expert quant finance mentor | Black-Scholes, Itô, Kelly, interview prep |
| 📚 **Education Hub** | 6 deep-dive lessons on stochastic calculus, LOB, MPT | BSM derivation, Monte Carlo, GBM |
| 🎓 **Interview Prep** | 15 Green Book problems with full solutions | Probability, finance, brainteasers, stochastic calc |

---

## ⚡ Quickstart

### Prerequisites
- Node.js ≥ 18
- An Anthropic API key → [console.anthropic.com](https://console.anthropic.com)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/quantforge.git
cd quantforge
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run

```bash
npm start
# → http://localhost:3000
```

For auto-restart during development:
```bash
npm run dev
```

---

## 🎮 Deploy to Replit

1. **Import from GitHub** → paste your repo URL
2. Open **Secrets** (🔒 tab) → add `ANTHROPIC_API_KEY`
3. Click **Run** — Replit auto-detects `npm start`
4. Share your Replit URL as a live demo

---

## 🌐 Deploy to a Domain (Render / Railway / Fly.io)

### Render (free tier)

1. Push repo to GitHub
2. New Web Service → connect your repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variable: `ANTHROPIC_API_KEY`
6. Connect a custom domain in Render settings

### Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway domain
```

---

## 📁 Project Structure

```
quantforge/
├── server.js           Express backend + Anthropic streaming API
├── package.json
├── .env.example        Environment variable template
├── .gitignore
├── README.md
└── public/
    └── index.html      Complete React SPA — all modules, all math
```

**No build step.** React loads from CDN via Babel standalone. The entire platform is `server.js` + `public/index.html`.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/coach` | Streaming SSE AI quant coach |
| `POST` | `/api/explain` | Explain a concept (non-streaming) |
| `GET`  | `/api/health` | Health check + model info |
| `GET`  | `*` | Serve React SPA |

### Example — Streaming Chat

```js
const res = await fetch('/api/coach', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Explain delta hedging' }],
    context: 'Options Lab'
  })
});

const reader = res.body.getReader();
// Stream SSE chunks: data: {"text": "..."}\n\n
```

---

## 🧮 Quantitative Models Implemented

All models run **entirely in the browser** — zero Python backend needed.

### Black-Scholes-Merton (with continuous dividends)

```
C = S·e^(-qT)·N(d₁) − K·e^(-rT)·N(d₂)
d₁ = [ln(S/K) + (r − q + σ²/2)T] / (σ√T)
d₂ = d₁ − σ√T
```

Full Greeks: Δ, Γ, ν (Vega), Θ, ρ

### Monte Carlo (European, 5,000 paths)

```
S(T) = S₀ · exp[(r − σ²/2)T + σ√T · Z],  Z ~ N(0,1)
Price = e^(-rT) · E[max(S(T) − K, 0)]
```

Implements Box-Muller transform for normal samples.

### Binomial Tree (CRR)

```
u = exp(σ√Δt),  d = 1/u,  p = (exp(rΔt) − d) / (u − d)
```

Supports European and American exercise via backward induction.

### Markowitz Portfolio Optimization

```
min  wᵀΣw        subject to:  Σwᵢ = 1,  wᵢ ≥ 0
s.t. wᵀμ = μ_target
```

Simulates 3,000 random portfolios to trace the efficient frontier.

### Bollinger Bands Strategy

```
Upper = SMA(N) + k·σ(N)
Lower = SMA(N) − k·σ(N)
Signal: Buy ↓ Lower, Sell ↑ Upper, Exit at Middle
```

Full backtest with Sharpe ratio and equity curve.

### LOB Simulation

Poisson-process order arrivals with price-time priority matching. Models:
- Limit order placements at random price levels
- Random cancellations
- Market orders that cross the spread

---

## 🎓 Interview Problems Covered

From *A Practical Guide to Quantitative Finance Interviews* (Xinfeng Zhou) and top HFT firm interviews:

| Category | Problems |
|----------|----------|
| **Probability** | Expected coin flips, Birthday paradox, Monty Hall, Coupon collector |
| **Finance** | Delta-gamma approximation, Put-call parity, BSM sensitivities, Kelly criterion |
| **Stochastic Calculus** | Itô's Lemma, GBM, risk-neutral vs real-world measure |
| **Statistics** | VaR and limitations, CVaR/Expected Shortfall |
| **Brainteasers** | Piano tuners (Fermi), 8 balls 2 weighings, 100 prisoners loop strategy, Water jug |

Every problem includes a full worked solution with the key formula.

---

## 📚 Education Lessons

1. **Black-Scholes-Merton** — derivation, PDE, closed-form, assumptions
2. **Monte Carlo Methods** — GBM paths, variance reduction, convergence
3. **Limit Order Books** — structure, price-time priority, market impact
4. **Modern Portfolio Theory** — Markowitz, efficient frontier, CAPM
5. **Reinforcement Learning** — Q-learning, DQN, MDP formulation for trading
6. **Stochastic Calculus** — Brownian motion, Itô integral, Feynman-Kac

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend** | Node.js + Express | API server, static file serving |
| **AI** | Anthropic Claude (claude-opus-4-5) | Streaming quant mentor |
| **Frontend** | React 18 (CDN) + Babel standalone | SPA, no build step |
| **Charts** | Chart.js 4.4 (CDN) | Options payoffs, equity curves, scatter |
| **Math** | Vanilla JavaScript | All quant models run client-side |
| **Fonts** | Google Fonts (Outfit + JetBrains Mono) | Fintech UI typography |
| **Rate Limiting** | express-rate-limit | API key protection |

---

## 🔒 Security

- API key is **server-side only** — never sent to the browser
- Rate limiting: 80 requests per 15-minute window
- Request body size capped at 20 KB
- Message history trimmed to last 24 messages

---

## 🗺 Roadmap

- [ ] Pairs trading analyzer (cointegration + OU process)
- [ ] Quantum portfolio optimization (QUBO formulation)
- [ ] VaR / CVaR risk dashboard
- [ ] Heston stochastic volatility model
- [ ] Real market data integration (Yahoo Finance API)
- [ ] User accounts + saved portfolios (Supabase)
- [ ] Mobile-responsive sidebar
- [ ] Dark/light theme toggle

---

## 📜 Disclaimer

QuantForge is an **educational and research platform**. Nothing on this platform constitutes financial advice. All models involve simplifying assumptions. Always consult a qualified financial professional before making investment decisions.

---

## 📄 License

MIT — free to use, fork, and build upon.

---

*Built with mathematics, curiosity, and way too much coffee. ☕*
