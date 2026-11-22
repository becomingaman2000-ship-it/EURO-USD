# Live EUR/USD verification checklist

## Development checks

- Automated feed tests use mocked Kraken/Binance API responses; they are not evidence of live connectivity.
- A real `loadLiveBook()` request was attempted in this sandbox and returned `fetch failed`. This environment restricts outbound market-data hosts. No live price was verified here.
- The replacement strategy has not been validated on independent real-market history. Do not treat regression-test success as a win-rate claim.

## Verify in your browser during FX market hours

1. Open the running app (or deploy the updated `public/` / `docs/` copy).
2. Choose Kraken only, Auto, or Binance proxy in the source selector. In Developer Tools → Network, verify successful responses for the selected venue's candles, bid/ask and recent trades. Inspect API errors, CORS, HTTP 429, and regional blocks. Auto/Binance use EUR/USDT as an explicitly labelled proxy, never as identical broker EUR/USD.
3. Check the desk source says **Kraken EUR/USD** or **Binance EUR/USDT · FX PROXY**, with bid/ask and last-trade age displayed. Compare to the selected exchange directly and independently to your broker. They need not be identical.
4. Confirm quotes are less than 15 seconds old, latest venue trade less than 60 seconds old, spread at most 2 pips and complete history fresh. Failure should show SIGNALS BLOCKED.
5. Check an external economic calendar, then enable the 30-minute monitoring window. This only removes the manual-calendar gate; it does not force a trade or override other gates.
6. Disconnect the network. Within 15 seconds of the last successful quote, signals and entry emails must be blocked. Reconnect. A previously active paper signal must require review/reset, since the missed path is unknown.
7. Paper-test through multiple sessions. A new setup must show ARMED before a later observed trigger; targets cannot be inferred as fills before that trigger. Reloading resets paper monitoring; it cannot recover broker trades.

If the selected venue is inaccessible, stale, or too illiquid for the safety thresholds, it will not generate entries. Auto can try Binance, but a stablecoin proxy does not guarantee the same direction as Pepperstone. Check its price and spread against MT5. Direction and entry setup are separate: live data may still correctly show WAIT. Switching the venue must reset paper tracking and display only the new venue history. A reliable broker-matched production feed would require a separately configured broker/data-provider integration, with appropriate credentials kept server-side and historical data licensing. No such broker connection is configured in this repository.

## Repeatable server-side network check

`node scripts/check-live.mjs` writes an ignored `live-feed-check.json`, including real bid/ask, venue trade age, all six timeframe counts, and `liveFeedVerified`. Run it from a machine with market-data network access. A reachable ticker with stale trades is not a fresh verified feed. This is not signal-performance validation and does not establish browser CORS/regional access. Automated GitHub-runner verification could not be installed because the current GitHub connection lacks workflow-write permission.
