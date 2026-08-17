/* Walk-forward ICT 2022 / PO3 Judas Engine — 3-Month EUR/USD Backtest.
   Institutional Forex standard:
   - Account: $10,000 USD
   - Size: 1.0 Standard Lot (100,000 EUR), $10/pip
   - ECN interbank spread: 0.6 pips
   - Commission: $3.00/side ($6.00 round turn per standard lot)
   - ESMA / Interbank leverage: 1:30 */

import { getMarket, isMarketOpen, nyParts, roundPx } from "./data.js";

export const SPEC = {
  from: "2026-05-14",
  to: "2026-08-14",
  startEquity: 10000,
  lots: 1.0, // 1 Standard Lot (100,000 EUR)
  leverage: 30,
  spreadPips: 0.6,
  commissionPerLotSide: 3.0, // $3/side ($6 round-turn per standard lot)
  pipValuePerLot: 10.0, // 1 Standard Lot EUR/USD = $10/pip
  swapLongPerLot: -1.8, // Daily overnight financing
  swapShortPerLot: 0.8,
  stopOutPct: 0.5,
  contract: 100000, // 100,000 EUR
};

const PIP = 0.0001;

function inKill(ms) {
  const { hour, minute } = nyParts(ms);
  const t = hour + minute / 60;
  if (t >= 2 && t < 5) return "LONDON";
  if (t >= 7 && t < 10) return "NY_AM";
  if (t >= 10 && t < 11) return "SB_NY";
  if (t >= 13.5 && t < 16) return "NY_PM";
  return null;
}

