/* EUR/USD market fabric — anchored to published 2025–2026 prints,
   then expanded into session-aware OHLC so ICT structure is readable. */

const NY = "America/New_York";

export const MARKET_META = {
  pair: "EUR/USD",
  pip: 0.0001,
  asOf: "2026-08-12T19:32:00Z",
  spotSeed: 1.15214,
  prevClose: 1.1545,
  dayHigh: 1.1563,
  dayLow: 1.1518,
  sma50: 1.1466,
  sma100: 1.1567,
  sma200: 1.1630,
  yearHigh: 1.2019,
  yearLow: 1.1356,
  yearAvg: 1.1626,
  gbp: 1.3491,
  dxy: 99.92,
  macro: {
    cpiHeadline: 3.4,
    cpiCore: 2.5,
    fedFunds: 3.75,
    ecbDepo: 2.40,
    headline: "USD recovered after in-line CPI; pair rejected 100-day SMA and faded toward 1.1500.",
  },
};

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function roundPx(v) {
  return Math.round(v * 100000) / 100000;
}

function nyParts(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    weekday: get("weekday"),
    year: +get("year"),
    month: +get("month"),
    day: +get("day"),
    hour: +get("hour"),
    minute: +get("minute"),
  };
}

export function isForexOpen(ms) {
  const p = nyParts(ms);
  if (p.weekday === "Sat") return false;
  if (p.weekday === "Fri" && p.hour >= 17) return false;
  if (p.weekday === "Sun" && p.hour < 17) return false;
  return true;
}

export function sessionOf(ms) {
  const { hour } = nyParts(ms);
  if (hour >= 20 || hour < 2) return "ASIAN";
  if (hour >= 2 && hour < 7) return "LONDON";
  if (hour >= 7 && hour < 12) return "NY_AM";
  if (hour >= 12 && hour < 17) return "NY_PM";
  return "AFTER";
}

export function killZoneOf(ms) {
  const { hour, minute } = nyParts(ms);
  const t = hour + minute / 60;
  if (t >= 20 || t < 0) return { id: "ASIAN", label: "Asian Range", active: t >= 20 };
  if (t >= 2 && t < 5) return { id: "LONDON", label: "London Kill Zone", active: true };
  if (t >= 3 && t < 4) return { id: "SB_LON", label: "London Silver Bullet", active: true };
  if (t >= 7 && t < 10) return { id: "NY_AM", label: "New York AM Kill Zone", active: true };
  if (t >= 10 && t < 11) return { id: "SB_NY", label: "NY AM Silver Bullet", active: true };
  if (t >= 10 && t < 12) return { id: "LONDON_CLOSE", label: "London Close", active: true };
  if (t >= 13.5 && t < 16) return { id: "NY_PM", label: "New York PM Kill Zone", active: true };
  if (t >= 14 && t < 15) return { id: "SB_PM", label: "NY PM Silver Bullet", active: true };
  return { id: "OFF", label: "Outside kill zone", active: false };
}

const DAILY_ANCHORS = [
  ["2025-01-02", 1.0362],
  ["2025-01-10", 1.0257],
  ["2025-02-14", 1.0488],
  ["2025-03-18", 1.0874],
  ["2025-04-22", 1.1365],
  ["2025-05-12", 1.1091],
  ["2025-05-26", 1.1392],
  ["2025-06-30", 1.1789],
  ["2025-07-22", 1.1680],
  ["2025-08-20", 1.1664],
  ["2025-09-16", 1.1868],
  ["2025-10-03", 1.1743],
  ["2025-10-09", 1.1563],
  ["2025-11-04", 1.1485],
  ["2025-11-13", 1.1626],
  ["2025-12-15", 1.1688],
  ["2025-12-31", 1.1728],
  ["2026-01-06", 1.1784],
  ["2026-01-27", 1.2019],
  ["2026-02-12", 1.1846],
  ["2026-02-26", 1.1712],
  ["2026-03-12", 1.1620],
  ["2026-03-31", 1.1568],
  ["2026-04-16", 1.1748],
  ["2026-04-30", 1.1694],
  ["2026-05-15", 1.1762],
  ["2026-05-31", 1.1684],
  ["2026-06-12", 1.1540],
  ["2026-06-24", 1.1356],
  ["2026-06-30", 1.1506],
  ["2026-07-10", 1.1488],
  ["2026-07-22", 1.1394],
  ["2026-07-31", 1.1422],
  ["2026-08-04", 1.1525],
  ["2026-08-07", 1.1557],
  ["2026-08-10", 1.1546],
  ["2026-08-11", 1.1543],
  ["2026-08-12", 1.15214],
];

function parseUTCDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 21, 0, 0); // ~17:00 NY
}

function weekdayUTC(ms) {
  return new Date(ms).getUTCDay();
}

function nextWeekday(ms) {
  let t = ms + 86400000;
  while (weekdayUTC(t) === 0 || weekdayUTC(t) === 6) t += 86400000;
  return t;
}

function buildDailyPath(rng) {
  const pts = DAILY_ANCHORS.map(([d, p]) => [parseUTCDate(d), p]);
  const start = pts[0][0];
  const end = pts[pts.length - 1][0];
  const days = [];
  let t = start;
  let prev = pts[0][1];

  while (t <= end) {
    if (weekdayUTC(t) !== 0 && weekdayUTC(t) !== 6) {
      let i = 0;
      while (i < pts.length - 1 && pts[i + 1][0] < t) i++;
      const a = pts[Math.max(0, i)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const span = Math.max(1, b[0] - a[0]);
      const u = clamp((t - a[0]) / span, 0, 1);
      const smooth = u * u * (3 - 2 * u);
      const mid = lerp(a[1], b[1], smooth);
      const drift = (rng() - 0.48) * 0.0024;
      const mean = mid * 0.82 + prev * 0.18 + drift;
      days.push({ t, close: mean });
      prev = mean;
    }
    t += 86400000;
  }

  days[days.length - 1].close = MARKET_META.spotSeed;
  return days;
}

function dailyOHLC(path, rng) {
  return path.map((d, i) => {
    const prev = i ? path[i - 1].close : d.close;
    const close = d.close;
    const range = 0.0042 + rng() * 0.0048;
    const bias = close >= prev ? 0.35 : -0.35;
    const high = Math.max(prev, close) + range * (0.28 + rng() * 0.45);
    const low = Math.min(prev, close) - range * (0.28 + rng() * 0.45);
    const open = prev + (rng() - 0.5) * 0.00035 + bias * 0.00005;
    return {
      t: d.t,
      o: roundPx(open),
      h: roundPx(Math.max(open, close, high)),
      l: roundPx(Math.min(open, close, low)),
      c: roundPx(close),
      v: Math.round(82000 + rng() * 54000),
    };
  });
}

function sessionVol(hourNY) {
  if (hourNY >= 2 && hourNY < 5) return 1.55;
  if (hourNY >= 7 && hourNY < 11) return 1.7;
  if (hourNY >= 11 && hourNY < 12) return 1.15;
  if (hourNY >= 13 && hourNY < 16) return 1.25;
  if (hourNY >= 20 || hourNY < 2) return 0.55;
  return 0.85;
}

function expandIntraday(daily, minutes, rng) {
  const out = [];
  for (let i = 0; i < daily.length; i++) {
    const bar = daily[i];
    const prevClose = i ? daily[i - 1].c : bar.o;
    const dayMs = 24 * 60 * 60 * 1000;
    const openMs = bar.t - 16 * 60 * 60 * 1000; // ~05:00 UTC prior? use NY 17:00 previous
    // Forex day for this daily close: previous 17:00 NY to 17:00 NY
    const sessionStart = bar.t - dayMs;
    const steps = Math.floor((24 * 60) / minutes);
    let px = prevClose;
    const target = bar.c;
    const hiCap = bar.h;
    const loCap = bar.l;
    let ranJudas = false;

    for (let s = 0; s < steps; s++) {
      const ts = sessionStart + s * minutes * 60 * 1000;
      if (!isForexOpen(ts) && minutes >= 60) continue;
      if (!isForexOpen(ts) && minutes < 60) continue;

      const p = nyParts(ts);
      const vol = sessionVol(p.hour) * (0.00009 + rng() * 0.00007) * Math.sqrt(minutes / 60);
      const progress = s / steps;
      const magnet = (target - px) * (0.018 + progress * 0.04);
      let shock = 0;

      // London Judas: sweep opposite of daily close, then reverse
      if (!ranJudas && p.hour === 3 && p.minute < minutes) {
        const dir = target < prevClose ? 1 : -1;
        shock = dir * (0.0009 + rng() * 0.0007);
        ranJudas = true;
      }
      // NY continuation / distribution
      if (p.hour === 8 && p.minute < minutes) {
        shock += (target < prevClose ? -1 : 1) * (0.0004 + rng() * 0.0004);
      }

      const noise = (rng() - 0.5) * vol * 2.2;
      const next = px + magnet + noise + shock;
      const wick = vol * (0.6 + rng() * 1.4);
      let o = px;
      let c = next;
      let h = Math.max(o, c) + wick * rng();
      let l = Math.min(o, c) - wick * rng();

      // Soft clamp toward daily envelope so HTF stays honest
      h = Math.min(h, hiCap + 0.0008);
      l = Math.max(l, loCap - 0.0008);
      c = clamp(c, l, h);
      o = clamp(o, l, h);

      out.push({
        t: ts,
        o: roundPx(o),
        h: roundPx(h),
        l: roundPx(l),
        c: roundPx(c),
        v: Math.round((900 + rng() * 1600) * sessionVol(p.hour) * (minutes / 15)),
      });
      px = c;
    }
  }
  return out;
}

function sculptToday(m15) {
  // Wednesday 12 Aug 2026 — published tape:
  // prev 1.1545, spike 1.1563 on CPI, fade to 1.1521.
  const dayStart = Date.UTC(2026, 7, 12, 0, 0, 0);
  const dayEnd = Date.UTC(2026, 7, 12, 19, 45, 0);
  const path = [
    [Date.UTC(2026, 7, 11, 21, 0, 0), 1.1545],
    [Date.UTC(2026, 7, 12, 0, 0, 0), 1.1542],
    [Date.UTC(2026, 7, 12, 4, 0, 0), 1.1539], // Asian
    [Date.UTC(2026, 7, 12, 6, 0, 0), 1.1534], // London open dip
    [Date.UTC(2026, 7, 12, 7, 30, 0), 1.1548],
    [Date.UTC(2026, 7, 12, 10, 0, 0), 1.1540],
    [Date.UTC(2026, 7, 12, 12, 35, 0), 1.1563], // CPI spike / Judas BSL
    [Date.UTC(2026, 7, 12, 13, 30, 0), 1.1549],
    [Date.UTC(2026, 7, 12, 15, 0, 0), 1.1536],
    [Date.UTC(2026, 7, 12, 17, 0, 0), 1.1528],
    [Date.UTC(2026, 7, 12, 19, 32, 0), 1.15214],
  ];

  return m15.map((b) => {
    if (b.t < Date.UTC(2026, 7, 11, 21, 0, 0) || b.t > dayEnd) return b;
    let i = 0;
    while (i < path.length - 1 && path[i + 1][0] < b.t) i++;
    const a = path[i];
    const c = path[Math.min(path.length - 1, i + 1)];
    const u = clamp((b.t - a[0]) / Math.max(1, c[0] - a[0]), 0, 1);
    const mid = lerp(a[1], c[1], u);
    const isSpike = b.t >= Date.UTC(2026, 7, 12, 12, 15, 0) && b.t <= Date.UTC(2026, 7, 12, 12, 45, 0);
    const high = isSpike ? 1.1563 : Math.max(b.h, mid + 0.00018);
    const low = Math.min(b.l, mid - 0.00016, b.t >= dayStart ? 1.1518 : b.l);
    return {
      ...b,
      o: roundPx(b.o * 0.25 + mid * 0.75),
      c: roundPx(mid),
      h: roundPx(Math.max(mid, high)),
      l: roundPx(Math.min(mid, low)),
    };
  });
}

function aggregate(src, ms) {
  const map = new Map();
  for (const b of src) {
    const key = Math.floor(b.t / ms) * ms;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function buildGbp(eurDaily, rng) {
  // GBPUSD ~ 1.3491 now; slightly more resilient into the sell so SMT can appear.
  return eurDaily.map((b, i) => {
    const scale = 1.171;
    const base = b.c * scale;
    const hold = i > eurDaily.length - 8 ? 0.0018 : 0;
    const c = roundPx(base - 0.0012 + hold + (rng() - 0.5) * 0.001);
    return {
      t: b.t,
      o: roundPx(b.o * scale),
      h: roundPx(Math.max(b.h * scale, c) + 0.0004),
      l: roundPx(Math.min(b.l * scale, c) - 0.0003),
      c,
      v: b.v,
    };
  });
}

let CACHE = null;

export function getMarket() {
  if (CACHE) return CACHE;
  const rng = mulberry32(0x455552); // EUR
  const dailyPath = buildDailyPath(rng);
  const daily = dailyOHLC(dailyPath, rng);
  let m15 = expandIntraday(daily.slice(-95), 15, rng);
  m15 = sculptToday(m15);
  const h1Recent = aggregate(m15, 60 * 60 * 1000);
  const h1Old = expandIntraday(daily.slice(-140, -45), 60, mulberry32(0x555344));
  const h1 = [...h1Old, ...h1Recent].sort((a, b) => a.t - b.t);
  const h4 = aggregate(h1, 4 * 60 * 60 * 1000);
  const weekly = aggregate(daily, 7 * 24 * 60 * 60 * 1000);
  const gbpDaily = buildGbp(daily, mulberry32(0x474250));

  const last = m15[m15.length - 1];
  const todayBars = m15.filter((b) => b.t >= Date.UTC(2026, 7, 11, 21, 0, 0));
  if (todayBars.length && daily.length) {
    const d = daily[daily.length - 1];
    d.h = roundPx(Math.max(d.h, ...todayBars.map((b) => b.h), MARKET_META.dayHigh));
    d.l = roundPx(Math.min(d.l, ...todayBars.map((b) => b.l), MARKET_META.dayLow));
    d.c = last.c;
  }
  CACHE = {
    meta: {
      ...MARKET_META,
      spot: last.c,
      lastBar: last.t,
    },
    frames: {
      M15: m15,
      H1: h1.slice(-1800),
      H4: h4.slice(-900),
      D1: daily,
      W1: weekly,
    },
    gbpDaily,
  };
  return CACHE;
}

export function applyLiveSpot(spot) {
  const m = getMarket();
  if (!Number.isFinite(spot) || spot < 0.8 || spot > 1.6) return m;
  const last = m.frames.M15[m.frames.M15.length - 1];
  const delta = spot - last.c;
  if (Math.abs(delta) > 0.02) return m;
  last.c = roundPx(spot);
  last.h = roundPx(Math.max(last.h, spot));
  last.l = roundPx(Math.min(last.l, spot));
  for (const key of ["H1", "H4", "D1"]) {
    const bar = m.frames[key][m.frames[key].length - 1];
    bar.c = last.c;
    bar.h = Math.max(bar.h, last.h);
    bar.l = Math.min(bar.l, last.l);
  }
  m.meta.spot = last.c;
  m.meta.live = true;
  return m;
}

export function hydrateFromLive(book) {
  if (!book?.frames?.M15?.length) return getMarket();
  const base = getMarket();
  CACHE = {
    meta: {
      ...base.meta,
      ...book.meta,
      yearHigh: base.meta.yearHigh,
      yearLow: base.meta.yearLow,
      yearAvg: base.meta.yearAvg,
      sma50: base.meta.sma50,
      sma100: base.meta.sma100,
      sma200: base.meta.sma200,
      live: true,
    },
    frames: {
      M15: book.frames.M15,
      H1: book.frames.H1,
      H4: book.frames.H4,
      D1: book.frames.D1,
      W1: book.frames.W1,
    },
    gbpDaily: book.gbpDaily?.length ? book.gbpDaily : base.gbpDaily,
    source: book.source,
  };
  return CACHE;
}

export async function fetchLiveSpot() {
  const controllers = [];
  const tryFetch = async (url, parse) => {
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const t = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      return parse(await res.json());
    } finally {
      clearTimeout(t);
    }
  };

  const jobs = [
    tryFetch("https://api.frankfurter.app/latest?from=EUR&to=USD", (j) => j?.rates?.USD),
    tryFetch("https://open.er-api.com/v6/latest/EUR", (j) => j?.rates?.USD),
    tryFetch("https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT", (j) => +j?.price),
    tryFetch("https://api.exchangerate.host/latest?base=EUR&symbols=USD", (j) => j?.rates?.USD),
  ];

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "fulfilled" && Number.isFinite(r.value) && r.value > 0.8 && r.value < 1.6) {
      return r.value;
    }
  }
  return null;
}
