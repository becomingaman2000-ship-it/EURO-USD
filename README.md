# IPDA Desk — EUR/USD

Institutional web terminal that reads **EUR/USD** through the full **Inner Circle Trader (ICT)** playbook and publishes a live desk memorandum: bias, liquidity draws, PD arrays, kill-zone timing, model setups, and multi-horizon predictions.

## What it does

- Rebuilds the 2025–2026 EUR/USD tape from published prints (Jan 2026 high **1.2019**, Jun 2026 low **1.1356**, 12 Aug 2026 spot **~1.1521**) and expands it into session-aware M15 / H1 / H4 / D1 / W1 candles.
- Runs an **IPDA / ICT engine** on that tape:
  - Market structure (BOS / CHoCH / MSS)
  - Buy-side & sell-side liquidity, equal highs/lows, PDH/PDL, PWH/PWL
  - Fair value gaps, inversion FVGs, order blocks, breaker blocks
  - Premium / discount / equilibrium dealing ranges and OTE
  - Power of Three (AMD) and Judas swings
  - Kill zones & Silver Bullet windows (New York time)
  - SMT versus GBP
  - ICT 2022 model, HTF discount OTE, Unicorn
- Renders a dark interbank-style desk: interactive ICT chart, confluence gauge, predictions, setups with entry / stop / targets, and a written read.
- **Realtime tape:** the browser pulls a live EUR/USD order book (Kraken spot FX first, Binance EURUSDT fallback), then streams ticks over WebSocket (2.5s REST poll if the socket drops). The last candle updates on every tick; ICT rescans on a new bar or every 20s.
- If every venue is blocked, the desk keeps a dated composite tape and keeps retrying.

## Live site

**https://becomingaman2000-ship-it.github.io/EURO-USD/**

## Run locally

```bash
node server.js
```

Opens on `http://0.0.0.0:4173`. No build step, no dependencies.

Keys `1–5` switch M15 / H1 / H4 / D1 / W1.

## Honest scope

This is a **research / education terminal**, not a broker and not a signal service. Forex can lose money. The engine is a rules-based ICT reading of structure, time, and liquidity — it is not a guarantee of future prices.