function sessionDayKey(ms) {
  const { hour } = nyParts(ms);
  const d = new Date(ms);
  if (hour >= 17) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function swings(bars, left = 2) {
  const out = [];
  for (let i = left; i < bars.length - left; i++) {
    let hi = true;
    let lo = true;
    for (let k = i - left; k <= i + left; k++) {
      if (k === i) continue;
      if (bars[k].h >= bars[i].h) hi = false;
      if (bars[k].l <= bars[i].l) lo = false;
    }
    if (hi) out.push({ i, price: bars[i].h, type: "H", t: bars[i].t });
    if (lo) out.push({ i, price: bars[i].l, type: "L", t: bars[i].t });
  }
  return out;
}

function htfBias(h1, i) {
  const win = h1.slice(Math.max(0, i - 40), i + 1);
  if (win.length < 10) return "FLAT";
  const sw = swings(win, 2);
  const hs = sw.filter((s) => s.type === "H").slice(-3);
  const ls = sw.filter((s) => s.type === "L").slice(-3);

  if (hs.length >= 2 && ls.length >= 2) {
    const upH = hs[hs.length - 1].price > hs[0].price;
    const upL = ls[ls.length - 1].price > ls[0].price;
    if (upH && upL) return "LONG";
    if (!upH && !upL) return "SHORT";
  }

  const first = win[0].c;
  const last = win[win.length - 1].c;
  if (last > first + 6 * PIP) return "LONG";
  if (last < first - 6 * PIP) return "SHORT";
  return "FLAT";
}

function nearestH1(h1, t) {
  let lo = 0;
  let hi = h1.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (h1[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function findRecentFVG(bars, i, type) {
  for (let k = i - 1; k >= Math.max(1, i - 8); k--) {
    const a = bars[k - 1];
    const c = bars[k + 1];
    if (!a || !c) continue;
    if (type === "BEAR" && c.h < a.l) {
      return { k, top: a.l, bot: c.h, ce: (a.l + c.h) / 2 };
    }
    if (type === "BULL" && c.l > a.h) {
      return { k, top: c.l, bot: a.h, ce: (c.l + a.h) / 2 };
    }
  }
  return null;
}

export function runBacktest(opts = {}) {
  const spec = { ...SPEC, ...opts };
  const m = getMarket();
  const start = Date.parse(spec.from + "T00:00:00Z");
  const end = Date.parse(spec.to + "T23:59:00Z");

  const m15 = m.frames.M15.filter((b) => b.t >= start && b.t <= end);
  const h1 = m.frames.H1.filter((b) => b.t >= start - 5 * 864e5 && b.t <= end);

  const pipVal = spec.lots * spec.pipValuePerLot;
  const comm = spec.lots * spec.commissionPerLotSide * 2;

  let equity = spec.startEquity;
  let peak = equity;
  let maxDD = 0;
  let maxDDPct = 0;

  const trades = [];
  const byMonth = {};
  const byZone = {
    LONDON: { n: 0, wins: 0, pnl: 0 },
    NY_AM: { n: 0, wins: 0, pnl: 0 },
    SB_NY: { n: 0, wins: 0, pnl: 0 },
    NY_PM: { n: 0, wins: 0, pnl: 0 },
  };

  let activeTrade = null;
  let lastSessionDay = "";
  let sessionTrades = 0;

  const equityCurve = [{ t: m15[0]?.t || start, eq: equity }];

  for (let i = 25; i < m15.length; i++) {
    const b = m15[i];
    const sDay = sessionDayKey(b.t);
    if (sDay !== lastSessionDay) {
      lastSessionDay = sDay;
      sessionTrades = 0;
    }

    // 1) Evaluate open trade
    if (activeTrade) {
      const t = activeTrade;
      let exitPrice = null;
      let reason = null;

      if (t.side === "LONG") {
        if (b.l <= t.sl) {
          exitPrice = t.sl;
          reason = "SL";
        } else if (b.h >= t.tp) {
          exitPrice = t.tp;
          reason = "TP1";
        }
      } else {
        if (b.h >= t.sl) {
          exitPrice = t.sl;
          reason = "SL";
        } else if (b.l <= t.tp) {
          exitPrice = t.tp;
          reason = "TP1";
        }
      }

      // Max holding period: 16 bars (4 hours)
      if (!exitPrice && i - t.entryBar >= 16) {
        exitPrice = b.c;
        reason = "TIME_EXIT";
      }

      if (exitPrice != null) {
        const delta = t.side === "LONG" ? exitPrice - t.entry : t.entry - exitPrice;
        const pipsGained = delta / PIP - spec.spreadPips;
        const rawPnl = pipsGained * pipVal;
        const netPnl = rawPnl - comm;

        equity += netPnl;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDD) {
          maxDD = dd;
          maxDDPct = (dd / peak) * 100;
        }

        const tradeRec = {
          t: t.openTime,
          closeTime: b.t,
          side: t.side,
          zone: t.zone,
          entry: roundPx(t.entry, 5),
          exit: roundPx(exitPrice, 5),
          pips: +pipsGained.toFixed(1),
          pnl: +netPnl.toFixed(2),
          reason,
          equity: +equity.toFixed(2),
        };

        trades.push(tradeRec);
        equityCurve.push({ t: b.t, eq: +equity.toFixed(2) });

        // Month stats
        const mKey = new Date(t.openTime).toISOString().slice(0, 7);
        if (!byMonth[mKey]) byMonth[mKey] = { n: 0, wins: 0, pnl: 0 };
        byMonth[mKey].n++;
        if (netPnl > 0) byMonth[mKey].wins++;
        byMonth[mKey].pnl += netPnl;

        // Zone stats
        if (byZone[t.zone]) {
          byZone[t.zone].n++;
          if (netPnl > 0) byZone[t.zone].wins++;
          byZone[t.zone].pnl += netPnl;
        }

        activeTrade = null;
      }
    }

    // 2) Scan for new setup if flat and within max daily trades
    if (!activeTrade && sessionTrades < 2) {
      const zone = inKill(b.t);
      if (zone) {
        const h1Idx = nearestH1(h1, b.t);
        const bias = htfBias(h1, h1Idx);

        const sw = swings(m15.slice(Math.max(0, i - 20), i), 2);
        const lastH = sw.filter((s) => s.type === "H").pop();
        const lastL = sw.filter((s) => s.type === "L").pop();

        if (bias === "SHORT" && lastH && b.h >= lastH.price - 1.5 * PIP) {
          const fvg = findRecentFVG(m15, i, "BEAR");
          if (fvg) {
            const entry = roundPx(fvg.ce, 5);
            const sl = roundPx(Math.max(b.h, lastH.price) + 2.5 * PIP, 5);
            const risk = sl - entry;
            if (risk >= 4 * PIP && risk <= 18 * PIP) {
              const tp = roundPx(entry - risk * 2.1, 5);
              activeTrade = {
                side: "SHORT",
                entry,
                sl,
                tp,
                zone,
                openTime: b.t,
                entryBar: i,
              };
              sessionTrades++;
            }
          }
        } else if (bias === "LONG" && lastL && b.l <= lastL.price + 1.5 * PIP) {
          const fvg = findRecentFVG(m15, i, "BULL");
          if (fvg) {
            const entry = roundPx(fvg.ce, 5);
            const sl = roundPx(Math.min(b.l, lastL.price) - 2.5 * PIP, 5);
            const risk = entry - sl;
            if (risk >= 4 * PIP && risk <= 18 * PIP) {
              const tp = roundPx(entry + risk * 2.1, 5);
              activeTrade = {
                side: "LONG",
                entry,
                sl,
                tp,
                zone,
                openTime: b.t,
                entryBar: i,
              };
              sessionTrades++;
            }
          }
        }
      }
    }
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winPnl = wins.reduce((s, t) => s + t.pnl, 0);
  const lossPnl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = lossPnl > 0 ? +(winPnl / lossPnl).toFixed(2) : 99.0;
  const winRate = trades.length > 0 ? +((wins.length / trades.length) * 100).toFixed(1) : 0;
  const profit = +(equity - spec.startEquity).toFixed(2);
  const returnPct = +((profit / spec.startEquity) * 100).toFixed(2);

  // Mini lot (0.1 lot = $1/pip)
  const tinyPnl = trades.reduce((s, t) => s + (t.pips * 1.0 - 0.6), 0);
  const tinyEquity = +(spec.startEquity + tinyPnl).toFixed(2);

  let maxWinStreak = 0;
  let maxLoseStreak = 0;
  let currWin = 0;
  let currLose = 0;
  for (const t of trades) {
    if (t.pnl > 0) {
      currWin++;
      currLose = 0;
      if (currWin > maxWinStreak) maxWinStreak = currWin;
    } else {
      currLose++;
      currWin = 0;
      if (currLose > maxLoseStreak) maxLoseStreak = currLose;
    }
  }

  const avgWinPips = wins.length ? +(wins.reduce((s, t) => s + t.pips, 0) / wins.length).toFixed(1) : 0;
  const avgLossPips = losses.length ? +(losses.reduce((s, t) => s + t.pips, 0) / losses.length).toFixed(1) : 0;

  return {
    spec: {
      ...spec,
      pipValue: spec.lots * spec.pipValuePerLot,
      roundTurnCommission: spec.lots * spec.commissionPerLotSide * 2,
      marginApprox: Math.round((100000 * 1.085) / spec.leverage),
      risk25pips: Math.round(25 * spec.pipValuePerLot * spec.lots),
    },
    equity: +equity.toFixed(2),
    profit,
    returnPct,
    maxDD: +maxDD.toFixed(2),
    maxDDPct: +maxDDPct.toFixed(1),
    winRate,
    profitFactor,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    maxWinStreak,
    maxLoseStreak,
    avgWinPips,
    avgLossPips,
    longPnl: +trades.filter((t) => t.side === "LONG").reduce((s, t) => s + t.pnl, 0).toFixed(2),
    shortPnl: +trades.filter((t) => t.side === "SHORT").reduce((s, t) => s + t.pnl, 0).toFixed(2),
    stopped: equity <= spec.startEquity * spec.stopOutPct,
    bars: m15.length,
    byMonth,
    byZone,
    tradeList: trades.slice(-50),
    equityCurve,
    tiny: {
      equity: tinyEquity,
      profit: +tinyPnl.toFixed(2),
      returnPct: +((tinyPnl / spec.startEquity) * 100).toFixed(2),
      maxDDPct: +((maxDD / spec.startEquity) * 10).toFixed(1),
      winRate,
    },
  };
}
