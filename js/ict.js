/* Advanced ICT / IPDA Engine — Structure, Liquidity, PD Arrays, Models, Bias.
   EUR/USD Institutional Forex Edition.
   Forex Standard: 1 Pip = 0.0001 (10 USD per standard lot). Pipette = 0.00001. */

import { MARKET_META, roundPx, nyParts, killZoneOf } from "./data.js";

const PIP = MARKET_META.pip; // 0.0001

const pad = (n, d = 5) =>
  Number.isFinite(+n) ? Number(n).toFixed(d) : "—";
const R5 = (n) => roundPx(n, 5);
const R4 = (n) => roundPx(n, 4);
const mid = (a, b) => (a + b) / 2;

const atr14 = (bars) => {
  if (!bars || bars.length < 2) return 0.0035; // 35 pips default
  let s = 0;
  let n = 0;
  const start = Math.max(1, bars.length - 14);
  for (let i = start; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    );
    s += tr;
    n++;
  }
  return n ? s / n : 0.0035;
};

function swings(bars, left = 2, right = 2) {
  const out = [];
  for (let i = left; i < bars.length - right; i++) {
    let hi = true;
    let lo = true;
    for (let k = i - left; k <= i + right; k++) {
      if (k === i) continue;
      if (bars[k].h >= bars[i].h) hi = false;
      if (bars[k].l <= bars[i].l) lo = false;
    }
    if (hi) out.push({ i, t: bars[i].t, price: bars[i].h, type: "H" });
    if (lo) out.push({ i, t: bars[i].t, price: bars[i].l, type: "L" });
  }
  return out;
}

function structure(bars, sw) {
  const highs = sw.filter((s) => s.type === "H");
  const lows = sw.filter((s) => s.type === "L");
  const events = [];
  let trend = "RANGE";
  let lastHigh = highs[0];
  let lastLow = lows[0];
  let confirmedHigh = highs[0];
  let confirmedLow = lows[0];

  const seq = [...sw].sort((a, b) => a.i - b.i);
  for (const s of seq) {
    if (s.type === "H") {
      if (lastHigh && s.price > lastHigh.price) {
        const kind = trend === "BEARISH" ? "CHOCH" : "BOS";
        events.push({ kind, dir: "BULL", t: s.t, price: s.price, i: s.i, ref: lastHigh.price });
        trend = "BULLISH";
        confirmedHigh = s;
      }
      lastHigh = s;
    } else {
      if (lastLow && s.price < lastLow.price) {
        const kind = trend === "BULLISH" ? "CHOCH" : "BOS";
        events.push({ kind, dir: "BEAR", t: s.t, price: s.price, i: s.i, ref: lastLow.price });
        trend = "BEARISH";
        confirmedLow = s;
      }
      lastLow = s;
    }
  }

  const last = events[events.length - 1] || null;
  const hh = highs.slice(-3);
  const ll = lows.slice(-3);
  let label = trend;
  if (hh.length >= 2 && ll.length >= 2) {
    const risingH = hh[hh.length - 1].price > hh[0].price;
    const risingL = ll[ll.length - 1].price > ll[0].price;
    if (risingH && risingL) label = "BULLISH";
    else if (!risingH && !risingL) label = "BEARISH";
    else label = trend === "RANGE" ? "RANGE" : trend;
  }

  return {
    trend: label,
    lastEvent: last,
    events: events.slice(-12),
    lastHigh: lastHigh || confirmedHigh,
    lastLow: lastLow || confirmedLow,
    swingHighs: highs.slice(-8),
    swingLows: lows.slice(-8),
  };
}

/* ICT Fair Value Gaps (FVG) and Inversion Fair Value Gaps (IFVG) */
function fvgs(bars, lookback = 180) {
  const start = Math.max(1, bars.length - lookback);
  const gaps = [];
  for (let i = start; i < bars.length - 1; i++) {
    const a = bars[i - 1];
    const c = bars[i + 1];
    // Bullish FVG (BISI): bar[i+1].low > bar[i-1].high
    if (c.l > a.h + 0.5 * PIP) {
      gaps.push({
        type: "BULL",
        top: c.l,
        bot: a.h,
        ce: mid(c.l, a.h), // Consequent Encroachment (50% midpoint)
        t: bars[i].t,
        i,
        fill: 0,
        inverted: false,
      });
    } else if (c.h < a.l - 0.5 * PIP) {
      // Bearish FVG (SIBI): bar[i+1].high < bar[i-1].low
      gaps.push({
        type: "BEAR",
        top: a.l,
        bot: c.h,
        ce: mid(a.l, c.h),
        t: bars[i].t,
        i,
        fill: 0,
        inverted: false,
      });
    }
  }

  for (const g of gaps) {
    let maxPen = 0;
    const size = g.top - g.bot;
    for (let j = g.i + 2; j < bars.length; j++) {
      const b = bars[j];
      if (g.type === "BULL") {
        if (b.l < g.top) {
          maxPen = Math.max(maxPen, g.top - b.l);
        }
        if (b.l <= g.bot) {
          g.fill = 1;
        }
        // Inversion: candle body closes below the bottom of the bullish FVG
        if (b.c < g.bot) {
          g.inverted = true;
          g.inversionType = "BEAR_RESISTANCE";
        }
      } else {
        if (b.h > g.bot) {
          maxPen = Math.max(maxPen, b.h - g.bot);
        }
        if (b.h >= g.top) {
          g.fill = 1;
        }
        // Inversion: candle body closes above the top of the bearish FVG
        if (b.c > g.top) {
          g.inverted = true;
          g.inversionType = "BULL_SUPPORT";
        }
      }
    }
    if (g.fill !== 1) {
      g.fill = size > 0 ? Math.min(0.99, maxPen / size) : 0;
    }
    g.virgin = g.fill < 0.15;
    g.sizePips = +((g.top - g.bot) / PIP).toFixed(1);
    g.top = R5(g.top);
    g.bot = R5(g.bot);
    g.ce = R5(g.ce);
  }
  return gaps;
}

function displacement(bars, atr) {
  const out = [];
  for (let i = 3; i < bars.length; i++) {
    const b = bars[i];
    const body = Math.abs(b.c - b.o);
    const range = Math.max(b.h - b.l, 1e-9);
    const dir = b.c > b.o ? "BULL" : "BEAR";
    let runBody = body;
    let run = 1;
    for (let k = i - 1; k >= i - 3; k--) {
      const same = (bars[k].c > bars[k].o) === (dir === "BULL");
      if (!same) break;
      run++;
      runBody += Math.abs(bars[k].c - bars[k].o);
    }
    const impulsive =
      (body > atr * 0.85 && body / range > 0.48) ||
      (run >= 2 && runBody > atr * 1.15) ||
      (range > atr * 1.05 && body / range > 0.58);
    if (impulsive) out.push({ i, t: b.t, dir, body, run, price: b.c });
  }
  return out.slice(-24);
}

