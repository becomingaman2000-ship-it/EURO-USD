/* Advanced ICT / IPDA engine — structure, liquidity, PD arrays, models, bias. */

const PIP = 0.0001;

const pad = (n) => n.toFixed(5);
const mid = (a, b) => (a + b) / 2;
const atr14 = (bars) => {
  if (bars.length < 2) return 0.0012;
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
  return n ? s / n : 0.0012;
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

function fvgs(bars, lookback = 180) {
  const start = Math.max(1, bars.length - lookback);
  const gaps = [];
  for (let i = start; i < bars.length - 1; i++) {
    const a = bars[i - 1];
    const c = bars[i + 1];
    if (c.l > a.h) {
      gaps.push({
        type: "BULL",
        top: c.l,
        bot: a.h,
        ce: mid(c.l, a.h),
        t: bars[i].t,
        i,
        fill: 0,
      });
    } else if (c.h < a.l) {
      gaps.push({
        type: "BEAR",
        top: a.l,
        bot: c.h,
        ce: mid(a.l, c.h),
        t: bars[i].t,
        i,
        fill: 0,
      });
    }
  }
  for (const g of gaps) {
    let maxPen = 0;
    for (let j = g.i + 2; j < bars.length; j++) {
      if (g.type === "BULL") {
        if (bars[j].l < g.top) maxPen = Math.max(maxPen, g.top - bars[j].l);
        if (bars[j].l <= g.bot) {
          g.fill = 1;
          g.inverted = bars[j].c < g.bot;
          break;
        }
      } else {
        if (bars[j].h > g.bot) maxPen = Math.max(maxPen, bars[j].h - g.bot);
        if (bars[j].h >= g.top) {
          g.fill = 1;
          g.inverted = bars[j].c > g.top;
          break;
        }
      }
    }
    const size = g.top - g.bot;
    if (g.fill !== 1) g.fill = size ? Math.min(0.99, maxPen / size) : 0;
    g.virgin = g.fill < 0.15;
    g.sizePips = (g.top - g.bot) / PIP;
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

function orderBlocks(bars, disp, sw) {
  const obs = [];
  const atr = atr14(bars);
  const seen = new Set();
  const pushFrom = (d) => {
    const seekDown = d.dir === "BULL";
    let best = null;
    for (let i = d.i - 1; i >= Math.max(0, d.i - 10); i--) {
      const b = bars[i];
      const bear = b.c < b.o;
      const range = b.h - b.l;
      if (range < atr * 0.18) continue;
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
    ob.breaker = broken;
    const dist = ob.type === "BULL" ? last.c - ob.top : ob.bot - last.c;
    ob.distancePips = dist / PIP;
  }
  return obs.slice(-14);
}

function liquidityPools(bars, sw) {
  const highs = sw.filter((s) => s.type === "H");
  const lows = sw.filter((s) => s.type === "L");
  const eqTol = 3.2 * PIP;
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
        price,
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
      if (p.side === "BSL" && b.h > p.price + 0.4 * PIP) {
        p.swept = true;
        p.sweepT = b.t;
        p.reclaimed = b.c < p.price;
      }
      if (p.side === "SSL" && b.l < p.price - 0.4 * PIP) {
        p.swept = true;
        p.sweepT = b.t;
        p.reclaimed = b.c > p.price;
      }
    }
  }

  // Session / calendar liquidity
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
  const wStart = today0 - 4 * day;
  const wBars = bars.filter((b) => b.t >= wStart && b.t < today0);
  if (yBars.length) {
    extras.push({ id: "PDH", label: "Previous Day High", price: Math.max(...yBars.map((b) => b.h)), side: "BSL" });
    extras.push({ id: "PDL", label: "Previous Day Low", price: Math.min(...yBars.map((b) => b.l)), side: "SSL" });
  }
  if (wBars.length) {
    extras.push({ id: "PWH", label: "Previous Week High", price: Math.max(...wBars.map((b) => b.h)), side: "BSL" });
    extras.push({ id: "PWL", label: "Previous Week Low", price: Math.min(...wBars.map((b) => b.l)), side: "SSL" });
  }
  extras.push({ id: "PSY", label: "Psychological 1.1500", price: 1.15, side: "SSL" });
  extras.push({ id: "PSY2", label: "Psychological 1.1600", price: 1.16, side: "BSL" });
  return extras;
}

function dealingRange(struct, price) {
  const hi = struct.lastHigh?.price;
  const lo = struct.lastLow?.price;
  if (!hi || !lo || hi <= lo) {
    return { high: price + 0.005, low: price - 0.005, eq: price, pos: 0.5, zone: "EQUILIBRIUM", oteBuy: [], oteSell: [] };
  }
  const eq = mid(hi, lo);
  const pos = (price - lo) / (hi - lo);
  let zone = "EQUILIBRIUM";
  if (pos >= 0.5) zone = "PREMIUM";
  if (pos <= 0.5) zone = "DISCOUNT";
  if (pos > 0.62) zone = "PREMIUM";
  if (pos < 0.38) zone = "DISCOUNT";
  if (Math.abs(pos - 0.5) < 0.04) zone = "EQUILIBRIUM";
  const fib = (f) => hi - (hi - lo) * f;
  return {
    high: hi,
    low: lo,
    eq,
    pos,
    zone,
    oteBuy: [lo + (hi - lo) * 0.62, lo + (hi - lo) * 0.705, lo + (hi - lo) * 0.79],
    oteSell: [fib(0.62), fib(0.705), fib(0.79)],
    fibs: [0, 0.21, 0.5, 0.62, 0.705, 0.79, 1].map((f) => ({ f, price: lo + (hi - lo) * f })),
  };
}

function sessionsFrom(bars) {
  const last = bars[bars.length - 1];
  if (!last) return {};
  const day = new Date(last.t);
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const d = day.getUTCDate();
  // Approximate NY windows in UTC for August (EDT = UTC-4)
  const windows = {
    asian: [Date.UTC(y, m, d - 1, 0, 0), Date.UTC(y, m, d, 6, 0)], // 20:00-02:00 NY
    london: [Date.UTC(y, m, d, 6, 0), Date.UTC(y, m, d, 11, 0)],
    ny: [Date.UTC(y, m, d, 11, 0), Date.UTC(y, m, d, 21, 0)],
  };
  const pack = (key, range) => {
    const sl = bars.filter((b) => b.t >= range[0] && b.t < range[1]);
    if (!sl.length) return null;
    return {
      key,
      high: Math.max(...sl.map((b) => b.h)),
      low: Math.min(...sl.map((b) => b.l)),
      open: sl[0].o,
      close: sl[sl.length - 1].c,
      bars: sl.length,
    };
  };
  return {
    asian: pack("ASIAN", windows.asian),
    london: pack("LONDON", windows.london),
    ny: pack("NY", windows.ny),
  };
}

function powerOfThree(sessions, price, dayBar) {
  const asian = sessions.asian;
  if (!asian) {
    return { phase: "UNKNOWN", judas: null, narrative: "Asian range not fully printed." };
  }
  const midA = mid(asian.high, asian.low);
  let judas = null;
  if (price > asian.high + 0.5 * PIP && dayBar && dayBar.c < asian.high) {
    judas = { side: "BSL", price: dayBar.h, label: "Judas swing above Asian high — buy-side taken" };
  } else if (price < asian.low - 0.5 * PIP && dayBar && dayBar.c > asian.low) {
    judas = { side: "SSL", price: dayBar.l, label: "Judas swing below Asian low — sell-side taken" };
  } else if (dayBar && dayBar.h > asian.high && dayBar.c < midA) {
    judas = { side: "BSL", price: dayBar.h, label: "Classic Judas: ran Asian high then reversed into discount" };
  } else if (dayBar && dayBar.l < asian.low && dayBar.c > midA) {
    judas = { side: "SSL", price: dayBar.l, label: "Classic Judas: ran Asian low then reversed into premium" };
  }

  let phase = "ACCUMULATION";
  if (judas) phase = "MANIPULATION";
  const away = Math.abs(price - midA) > Math.max(asian.high - asian.low, 4 * PIP) * 0.35;
  if (judas && (away || (sessions.ny && sessions.ny.bars > 4))) phase = "DISTRIBUTION";
  else if (sessions.ny && Math.abs(sessions.ny.close - asian.open) > (asian.high - asian.low) * 0.8) {
    phase = "DISTRIBUTION";
  } else if (sessions.london && away) {
    phase = judas ? "DISTRIBUTION" : "MANIPULATION";
  }
  return {
    phase,
    judas,
    asianRange: asian.high - asian.low,
    narrative:
      phase === "ACCUMULATION"
        ? "Price is still building the daily range. Wait for the Judas before committing."
        : phase === "MANIPULATION"
          ? "Stops have been engineered. The true move (distribution) should follow the sweep."
          : "Distribution is underway — trade with the displacement away from the Asian box.",
  };
}

function smt(eurDaily, gbpDaily) {
  if (!eurDaily?.length || !gbpDaily?.length) return null;
  const e = eurDaily.slice(-8);
  const g = gbpDaily.slice(-8);
  const eLL = e[e.length - 1].l < Math.min(...e.slice(0, -1).map((b) => b.l));
  const gLL = g[g.length - 1].l < Math.min(...g.slice(0, -1).map((b) => b.l));
  const eHH = e[e.length - 1].h > Math.max(...e.slice(0, -1).map((b) => b.h));
  const gHH = g[g.length - 1].h > Math.max(...g.slice(0, -1).map((b) => b.h));
  if (eLL && !gLL) {
    return {
      type: "BULLISH",
      label: "Bullish SMT",
      detail: "EUR printed a fresh sell-side low while GBP refused. Smart-money divergence favors a euro bounce if 1.1500 is defended.",
    };
  }
  if (eHH && !gHH) {
    return {
      type: "BEARISH",
      label: "Bearish SMT",
      detail: "EUR ran buy-side while GBP failed to confirm. Divergence favors euro weakness.",
    };
  }
  if (gLL && !eLL) {
    return {
      type: "BEARISH_GBP",
      label: "Relative EUR strength",
      detail: "GBP made the weaker low. EUR is the stronger European, but that does not veto a dollar bid.",
    };
  }
  return {
    type: "NONE",
    label: "No SMT",
    detail: "EUR and GBP are delivering in tandem — no intermarket divergence to lean on yet.",
  };
}

function scoreConfluence(parts) {
  let score = 42;
  const notes = [];
  const add = (v, note) => {
    score += v;
    if (note) notes.push(note);
  };
  if (parts.htfTrend === parts.ltfTrend && parts.ltfTrend !== "RANGE") add(14, "HTF/LTF aligned");
  if (parts.htfTrend !== parts.ltfTrend) add(-6, "Timeframe conflict");
  if (parts.zone === "DISCOUNT" && parts.bias === "BULLISH") add(10, "Buy in discount");
  if (parts.zone === "PREMIUM" && parts.bias === "BEARISH") add(10, "Sell in premium");
  if (parts.zone === "PREMIUM" && parts.bias === "BULLISH") add(-8, "Buying premium");
  if (parts.zone === "DISCOUNT" && parts.bias === "BEARISH") add(-8, "Selling discount");
  if (parts.sweep) add(12, "Liquidity sweep in play");
  if (parts.choch) add(9, "Change of character printed");
  if (parts.fvgInZone) add(8, "FVG in correct PD array");
  if (parts.killActive) add(7, "Inside a kill zone");
  if (parts.smtBull && parts.bias === "BULLISH") add(8, "SMT agrees");
  if (parts.smtBear && parts.bias === "BEARISH") add(8, "SMT agrees");
  if (parts.po3 === "DISTRIBUTION") add(6, "Power of Three in distribution");
  return { score: clamp(Math.round(score), 8, 96), notes };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function nearest(arr, price, pred) {
  let best = null;
  let dist = Infinity;
  for (const x of arr) {
    if (pred && !pred(x)) continue;
    const d = Math.abs((x.price ?? x.ce ?? x.top) - price);
    if (d < dist) {
      dist = d;
      best = x;
    }
  }
  return best;
}

function buildSetups(ctx) {
  const { price, d1r, h1, m15, liq, po3, bias, frames } = ctx;
  const setups = [];
  const atr = atr14(frames.M15) || 0.0009;

  const bsl = liq.pools.filter((p) => p.side === "BSL").sort((a, b) => a.price - b.price);
  const ssl = liq.pools.filter((p) => p.side === "SSL").sort((a, b) => b.price - a.price);
  const nextBSL = bsl.find((p) => p.price > price + 2 * PIP) || { price: 1.1567 };
  const nextSSL = ssl.find((p) => p.price < price - 2 * PIP) || { price: 1.15 };

  const bearFvg = [...h1.gaps, ...m15.gaps].filter((g) => g.type === "BEAR" && g.fill < 0.85 && g.bot > 1.15).pop();
  const bullFvg = [...h1.gaps, ...m15.gaps].filter((g) => g.type === "BULL" && g.fill < 0.85 && g.top < price + 0.004).pop();

  if (bias.shortTerm === "BEARISH" || po3.judas?.side === "BSL") {
    const entry = bearFvg ? bearFvg.ce : Math.max(price + 0.0006, 1.1534);
    const sl = Math.max(po3.judas?.price || 1.1563, nextBSL.price) + 0.00018;
    const t1 = Math.min(nextSSL.price, 1.15);
    const t2 = Math.min(1.1466, t1 - 0.003);
    setups.push({
      id: "2022-SHORT",
      model: "ICT 2022 Model",
      side: "SHORT",
      title: "Premium continuation after BSL Judas",
      entry,
      sl,
      t1,
      t2,
      rr: (entry - t1) / Math.max(sl - entry, 0.0002),
      invalid: sl,
      window: "London Close / NY PM / next London",
      thesis:
        "Buy-side above the London/NY morning high was engineered (1.1563). Displacement lower leaves a bearish PD array in premium. IPDA’s next draw is internal range liquidity at 1.1500, then the 50-day / July demand at 1.1466.",
    });
  }

  if (d1r.zone === "DISCOUNT" || price <= 1.1512) {
    const entry = Math.min(price, 1.1502);
    const sl = 1.1461;
    setups.push({
      id: "HTF-LONG",
      model: "OTE + HTF Discount",
      side: "LONG",
      title: "Yearly-discount reaction at 1.1500 SSL",
      entry,
      sl,
      t1: 1.1567,
      t2: 1.163,
      rr: (1.1567 - entry) / Math.max(entry - sl, 0.0002),
      invalid: sl,
      window: "Next London or NY AM, only after MSS higher",
      thesis:
        "On the 2026 dealing range (1.1356–1.2019) price is deep in discount. A sweep of 1.1500 that reclaims and prints a bullish CISD/MSS is a high-quality long back into 100-day and 200-day arrays.",
    });
  }

  if (bullFvg && bias.htf === "BULLISH") {
    setups.push({
      id: "UNICORN",
      model: "Unicorn (Breaker + FVG)",
      side: "LONG",
      title: "Bullish unicorn if 1.1500 is swept and reclaimed",
      entry: bullFvg.ce,
      sl: Math.min(1.1488, bullFvg.bot - 0.0004),
      t1: 1.1563,
      t2: 1.163,
      rr: 2.4,
      invalid: 1.1466,
      window: "Kill zone only",
      thesis: "Requires a sell-side raid, a shift in delivery, then entry inside the overlapping bullish FVG/breaker. Do not front-run.",
    });
  }

  return setups.map((s) => ({
    ...s,
    entry: +s.entry.toFixed(5),
    sl: +s.sl.toFixed(5),
    t1: +s.t1.toFixed(5),
    t2: +s.t2.toFixed(5),
    rr: +Number(s.rr).toFixed(2),
    riskPips: +((Math.abs(s.entry - s.sl) / PIP).toFixed(1)),
    t1Pips: +((Math.abs(s.t1 - s.entry) / PIP).toFixed(1)),
  }));
}

function predictions(ctx, setups) {
  const { price, d1r, w1, d1, po3, bias, smtData, liq } = ctx;
  const short = setups.find((s) => s.side === "SHORT");
  const primaryDir = bias.shortTerm === "BEARISH" ? "DOWN" : bias.shortTerm === "BULLISH" ? "UP" : "RANGE";

  return {
    intraday: {
      horizon: "Session / 8 hours",
      direction: po3.judas?.side === "BSL" ? "DOWN" : primaryDir,
      from: price,
      target: short ? short.t1 : 1.15,
      stretch: 1.1466,
      invalid: 1.1567,
      confidence: po3.judas ? 74 : 58,
      text: po3.judas
        ? "Judas complete. Algorithm is repricing lower to restock at 1.1500 SSL. A reclaim of 1.1567 would void the session short."
        : "Waiting on a clean raid of session liquidity before committing a directional call.",
    },
    day: {
      horizon: "24 hours",
      direction: price > 1.1567 ? "UP" : "DOWN",
      target: 1.15,
      stretch: 1.1466,
      invalid: 1.1585,
      confidence: 68,
      text: "Daily candle is a rejection of the 100-day SMA (1.1567). As long as New York settles below that array, the next daily draw is 1.1500 then 1.1466.",
    },
    swing: {
      horizon: "5–15 sessions",
      direction: d1r.zone === "DISCOUNT" || w1.range.zone === "DISCOUNT" ? "UP" : "DOWN",
      target: 1.163,
      stretch: 1.174,
      invalid: 1.1356,
      confidence: 63,
      text: "Weekly/yearly IPDA is still a buy program beneath equilibrium (1.1688 of the 2026 range). The current sell is a discount-building move, not a regime change — unless 1.1356 June low is surrendered.",
    },
    scenarios: [
      {
        name: "Primary — distribute into 1.1500",
        odds: 0.52,
        path: "Hold below 1.1540 → tag 1.1500 → optional sweep of 1.1466 → react",
      },
      {
        name: "Alternate — 1.1500 holds, HTF long",
        odds: 0.33,
        path: "Sweep 1.1500, CISD higher, reclaim 1.1535, expand into 1.1567 / 1.1630",
      },
      {
        name: "Risk — dollar squeeze",
        odds: 0.15,
        path: "CPI aftershock + DXY through 100.50 sends EUR through 1.1466 toward 1.1356",
      },
    ],
    smt: smtData,
    levels: {
      resistance: [1.1545, 1.1563, 1.1567, 1.1585, 1.163],
      support: [1.1518, 1.15, 1.1466, 1.1422, 1.1356],
    },
  };
}

function narrative(ctx, pred, setups, confluence) {
  const { price, d1r, w1, d1, h4, h1, po3, bias, sessions, meta, smtData } = ctx;
  const p = pad(price);
  return {
    headline: po3.judas
      ? "Judas complete — IPDA drawing EUR/USD into 1.1500 discount"
      : `${bias.shortTerm} delivery inside a ${d1r.zone.toLowerCase()} dealing range`,
    paragraphs: [
      `Spot ${p}. The 2026 dealing range is 1.1356 (24 Jun) to 1.2019 (27 Jan). Equilibrium sits at 1.1688. Price is ${((1.1688 - price) / PIP).toFixed(0)} pips below that midpoint — a discount print on the yearly IPDA range. Higher-timeframe order flow remains a buy program so long as the June low is respected.`,
      `The intermediate book is less friendly. April–May supply at 1.168–1.176 rejected the spring rally. July delivered a sell-side run into 1.1422, then a weak reclaim. This week’s range high 1.1585 and the 100-day SMA at 1.1567 are the active premium arrays. Today’s tape engineered buy-side through 1.1563 on the CPI spike (headline 3.4 / core 2.5) and immediately redistributed. That is textbook Power of Three: Asian accumulation, New York manipulation, then distribution.`,
      `Daily structure is therefore short-term bearish against 1.1567, targeting internal range liquidity at the 1.1500 psychological pool, then the 50-day SMA / demand at 1.1466. A displacement through 1.1466 would open the July low 1.1422 and, in an extreme dollar squeeze, the yearly SSL at 1.1356.`,
      `The long is not dead — it is waiting. ${smtData?.detail || ""} The correct ICT long is a sell-side raid of 1.1500 (or 1.1466), a bullish CISD/MSS on M15, and an entry inside a discount FVG or unicorn during London or NY AM. Do not buy a falling premium candle just because the yearly range is cheap.`,
      `Macro tape: DXY hovering the 100 figure, Fed still at 3.75 versus ECB 2.40, energy/Hormuz residual keeping a bid under the dollar. That mix supports a grind lower into discount rather than a V-shape reclaim of 1.16. Time filter: next high-quality window is London open (02:00–05:00 NY) and the 10:00 NY Silver Bullet.`,
    ],
    bullets: [
      `HTF bias: ${bias.htf} · dealing range ${d1r.zone} (${(d1r.pos * 100).toFixed(0)}% of range)`,
      `LTF bias: ${bias.shortTerm} · last ${d1.struct.lastEvent?.kind || "—"} ${d1.struct.lastEvent?.dir || ""}`,
      `PO3 phase: ${po3.phase}${po3.judas ? " · " + po3.judas.label : ""}`,
      `Draw on liquidity: ${pred.intraday.direction === "DOWN" ? "1.1500 SSL then 1.1466" : "1.1567 / 1.1630 BSL"}`,
      `Confluence ${confluence.score} — ${confluence.notes.join(" · ") || "mixed"}`,
      `Primary model: ${setups[0]?.model || "stand aside"} ${setups[0]?.side || ""}`,
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
  const last = bars[bars.length - 1];
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

  const spot = frames.M15.last.c;
  if (spot < 1.1688 && htf === "RANGE") htf = "BULLISH";

  let shortTerm = h4 === "RANGE" ? h1 : h4;
  if (frames.H1.struct.lastEvent?.kind === "CHOCH") {
    shortTerm = frames.H1.struct.lastEvent.dir === "BEAR" ? "BEARISH" : "BULLISH";
  }
  if (po3?.judas?.side === "BSL" && spot < po3.judas.price - 6 * PIP) shortTerm = "BEARISH";
  if (po3?.judas?.side === "SSL" && spot > po3.judas.price + 6 * PIP) shortTerm = "BULLISH";
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
      note: "No valid ICT model is armed. Wait for a sweep and a kill zone.",
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

  const prefer = bias?.shortTerm === "BEARISH" ? "SHORT" : bias?.shortTerm === "BULLISH" ? "LONG" : null;
  const ranked = setups
    .map((s) => {
      const past = s.side === "SHORT" ? s.entry - price : price - s.entry;
      const toEntry = Math.abs(price - s.entry) / PIP;
      const toTp = (s.side === "SHORT" ? price - s.t1 : s.t1 - price) / PIP;
      const toSl = (s.side === "SHORT" ? s.sl - price : price - s.sl) / PIP;
      const dead = s.side === "SHORT" ? price >= s.sl : price <= s.sl;
      const tpHit = s.side === "SHORT" ? price <= s.t1 : price >= s.t1;
      const inTrade = !dead && past > 1 * PIP;
      const atEntry = !dead && !tpHit && toEntry <= 3.2;
      return { s, past, toEntry, toTp, toSl, dead, tpHit, inTrade, atEntry };
    })
    .sort((a, b) => a.toEntry - b.toEntry);

  const pick = ranked.find((r) => !r.dead) || ranked[0];
  const s = pick.s;
  let status = "WAIT";
  let label = "WAIT";
  let when = next.label;
  let note = `Do not chase. Next high-quality window is ${next.label}. Limit the ${s.side.toLowerCase()} at ${pad(s.entry)}.`;

  if (pick.dead) {
    status = "INVALID";
    label = "INVALIDATED";
    when = "Stand aside";
    note = `Stop ${pad(s.sl)} has been traded. The ${s.side.toLowerCase()} is dead. Wait for the next model.`;
  } else if (pick.tpHit) {
    status = "TAKE_PROFIT";
    label = "TAKE PROFIT";
    when = "Bank T1 now";
    note = `T1 ${pad(s.t1)} is in. Close at least half. Trail the rest to T2 ${pad(s.t2)}.`;
  } else if (pick.inTrade) {
    status = "IN_TRADE";
    label = "IN TRADE — HOLD";
    when = `Target ${pad(s.t1)}`;
    note = `${s.side} is live. First take-profit is ${pad(s.t1)} (${pick.toTp.toFixed(1)} pips). Stop stays ${pad(s.sl)}.`;
  } else if (pick.atEntry && inKill) {
    status = "ENTER";
    label = `ENTER ${s.side} NOW`;
    when = tradable[0].name;
    note = `Kill zone is open and price is in the entry array. ${s.side} ${pad(s.entry)} · stop ${pad(s.sl)} · TP1 ${pad(s.t1)}.`;
  } else if (pick.atEntry && !inKill) {
    status = "ARM";
    label = "ARMED — WAIT FOR KILL ZONE";
    when = next.label;
    note = `Entry ${pad(s.entry)} is printed, but time is wrong. Only take it in ${next.label}.`;
  } else if (pick.toEntry <= 8) {
    status = "ARM";
    label = "APPROACHING ENTRY";
    when = inKill ? tradable[0].name : next.label;
    note = `${pick.toEntry.toFixed(1)} pips from the ${s.side.toLowerCase()} limit at ${pad(s.entry)}. ${inKill ? "Kill zone is live — rest the order." : "Wait for " + next.label + "."}`;
  }

  const span = Math.abs(s.t1 - s.entry) || 0.001;
  const traveled = s.side === "SHORT" ? s.entry - price : price - s.entry;
  const progress = clamp((traveled / span) * 100, 0, 100);

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
    progress,
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
    SB_NY: "NY Silver Bullet (10:00 NY)",
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
  return { label: named[best], countdown, id: best };
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
  const limit = partial.limit;
  const sl = partial.sl;
  const tp1 = partial.tp1;
  const tp2 = partial.tp2;
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
      ? +(Math.abs(tp1 - limit) / Math.max(Math.abs(limit - sl), 0.0002)).toFixed(2)
      : null;
  return {
    ...partial,
    action,
    order,
    fill,
    rr,
    limit: limit != null ? +Number(limit).toFixed(5) : null,
    sl: sl != null ? +Number(sl).toFixed(5) : null,
    tp1: tp1 != null ? +Number(tp1).toFixed(5) : null,
    tp2: tp2 != null ? +Number(tp2).toFixed(5) : null,
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
    entry: bearGap?.ce || dayRange?.oteSell?.[0] || 1.1534,
    sl: Math.max(po3.judas?.price || price + 0.0035, 1.1563),
    t1: 1.15,
    t2: 1.1466,
  };
  const dayBuy = long || {
    entry: bullGap?.ce || dayRange?.oteBuy?.[0] || 1.1502,
    sl: 1.1461,
    t1: 1.1567,
    t2: 1.163,
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
    id: "DAILY", session: "Daily", clock: "Sun 17:00 – Fri 17:00 NY",
    side: sessionBias, limit: primary.entry, sl: primary.sl, tp1: primary.t1, tp2: primary.t2, live: true,
    why: sessionBias === "SHORT"
      ? "Day ticket: sell-limit the premium array. Invalid if NY settles above the stop."
      : "Day ticket: buy-limit the discount array. Invalid if NY settles below the stop.",
  }, price);

  const asianCard = ticket({
    id: "ASIAN", session: "Asian", clock: "20:00 – 02:00 NY",
    side: "FLAT", skip: true, limit: null, sl: null, tp1: null, tp2: null, live: live.ASIAN,
    why: ash
      ? "Map only. Box " + asl.toFixed(5) + " – " + ash.toFixed(5) + ". Do not fill here. Use the high/low as London Judas liquidity."
      : "Asian is for building the range. No limit during this window.",
  }, price);

  const londonLimit = sessionBias === "SHORT" ? (bearGap?.ce || ash || daySell.entry) : (bullGap?.ce || asl || dayBuy.entry);
  const londonSl = sessionBias === "SHORT"
    ? Math.max(ash || 0, po3.judas?.price || 0, londonHigh || 0) + 0.00025
    : Math.min(asl || 99, londonLow || 99, dayBuy.sl) - 0.00025;
  const londonCard = ticket({
    id: "LONDON", session: "London", clock: "02:00 – 05:00 NY · Silver Bullet 03:00",
    side: sessionBias, limit: londonLimit, sl: londonSl,
    tp1: sessionBias === "SHORT" ? Math.min(asl || 1.15, 1.15) : Math.max(ash || 1.1563, 1.1563),
    tp2: sessionBias === "SHORT" ? 1.1466 : 1.163, live: live.LONDON,
    why: sessionBias === "SHORT"
      ? "Sell limit at the London premium / Asian high. Let Judas run buy-side first, then rest in the FVG."
      : "Buy limit at the London discount / Asian low after sell-side is raided.",
  }, price);

  const nyAmLimit = sessionBias === "SHORT" ? (bearGap?.ce || londonHigh || daySell.entry) : (bullGap?.ce || londonLow || dayBuy.entry);
  const nyAmCard = ticket({
    id: "NY_AM", session: "New York AM", clock: "07:00 – 10:00 NY · Silver Bullet 10:00",
    side: sessionBias, limit: nyAmLimit,
    sl: sessionBias === "SHORT"
      ? Math.max(daySell.sl, londonHigh || 0, po3.judas?.price || 0) + 0.0001
      : Math.min(dayBuy.sl, londonLow || 99) - 0.0001,
    tp1: sessionBias === "SHORT" ? 1.15 : 1.1567,
    tp2: sessionBias === "SHORT" ? 1.1466 : 1.163, live: live.NY_AM,
    why: sessionBias === "SHORT"
      ? "True-day sell. Rest the sell limit in the NY AM bearish FVG. Target 1.1500 SSL."
      : "True-day buy. Rest the buy limit in the NY AM bullish FVG after a 1.1500 raid.",
  }, price);

  const delivered = sessionBias === "SHORT" ? price <= 1.1512 : price >= 1.156;
  const nyPm = delivered
    ? ticket({
        id: "NY_PM", session: "New York PM", clock: "13:30 – 16:00 NY",
        side: sessionBias === "SHORT" ? "LONG" : "SHORT",
        limit: sessionBias === "SHORT" ? 1.1502 : 1.1563,
        sl: sessionBias === "SHORT" ? 1.1461 : 1.1588,
        tp1: sessionBias === "SHORT" ? 1.1534 : 1.152,
        tp2: sessionBias === "SHORT" ? 1.1567 : 1.15, live: live.NY_PM,
        why: "Day target is in. Afternoon is for banking or a mean-reversion limit, not a hero add.",
      }, price)
    : ticket({
        id: "NY_PM", session: "New York PM", clock: "13:30 – 16:00 NY",
        side: sessionBias, limit: primary.entry, sl: primary.sl, tp1: primary.t1, tp2: primary.t2, live: live.NY_PM,
        why: sessionBias === "SHORT"
          ? "If 1.1500 is still open, keep the same sell limit working into London close / NY PM."
          : "If the discount buy has not filled, leave the buy limit on for the PM raid.",
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
  const smtData = smt(market.frames.D1, market.gbpDaily);
  const d1rYear = {
    high: 1.2019,
    low: 1.1356,
    eq: 1.16875,
    pos: (price - 1.1356) / (1.2019 - 1.1356),
    zone: price >= 1.16875 ? "PREMIUM" : "DISCOUNT",
  };

  const ctx = {
    price,
    meta: market.meta,
    frames,
    m15: frames.M15,
    h1: frames.H1,
    h4: frames.H4,
    d1: frames.D1,
    w1: frames.W1,
    d1r: d1rYear,
    bias,
    sessions,
    po3,
    smtData,
    liq: frames.H1.liq,
    now,
  };

  const fvgInZone =
    bias.shortTerm === "BEARISH"
      ? frames.H1.gaps.some((g) => g.type === "BEAR" && g.ce > d1rYear.eq * 0.98 && g.fill < 0.8)
      : frames.H1.gaps.some((g) => g.type === "BULL" && g.fill < 0.8);

  const kzNow = killZones(now);
  const confluence = scoreConfluence({
    htfTrend: bias.htf,
    ltfTrend: bias.shortTerm,
    zone: d1rYear.zone,
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
    price,
    meta: market.meta,
    bias,
    confluence,
    po3,
    sessions,
    dealing: {
      year: d1rYear,
      week: frames.W1.range,
      day: frames.D1.range,
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
      { price: 1.1466, kind: "SMA50 / demand" },
      { price: 1.1567, kind: "SMA100 / premium" },
      { price: 1.163, kind: "SMA200" },
      { price: 1.1688, kind: "2026 EQ" },
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
    const k = x.price.toFixed(4);
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
    { id: "ASIAN", name: "Asian Range", start: 20, end: 24, note: "Build the box. Do not hunt entries." },
    { id: "LONDON", name: "London Kill Zone", start: 2, end: 5, note: "Judas + first displacement." },
    { id: "SB_LON", name: "London Silver Bullet", start: 3, end: 4, note: "60-minute surgical window." },
    { id: "NY_AM", name: "New York AM", start: 7, end: 10, note: "True day direction, news raids." },
    { id: "SB_NY", name: "NY AM Silver Bullet", start: 10, end: 11, note: "ICT Silver Bullet — previous hour liquidity." },
    { id: "LONDON_CLOSE", name: "London Close", start: 10, end: 12, note: "Profit-taking / reversal risk." },
    { id: "NY_PM", name: "New York PM", start: 13.5, end: 16, note: "Continuation or afternoon reversal." },
    { id: "SB_PM", name: "NY PM Silver Bullet", start: 14, end: 15, note: "Late raid of AM extremes." },
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
