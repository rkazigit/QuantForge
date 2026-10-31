'use strict';
/**
 * quantContent.js — Educational content for the Quant Lab.
 * All lessons and problems are original write-ups of standard material.
 * Numeric answers in the problem bank were checked by hand/calculation.
 */

const QuantContent = (() => {

  const m = s => `<div class="math-block">${s}</div>`;
  const info = s => `<div class="info-box">${s}</div>`;
  const warn = s => `<div class="warn-box">${s}</div>`;

  /* ══════════════════════════════════════════════════════════════════════
     LESSONS
     ══════════════════════════════════════════════════════════════════════ */
  const LESSONS = [
    {
      id: 'bsm', area: 'Derivatives', level: 'Core', mins: 12,
      title: 'Risk-Neutral Pricing and the Black-Scholes-Merton Model',
      html: `
        <p>The central surprise of Black-Scholes is that the option price does <strong>not</strong> depend on the stock's expected return. It depends on volatility because volatility determines the cost of hedging.</p>
        <h3>1. Model</h3>
        <p>Assume the stock follows geometric Brownian motion with a continuous dividend yield <em>q</em>:</p>
        ${m('dS = (μ − q)·S·dt + σ·S·dW')}
        <p>Applying Itô's lemma to ln S gives the exact solution:</p>
        ${m('S_T = S_0 · exp[(μ − q − σ²/2)T + σ·W_T]')}
        <h3>2. The hedging argument</h3>
        <p>Build the portfolio Π = V − Δ·S with Δ = ∂V/∂S. Itô's lemma on V(S,t) shows the dW terms cancel, leaving a deterministic change:</p>
        ${m('dΠ = (V_t + ½σ²S²·V_SS)·dt')}
        <p>No-arbitrage requires a riskless portfolio to earn the risk-free rate. After accounting for dividends this yields the Black-Scholes PDE:</p>
        ${m('V_t + ½σ²S²·V_SS + (r − q)·S·V_S − r·V = 0')}
        <p>μ has vanished. Every investor, whatever their risk appetite, agrees on the price because it is enforced by replication.</p>
        <h3>3. Risk-neutral expectation</h3>
        <p>By Feynman-Kac the PDE solution equals a discounted expectation under a different measure Q in which the stock drifts at r − q:</p>
        ${m('V_0 = e^(−rT) · E^Q[ payoff(S_T) ]')}
        <p>This is why Monte Carlo works: simulate under Q, average the payoffs, discount.</p>
        <h3>4. Closed form</h3>
        ${m('C = S·e^(−qT)·N(d₁) − K·e^(−rT)·N(d₂)<br/>P = K·e^(−rT)·N(−d₂) − S·e^(−qT)·N(−d₁)<br/>d₁ = [ln(S/K) + (r − q + σ²/2)T] / (σ√T),   d₂ = d₁ − σ√T')}
        <p><strong>N(d₂)</strong> is the risk-neutral probability of finishing in the money. <strong>N(d₁)</strong> (times e^(−qT)) is the option's delta.</p>
        ${info('<strong>Quick approximation.</strong> For an at-the-money option with r ≈ q ≈ 0: C ≈ 0.4·S·σ·√T. A 25% vol, 3-month ATM option on a $100 stock is worth about 0.4·100·0.25·0.5 ≈ $5.00.')}
        <h3>5. What breaks</h3>
        <ul>
          <li><strong>Constant volatility.</strong> Real implied vol varies by strike and maturity (the smile). See the implied volatility lesson.</li>
          <li><strong>Continuous hedging, no costs.</strong> Real hedging is discrete and costly, so hedging error is non-zero.</li>
          <li><strong>No jumps.</strong> Gaps break the replication argument; the market is incomplete.</li>
          <li><strong>European exercise only.</strong> American options need trees or finite differences.</li>
        </ul>
        <p>Try it: the <strong>OPTIONS</strong> tab prices any parameter set with BSM, Monte Carlo and a binomial tree side by side.</p>`
    },
    {
      id: 'greeks', area: 'Derivatives', level: 'Core', mins: 10,
      title: 'The Greeks and the Economics of a Delta-Hedged Book',
      html: `
        <p>Greeks are partial derivatives of the option value. For a trader they are risk limits, and for a market maker they are the P&amp;L attribution.</p>
        ${m('Δ = ∂V/∂S     Γ = ∂²V/∂S²     ν = ∂V/∂σ     Θ = ∂V/∂t     ρ = ∂V/∂r')}
        <h3>Theta pays for gamma</h3>
        <p>Rewrite the Black-Scholes PDE in terms of the Greeks:</p>
        ${m('Θ + (r − q)·S·Δ + ½σ²S²·Γ = r·V')}
        <p>For a delta-hedged position (the Δ term is hedged away) with small r, this says <strong>Θ ≈ −½σ²S²Γ</strong>. A long-gamma position bleeds time value every day in exchange for profiting from movement. Over one day the P&amp;L of a delta-hedged long option is approximately:</p>
        ${m('P&L ≈ ½·Γ·S²·[(ΔS/S)² − σ²·dt]')}
        <p>You make money when the realized squared return exceeds what implied vol priced in, and lose it otherwise. Trading options is therefore trading <em>realized versus implied volatility</em>.</p>
        ${info('<strong>Breakeven move.</strong> Setting the bracket to zero: the daily breakeven move is σ/√252 of spot. At 20% implied vol that is about 1.26% per day.')}
        <h3>Shape of the Greeks</h3>
        <ul>
          <li><strong>Gamma</strong> peaks at-the-money and explodes as expiry approaches. This is "pin risk" near expiry.</li>
          <li><strong>Vega</strong> is largest at-the-money and grows with √T. Long-dated options carry the vol exposure.</li>
          <li><strong>Theta</strong> accelerates into expiry for ATM options.</li>
          <li><strong>Delta</strong> of a call is between 0 and e^(−qT). It is roughly the risk-neutral probability of expiring in the money.</li>
        </ul>
        <h3>Second-order Greeks</h3>
        <ul>
          <li><strong>Vanna</strong> = ∂Δ/∂σ = ∂ν/∂S. It matters for skew trades and for how your hedge shifts when vol moves.</li>
          <li><strong>Volga (Vomma)</strong> = ∂ν/∂σ. A positive volga position benefits from vol-of-vol, and it is the reason wings carry a premium.</li>
          <li><strong>Charm</strong> = ∂Δ/∂t. Your delta changes just by the passage of time, which matters for weekend hedging.</li>
        </ul>
        <p>The OPTIONS tab shows all eight Greeks live as you move the sliders.</p>`
    },
    {
      id: 'iv', area: 'Derivatives', level: 'Intermediate', mins: 9,
      title: 'Implied Volatility, the Smile, and the Surface',
      html: `
        <p>Black-Scholes is a monotone map from volatility to price, so any market price can be inverted to an <strong>implied volatility</strong>. Options are quoted in vol terms because vol is comparable across strikes and maturities in a way that price is not.</p>
        <h3>Solving for IV</h3>
        <p>Vega is always positive, so Newton-Raphson converges quickly from a sensible start:</p>
        ${m('σ_{n+1} = σ_n − [BS(σ_n) − Market] / Vega(σ_n)')}
        <p>A good first guess is the Brenner-Subrahmanyam approximation σ₀ ≈ √(2π/T) · C/S. Prices below intrinsic value have no solution, and very deep OTM options have vega near zero, so a bisection fallback is wise in production.</p>
        <h3>The smile and skew</h3>
        <p>If Black-Scholes were right, IV would be flat across strikes. It never is:</p>
        <ul>
          <li><strong>Equity indices</strong> show a pronounced <em>skew</em>: downside puts trade at higher IV. Causes include crash fear, structural demand for portfolio protection, and the leverage effect (falling prices raise leverage and volatility).</li>
          <li><strong>FX</strong> often shows a symmetric smile; <strong>commodities</strong> can skew toward calls.</li>
          <li><strong>Term structure</strong> is usually upward-sloping in calm markets and inverts under stress.</li>
        </ul>
        <h3>No-arbitrage constraints on the surface</h3>
        <ul>
          <li><strong>Butterfly:</strong> call prices must be convex in strike, otherwise the implied risk-neutral density goes negative.</li>
          <li><strong>Calendar:</strong> total implied variance σ²T must not decrease with maturity at a fixed strike.</li>
        </ul>
        <h3>Models that fit the surface</h3>
        <ul>
          <li><strong>Local volatility (Dupire):</strong> σ(S,t) calibrated to match every vanilla price exactly. It gives the wrong forward-smile dynamics.</li>
          <li><strong>Heston:</strong> stochastic variance that mean-reverts, with spot-vol correlation ρ &lt; 0 generating skew.</li>
          <li><strong>SABR:</strong> an industry standard for interest-rate smiles.</li>
          <li><strong>Jump-diffusion (Merton, Bates):</strong> fits short-dated wings.</li>
        </ul>
        ${info('The <strong>VIX</strong> is a model-free estimate of 30-day variance computed from a strip of S&amp;P 500 options. It is not Black-Scholes at-the-money vol.')}
        <p>The OPTIONS tab loads the live chain and shows each strike's quoted IV, so you can see the skew directly.</p>`
    },
    {
      id: 'mc', area: 'Numerical Methods', level: 'Intermediate', mins: 10,
      title: 'Monte Carlo Methods and Variance Reduction',
      html: `
        <p>Monte Carlo estimates an expectation by a sample mean. By the central limit theorem the standard error shrinks as <strong>σ/√N</strong>, so each extra digit of accuracy costs 100× more paths. Its strength is dimension-independence: the rate does not worsen for baskets, path-dependent payoffs, or many risk factors.</p>
        <h3>Pricing recipe</h3>
        ${m('V ≈ e^(−rT) · (1/N) · Σ payoff(S_T^(i)),    SE = e^(−rT)·s/√N')}
        <p>Always report the standard error or a confidence interval with the price.</p>
        <h3>Variance reduction</h3>
        <ul>
          <li><strong>Antithetic variates.</strong> For each draw Z also use −Z and average the two payoffs. For monotone payoffs the pair is negatively correlated, so variance falls. The OPTIONS tab uses this.</li>
          <li><strong>Control variates.</strong> Pick X with a known mean (for example the discounted terminal stock price, whose expectation is S₀). Estimate Y − β(X − E[X]) with β = Cov(Y,X)/Var(X). The variance is multiplied by (1 − ρ²), so a 0.95 correlation removes about 90% of the variance.</li>
          <li><strong>Importance sampling.</strong> Shift the sampling distribution toward the rare region that drives the payoff (deep OTM options, tail risk).</li>
          <li><strong>Quasi-Monte Carlo.</strong> Low-discrepancy sequences (Sobol) can reach error near (log N)^d/N for smooth integrands.</li>
        </ul>
        <h3>Greeks from Monte Carlo</h3>
        <ul>
          <li><strong>Bump-and-revalue</strong> with <em>common random numbers</em> (reuse the same Z). Simple but noisy for gamma.</li>
          <li><strong>Pathwise</strong> differentiation of the payoff. Efficient, but fails for discontinuous payoffs such as digitals.</li>
          <li><strong>Likelihood ratio</strong> differentiates the density instead. Works for digitals, with higher variance.</li>
        </ul>
        <h3>American options</h3>
        <p>Early exercise needs the continuation value. The Longstaff-Schwartz method regresses discounted future cashflows on basis functions of the current state across in-the-money paths.</p>
        ${warn('<strong>Pitfall:</strong> using too few paths and reading noise as signal. Two runs that differ by less than the standard error are statistically identical.')}`
    },
    {
      id: 'tree', area: 'Numerical Methods', level: 'Intermediate', mins: 8,
      title: 'Binomial Trees and American Options',
      html: `
        <p>A binomial tree is a discrete-time model of the stock in which each step moves up by u or down by d. It is simple, converges to Black-Scholes, and handles early exercise naturally.</p>
        <h3>Cox-Ross-Rubinstein parameters</h3>
        ${m('u = e^(σ√Δt),   d = 1/u,   p = (e^((r−q)Δt) − d) / (u − d)')}
        <p>Here p is the <em>risk-neutral</em> probability chosen so the stock's expected growth equals r − q. It is not the real-world probability of rising.</p>
        <h3>Backward induction</h3>
        <ol>
          <li>Set terminal values to the payoff at each of the N+1 final nodes.</li>
          <li>Step back: <em>continuation</em> = e^(−rΔt)·[p·V_up + (1−p)·V_down].</li>
          <li>For American exercise: V = max(continuation, intrinsic value).</li>
        </ol>
        <h3>Convergence</h3>
        <p>The price converges at roughly O(1/N) but with a sawtooth oscillation depending on where the strike falls relative to the terminal nodes. Averaging the N and N+1 step results, or using Richardson extrapolation, smooths this.</p>
        <h3>Early exercise facts</h3>
        <ul>
          <li>An American <strong>call on a non-dividend-paying stock</strong> is never exercised early, so it equals the European call.</li>
          <li>An American <strong>put</strong> can be optimal to exercise early (deep ITM, high rates), and so carries an <em>early exercise premium</em>.</li>
          <li>With dividends, early call exercise can be optimal just before an ex-dividend date.</li>
        </ul>
        <p>A tree is equivalent to an explicit finite-difference scheme on the Black-Scholes PDE. Trinomial trees and Crank-Nicolson schemes are the production versions. The OPTIONS tab shows European and American binomial values together so the early-exercise premium is visible.</p>`
    },
    {
      id: 'micro', area: 'Market Microstructure', level: 'Advanced', mins: 14,
      title: 'Limit Order Books, Market Making and Price Impact',
      html: `
        <p>Almost every electronic market runs a <strong>central limit order book</strong>. Participants post passive limit orders (makers) or take liquidity with marketable orders (takers).</p>
        <h3>Matching rules</h3>
        <ul>
          <li><strong>Price-time priority (FIFO):</strong> best price first, then earliest arrival. This is the standard in US equities. It makes <em>queue position</em> valuable, and it is why latency matters.</li>
          <li><strong>Pro-rata</strong> allocation is used in some futures markets. It rewards size at the touch rather than speed.</li>
        </ul>
        <h3>Why spreads exist</h3>
        <ul>
          <li><strong>Order processing costs</strong> (small today).</li>
          <li><strong>Inventory risk:</strong> a market maker who gets long must hold risk until it can be unwound.</li>
          <li><strong>Adverse selection (Glosten-Milgrom):</strong> some counterparties know more. The spread compensates the maker for trading against informed flow.</li>
        </ul>
        <h3>Price impact</h3>
        <p>In Kyle's model the price moves linearly with signed order flow, ΔP = λ·Q. Empirically, metaorder impact is <em>concave</em>, following the "square-root law":</p>
        ${m('Impact ≈ Y · σ · √(Q / V)')}
        <p>where σ is daily volatility, V is daily volume, and Y is a constant of order one. Trading 1% of daily volume in a stock with 2% daily vol costs very roughly 0.2% in impact. This is why capacity matters for every strategy.</p>
        <h3>Optimal execution (Almgren-Chriss)</h3>
        <p>Executing quickly raises impact cost, while executing slowly adds timing risk. The optimal schedule trades these off through risk aversion: a front-loaded schedule for high risk aversion, close to TWAP for low.</p>
        <h3>Market making (Avellaneda-Stoikov)</h3>
        <p>With inventory q, risk aversion γ and volatility σ, the maker quotes around a <em>reservation price</em> shifted against inventory:</p>
        ${m('r = s − q·γ·σ²·(T − t)')}
        <p>If you are long, you shade your quotes lower to encourage selling into you. The optimal total spread widens with volatility and risk aversion.</p>
        <h3>Order flow imbalance</h3>
        <p>Short-horizon price changes are well explained by the net change in best bid and ask queue sizes (Cont, Kukanov and Stoikov). Imbalance toward the bid predicts an uptick.</p>
        ${warn('<strong>About this platform\'s order book.</strong> The free data feed provides only the best bid and ask. The depth ladder on the TERMINAL tab models deeper levels around the real top of book and is labelled as such. Real Level-2/3 data requires a paid exchange feed.')}
        <p>The C++ matching engine from the earlier project in this series implements price-time priority with an O(1) cancel via an intrusive linked list per price level.</p>`
    },
    {
      id: 'statarb', area: 'Statistical Arbitrage', level: 'Advanced', mins: 12,
      title: 'Cointegration, the Ornstein-Uhlenbeck Process and Pairs Trading',
      html: `
        <p>Two non-stationary price series are <strong>cointegrated</strong> if some linear combination is stationary. Correlation measures co-movement of <em>returns</em> and says nothing about whether the <em>price gap</em> reverts. Cointegration does.</p>
        <h3>Engle-Granger procedure</h3>
        <ol>
          <li>Regress log P_y on log P_x to get hedge ratio β and residual spread s_t = y_t − β·x_t.</li>
          <li>Test the residual for a unit root with ADF. Use MacKinnon cointegration critical values, not the standard ADF table, because β was estimated.</li>
        </ol>
        <p>For more than two assets use the Johansen test, which finds all cointegrating vectors.</p>
        <h3>Ornstein-Uhlenbeck dynamics</h3>
        ${m('dX = θ·(μ − X)·dt + σ·dW')}
        <p>Discretizing gives an AR(1): X_{t+1} = a + b·X_t + ε with b = e^(−θΔt). The key quantities are:</p>
        ${m('half-life = ln 2 / θ = −ln 2 / ln b<br/>stationary std = σ / √(2θ)')}
        <p>The half-life tells you how long a typical deviation takes to halve. Pick pairs with a half-life that matches your holding period: too short and costs eat the edge, too long and capital sits idle and regime risk grows.</p>
        <h3>Trading rule</h3>
        <p>Standardize the spread into a z-score with a rolling mean and standard deviation. Enter when |z| exceeds roughly 2, exit near 0, and stop out at a larger bound (3 to 4). The <em>Z-Score Mean Reversion</em> strategy in the BACKTEST tab is the single-asset version of this logic.</p>
        <h3>Why pairs strategies fail in practice</h3>
        <ul>
          <li><strong>Selection bias.</strong> Test 1,000 pairs at the 5% level and about 50 will look cointegrated by chance. Validate out of sample or correct for multiple testing.</li>
          <li><strong>Drifting hedge ratio.</strong> Use a rolling regression or a Kalman filter.</li>
          <li><strong>Structural breaks</strong> (mergers, regulation, business-model change) permanently destroy the relationship. A hard stop-loss is essential.</li>
          <li><strong>Crowding and costs.</strong> Two legs mean double the spread, double the commissions, plus borrow cost on the short.</li>
        </ul>
        <p>The first project in this series (the Python pairs engine) implements the full pipeline: screening, half-life filtering, and a cost-aware backtest.</p>`
    },
    {
      id: 'portfolio', area: 'Portfolio Theory', level: 'Intermediate', mins: 12,
      title: 'Mean-Variance Optimization and the Kelly Criterion',
      html: `
        <p>Markowitz showed that portfolio risk depends on covariances, not just individual volatilities, so diversification is a free lunch up to a point.</p>
        ${m('E[R_p] = wᵀμ          Var(R_p) = wᵀΣw')}
        <h3>Closed-form solutions (unconstrained)</h3>
        ${m('Minimum variance:  w = Σ⁻¹·1 / (1ᵀ·Σ⁻¹·1)<br/>Tangency (max Sharpe):  w ∝ Σ⁻¹·(μ − r·1)')}
        <p>Two uncorrelated assets with vols 20% and 30% have a minimum-variance weight of σ₂²/(σ₁²+σ₂²) = 69.2% in the first, and a combined vol of 16.6%, below either asset alone.</p>
        <h3>The estimation-error problem</h3>
        <p>The optimizer is an "error maximizer": it loads up on whichever assets have noisy-high estimated returns or noisy-low estimated risk. Expected returns are very hard to estimate, so practitioners use:</p>
        <ul>
          <li><strong>Covariance shrinkage</strong> (Ledoit-Wolf) to stabilize Σ.</li>
          <li><strong>Black-Litterman</strong> to blend market-implied returns with explicit views.</li>
          <li><strong>Risk parity</strong> / equal-risk-contribution, which needs no return forecast.</li>
          <li><strong>Hierarchical Risk Parity</strong> (López de Prado), which avoids inverting Σ.</li>
          <li>Constraints: long-only, position caps, turnover limits.</li>
        </ul>
        <h3>Kelly criterion</h3>
        <p>Kelly sizing maximizes the expected log of wealth, and so maximizes long-run growth. For a bet that pays b-to-1 with win probability p (q = 1 − p):</p>
        ${m('f* = (b·p − q) / b')}
        <p>For a continuous-time asset with excess return μ − r and variance σ²:</p>
        ${m('f* = (μ − r) / σ²,      growth g(f) = r + f·(μ − r) − ½f²σ²')}
        <p>At full Kelly the growth rate above the risk-free rate is SR²/2. Betting a fraction k of Kelly gives growth SR²·(k − k²/2). So <strong>half-Kelly keeps 75% of the growth at half the volatility</strong>, while betting more than 2× Kelly grows your money <em>more slowly than the risk-free rate</em> despite taking far more risk.</p>
        ${warn('Kelly assumes you know your edge. Overestimating the edge is far more dangerous than underestimating it, which is why practitioners use fractional Kelly. Try it in the <strong>Kelly simulator</strong> under Simulations.')}`
    },
    {
      id: 'backtest', area: 'Research Methodology', level: 'Core', mins: 11,
      title: 'Backtesting Without Fooling Yourself',
      html: `
        <p>Most backtests that look good are wrong. The skill in systematic trading is mostly in not deceiving yourself.</p>
        <h3>The classic biases</h3>
        <ul>
          <li><strong>Look-ahead bias:</strong> using information that was not available at decision time (for example, trading on a bar's close using that same close). This platform executes signals at the <strong>next bar's open</strong> for this reason.</li>
          <li><strong>Survivorship bias:</strong> testing only on companies that still exist today.</li>
          <li><strong>Data snooping / multiple testing:</strong> try enough strategies and one will look great by chance.</li>
          <li><strong>Unrealistic costs:</strong> ignoring spread, slippage, borrow, and market impact.</li>
        </ul>
        <h3>How noisy is a Sharpe ratio?</h3>
        <p>The standard error of an annualized Sharpe estimate over T years is approximately:</p>
        ${m('SE(SR) ≈ √[(1 + ½·SR²) / T]')}
        <p>A Sharpe of 1.0 measured over 3 years has SE ≈ 0.71, so the 95% interval is roughly −0.4 to 2.4. That is statistically indistinguishable from zero.</p>
        <h3>The multiple-testing penalty</h3>
        <p>If you test 100 strategies with zero true skill and keep the best, the expected maximum of 100 standard normals is about 2.5 standard errors. With the SE above, that is an annualized Sharpe near <strong>1.8 from pure noise</strong>. The Deflated Sharpe Ratio (Bailey and López de Prado) adjusts for the number of trials, skewness and kurtosis.</p>
        <h3>Better validation</h3>
        <ul>
          <li><strong>Hold-out data used once.</strong> If you peek repeatedly, it stops being out-of-sample.</li>
          <li><strong>Walk-forward testing:</strong> fit on a rolling window, trade the next period, repeat.</li>
          <li><strong>Purged and embargoed cross-validation</strong> when labels overlap in time.</li>
          <li><strong>Parameter stability:</strong> a real edge survives small parameter changes. If Sharpe collapses when you move a lookback from 20 to 22, you have fit noise.</li>
          <li><strong>Economic rationale</strong> for why the edge should exist and persist.</li>
        </ul>
        ${warn('<strong>About the BACKTEST tab:</strong> it is an educational research tool. Fills happen at the next open with simple percentage slippage, one position at a time, no borrow costs, no market impact, and adjusted prices from a free data source. Treat results as hypotheses to stress-test, never as evidence of profitability.')}`
    },
    {
      id: 'rl', area: 'Machine Learning', level: 'Advanced', mins: 10,
      title: 'Machine Learning and Reinforcement Learning in Trading',
      html: `
        <p>Reinforcement learning frames trading as a Markov decision process: a <strong>state</strong> (features, current position), an <strong>action</strong> (buy, hold, sell), and a <strong>reward</strong> (risk-adjusted P&amp;L). The goal is a policy that maximizes expected discounted reward.</p>
        ${m('Q(s,a) ← Q(s,a) + α·[ r + γ·max_a′ Q(s′,a′) − Q(s,a) ]')}
        <p>Tabular Q-learning stores this table for a discretized state space. A Deep Q-Network replaces the table with a neural network, stabilized by an <strong>experience replay</strong> buffer and a slowly updated <strong>target network</strong>.</p>
        <h3>Why financial RL is genuinely hard</h3>
        <ul>
          <li><strong>Tiny effective sample.</strong> A decade of daily bars is ~2,500 observations, orders of magnitude fewer than Atari or Go agents train on, and each is mostly noise.</li>
          <li><strong>Low signal-to-noise ratio.</strong> The reward barely depends on the agent's skill.</li>
          <li><strong>Non-stationarity.</strong> The environment changes with regimes, and your own trading changes it too.</li>
          <li><strong>Simulator exploitation.</strong> Agents find and abuse any unrealistic assumption (zero costs, perfect fills) in your backtest.</li>
        </ul>
        <h3>What professionals actually do</h3>
        <ul>
          <li>Predict returns (or probabilities) with heavily regularized supervised models, then size positions with a separate optimizer.</li>
          <li>Use <strong>stationary, volatility-scaled features</strong> (returns, z-scores), never raw prices.</li>
          <li>Label with the <strong>triple-barrier method</strong>, and use <strong>meta-labeling</strong> to decide when to act on a primary signal.</li>
          <li>Validate with purged, embargoed cross-validation, and report results net of realistic costs.</li>
        </ul>
        ${info('A strategy that cannot be explained economically deserves extra suspicion, however good its backtest. ML is a tool for extracting small, real edges, not for discovering large ones.')}`
    },
    {
      id: 'stoch', area: 'Mathematics', level: 'Advanced', mins: 12,
      title: "Stochastic Calculus Primer: Brownian Motion and Itô's Lemma",
      html: `
        <h3>Brownian motion</h3>
        <p>A standard Brownian motion W has W₀ = 0, independent increments, W_t − W_s ~ N(0, t − s), and continuous paths that are nowhere differentiable. Its crucial property is non-zero <strong>quadratic variation</strong>:</p>
        ${m('(dW)² = dt,    dW·dt = 0,    (dt)² = 0')}
        <h3>Itô's lemma</h3>
        <p>For dX = a·dt + b·dW and a smooth f(X,t):</p>
        ${m('df = (f_t + a·f_X + ½b²·f_XX)·dt + b·f_X·dW')}
        <p>The extra ½b²·f_XX term exists because (dW)² = dt: the second-order Taylor term does not vanish the way it would in ordinary calculus.</p>
        <h3>Worked example: geometric Brownian motion</h3>
        <p>Let dS = μS·dt + σS·dW and f = ln S. Then f_S = 1/S and f_SS = −1/S², so:</p>
        ${m('d(ln S) = (μ − σ²/2)·dt + σ·dW   ⟹   S_T = S_0·exp[(μ − σ²/2)T + σ·W_T]')}
        <p>Two consequences: <strong>E[S_T] = S₀·e^(μT)</strong>, but the <em>median</em> is S₀·e^((μ − σ²/2)T). The gap σ²/2 is the "volatility drag" that makes arithmetic and geometric average returns differ.</p>
        <h3>Change of measure and martingales</h3>
        <p>Girsanov's theorem says you can change the drift of a Brownian motion by reweighting probabilities. Moving from the real-world measure P to the risk-neutral measure Q replaces μ with r and makes discounted asset prices martingales. The Martingale Representation Theorem guarantees (in complete markets) that any claim can be replicated by trading the underlying.</p>
        <h3>Link to PDEs</h3>
        <p>The Feynman-Kac theorem connects expectations of diffusions to PDE solutions. It is the bridge between "average discounted payoff" (Monte Carlo) and "solve the Black-Scholes equation" (finite differences).</p>`
    },
    {
      id: 'risk', area: 'Risk Management', level: 'Intermediate', mins: 9,
      title: 'Value at Risk and Expected Shortfall',
      html: `
        <p><strong>VaR</strong> at confidence α over horizon h is the loss threshold exceeded with probability only 1 − α. "1-day 99% VaR of $1M" means: on 99 days out of 100 we expect to lose less than $1M.</p>
        <h3>Three ways to compute it</h3>
        <ul>
          <li><strong>Parametric (variance-covariance):</strong> assume normal returns. VaR = z_α·σ·√h − μ·h, with z = 1.645 at 95% and 2.326 at 99%.</li>
          <li><strong>Historical simulation:</strong> take the empirical α-quantile of past P&amp;L. No distribution assumed, but it is only as good as the window.</li>
          <li><strong>Monte Carlo:</strong> simulate risk factors and revalue the book. It is the most flexible, handling options and non-linear exposures.</li>
        </ul>
        <h3>Expected shortfall</h3>
        <p><strong>ES</strong> (CVaR) is the average loss <em>given</em> that VaR is breached. For normal returns:</p>
        ${m('ES_α = σ·φ(z_α) / (1 − α)      (99%: ES ≈ 2.67σ vs VaR ≈ 2.33σ)')}
        <h3>Why ES replaced VaR in regulation</h3>
        <ul>
          <li>VaR is silent about <em>how bad</em> losses beyond the threshold are.</li>
          <li>VaR is <strong>not subadditive</strong>: the VaR of a combined portfolio can exceed the sum of parts, contradicting diversification. ES is a coherent risk measure.</li>
          <li>Normal assumptions understate fat tails, which is exactly where VaR models failed in 2008.</li>
        </ul>
        <h3>Backtesting a VaR model</h3>
        <p>Count exceptions. A 99% model should be breached about 1% of days. The Kupiec proportion-of-failures test checks whether the observed breach frequency is consistent with 1 − α. Clustering of breaches (Christoffersen test) signals a model that is slow to adapt.</p>
        <p>Square-root-of-time scaling (σ·√h) assumes independent returns and is unreliable for illiquid positions and stress periods. Always complement VaR with stress tests.</p>`
    },
  ];

  /* ══════════════════════════════════════════════════════════════════════
     INTERVIEW-STYLE PROBLEMS
     ══════════════════════════════════════════════════════════════════════ */
  const PROBLEMS = [
    { cat: 'Probability', diff: 'Easy',
      q: 'You flip a fair coin until you see two heads in a row (HH). What is the expected number of flips?',
      a: `<p>Use states. Let E₀ be the expected flips from scratch and E₁ the expected flips given the last flip was H.</p>
        ${m('E₀ = 1 + ½·E₁ + ½·E₀<br/>E₁ = 1 + ½·0 + ½·E₀')}
        <p>Substitute E₁ = 1 + E₀/2: E₀ = 1 + ½ + E₀/4 + E₀/2, so E₀/4 = 3/2, giving <strong>E₀ = 6</strong>.</p>
        <p>For comparison, waiting for HT takes only <strong>4</strong> flips. The difference is what a "wrong" flip costs: when hunting HT, an extra H leaves you still holding a useful H, but when hunting HH, a T right after an H throws away your progress and sends you back to the start.</p>` },
    { cat: 'Probability', diff: 'Easy',
      q: 'Two children: at least one is a boy. What is the probability both are boys? Now: the older one is a boy. What is the probability both are boys?',
      a: `<p>Equally likely families: BB, BG, GB, GG.</p>
        <p><strong>At least one boy</strong> eliminates GG, leaving three equally likely cases, one of which is BB: <strong>1/3</strong>.</p>
        <p><strong>The older is a boy</strong> leaves BB and BG: <strong>1/2</strong>.</p>
        <p>The lesson: the exact information you condition on changes the sample space. Always enumerate it.</p>` },
    { cat: 'Probability', diff: 'Easy',
      q: 'Roughly how many people do you need in a room for a better-than-even chance that two share a birthday?',
      a: `<p>Compute the complement, no shared birthday among n people (365 days, uniform):</p>
        ${m('P(all distinct) = Π_{k=0}^{n−1} (365 − k)/365 ≈ exp(−n(n−1)/730)')}
        <p>Setting this to ½ gives n ≈ 23. At n = 23, P(match) ≈ <strong>50.7%</strong>.</p>
        <p>Intuition: there are C(23,2) = 253 pairs, each with a 1/365 chance of matching, far more pairs than people.</p>` },
    { cat: 'Probability', diff: 'Medium',
      q: 'Monty Hall with 100 doors: you pick one, the host (who knows where the car is) opens 98 goat doors, leaving yours and one other. Should you switch?',
      a: `<p>Your first pick is right with probability 1/100 and the host's action does not change that. The car is behind one of the other 99 doors with probability 99/100, and the host has concentrated all of that onto the single door left unopened.</p>
        ${m('P(win | switch) = 99/100,   P(win | stay) = 1/100')}
        <p>The result depends on the host <em>knowing</em> and <em>always</em> opening goat doors. If he opened doors at random and happened to show goats, the odds would be 50/50. Try the Monty Hall simulator under Simulations.</p>` },
    { cat: 'Probability', diff: 'Medium',
      q: 'A fair six-sided die is rolled repeatedly. What is the expected number of rolls to see every face at least once?',
      a: `<p>This is the coupon collector problem. With k faces already seen, the wait for a new one is geometric with success probability (6−k)/6, so its mean is 6/(6−k).</p>
        ${m('E = 6/6 + 6/5 + 6/4 + 6/3 + 6/2 + 6/1 = 6·H₆ = 14.7')}
        <p>For n faces, E = n·Hₙ ≈ n·(ln n + 0.5772).</p>` },
    { cat: 'Probability', diff: 'Medium',
      q: 'A random permutation of n distinct items is drawn. What is the expected number of items that land in their original position?',
      a: `<p>Use linearity of expectation with indicators. Let I_i = 1 if item i is a fixed point. Then P(I_i = 1) = 1/n.</p>
        ${m('E[Σ I_i] = n · (1/n) = 1')}
        <p>The answer is <strong>1 for every n</strong>, even though the I_i are dependent. Linearity does not require independence, which is why it is the most useful tool in this area.</p>` },
    { cat: 'Probability', diff: 'Medium',
      q: 'Break a stick at two independent uniform random points. What is the probability the three pieces form a triangle?',
      a: `<p>The pieces form a triangle iff each is shorter than half the stick. Let the points be X, Y ~ U(0,1). By symmetry, split into cases X &lt; Y and X &gt; Y. For X &lt; Y the conditions are X &lt; ½, Y &gt; ½ and Y − X &lt; ½. That region has area 1/8 in the unit square; doubling for the symmetric case gives:</p>
        ${m('P = 1/4')}` },
    { cat: 'Probability', diff: 'Medium',
      q: 'You start with $30 and bet $1 on a fair coin each round until you reach $100 or $0. What is the probability of reaching $100, and how many bets does the game last on average?',
      a: `<p>This is the gambler's ruin on a fair walk. The wealth process is a martingale, so by optional stopping E[W_end] = 30. With W_end ∈ {0, 100}:</p>
        ${m('P(reach 100) = 30/100 = 0.30')}
        <p>For the expected duration, W_t² − t is a martingale, so E[T] = E[W_end²] − 30² = 100²·0.3 − 900 = 2100:</p>
        ${m('E[T] = k·(N − k) = 30·70 = 2100 bets')}` },
    { cat: 'Probability', diff: 'Hard',
      q: '100 prisoners are numbered 1-100. Boxes 1-100 each hide a distinct random number. Each prisoner may open 50 boxes, and ALL must find their own number or all lose. Random search wins with probability 2^−100. What strategy does much better?',
      a: `<p><strong>The cycle-following strategy:</strong> prisoner i opens box i, reads the number inside, opens that box next, and so on.</p>
        <p>The hidden numbers form a random permutation, which decomposes into cycles. Prisoner i is following the cycle that contains i, and will find their own number if and only if that cycle has length ≤ 50. So everyone wins iff <strong>the permutation has no cycle longer than 50</strong>.</p>
        ${m('P(longest cycle > 50) = Σ_{k=51}^{100} 1/k ≈ ln 2 ≈ 0.693<br/>P(win) ≈ 1 − 0.693 ≈ 31%')}
        <p>The strategy works by making all the prisoners' outcomes perfectly correlated, so success is "all or nothing" together instead of 100 independent 50% events.</p>` },
    { cat: 'Finance', diff: 'Easy',
      q: 'S = 100, K = 100, r = 5%, T = 1 year, no dividends. The call is worth $10.45. What is the put worth?',
      a: `<p>Put-call parity for European options:</p>
        ${m('C − P = S − K·e^(−rT)')}
        ${m('P = C − S + K·e^(−rT) = 10.45 − 100 + 100·e^(−0.05) = 10.45 − 100 + 95.12 = 5.57')}
        <p>The derivation is by replication: a long call plus K·e^(−rT) of cash pays max(S_T, K), exactly the same as a long put plus the stock.</p>` },
    { cat: 'Finance', diff: 'Easy',
      q: 'Estimate the value of a 3-month at-the-money call on a $100 stock with 25% implied volatility, ignoring rates and dividends.',
      a: `<p>For ATM options with r ≈ 0, the Black-Scholes price simplifies to:</p>
        ${m('C ≈ 0.4 · S · σ · √T = 0.4 × 100 × 0.25 × √0.25 = $5.00')}
        <p>The constant 0.4 is 1/√(2π) ≈ 0.399. This mental-math shortcut is accurate to a few percent for near-the-money options.</p>` },
    { cat: 'Finance', diff: 'Medium',
      q: 'You are long an at-the-money option and delta-hedge daily. Implied vol is 20%. How large does the daily move in the stock need to be, in percent, for you to break even on gamma versus theta?',
      a: `<p>The delta-hedged daily P&L is approximately ½·Γ·S²·[(ΔS/S)² − σ²·dt]. It is zero when:</p>
        ${m('|ΔS/S| = σ·√dt = σ/√252 = 0.20 / 15.87 ≈ 1.26%')}
        <p>Daily moves bigger than about 1.26% make you money, and smaller moves lose to theta. Equivalently you break even if <em>realized</em> vol equals <em>implied</em> vol.</p>` },
    { cat: 'Finance', diff: 'Medium',
      q: 'You can bet on a coin that lands heads with probability 0.55, even-money payoff. What fraction of your bankroll maximizes long-run growth, and what is the growth rate per bet?',
      a: `<p>Kelly fraction for even money (b = 1): f* = p − q = 0.55 − 0.45 = <strong>0.10</strong>.</p>
        ${m('g = p·ln(1 + f) + q·ln(1 − f) = 0.55·ln(1.1) + 0.45·ln(0.9) = 0.05242 − 0.04741 ≈ 0.0050')}
        <p>About 0.5% growth per bet. Betting 20% (twice Kelly) gives g ≈ 0.55·ln(1.2) + 0.45·ln(0.8) = 0.10027 − 0.10041 ≈ 0, no growth at all despite a genuine edge.</p>` },
    { cat: 'Finance', diff: 'Medium',
      q: 'Two uncorrelated assets have volatilities of 20% and 30%. What weights minimize portfolio variance, and what is the resulting volatility?',
      a: `<p>For ρ = 0 the minimum-variance weight on asset 1 is:</p>
        ${m('w₁ = σ₂² / (σ₁² + σ₂²) = 0.09 / 0.13 = 0.692,    w₂ = 0.308')}
        ${m('σ_p² = σ₁²σ₂² / (σ₁² + σ₂²) = 0.04·0.09 / 0.13 = 0.02769   ⟹   σ_p ≈ 16.6%')}
        <p>The portfolio is less risky than even the safer asset. That is the entire argument for diversification.</p>` },
    { cat: 'Stochastic Calculus', diff: 'Medium',
      q: 'Show that W_t² − t is a martingale for a standard Brownian motion W.',
      a: `<p>Apply Itô's lemma to f(W) = W²: f′ = 2W, f″ = 2, so</p>
        ${m('d(W²) = 2W·dW + ½·2·dt = 2W·dW + dt')}
        <p>Therefore W_t² − t = ∫₀ᵗ 2W_s dW_s, an Itô integral of a square-integrable process, which is a martingale. In particular E[W_t²] = t.</p>` },
    { cat: 'Stochastic Calculus', diff: 'Medium',
      q: 'If dS = μS dt + σS dW, what are E[S_T] and the median of S_T? Why do they differ?',
      a: `<p>From S_T = S₀·exp[(μ − σ²/2)T + σW_T]:</p>
        ${m('E[S_T] = S₀·e^(μT)       Median = S₀·e^((μ − σ²/2)T)')}
        <p>E[e^(σW_T)] = e^(σ²T/2) restores the −σ²/2 in the mean. The lognormal distribution is right-skewed, so the mean exceeds the median by the factor e^(σ²T/2): the volatility drag.</p>` },
    { cat: 'Stochastic Calculus', diff: 'Hard',
      q: 'A stock follows Brownian motion with no drift: W_t. What is the probability that its maximum over [0, T] exceeds a level a > 0? (Relevant to barrier options.)',
      a: `<p>By the <strong>reflection principle</strong>, every path that touches a and ends below a has a mirror-image path that ends above a. Hence:</p>
        ${m('P(max_{t≤T} W_t ≥ a) = 2·P(W_T ≥ a) = 2·[1 − Φ(a/√T)]')}
        <p>The probability of touching a barrier is <em>twice</em> the probability of finishing beyond it. That factor of 2 is the reason barrier options are worth less than their naive vanilla analogue suggests.</p>` },
    { cat: 'Market Making', diff: 'Medium',
      q: 'I flip a coin 10 times. Make me a market on the number of heads.',
      a: `<p>This is a judgement problem, not a single number. Reasoning to show:</p>
        <ul>
          <li><strong>Fair value:</strong> N ~ Binomial(10, ½): mean 5, variance 2.5, std ≈ 1.58.</li>
          <li><strong>Width:</strong> you are quoting a two-sided price at which you must trade against someone who may know more, so the width compensates for adverse selection and your risk. With std ≈ 1.6, a small-size market like <strong>4.5 / 5.5</strong> is defensible.</li>
          <li><strong>Information:</strong> if the counterparty can <em>choose</em> when to trade after seeing some flips, you must widen sharply or fade the price toward the observed results.</li>
          <li><strong>Size and inventory:</strong> state how your quote changes if they trade, and if they ask for size.</li>
          <li>Be ready to update immediately as flips are revealed: after 6 flips with 5 heads, fair value is 5 + 4·½ = 7.</li>
        </ul>
        <p>Interviewers grade the structure of your thinking (fair value, spread logic, adversity, updating), not a "correct" quote.</p>` },
  ];

  /* ══════════════════════════════════════════════════════════════════════
     READING LIST
     ══════════════════════════════════════════════════════════════════════ */
  const READING = [
    { area: 'Derivatives', items: [
      'John Hull, <em>Options, Futures, and Other Derivatives</em>',
      'Steven Shreve, <em>Stochastic Calculus for Finance I &amp; II</em>',
      'Jim Gatheral, <em>The Volatility Surface: A Practitioner\'s Guide</em>',
      'Black &amp; Scholes (1973), <em>The Pricing of Options and Corporate Liabilities</em>; Merton (1973)',
      'Cox, Ross &amp; Rubinstein (1979), <em>Option Pricing: A Simplified Approach</em>',
      'Heston (1993), <em>A Closed-Form Solution for Options with Stochastic Volatility</em>',
    ]},
    { area: 'Numerical Methods', items: [
      'Paul Glasserman, <em>Monte Carlo Methods in Financial Engineering</em>',
      'Longstaff &amp; Schwartz (2001), <em>Valuing American Options by Simulation</em>',
    ]},
    { area: 'Microstructure & Execution', items: [
      'Larry Harris, <em>Trading and Exchanges</em>',
      'Bouchaud, Bonart, Donier &amp; Gould, <em>Trades, Quotes and Prices</em>',
      'Avellaneda &amp; Stoikov (2008), <em>High-frequency trading in a limit order book</em>',
      'Almgren &amp; Chriss (2000), <em>Optimal execution of portfolio transactions</em>',
      'Cont, Kukanov &amp; Stoikov (2014), <em>The Price Impact of Order Book Events</em>',
    ]},
    { area: 'Statistical Arbitrage & Portfolio Theory', items: [
      'Engle &amp; Granger (1987), <em>Co-integration and Error Correction</em>',
      'Ernest Chan, <em>Algorithmic Trading</em>',
      'Markowitz (1952), <em>Portfolio Selection</em>; Kelly (1956), <em>A New Interpretation of Information Rate</em>',
      'Ledoit &amp; Wolf (2004), <em>A well-conditioned estimator for large-dimensional covariance matrices</em>',
    ]},
    { area: 'Research Methodology & ML', items: [
      'Marcos López de Prado, <em>Advances in Financial Machine Learning</em>',
      'Bailey &amp; López de Prado (2014), <em>The Deflated Sharpe Ratio</em>',
      'Harvey, Liu &amp; Zhu (2016), <em>…and the Cross-Section of Expected Returns</em>',
    ]},
    { area: 'Interview Preparation', items: [
      'Xinfeng Zhou, <em>A Practical Guide to Quantitative Finance Interviews</em>',
      'Timothy Crack, <em>Heard on the Street</em>',
      'Mark Joshi, <em>Quant Job Interview Questions and Answers</em>',
    ]},
  ];

  return { LESSONS, PROBLEMS, READING };
})();