/* ICT Order Blocks (OB) and Breaker Blocks */
function orderBlocks(bars, disp, sw) {
  const obs = [];
  const atr = atr14(bars);
  const seen = new Set();
  const pushFrom = (d) => {
    const seekDown = d.dir === "BULL"; // Bullish displacement stems from down-close candle
    let best = null;
    for (let i = d.i - 1; i >= Math.max(0, d.i - 10); i--) {
      const b = bars[i];
      const bear = b.c < b.o;
      const range = b.h - b.l;
      if (range < atr * 0.15) continue;
      if ((seekDown && bear) || (!seekDown && !bear)) {
        if (!best || range > bars[best].h - bars[best].l) best = i;
        if (range > atr * 0.35) break;
      }
    }
    if (best == null) return;
    if (seen.has(best)) return;
    seen.add(best);
    const b = bars[best];
    obs.push({
      type: seekDown ? "BULL" : "BEAR",
      top: b.h,
      bot: b.l,
      open: b.o,
      close: b.c,
      t: b.t,
      i: best,
      impulse: d.t,
    });
  };

  for (const d of disp) pushFrom(d);
  const last = bars[bars.length - 1];

  for (const ob of obs) {
    let mitigated = false;
    let broken = false;
    for (let j = ob.i + 1; j < bars.length; j++) {
      if (ob.type === "BULL") {
        if (bars[j].l <= ob.top && bars[j].l >= ob.bot) mitigated = true;
        if (bars[j].c < ob.bot) broken = true;
      } else {
        if (bars[j].h >= ob.bot && bars[j].h <= ob.top) mitigated = true;
        if (bars[j].c > ob.top) broken = true;
      }
    }
    ob.mitigated = mitigated;
    ob.broken = broken;
    ob.fresh = !mitigated && !broken;
    // An OB that has been broken becomes a potential breaker block
    ob.breaker = broken;
    const dist = ob.type === "BULL" ? last.c - ob.top : ob.bot - last.c;
    ob.distancePips = +(dist / PIP).toFixed(1);
    ob.top = R5(ob.top);
    ob.bot = R5(ob.bot);
  }
  return obs.slice(-14);
}

/* Buy-side Liquidity (BSL), Sell-side Liquidity (SSL), and Calendar / Psych Pools */
function liquidityPools(bars, sw) {
  const highs = sw.filter((s) => s.type === "H");
  const lows = sw.filter((s) => s.type === "L");
  const eqTol = 2.5 * PIP; // 2.5 pips tolerance for equal highs/lows
  const pools = [];

  const cluster = (arr, side) => {
    const used = new Set();
    for (let i = 0; i < arr.length; i++) {
      if (used.has(i)) continue;
      const group = [arr[i]];
      used.add(i);
      for (let j = i + 1; j < arr.length; j++) {
        if (Math.abs(arr[j].price - arr[i].price) <= eqTol) {
          group.push(arr[j]);
          used.add(j);
        }
      }
      const price = group.reduce((s, g) => s + g.price, 0) / group.length;
      pools.push({
        side,
        price: R5(price),
        equal: group.length >= 2,
        count: group.length,
        t: group[group.length - 1].t,
        swept: false,
      });
    }
  };

  cluster(highs.slice(-10), "BSL");
  cluster(lows.slice(-10), "SSL");

  const lastN = bars.slice(-80);
  for (const p of pools) {
    for (const b of lastN) {
      if (b.t <= p.t) continue;
      if (p.side === "BSL" && b.h > p.price + 0.3 * PIP) {
        p.swept = true;
        p.sweepT = b.t;
        p.reclaimed = b.c < p.price;
      }
      if (p.side === "SSL" && b.l < p.price - 0.3 * PIP) {
        p.swept = true;
        p.sweepT = b.t;
        p.reclaimed = b.c > p.price;
      }
    }
  }

  const extras = calendarLiquidity(bars);
  return { pools: pools.sort((a, b) => b.price - a.price), extras };
}

function calendarLiquidity(bars) {
  const extras = [];
  if (!bars.length) return extras;
  const last = bars[bars.length - 1];
  const day = 24 * 3600 * 1000;
  const today0 = Math.floor(last.t / day) * day;
  const yBars = bars.filter((b) => b.t >= today0 - day && b.t < today0);
  const wStart = today0 - 5 * day;
  const wBars = bars.filter((b) => b.t >= wStart && b.t < today0);

  if (yBars.length) {
    extras.push({ id: "PDH", label: "Previous Day High (PDH)", price: R5(Math.max(...yBars.map((b) => b.h))), side: "BSL" });
    extras.push({ id: "PDL", label: "Previous Day Low (PDL)", price: R5(Math.min(...yBars.map((b) => b.l))), side: "SSL" });
  }
  if (wBars.length) {
    extras.push({ id: "PWH", label: "Previous Week High (PWH)", price: R5(Math.max(...wBars.map((b) => b.h))), side: "BSL" });
    extras.push({ id: "PWL", label: "Previous Week Low (PWL)", price: R5(Math.min(...wBars.map((b) => b.l))), side: "SSL" });
  }

  // Institutional Big Figure (00) and Mid Figure (50) psychological pools around current price
  const base = Math.floor(last.c * 100) / 100;
  const figures = [
    { p: base + 0.0100, l: `${(base + 0.01).toFixed(4)} Big Figure (BSL)`, s: "BSL" },
    { p: base + 0.0050, l: `${(base + 0.005).toFixed(4)} Mid Figure (BSL)`, s: "BSL" },
    { p: base, l: `${base.toFixed(4)} Big Figure`, s: last.c >= base ? "SSL" : "BSL" },
    { p: base - 0.0050, l: `${(base - 0.005).toFixed(4)} Mid Figure (SSL)`, s: "SSL" },
    { p: base - 0.0100, l: `${(base - 0.01).toFixed(4)} Big Figure (SSL)`, s: "SSL" },
  ];

  for (let i = 0; i < figures.length; i++) {
    extras.push({
      id: `PSY_${i}`,
      label: figures[i].l,
      price: R5(figures[i].p),
      side: figures[i].s,
    });
  }

  return extras;
}

/* ICT Dealing Range & Optimal Trade Entry (OTE)
   Golden zone: 62% – 79% retracement.
   - For Buy (Discount): Price retraces downward from High into Discount:
     OTE = High - (High - Low) * [0.62, 0.705, 0.79] = Low + (High - Low) * [0.38, 0.295, 0.21]
   - For Sell (Premium): Price retraces upward from Low into Premium:
     OTE = Low + (High - Low) * [0.62, 0.705, 0.79] */
function dealingRange(struct, price) {
  const hi = struct.lastHigh?.price;
  const lo = struct.lastLow?.price;
  if (!hi || !lo || hi <= lo) {
    const padRange = 0.0040;
    return {
      high: R5(price + padRange),
      low: R5(price - padRange),
      eq: R5(price),
      pos: 0.5,
      zone: "EQUILIBRIUM",
      oteBuy: [R5(price - padRange * 0.62), R5(price - padRange * 0.705), R5(price - padRange * 0.79)],
      oteSell: [R5(price + padRange * 0.62), R5(price + padRange * 0.705), R5(price + padRange * 0.79)],
    };
  }

  const span = hi - lo;
  const eq = R5(mid(hi, lo));
  const pos = (price - lo) / span;
  let zone = "EQUILIBRIUM";
  if (pos > 0.52) zone = "PREMIUM";
  else if (pos < 0.48) zone = "DISCOUNT";
  else zone = "EQUILIBRIUM";

  // Retracements into Discount for Longs (OTE Buy: 62% - 79% retracement down from high)
  const oteBuy = [
    R5(hi - span * 0.62),
    R5(hi - span * 0.705), // ICT 70.5% Sweet Spot
    R5(hi - span * 0.79),
  ];

  // Retracements into Premium for Shorts (OTE Sell: 62% - 79% retracement up from low)
  const oteSell = [
    R5(lo + span * 0.62),
    R5(lo + span * 0.705), // ICT 70.5% Sweet Spot
    R5(lo + span * 0.79),
  ];

  return {
    high: R5(hi),
    low: R5(lo),
    eq,
    pos,
    zone,
    oteBuy,
    oteSell,
    fibs: [0, 0.21, 0.38, 0.5, 0.62, 0.705, 0.79, 1].map((f) => ({
      f,
      price: R5(lo + span * f),
    })),
  };
}

