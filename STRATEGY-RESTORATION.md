# Original model families with current levels

Baseline: `1f2f68e`, `js/ict.js:buildSetups`. This update deliberately leaves `directionsFrom()` unchanged. This is a restoration of original model-family activation with live level substitutions, **not a byte-for-byte restoration of hard-coded historical prices**, a new scalping model, or evidence of profitable scalping performance.

| Family | Activation retained / mapped from baseline | Current level inputs |
| --- | --- | --- |
| ICT 2022 short | Bearish short-term bias OR BSL Judas | Nearest unfilled M15/H1 bearish FVG above spot; otherwise current premium/equilibrium retracement with original 6-pip offset. Stop above relevant current gap/Judas/BSL with original 1.8-pip pad. Targets are observed liquidity/ranges below spot. |
| OTE + HTF Discount long | Rolling-range discount OR proximity to current SSL | Historical `price <= 1.1512` is mapped to within 12 pips above observed SSL (the old 1.1500 reference plus 12 pips). Entry from current bullish gap/discount range; stop beneath demand with 5-pip pad corresponding to the old demand/stop separation; targets from observed overhead liquidity/ranges. |
| Unicorn watch | Bullish FVG AND bullish HTF | Gap midpoint entry; current support/gap boundary stop with original 4-pip pad. Original code did not verify breaker overlap, so the UI explicitly labels it a watch, not a confirmed Unicorn. |

The removed implementation had added a mandatory recent sweep + MSS/BOS + displacement conjunction, opposing H1/H4 veto, minimum 1.5 reward/risk and ATR-based risk bounds. Those are **not** entry requirements now. The added ATR-volatility veto is removed too. Reward/risk and pip distances are displayed descriptively, not used as newly invented strategy thresholds.

Historical fixed thresholds, SMA claims, and targets are not reused as today's EUR/USD prices. Nearest eligible current arrays are used instead of the old list-order `.pop()` selection. Pool/array provenance is the complete currently selected exchange book, not Pepperstone. Only finite, directionally valid entry/stop/TP1 geometry is emitted. TP2 is absent if no distinct second observed target exists: a risk-multiple target is not fabricated.

## Planning versus entry

- The visible scalp watchlist contains conditional original-model plans whenever data health passes. Plans can be visible while execution conditions (FX hours, spread/data validity, eligible kill-zone timing) prevent a trigger.
- Planned prices can update with refreshed candles before arming. Paper tracking freezes armed entry/stop/targets. It never claims an earlier historical broker fill.
- A subsequent observed quote touch during an eligible window can trigger a paper signal. The original execution array proximity of 3.2 pips is used; the later-introduced 1.5-pip tracker discrepancy is removed. Plan display alone never sends an entry email.
- Technical protections retained: single-venue source integrity, candle validity/history, stale quote/trade checks, a 2-pip venue-spread limit, FX closure/rollover guard, finite level geometry, monitoring-gap review and paper reset on venue change. These are disclosed operational protections, not claims that the original baseline enforced all of them.
- No automated news calendar, broker position reconciliation, background mobile execution, or validated win rate is provided. Validate real historical and demo-broker outcomes before relying on this for scalping; exchange spreads and latency may make a seemingly attractive plan unsuitable at your broker.
