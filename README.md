# IPDA Desk — EUR/USD Institutional ICT Terminal

Institutional web terminal that analyzes **EUR/USD** through the complete **Inner Circle Trader (ICT) / Interbank Price Delivery Algorithm (IPDA)** methodology and streams a live interbank desk memorandum: market structure, liquidity draws, PD arrays, kill zones, execution models, and multi-horizon predictions.

---

## 🔍 Strategy Audit & Errors Checked

During the comprehensive audit of the ICT strategy implementation, the following critical errors were identified and resolved:

### 1. Optimal Trade Entry (OTE) Retracement Math Inversion
- **Issue Found:** The original calculations inverted the Fibonacci golden zone (62.0%–79.0% / 70.5% sweet spot). `oteBuy` was calculating levels above the 50% equilibrium into Premium, while `oteSell` was calculating levels below equilibrium into Discount. In ICT theory, long entries must only occur in Discount retracements, and short entries in Premium retracements.
- **Correction:** `oteBuy` is now correctly mapped as a downward retracement from the swing high into Discount (`Low + Range * [0.38, 0.295, 0.21]` / `High - Range * [0.62, 0.705, 0.79]`), and `oteSell` is mapped as an upward retracement from the swing low into Premium (`Low + Range * [0.62, 0.705, 0.79]`).

### 2. Fair Value Gap (FVG) & Inversion FVG (IFVG) Logic
- **Issue Found:** Inversion detection was previously evaluated only on the single bar where the gap was first penetrated. If a candle wicked through the gap boundary but closed inside, `inverted` remained false, and subsequent bars closing beyond the gap were never evaluated.
- **Correction:** FVG lifecycle tracking now continuously checks all subsequent candle closes. When candle bodies close beyond the far boundary of a BISI or SIBI, the gap is formally marked as an Inversion FVG (`IFVG`) and flips polarity (e.g. Bullish FVG becomes Bearish Resistance on retest).

### 3. Breaker Block Classification
- **Issue Found:** Any broken order block was previously flagged as a breaker block, regardless of whether a prior liquidity sweep occurred.
- **Correction:** Breaker blocks now require a confirmed swing raid (liquidity purge of swing high/low) followed by an impulsive displacement that violates the originating order block.

### 4. Smart Money Tooling (SMT) Correlation Assets
- **Issue Found:** The engine was previously comparing EUR/USD against ETH (inherited from a crypto template).
- **Correction:** SMT divergence is now properly calibrated to European interbank correlations:
  1. **EUR/USD vs GBP/USD (Direct Correlation):** Detects Bullish SMT when EUR/USD sweeps sell-side lows while GBP/USD holds higher lows, and Bearish SMT when EUR/USD takes buy-side highs while GBP/USD fails to confirm.
  2. **EUR/USD vs DXY (Inverse Dollar Correlation):** Detects non-confirmation between EUR/USD swings and the US Dollar Index.

### 5. Forex Market Hours & Pip Sizing
- **Issue Found:** The tape assumed 24/7 continuous trading (crypto style) and hardcoded BTC price levels (e.g. 90,000, 100,400) and $10 pips.
- **Correction:** Standard Forex market hours are now enforced (Sunday 17:00 NY to Friday 17:00 NY). The engine uses 1 Pip = `0.0001` (5 decimal precision `0.00001`), Standard Lots (100,000 EUR base = $10/pip), and institutional Big Figure (`00`) / Mid Figure (`50`) psychological levels.

---

## ⚡ Real-Time EUR/USD Feed Architecture

The terminal connects to live interbank feeds with automatic multi-venue failover:

1. **Binance EUR/USDT Spot:** High-frequency WebSocket ticks (`wss://stream.binance.com:9443/ws/eurusdt@trade`) and REST klines (M15, H1, H4, D1, W1).
2. **Kraken EUR/USD Spot:** European fiat book WebSocket (`wss://ws.kraken.com`) and REST fallback.
3. **Coinbase EUR-USD:** US institutional fiat ticker and candles.
4. **Frankfurter / ECB:** European Central Bank reference rate fallback.
5. **Continuous Tick Processor:** Real-time updates to the active candle on every single tick, with full ICT engine rescans on bar close or every 20 seconds.
6. **Market Status Indicator:** Explicitly flags `STREAMING`, `LIVE BOOK`, or `WEEKEND CLOSED` based on live New York interbank session hours.

---

## 🚀 Running Locally

```bash
# Start the local server
node server.js
```

Open `http://0.0.0.0:4173` in your browser.

- **Keyboard Shortcuts:**
  - `1`: Switch to M15 timeframe
  - `2`: Switch to H1 timeframe
  - `3`: Switch to H4 timeframe
  - `4`: Switch to D1 timeframe
  - `5`: Switch to W1 timeframe
  - `R`: Rescan IPDA Engine

---

## 📧 Email Alerts

Entry alerts are dispatched via FormSubmit to **becomingaman2000@gmail.com** when the desk detects a validated **ENTER** state (BUY or SELL) with Entry Limit, Protective Stop, TP1, and TP2. A 40-minute cooldown per setup prevents inbox flooding.

---

## 🧪 3-Month Walk-Forward Backtest

Access the full walk-forward performance report at `http://0.0.0.0:4173/backtest.html`:
- 1.0 Standard Lot ($10/pip), $10,000 starting equity, 1:30 leverage.
- Includes equity curve, performance by month, performance by kill zone, and complete execution trade blotter.