/* Timezone & Session Window Aggregation (New York Time) */
function sessionsFrom(bars) {
  const last = bars[bars.length - 1];
  if (!last) return {};

  const asianBars = [];
  const londonBars = [];
  const nyBars = [];

  for (const b of bars.slice(-96)) {
    const { hour, minute, weekday } = nyParts(b.t);
    const t = hour + minute / 60;

    // Asian Range: 20:00 – 00:00 NY (or up to 02:00)
    if (t >= 20 || t < 2) asianBars.push(b);
    // London Kill Zone: 02:00 – 05:00 NY (and London Session 02:00 – 07:00)
    if (t >= 2 && t < 7) londonBars.push(b);
    // New York Session: 07:00 – 16:00 NY
    if (t >= 7 && t < 16) nyBars.push(b);
  }

  const pack = (key, sl) => {
    if (!sl || !sl.length) return null;
    return {
      key,
      high: R5(Math.max(...sl.map((b) => b.h))),
      low: R5(Math.min(...sl.map((b) => b.l))),
      open: R5(sl[0].o),
      close: R5(sl[sl.length - 1].c),
      bars: sl.length,
    };
  };

  return {
    asian: pack("ASIAN", asianBars),
    london: pack("LONDON", londonBars),
    ny: pack("NY", nyBars),
  };
}

/* Power of Three (AMD — Accumulation, Manipulation, Distribution) & Judas Swings */
function powerOfThree(sessions, price, dayBar) {
  const asian = sessions.asian;
  if (!asian) {
    return { phase: "UNKNOWN", judas: null, narrative: "Asian range still printing." };
  }
  const midA = mid(asian.high, asian.low);
  let judas = null;

  if (price > asian.high + 0.5 * PIP && dayBar && dayBar.c < asian.high) {
    judas = { side: "BSL", price: R5(dayBar.h), label: "Judas swing above Asian High (BSL run)" };
  } else if (price < asian.low - 0.5 * PIP && dayBar && dayBar.c > asian.low) {
    judas = { side: "SSL", price: R5(dayBar.l), label: "Judas swing below Asian Low (SSL run)" };
  } else if (dayBar && dayBar.h > asian.high && dayBar.c < midA) {
    judas = { side: "BSL", price: R5(dayBar.h), label: "Classic Judas: purged Asian High then reversed into discount" };
  } else if (dayBar && dayBar.l < asian.low && dayBar.c > midA) {
    judas = { side: "SSL", price: R5(dayBar.l), label: "Classic Judas: purged Asian Low then reversed into premium" };
  }

  let phase = "ACCUMULATION";
  if (judas) phase = "MANIPULATION";
  const away = Math.abs(price - midA) > Math.max(asian.high - asian.low, 10 * PIP) * 0.4;
  if (judas && (away || (sessions.ny && sessions.ny.bars > 4))) {
    phase = "DISTRIBUTION";
  } else if (sessions.ny && Math.abs(sessions.ny.close - asian.open) > (asian.high - asian.low) * 0.85) {
    phase = "DISTRIBUTION";
  } else if (sessions.london && away) {
    phase = judas ? "DISTRIBUTION" : "MANIPULATION";
  }

  return {
    phase,
    judas,
    asianHigh: asian.high,
    asianLow: asian.low,
    asianRangePips: +((asian.high - asian.low) / PIP).toFixed(1),
    narrative:
      phase === "ACCUMULATION"
        ? "Price is in Asian accumulation. Wait for the London Judas sweep before executing."
        : phase === "MANIPULATION"
          ? "Judas manipulation active: stops engineered. The distribution move will follow the sweep."
          : "Distribution phase active — institutional order flow expanding with directional displacement.",
  };
}

/* SMT Divergence (Smart Money Tooling) for EUR/USD:
   1. EUR/USD vs GBP/USD (Correlated European Major)
   2. EUR/USD vs DXY (Inverse Dollar Index) */
function smt(eurDaily, gbpDaily, dxyDaily) {
  if (!eurDaily?.length) return null;
  const e = eurDaily.slice(-8);
  const lastE = e[e.length - 1];
  const prevE = e.slice(0, -1);

  const eLL = lastE.l < Math.min(...prevE.map((b) => b.l));
  const eHH = lastE.h > Math.max(...prevE.map((b) => b.h));

  // 1) SMT vs GBP/USD
  if (gbpDaily?.length) {
    const g = gbpDaily.slice(-8);
    const lastG = g[g.length - 1];
    const prevG = g.slice(0, -1);
    const gLL = lastG.l < Math.min(...prevG.map((b) => b.l));
    const gHH = lastG.h > Math.max(...prevG.map((b) => b.h));

    if (eLL && !gLL) {
      return {
        type: "BULLISH",
        pair: "EUR/USD vs GBP/USD",
        label: "Bullish SMT Divergence (GBP/USD Refuses New Low)",
        detail: "EUR/USD printed a fresh sell-side low while GBP/USD held a higher low. Institutional accumulation favors a EUR/USD bullish expansion.",
      };
    }
    if (eHH && !gHH) {
      return {
        type: "BEARISH",
        pair: "EUR/USD vs GBP/USD",
        label: "Bearish SMT Divergence (GBP/USD Failed High)",
        detail: "EUR/USD swept buy-side liquidity while GBP/USD failed to confirm. Institutional distribution favors a EUR/USD retracement lower.",
      };
    }
    if (gLL && !eLL) {
      return {
        type: "BULLISH_EUR",
        pair: "EUR/USD vs GBP/USD",
        label: "EUR/USD Relative Strength SMT",
        detail: "GBP/USD swept lows while EUR/USD defended structure. Euro is the stronger major.",
      };
    }
  }

  // 2) SMT vs DXY (Inverse)
  if (dxyDaily?.length) {
    const d = dxyDaily.slice(-8);
    const lastD = d[d.length - 1];
    const prevD = d.slice(0, -1);
    const dHH = lastD.h > Math.max(...prevD.map((b) => b.h));
    const dLL = lastD.l < Math.min(...prevD.map((b) => b.l));

    if (eLL && !dHH) {
      return {
        type: "BULLISH",
        pair: "EUR/USD vs DXY",
        label: "Bullish SMT Divergence (DXY Failed Higher High)",
        detail: "EUR/USD swept sell-side liquidity but DXY failed to take buy-side. Dollar weakness confirms EUR/USD buy program.",
      };
    }
    if (eHH && !dLL) {
      return {
        type: "BEARISH",
        pair: "EUR/USD vs DXY",
        label: "Bearish SMT Divergence (DXY Refused Lower Low)",
        detail: "EUR/USD made higher high while DXY refused to make lower low. SMT confirms smart money distribution.",
      };
    }
  }

  return {
    type: "NONE",
    pair: "EUR/USD",
    label: "No SMT Divergence",
    detail: "EUR/USD and correlated pairs are delivering in tandem — order flow is symmetric.",
  };
}

