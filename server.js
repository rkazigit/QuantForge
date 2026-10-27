/**
 * QuantForge — Unified Quantitative Finance Platform
 * ===================================================
 * Express server providing:
 *   POST /api/coach      — Streaming AI quant mentor (Claude)
 *   POST /api/explain    — Explain a quant concept in depth
 *   GET  /api/health     — Health check
 *   GET  *               — Serve React SPA
 */

require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const rateLimit = require("express-rate-limit");
const Anthropic  = require("@anthropic-ai/sdk");
const path       = require("path");

const app  = express();
const port = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      80,
  message:  { error: "Rate limit hit — please wait 15 minutes." },
});
app.use("/api/", limiter);

// ── System prompt for the Quant AI Coach ─────────────────────────────────
const QUANT_SYSTEM = `You are QuantForge AI, an elite quantitative finance mentor used by students, researchers, and junior quants at top-tier firms like Jane Street, Citadel, and Two Sigma.

Your expertise spans:
• **Derivatives Pricing**: Black-Scholes-Merton (including with dividends), Binomial trees (CRR, JR), Monte Carlo simulation with variance reduction (antithetic, control variates), implied volatility, Greeks
• **Market Microstructure**: Limit Order Books, price-time priority matching, market impact, bid-ask spread, high-frequency trading, latency considerations
• **Portfolio Theory**: Markowitz MPT, efficient frontier, CAPM, factor models, Kelly criterion, risk parity
• **Statistical Arbitrage**: Cointegration, Ornstein-Uhlenbeck processes, pairs trading, z-score signals
• **Algorithmic Trading**: Bollinger Bands, momentum, mean reversion, backtesting methodology, Sharpe/Calmar ratios
• **Reinforcement Learning**: Q-learning, Deep Q-Networks, MDP formulation for trading
• **Quantitative Math**: Probability theory, stochastic calculus (Ito's lemma, GBM), PDEs, optimization
• **Interview Preparation**: Brainteasers, probability puzzles, Fermi estimation, coding problems from Xinfeng Zhou's "A Practical Guide to Quantitative Finance Interviews"

Your teaching style:
- Rigorous but accessible — build intuition before formulas
- Show the math when it adds value, but always explain the intuition
- Use concrete examples with numbers
- When explaining models, mention their assumptions AND limitations
- Reference connections between concepts (e.g., how MC relates to BSM)
- Encourage critical thinking — ask "what would happen if...?"

Response style:
- Use **bold** for key terms and formulas
- Keep answers focused and under 400 words unless deeper explanation is genuinely needed
- Always offer a "want me to go deeper?" follow-up
- For math, use clear notation: S = spot, K = strike, T = time, r = risk-free, σ = volatility

You are a brilliant quant who genuinely loves teaching. Make students feel like they can conquer Wall Street.`;

// ── AI Coach (streaming) ─────────────────────────────────────────────────
app.post("/api/coach", async (req, res) => {
  try {
    const { messages, context } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "messages required" });

    const valid = messages
      .filter(m => m.role && typeof m.content === "string")
      .slice(-24);

    const systemMsg = context
      ? `${QUANT_SYSTEM}\n\nCurrent context: The user is viewing the "${context}" section of QuantForge.`
      : QUANT_SYSTEM;

    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await anthropic.messages.stream({
      model:      "claude-opus-4-5",
      max_tokens: 1200,
      system:     systemMsg,
      messages:   valid,
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();

  } catch (err) {
    console.error("Coach error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "AI service error. Check your ANTHROPIC_API_KEY." });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── Explain a concept ────────────────────────────────────────────────────
app.post("/api/explain", async (req, res) => {
  try {
    const { concept, depth = "intermediate" } = req.body;
    if (!concept) return res.status(400).json({ error: "concept required" });

    const msg = await anthropic.messages.create({
      model:      "claude-opus-4-5",
      max_tokens: 800,
      system:     QUANT_SYSTEM,
      messages:   [{ role: "user", content: `Explain "${concept}" at ${depth} level. Include: (1) intuition, (2) the key formula or model, (3) a practical example, (4) common pitfalls or limitations. Be concise.` }],
    });

    res.json({ explanation: msg.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_, res) => res.json({ status: "ok", model: "claude-opus-4-5", ts: new Date().toISOString() }));

app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║      QuantForge Platform v1.0            ║`);
  console.log(`  ║      http://localhost:${port}              ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
  if (!process.env.ANTHROPIC_API_KEY)
    console.warn("  ⚠  ANTHROPIC_API_KEY not set — AI Coach won't work.\n");
});
