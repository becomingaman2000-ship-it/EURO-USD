# IPDA Desk — EUR/USD

Rules-based ICT research dashboard. **Paper signals only; no broker orders or fills.** No profitability guarantee. The repaired rules have not been validated as profitable on independent real-market history.

## Live market source and limitations

- **Source selector:** Auto (Kraken first, Binance fallback), Kraken only, or Binance only. Auto/Binance explicitly allow **Binance EUR/USDT**, a stablecoin FX proxy—not cash EUR/USD. Quotes, trade timestamps and all six candle histories always come from one venue. Switching venues reloads the complete book and resets paper signal tracking. Genuine, aligned Kraken GBP/USD candles can supply SMT; no GBP data is fabricated on the proxy.
- This is exchange FX data, **not a Pepperstone or interbank consolidated feed**. Check prices and spreads against your broker before acting.
- Polls quotes/trades every 5 seconds, with non-overlapping requests and an 8-second request timeout. Refreshes complete candles every minute to repair missed bars. Not tick-by-tick streaming.
- Public Kraken endpoints must be reachable from the user's browser and permit its requests. Auto mode can fall back to a complete Binance proxy book if Kraken fails validation; Kraken-only mode never does. Selecting Auto/Binance consents to the proxy. Binance requests use its public market-data endpoints on `data-api.binance.vision` or `api.binance.com`, subject to availability. No exchange credentials are required. Regional blocks, CORS, rate limiting, maintenance, or lack of recent trades can leave the desk blocked. Direct venue access could not be verified in the restricted development sandbox.
- Requests: `https://api.kraken.com/0/public/OHLC?pair=EURUSD&interval=15` (plus 30/60/240/1440/10080), `Ticker?pair=EURUSD`, and `Trades?pair=EURUSD&count=1`.

## Fail-closed entry policy

Monitoring is blocked when any of these apply:

- demo/synthetic data, unknown source, or a proxy not explicitly permitted;
- quote older than 15 seconds, venue trade older than 60 seconds, history refresh older than 3 minutes;
- missing or malformed OHLC, duplicate/out-of-order timestamps, missing recent intraday bars, insufficient/stale timeframe history;
- missing/crossed bid/ask or spread above 2 pips;
- FX weekend closure or daily 17:00–17:05 New York rollover buffer;
- extreme M15 volatility change (14-bar average versus prior 27-bar baseline outside 0.3–2.5), or last bar exceeding four times the preceding mean range;
- no manual confirmation gate is used; news coverage remains unverified (see below).

**No automatic economic-news feed is connected.** A visible external calendar link is provided. The confusing calendar-confirmation gate has been removed: monitoring starts automatically on healthy data. This is not a news-safe assurance; check releases independently before acting. Conservative spread/volatility thresholds are safeguards, not optimized strategy parameters.

Directional data health is separate from entry eligibility: healthy data can show directional bias without calendar confirmation or an entry setup. Closed FX hours and volatility conditions still gate paper entries. A one-second watchdog revokes actionable UI and email guidance even if quotes stop arriving. Frozen or illiquid tape should show **SIGNALS BLOCKED**, not a fabricated trade. A network outage does not turn synthetic candles into live data.

## Strategy and lifecycle repairs

- Structure uses **closed venue candles**, confirmed pivots, and subsequent closing-price breaks. Locally quote-updated candles are provisional and cannot become confirmation until replaced with venue history. The six direction rows require recent structure (within 12 bars) and agreeing 8-bar momentum greater than 0.25 ATR in magnitude; conflict, invalidated swings, stale reads, or weak evidence show WAIT. These conservative thresholds are uncalibrated heuristics, not proven improvements in forecast accuracy.
- Entry setups additionally reject opposing H1/H4 structure and require a recent liquidity reclaim, directional structure break, displacement, and an unfilled retracement FVG. Stops and liquidity targets derive from available candles, with geometry/risk checks. Old snapshot-based prices, macro stories, SMA assumptions, fixed probabilities and automatic discount-buy bias were removed from live analysis.
- Daily/week/session levels follow New York calendar boundaries with DST; weekly candle buckets use Monday. OTE discount/premium mapping is corrected.
- Forecasts are conditional structural scenarios, not calibrated probabilities. Trade completion times cannot be predicted reliably; arbitrary ATR-to-hours estimates are no longer displayed.
- A paper setup is first armed. Only a later observed quote near its entry in an eligible window can trigger it. Entry/stop/targets are then frozen; observed stop/target events close the paper signal. No historical entry is inferred from price being beyond a limit.
- Monitoring gaps invalidate confidence in the paper trade path. Use **Reset paper signal monitoring** to start over; this does not close any real broker trade. Reloading the page resets in-memory paper monitoring. The app does not reconcile broker positions.
- Email alerts require healthy market data. Alerts are browser-driven and do not run when the page is closed.