function scoreConfluence(parts) {
  let score = 45;
  const notes = [];
  const add = (v, note) => {
    score += v;
    if (note) notes.push(note);
  };
  if (parts.htfTrend === parts.ltfTrend && parts.ltfTrend !== "RANGE") add(14, "HTF & LTF Trend Aligned");
  if (parts.htfTrend !== parts.ltfTrend) add(-6, "Timeframe Conflict");
  if (parts.zone === "DISCOUNT" && parts.bias === "BULLISH") add(12, "Buying in HTF Discount");
  if (parts.zone === "PREMIUM" && parts.bias === "BEARISH") add(12, "Selling in HTF Premium");
  if (parts.zone === "PREMIUM" && parts.bias === "BULLISH") add(-8, "Buying in Premium");
  if (parts.zone === "DISCOUNT" && parts.bias === "BEARISH") add(-8, "Selling in Discount");
  if (parts.sweep) add(12, "Liquidity Sweep Confirmed");
  if (parts.choch) add(10, "Market Structure Shift (MSS)");
  if (parts.fvgInZone) add(9, "FVG in Correct PD Array");
  if (parts.killActive) add(8, "Inside Active Kill Zone");
  if (parts.smtBull && parts.bias === "BULLISH") add(9, "Bullish SMT Confirmed");
  if (parts.smtBear && parts.bias === "BEARISH") add(9, "Bearish SMT Confirmed");
  if (parts.po3 === "DISTRIBUTION") add(7, "Power of Three in Distribution");

  return { score: Math.max(10, Math.min(96, Math.round(score))), notes };
}

/* ICT Model Setups for EUR/USD */
function buildSetups(ctx) {
  const { price, d1r, h1, m15, liq, po3, bias, frames } = ctx;
  const setups = [];
  const atr = atr14(frames.M15) || 0.0015;

  const bsl = liq.pools.filter((p) => p.side === "BSL").sort((a, b) => a.price - b.price);
  const ssl = liq.pools.filter((p) => p.side === "SSL").sort((a, b) => b.price - a.price);

  const nextBSL = bsl.find((p) => p.price > price + 3 * PIP) || { price: R5(price + 25 * PIP) };
  const nextSSL = ssl.find((p) => p.price < price - 3 * PIP) || { price: R5(price - 25 * PIP) };

  const bearFvg = [...h1.gaps, ...m15.gaps].filter((g) => g.type === "BEAR" && g.fill < 0.85 && g.ce >= price).pop();
  const bullFvg = [...h1.gaps, ...m15.gaps].filter((g) => g.type === "BULL" && g.fill < 0.85 && g.ce <= price).pop();

  const freshBearOb = h1.obs.find((o) => o.type === "BEAR" && o.fresh);
  const freshBullOb = h1.obs.find((o) => o.type === "BULL" && o.fresh);

  // Model 1: ICT 2022 Model (Judas / Liquidity Sweep -> MSS -> FVG Entry)
  if (bias.shortTerm === "BEARISH" || po3.judas?.side === "BSL") {
    const entry = bearFvg ? bearFvg.ce : R5(Math.max(price + 4 * PIP, d1r.oteSell?.[1] || price + 6 * PIP));
    const sl = R5(Math.max(po3.judas?.price || 0, nextBSL.price, entry + 12 * PIP) + 3 * PIP);
    const t1 = R5(Math.min(nextSSL.price, entry - 18 * PIP));
    const t2 = R5(Math.min(t1 - 15 * PIP, d1r.low));
    const risk = Math.max(sl - entry, 5 * PIP);
    const reward = Math.max(entry - t1, 8 * PIP);

    setups.push({
      id: "ICT-2022-SHORT",
      model: "ICT 2022 Model",
      side: "SHORT",
      title: "Premium Continuation After BSL Sweep",
      entry,
      sl,
      t1,
      t2,
      rr: +(reward / risk).toFixed(2),
      invalid: sl,
      window: "London Open / NY AM Silver Bullet",
      thesis:
        `Buy-side liquidity above Asian high/PDH was raided. Bearish market structure shift on M15 leaves a SIBI/FVG in premium. IPDA draws price toward sell-side pool at ${pad(t1)}.`,
    });
  }

  // Model 2: Optimal Trade Entry (OTE) in HTF Discount
  if (d1r.zone === "DISCOUNT" || bias.shortTerm === "BULLISH" || po3.judas?.side === "SSL") {
    const entry = bullFvg ? bullFvg.ce : R5(Math.min(price - 3 * PIP, d1r.oteBuy?.[1] || price - 5 * PIP));
    const sl = R5(Math.min(po3.judas?.price || 999, nextSSL.price, entry - 12 * PIP) - 3 * PIP);
    const t1 = R5(Math.max(nextBSL.price, entry + 18 * PIP));
    const t2 = R5(Math.max(t1 + 15 * PIP, d1r.high));
    const risk = Math.max(entry - sl, 5 * PIP);
    const reward = Math.max(t1 - entry, 8 * PIP);

    setups.push({
      id: "HTF-DISCOUNT-LONG",
      model: "OTE + HTF Discount",
      side: "LONG",
      title: "Discount Retracement Reaction",
      entry,
      sl,
      t1,
      t2,
      rr: +(reward / risk).toFixed(2),
      invalid: sl,
      window: "London Kill Zone / NY AM Kill Zone",
      thesis:
        `Price is trading in HTF Discount (${(d1r.pos * 100).toFixed(0)}% of dealing range). A sweep of sell-side followed by CISD offers a high-probability long targeting premium BSL at ${pad(t1)}.`,
    });
  }

  // Model 3: Unicorn Model (Breaker Block + FVG Confluence)
  const bearBreaker = h1.obs.find((o) => o.breaker && o.type === "BULL"); // Broken bull OB = Bear Breaker
  const bullBreaker = h1.obs.find((o) => o.breaker && o.type === "BEAR"); // Broken bear OB = Bull Breaker

  if (bearBreaker && bearFvg) {
    const entry = R5(mid(bearBreaker.bot, bearFvg.ce));
    const sl = R5(bearBreaker.top + 4 * PIP);
    const t1 = nextSSL.price;
    setups.push({
      id: "UNICORN-SHORT",
      model: "Unicorn (Breaker + FVG)",
      side: "SHORT",
      title: "Bearish Unicorn Setup at Liquidity Void",
      entry,
      sl,
      t1,
      t2: R5(t1 - 15 * PIP),
      rr: +((entry - t1) / Math.max(sl - entry, 5 * PIP)).toFixed(2),
      invalid: sl,
      window: "Silver Bullet Window",
      thesis:
        "High-probability confluence of a broken bullish order block (now acting as a breaker) and a bearish FVG. Trade short on the retest.",
    });
  } else if (bullBreaker && bullFvg) {
    const entry = R5(mid(bullBreaker.top, bullFvg.ce));
    const sl = R5(bullBreaker.bot - 4 * PIP);
    const t1 = nextBSL.price;
    setups.push({
      id: "UNICORN-LONG",
      model: "Unicorn (Breaker + FVG)",
      side: "LONG",
      title: "Bullish Unicorn Setup at Discount Pool",
      entry,
      sl,
      t1,
      t2: R5(t1 + 15 * PIP),
      rr: +((t1 - entry) / Math.max(entry - sl, 5 * PIP)).toFixed(2),
      invalid: sl,
      window: "Silver Bullet Window",
      thesis:
        "High-probability confluence of a broken bearish order block (bullish breaker) and a bullish FVG. Trade long on the mitigation.",
    });
  }

  return setups.map((s) => ({
    ...s,
    entry: R5(s.entry),
    sl: R5(s.sl),
    t1: R5(s.t1),
    t2: R5(s.t2),
    riskPips: +((Math.abs(s.entry - s.sl) / PIP).toFixed(1)),
    t1Pips: +((Math.abs(s.t1 - s.entry) / PIP).toFixed(1)),
  }));
}

function predictions(ctx, setups) {
  const { price, d1r, bias, po3, smtData, liq } = ctx;
  const primarySide = bias.shortTerm === "BEARISH" ? "DOWN" : bias.shortTerm === "BULLISH" ? "UP" : "RANGE";
  const activeSetup = setups[0] || null;

  return {
    intraday: {
      horizon: "Session / 8 Hours",
      direction: po3.judas?.side === "BSL" ? "DOWN" : po3.judas?.side === "SSL" ? "UP" : primarySide,
      from: R5(price),
      target: activeSetup ? activeSetup.t1 : R5(primarySide === "DOWN" ? price - 20 * PIP : price + 20 * PIP),
      stretch: activeSetup ? activeSetup.t2 : R5(primarySide === "DOWN" ? price - 35 * PIP : price + 35 * PIP),
      invalid: activeSetup ? activeSetup.sl : R5(primarySide === "DOWN" ? price + 15 * PIP : price - 15 * PIP),
      confidence: po3.judas ? 78 : 62,
      text: po3.judas
        ? `Judas manipulation complete. IPDA algorithm is delivering EUR/USD toward ${primarySide === "DOWN" ? "Sell-Side Liquidity" : "Buy-Side Liquidity"}.`
        : "Monitoring liquidity raids at session extremes before committing institutional order flow.",
    },
    day: {
      horizon: "24 Hours (Daily Candle)",
      direction: price >= d1r.eq ? (bias.shortTerm === "BEARISH" ? "DOWN" : "UP") : (bias.shortTerm === "BULLISH" ? "UP" : "DOWN"),
      target: R5(bias.shortTerm === "BEARISH" ? d1r.low : d1r.high),
      stretch: R5(bias.shortTerm === "BEARISH" ? d1r.low - 15 * PIP : d1r.high + 15 * PIP),
      invalid: R5(price >= d1r.eq ? d1r.high + 10 * PIP : d1r.low - 10 * PIP),
      confidence: 70,
      text: `Daily profile reflects ${d1r.zone.toLowerCase()} delivery. Expected daily expansion toward ${bias.shortTerm === "BEARISH" ? "discount arrays" : "premium arrays"}.`,
    },
    swing: {
      horizon: "1–3 Weeks",
      direction: d1r.zone === "DISCOUNT" ? "UP" : "DOWN",
      target: R5(d1r.eq),
      stretch: R5(d1r.zone === "DISCOUNT" ? d1r.high : d1r.low),
      invalid: R5(d1r.zone === "DISCOUNT" ? d1r.low - 25 * PIP : d1r.high + 25 * PIP),
      confidence: 65,
      text: "Higher-timeframe IPDA algorithm repricing toward equilibrium and opposing liquidity pools.",
    },
    scenarios: [
      {
        name: `Primary — ${primarySide === "DOWN" ? "Sell-Side Delivery" : "Buy-Side Expansion"}`,
        odds: 0.54,
        path: primarySide === "DOWN"
          ? "Reject Premium FVG → Sweep Asian Low / PDL → Expand into Discount"
          : "Mitigate Discount FVG → Raid Asian High / PDH → Expand into Premium",
      },
      {
        name: "Alternate — Range Equilibrium Reversion",
        odds: 0.32,
        path: "Consolidate inside daily dealing range → Sweep both sides → Settle at EQ",
      },
      {
        name: "Risk — Macro News Shock",
        odds: 0.14,
        path: "High-impact central bank / NFP release breaks dealing range extremes with high slippage",
      },
    ],
    smt: smtData,
    levels: {
      resistance: [
        R5(price + 45 * PIP),
        R5(price + 28 * PIP),
        R5(price + 12 * PIP),
      ],
      support: [
        R5(price - 12 * PIP),
        R5(price - 28 * PIP),
        R5(price - 45 * PIP),
      ],
    },
  };
}

function narrative(ctx, pred, setups, confluence) {
  const { price, d1r, bias, po3, smtData, sessions } = ctx;
  const p = pad(price);

  return {
    headline: po3.judas
      ? `Judas Swing Complete — IPDA Delivering EUR/USD into ${pred.intraday.direction === "DOWN" ? "Discount" : "Premium"}`
      : `${bias.shortTerm} Institutional Order Flow inside ${d1r.zone} Dealing Range`,
    paragraphs: [
      `EUR/USD Spot ${p}. The active dealing range spans from ${pad(d1r.low)} to ${pad(d1r.high)} with Range Equilibrium at ${pad(d1r.eq)}. Spot is currently ${(d1r.pos * 100).toFixed(0)}% within the range, placing it in ${d1r.zone}.`,
      `Session Analysis: Asian range printed ${sessions.asian?.low ? pad(sessions.asian.low) + ' – ' + pad(sessions.asian.high) : 'consolidating'} (${po3.asianRangePips || '—'} pips). ${po3.narrative}`,
      `Market Structure: Multi-timeframe trend alignment shows HTF ${bias.htf} with LTF ${bias.shortTerm}. Confluence score stands at ${confluence.score}/100 based on active PD arrays, liquidity sweeps, and kill zone timing.`,
      `Intermarket SMT: ${smtData?.detail || "EUR/USD tracking European cross-currency correlations symmetrically."}`,
      `Execution Protocol: ${setups[0] ? `Primary model is ${setups[0].model} (${setups[0].side}) with entry limit at ${pad(setups[0].entry)}, stop at ${pad(setups[0].sl)}, targeting TP1 at ${pad(setups[0].t1)}.` : "Stand aside and wait for kill zone confirmation."}`,
    ],
    bullets: [
      `HTF Bias: ${bias.htf} · LTF Bias: ${bias.shortTerm}`,
      `Dealing Range: ${d1r.zone} (${(d1r.pos * 100).toFixed(0)}% of range)`,
      `Power of Three: ${po3.phase}${po3.judas ? " (" + po3.judas.label + ")" : ""}`,
      `Draw on Liquidity: ${pred.intraday.direction === "DOWN" ? "Sell-Side Liquidity (SSL)" : "Buy-Side Liquidity (BSL)"}`,
      `Confluence: ${confluence.score}/100 · ${confluence.notes.join(" · ") || "Balanced"}`,
      `Primary Setup: ${setups[0]?.model || "Stand Aside"} ${setups[0]?.side || ""}`,
    ],
  };
}

function framePack(bars, left = 2) {
  const atr = atr14(bars);
  const sw = swings(bars, left, left);
  const struct = structure(bars, sw);
  const gaps = fvgs(bars);
  const disp = displacement(bars, atr);
  const obs = orderBlocks(bars, disp, sw);
  const liq = liquidityPools(bars, sw);
  const last = bars[bars.length - 1] || { c: MARKET_META.spotSeed, t: Date.now() };
  const range = dealingRange(struct, last.c);
  return { bars, atr, sw, struct, gaps, disp, obs, liq, range, last };
}