## Backtests

`backtest.html` and `backtest-results.json` are explicitly marked **archived synthetic demonstrations** of the retired rules. They are not validation of the current engine or verified broker performance.

`js/backtest.js` now requires supplied genuine historical EUR/USD candles with source provenance (`meta.synthetic: false`, `meta.instrument: "EUR/USD"`, and `meta.source`). It uses the current `analyze()` engine with only candles closed at the decision time, executes a candidate no earlier than the next M15 open, and models spread, slippage and commissions. Same-bar stop/target ambiguity assumes the stop first. No synthetic default, swaps, tick execution or historical news calendar is modeled. Source declarations are caller-supplied, not cryptographically verified. Enough prior history for all six timeframes is required; default Kraken intraday depth is not a three-month dataset.

Example module usage:

```js
import { runBacktest } from './js/backtest.js';
const result = runBacktest({
  market: sourcedHistoricalBook, // frames: M15, M30, H1, H4, D1, W1; t is bar-open UTC milliseconds
  from: '2026-05-12', to: '2026-08-12',
  lots: 0.01, spreadPips: 1, slippagePips: 0.2,
});
```

## Run and test

```bash
npm start
npm test
```

Server binds `0.0.0.0:4173` and serves `public/`. Keys 1–6 select M15/M30/H1/H4/D1/W1. Root, `public/`, and `docs/` contain synchronized deployment files (including `js/safety.js`). Static GitHub Pages hosting uses direct browser-to-exchange requests; there is no server-side feed proxy or secret API key.

Tests cover safety gates, DST/weekends, candle validity, feed-source isolation (mocked), adaptive forecasts, closed-candle selection, paper lifecycle, synthetic backtest rejection, and UI boot/offline rendering through a DOM/canvas harness. They do not prove real external connectivity or browser CORS compatibility. Follow `LIVE-VERIFICATION.md` before relying on the live display.

## Email controls and delivery

The Email alerts switch restores and saves the browser's setting. It is ON by default unless disabled on that device. **Send test** is an explicit non-trading test and works even when market conditions block entry alerts; it does not turn automatic alerts on or imply a live setup. No test email is sent automatically. The service must return a successful acceptance response before the UI reports acceptance. Requests time out after 15 seconds and overlapping automatic submissions are suppressed. Acceptance is not proof of inbox delivery: check Spam and any FormSubmit activation message for `becomingaman2000@gmail.com`. Browser-based alerts require the page to remain active and an observed ENTER signal on healthy data; a bullish/bearish bias alone sends no email.

## Simple automatic layout

The default screen shows connection health, one current paper setup, and six timeframe directions. Source controls, email settings, chart and research live in collapsed native drawers. No demonstration tape is analyzed at startup. On unavailable live data the screen shows no prices or invented directions and reconnects automatically. Returning from a background tab or going online triggers a full reload; old quotes are invalidated on resume. This does not make background mobile alerts reliable. Browser-storage failures no longer prevent email controls and startup from functioning (settings use temporary in-memory fallback). No always-on backend, automatic news feed, broker execution, or performance guarantee is claimed.

### Email transport / “Failed to fetch”

Email requests now use URL-encoded form POSTs with a safelisted Accept header rather than JSON requests that require a CORS preflight. The fictitious reply-to address was removed. A readable provider success response is still required; opaque `no-cors` requests are never counted as delivery. A separate **Send test on provider page** button performs a user-initiated normal form POST in a new tab, allowing the provider to display its activation/error page without AJAX CORS constraints. This fallback sends only a clearly labelled test; it does not silently route automatic signals around browser restrictions. Network blocks, provider outages, activation, spam handling and mobile suspension remain external limitations. Failed automatic submissions are throttled for 60 seconds per setup, not endlessly retried. Tests cover transport encoding, timeouts, failure responses and non-trading test payloads. A touch-enabled Chromium check also exercised failure, accepted mock response and native-form fallback; no actual emails were sent during validation.