function biasFrom(frames, po3) {
  const w = frames.W1.struct.trend;
  const d = frames.D1.struct.trend;
  const h4 = frames.H4.struct.trend;
  const h1 = frames.H1.struct.trend;
  const votes = [w, d, h4, h1];
  const bull = votes.filter((v) => v === "BULLISH").length;
  const bear = votes.filter((v) => v === "BEARISH").length;

  let htf = "RANGE";
  if (bull >= 3) htf = "BULLISH";
  else if (bear >= 3) htf = "BEARISH";
  else if ((w === "BULLISH" && d !== "BEARISH") || (d === "BULLISH" && w !== "BEARISH")) htf = "BULLISH";
  else if ((w === "BEARISH" && d !== "BULLISH") || (d === "BEARISH" && w !== "BULLISH")) htf = "BEARISH";

  let shortTerm = h4 === "RANGE" ? h1 : h4;
  if (frames.H1.struct.lastEvent?.kind === "CHOCH") {
    shortTerm = frames.H1.struct.lastEvent.dir === "BEAR" ? "BEARISH" : "BULLISH";
  }
  if (po3?.judas?.side === "BSL") shortTerm = "BEARISH";
  if (po3?.judas?.side === "SSL") shortTerm = "BULLISH";

  return { htf, shortTerm, votes: { W1: w, D1: d, H4: h4, H1: h1, M15: frames.M15.struct.trend } };
}

export function executionFrom(setups, price, now, po3, bias, kz) {
  const zones = kz || killZones(now);
  const tradable = zones.active.filter((z) => z.id !== "ASIAN");
  const inKill = tradable.length > 0;
  const next = nextWindow(zones);

  if (!setups?.length) {
    return {
      status: "STAND_ASIDE",
      label: "STAND ASIDE",
      side: "FLAT",
      when: next.label,
      countdown: next.countdown,
      note: "No valid ICT model armed. Wait for a liquidity raid inside an active kill zone.",
      entry: null,
      sl: null,
      t1: null,
      t2: null,
      pipsToEntry: null,
      pipsToTp: null,
      progress: 0,
      model: "—",
    };
  }

  const ranked = setups
    .map((s) => {
      const past = s.side === "SHORT" ? s.entry - price : price - s.entry;
      const toEntry = Math.abs(price - s.entry) / PIP;
      const toTp = (s.side === "SHORT" ? price - s.t1 : s.t1 - price) / PIP;
      const toSl = (s.side === "SHORT" ? s.sl - price : price - s.sl) / PIP;
      const dead = s.side === "SHORT" ? price >= s.sl : price <= s.sl;
      const tpHit = s.side === "SHORT" ? price <= s.t1 : price >= s.t1;
      const inTrade = !dead && past > 0.8 * PIP;
      const atEntry = !dead && !tpHit && toEntry <= 2.0; // within 2 pips of limit
      return { s, past, toEntry, toTp, toSl, dead, tpHit, inTrade, atEntry };
    })
    .sort((a, b) => a.toEntry - b.toEntry);

  const pick = ranked.find((r) => !r.dead) || ranked[0];
  const s = pick.s;
  let status = "WAIT";
  let label = "WAIT";
  let when = next.label;
  let note = `Do not chase. Next surgical window is ${next.label}. Rest the ${s.side.toLowerCase()} limit at ${pad(s.entry)}.`;

  if (pick.dead) {
    status = "INVALID";
    label = "INVALIDATED";
    when = "Stand aside";
    note = `Stop ${pad(s.sl)} has been violated. The ${s.side.toLowerCase()} setup is void. Stand aside.`;
  } else if (pick.tpHit) {
    status = "TAKE_PROFIT";
    label = "TAKE PROFIT";
    when = "Bank T1 now";
    note = `Take Profit 1 at ${pad(s.t1)} reached. Close 70% of position and move stop to breakeven.`;
  } else if (pick.inTrade) {
    status = "IN_TRADE";
    label = "IN TRADE — HOLD";
    when = `Target ${pad(s.t1)}`;
    note = `${s.side} trade is active. First target ${pad(s.t1)} (${pick.toTp.toFixed(1)} pips). Protective stop at ${pad(s.sl)}.`;
  } else if (pick.atEntry && inKill) {
    status = "ENTER";
    label = `ENTER ${s.side} NOW`;
    when = tradable[0].name;
    note = `Kill zone is active and price has tapped the entry PD array. Enter ${s.side} at ${pad(s.entry)}, stop ${pad(s.sl)}, TP1 ${pad(s.t1)}.`;
  } else if (pick.atEntry && !inKill) {
    status = "ARM";
    label = "ARMED — WAIT FOR KILL ZONE";
    when = next.label;
    note = `Price is at entry array ${pad(s.entry)}, but time filter is closed. Wait for ${next.label} before firing.`;
  } else if (pick.toEntry <= 6) {
    status = "ARM";
    label = "APPROACHING ENTRY";
    when = inKill ? tradable[0].name : next.label;
    note = `${pick.toEntry.toFixed(1)} pips from the ${s.side.toLowerCase()} limit at ${pad(s.entry)}. ${inKill ? "Kill zone is live — rest the order." : "Wait for " + next.label + "."}`;
  }

  const span = Math.abs(s.t1 - s.entry) || 0.0020;
  const traveled = s.side === "SHORT" ? s.entry - price : price - s.entry;
  const progress = Math.max(0, Math.min(100, (traveled / span) * 100));

  return {
    status,
    label,
    side: s.side,
    when,
    countdown: next.countdown,
    note,
    entry: s.entry,
    sl: s.sl,
    t1: s.t1,
    t2: s.t2,
    pipsToEntry: +pick.toEntry.toFixed(1),
    pipsToTp: +pick.toTp.toFixed(1),
    pipsToSl: +pick.toSl.toFixed(1),
    progress: +progress.toFixed(1),
    model: s.model,
    title: s.title,
    rr: s.rr,
    window: s.window,
  };
}

function nextWindow(kz) {
  const order = ["LONDON", "SB_LON", "NY_AM", "SB_NY", "NY_PM", "SB_PM"];
  const named = {
    LONDON: "London Kill Zone (02:00 NY)",
    SB_LON: "London Silver Bullet (03:00 NY)",
    NY_AM: "New York AM (07:00 NY)",
    SB_NY: "NY AM Silver Bullet (10:00 NY)",
    NY_PM: "New York PM (13:30 NY)",
    SB_PM: "NY PM Silver Bullet (14:00 NY)",
  };
  const t = kz.hour + kz.minute / 60;
  const starts = { LONDON: 2, SB_LON: 3, NY_AM: 7, SB_NY: 10, NY_PM: 13.5, SB_PM: 14 };
  let best = null;
  let wait = 99;
  for (const id of order) {
    let d = starts[id] - t;
    if (d < 0) d += 24;
    if (d < wait) {
      wait = d;
      best = id;
    }
  }
  const mins = Math.round(wait * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const countdown = h ? `${h}h ${m}m` : `${m}m`;
  const live = kz.active.find((z) => order.includes(z.id));
  if (live) return { label: `${live.name} is OPEN`, countdown: "now", id: live.id };
  return { label: named[best] || "London Kill Zone", countdown, id: best };
}

function pickGap(gaps, type, price) {
  const open = (gaps || []).filter((g) => g.type === type && g.fill < 0.85);
  if (!open.length) return null;
  return open.slice().sort((a, b) => Math.abs(a.ce - price) - Math.abs(b.ce - price))[0];
}

function ticket(partial, price) {
  const side = partial.side;
  const action = side === "SHORT" ? "SELL" : side === "LONG" ? "BUY" : "FLAT";
  const order = side === "SHORT" ? "SELL LIMIT" : side === "LONG" ? "BUY LIMIT" : "NO ORDER";
  const limit = partial.limit != null ? R5(partial.limit) : null;
  const sl = partial.sl != null ? R5(partial.sl) : null;
  const tp1 = partial.tp1 != null ? R5(partial.tp1) : null;
  const tp2 = partial.tp2 != null ? R5(partial.tp2) : null;

  let fill = "REST";
  if (partial.skip) fill = "SKIP";
  else if (side === "SHORT" && sl != null && price >= sl) fill = "DEAD";
  else if (side === "LONG" && sl != null && price <= sl) fill = "DEAD";
  else if (side === "SHORT" && tp1 != null && price <= tp1) fill = "TP HIT";
  else if (side === "LONG" && tp1 != null && price >= tp1) fill = "TP HIT";
  else if (side === "SHORT" && limit != null && price <= limit) fill = "FILLED";
  else if (side === "LONG" && limit != null && price >= limit) fill = "FILLED";
  else if (partial.live) fill = "WORKING";

  const rr =
    limit != null && sl != null && tp1 != null
      ? +(Math.abs(tp1 - limit) / Math.max(Math.abs(limit - sl), 0.0003)).toFixed(2)
      : null;

  return {
    ...partial,
    action,
    order,
    fill,
    rr,
    limit,
    sl,
    tp1,
    tp2,
    dist: limit != null ? +((Math.abs(price - limit) / PIP).toFixed(1)) : null,
  };
}

function buildSessionLimits(ctx, setups, kz) {
  const price = ctx.price;
  const { sessions, po3, bias, h1, m15, d1 } = ctx;
  const asian = sessions.asian;
  const london = sessions.london;

  const bearGap = pickGap([...(h1?.gaps || []), ...(m15?.gaps || [])], "BEAR", price);
  const bullGap = pickGap([...(h1?.gaps || []), ...(m15?.gaps || [])], "BULL", price);
  const dayRange = d1?.range;
  const short = setups.find((s) => s.side === "SHORT");
  const long = setups.find((s) => s.side === "LONG");

  const daySell = short || {
    entry: bearGap?.ce || dayRange?.oteSell?.[1] || R5(price + 8 * PIP),
    sl: R5(Math.max(po3.judas?.price || price + 20 * PIP, price + 15 * PIP)),
    t1: R5(price - 25 * PIP),
    t2: R5(price - 45 * PIP),
  };
  const dayBuy = long || {
    entry: bullGap?.ce || dayRange?.oteBuy?.[1] || R5(price - 8 * PIP),
    sl: R5(Math.min(po3.judas?.price || price - 20 * PIP, price - 15 * PIP)),
    t1: R5(price + 25 * PIP),
    t2: R5(price + 45 * PIP),
  };

  const sessionBias = bias.shortTerm === "BEARISH" || po3.judas?.side === "BSL" ? "SHORT" : "LONG";
  const primary = sessionBias === "SHORT" ? daySell : dayBuy;
  const tt = (kz?.hour || 0) + (kz?.minute || 0) / 60;
  const live = {
    ASIAN: tt >= 20 || tt < 2,
    LONDON: tt >= 2 && tt < 7,
    NY_AM: tt >= 7 && tt < 12,
    NY_PM: tt >= 12 && tt < 17,
  };

  const ash = asian?.high;
  const asl = asian?.low;
  const londonHigh = london?.high;
  const londonLow = london?.low;

  const daily = ticket({
    id: "DAILY",
    session: "Daily Desk",
    clock: "Sunday 17:00 NY – Friday 17:00 NY",
    side: sessionBias,
    limit: primary.entry,
    sl: primary.sl,
    tp1: primary.t1,
    tp2: primary.t2,
    live: true,
    why: sessionBias === "SHORT"
      ? "Daily ticket: Sell-limit the premium array. Invalidated if price breaks above protective swing high."
      : "Daily ticket: Buy-limit the discount array. Invalidated if price breaks below protective swing low.",
  }, price);

  const asianCard = ticket({
    id: "ASIAN",
    session: "Asian Range",
    clock: "20:00 – 00:00 NY",
    side: "FLAT",
    skip: true,
    limit: null,
    sl: null,
    tp1: null,
    tp2: null,
    live: live.ASIAN,
    why: ash
      ? `Range mapping: ${pad(asl)} – ${pad(ash)}. Do not execute here. Mark extremes for London Judas manipulation.`
      : "Asian range is consolidating. Stand aside and let the box form.",
  }, price);

  const londonLimit = sessionBias === "SHORT" ? (bearGap?.ce || ash || daySell.entry) : (bullGap?.ce || asl || dayBuy.entry);
  const londonSl = sessionBias === "SHORT"
    ? R5(Math.max(ash || 0, po3.judas?.price || 0, londonHigh || 0, londonLimit + 10 * PIP) + 3 * PIP)
    : R5(Math.min(asl || 999, londonLow || 999, dayBuy.sl, londonLimit - 10 * PIP) - 3 * PIP);
  const londonCard = ticket({
    id: "LONDON",
    session: "London Kill Zone",
    clock: "02:00 – 05:00 NY · Silver Bullet 03:00",
    side: sessionBias,
    limit: londonLimit,
    sl: londonSl,
    tp1: sessionBias === "SHORT" ? R5(asl ? asl - 5 * PIP : primary.t1) : R5(ash ? ash + 5 * PIP : primary.t1),
    tp2: sessionBias === "SHORT" ? primary.t2 : primary.t2,
    live: live.LONDON,
    why: sessionBias === "SHORT"
      ? "Sell limit at London premium / Asian high. Wait for Judas swing to purge buy-side, then enter on FVG retest."
      : "Buy limit at London discount / Asian low. Enter following sell-side purge and bullish MSS.",
  }, price);

  const nyAmLimit = sessionBias === "SHORT" ? (bearGap?.ce || londonHigh || daySell.entry) : (bullGap?.ce || londonLow || dayBuy.entry);
  const nyAmCard = ticket({
    id: "NY_AM",
    session: "New York AM",
    clock: "07:00 – 10:00 NY · Silver Bullet 10:00",
    side: sessionBias,
    limit: nyAmLimit,
    sl: sessionBias === "SHORT"
      ? R5(Math.max(daySell.sl, londonHigh || 0, po3.judas?.price || 0) + 2 * PIP)
      : R5(Math.min(dayBuy.sl, londonLow || 999) - 2 * PIP),
    tp1: sessionBias === "SHORT" ? daySell.t1 : dayBuy.t1,
    tp2: sessionBias === "SHORT" ? daySell.t2 : dayBuy.t2,
    live: live.NY_AM,
    why: sessionBias === "SHORT"
      ? "True-day distribution. Rest sell limit in the NY AM bearish FVG targeting internal discount liquidity."
      : "True-day expansion. Rest buy limit in the NY AM bullish FVG targeting external premium liquidity.",
  }, price);

  const nyPm = ticket({
    id: "NY_PM",
    session: "New York PM",
    clock: "13:30 – 16:00 NY · Silver Bullet 14:00",
    side: sessionBias,
    limit: primary.entry,
    sl: primary.sl,
    tp1: primary.t1,
    tp2: primary.t2,
    live: live.NY_PM,
    why: "Late-session expansion or mean-reversion. Bank partial profits ahead of the 17:00 NY settlement.",
  }, price);

  return [daily, asianCard, londonCard, nyAmCard, nyPm];
}

export function analyze(market, now = Date.now()) {
  const frames = {
    M15: framePack(market.frames.M15, 2),
    H1: framePack(market.frames.H1, 2),
    H4: framePack(market.frames.H4, 3),
    D1: framePack(market.frames.D1, 2),
    W1: framePack(market.frames.W1, 1),
  };

  const price = market.meta.spot || frames.M15.last.c;
  const sessions = sessionsFrom(market.frames.M15);
  const dayBar = {
    h: market.meta.dayHigh || frames.D1.last.h,
    l: market.meta.dayLow || frames.D1.last.l,
    c: price,
    o: market.meta.prevClose || frames.D1.last.o,
  };
  const po3 = powerOfThree(sessions, price, dayBar);
  const bias = biasFrom(frames, po3);
  const smtData = smt(market.frames.D1, market.gbpDaily, market.dxyDaily);

  const d1r = frames.D1.range;
  const w1r = frames.W1.range;

  const ctx = {
    price,
    meta: market.meta,
    frames,
    m15: frames.M15,
    h1: frames.H1,
    h4: frames.H4,
    d1: frames.D1,
    w1: frames.W1,
    d1r,
    w1r,
    bias,
    sessions,
    po3,
    smtData,
    liq: frames.H1.liq,
    now,
  };

  const fvgInZone =
    bias.shortTerm === "BEARISH"
      ? frames.H1.gaps.some((g) => g.type === "BEAR" && g.ce > d1r.eq && g.fill < 0.8)
      : frames.H1.gaps.some((g) => g.type === "BULL" && g.ce < d1r.eq && g.fill < 0.8);

  const kzNow = killZones(now);
  const confluence = scoreConfluence({
    htfTrend: bias.htf,
    ltfTrend: bias.shortTerm,
    zone: d1r.zone,
    bias: bias.shortTerm,
    sweep: Boolean(po3.judas) || frames.H1.liq.pools.some((p) => p.swept && p.reclaimed),
    choch: frames.H1.struct.lastEvent?.kind === "CHOCH" || frames.M15.struct.lastEvent?.kind === "CHOCH",
    fvgInZone,
    killActive: kzNow.active.some((z) => z.id !== "ASIAN"),
    smtBull: smtData?.type === "BULLISH",
    smtBear: smtData?.type === "BEARISH",
    po3: po3.phase,
  });

  const setups = buildSetups(ctx);
  const pred = predictions(ctx, setups);
  const story = narrative(ctx, pred, setups, confluence);
  const execution = executionFrom(setups, price, now, po3, bias, kzNow);
  const limits = buildSessionLimits(ctx, setups, kzNow);
  const pdArrays = collectPD(frames, price);

  return {
    asOf: now,
    price: R5(price),
    meta: market.meta,
    bias,
    confluence,
    po3,
    sessions,
    dealing: {
      year: {
        high: MARKET_META.yearHigh,
        low: MARKET_META.yearLow,
        eq: MARKET_META.yearAvg,
        pos: (price - MARKET_META.yearLow) / (MARKET_META.yearHigh - MARKET_META.yearLow),
        zone: price >= MARKET_META.yearAvg ? "PREMIUM" : "DISCOUNT",
      },
      week: w1r,
      day: d1r,
      h4: frames.H4.range,
      h1: frames.H1.range,
    },
    structure: {
      W1: frames.W1.struct,
      D1: frames.D1.struct,
      H4: frames.H4.struct,
      H1: frames.H1.struct,
      M15: frames.M15.struct,
    },
    frames,
    pdArrays,
    setups,
    execution,
    limits,
    predictions: pred,
    narrative: story,
    smt: smtData,
    keyLevels: uniqueLevels([
      ...pred.levels.support.map((p) => ({ price: p, kind: "SUPPORT" })),
      ...pred.levels.resistance.map((p) => ({ price: p, kind: "RESISTANCE" })),
      { price: R5(MARKET_META.sma50), kind: "50-day SMA" },
      { price: R5(MARKET_META.sma100), kind: "100-day SMA" },
      { price: R5(MARKET_META.sma200), kind: "200-day SMA" },
      { price: R5(MARKET_META.yearAvg), kind: "2026 Year EQ" },
      { price: R5(d1r.eq), kind: "Daily Range EQ" },
    ]),
  };
}

function collectPD(frames, price) {
  const take = (arr, map) => arr.slice(-6).map(map);
  return {
    fvgs: [
      ...take(frames.H4.gaps.filter((g) => g.fill < 1), (g) => ({ ...g, tf: "H4" })),
      ...take(frames.H1.gaps.filter((g) => g.fill < 1), (g) => ({ ...g, tf: "H1" })),
      ...take(frames.M15.gaps.filter((g) => g.fill < 0.9), (g) => ({ ...g, tf: "M15" })),
    ]
      .sort((a, b) => Math.abs(a.ce - price) - Math.abs(b.ce - price))
      .slice(0, 10),
    orderBlocks: [
      ...frames.D1.obs.slice(-3).map((o) => ({ ...o, tf: "D1" })),
      ...frames.H4.obs.slice(-4).map((o) => ({ ...o, tf: "H4" })),
      ...frames.H1.obs.slice(-4).map((o) => ({ ...o, tf: "H1" })),
      ...frames.M15.obs.slice(-4).map((o) => ({ ...o, tf: "M15" })),
    ]
      .filter((o) => !o.broken || o.breaker)
      .slice(0, 10),
    breakers: [...frames.H4.obs, ...frames.H1.obs].filter((o) => o.breaker).slice(-5),
  };
}

function uniqueLevels(list) {
  const seen = new Set();
  return list.filter((x) => {
    const k = Number(x.price).toFixed(4);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function killZones(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = +get("hour");
  const minute = +get("minute");
  const t = hour + minute / 60;

  const zones = [
    { id: "ASIAN", name: "Asian Range (Accumulation)", start: 20, end: 24, note: "Consolidation box. High & low become Judas targets." },
    { id: "LONDON", name: "London Kill Zone", start: 2, end: 5, note: "Judas swing sweeps Asian extremes, followed by true expansion." },
    { id: "SB_LON", name: "London Silver Bullet", start: 3, end: 4, note: "60-minute surgical window: 15m FVG retracement setup." },
    { id: "NY_AM", name: "New York AM Kill Zone", start: 7, end: 10, note: "Highest volume window: US economic releases & news raids." },
    { id: "SB_NY", name: "NY AM Silver Bullet", start: 10, end: 11, note: "Classic ICT Silver Bullet: draw on session liquidity." },
    { id: "LONDON_CLOSE", name: "London Close Kill Zone", start: 10, end: 12, note: "Profit taking / counter-trend retracements." },
    { id: "NY_PM", name: "New York PM Kill Zone", start: 13.5, end: 16, note: "Continuation or daily high/low lock." },
    { id: "SB_PM", name: "NY PM Silver Bullet", start: 14, end: 15, note: "Afternoon raid of AM session liquidity." },
  ];

  const wraps = (z) => {
    if (z.start > z.end) return t >= z.start || t < z.end;
    return t >= z.start && t < z.end;
  };

  return {
    ny: `${get("weekday")} ${get("hour")}:${get("minute")}:${get("second")} NY`,
    hour,
    minute,
    active: zones.filter(wraps),
    zones: zones.map((z) => ({ ...z, on: wraps(z) })),
  };
}
