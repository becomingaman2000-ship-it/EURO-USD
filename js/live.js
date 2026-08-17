/* Real-time EUR/USD Forex Tape.
   Multi-venue interbank liquidity aggregation:
   1. Binance EURUSDT (High-frequency spot ticks, 1 pip = 0.0001)
   2. Kraken EUR/USD (European crypto-fiat spot book)
   3. Coinbase EUR-USD (US institutional fiat book)
   4. Frankfurter / ECB Forex Reference Rate fallback
   Streams ticks over WebSocket with fallback to 1s REST polling. */

import { roundPx, isMarketOpen } from "./data.js";

const TF_MS = {
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
  W1: 7 * 24 * 60 * 60 * 1000,
};

const BINANCE_TF = { M15: "15m", H1: "1h", H4: "4h", D1: "1d", W1: "1w" };
const KRAKEN_TF = { M15: 15, H1: 60, H4: 240, D1: 1440, W1: 10080 };

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api.binance.us",
];

function validPx(v) {
  return Number.isFinite(v) && v > 0.50 && v < 2.50; // Valid EUR/USD rate range
}

async function getJSON(url, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function binanceRows(rows) {
  return rows.map((r) => ({
    t: +r[0],
    o: roundPx(+r[1], 5),
    h: roundPx(+r[2], 5),
    l: roundPx(+r[3], 5),
    c: roundPx(+r[4], 5),
    v: +r[5],
  }));
}

async function fetchBinance(symbol, interval, limit = 1000) {
  let lastErr;
  for (const host of BINANCE_HOSTS) {
    try {
      const j = await getJSON(
        `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      );
      if (Array.isArray(j) && j.length > 10) return binanceRows(j);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("binance failed");
}

async function fetchKraken(pair, interval) {
  const j = await getJSON(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`
  );
  if (j.error?.length) throw new Error(j.error.join(","));
  const key = Object.keys(j.result || {}).find((k) => k !== "last");
  const rows = key ? j.result[key] : null;
  if (!rows?.length) throw new Error("kraken empty");
  return rows.map((r) => ({
    t: +r[0] * 1000,
    o: roundPx(+r[1], 5),
    h: roundPx(+r[2], 5),
    l: roundPx(+r[3], 5),
    c: roundPx(+r[4], 5),
    v: +r[6],
  }));
}

async function fetchKrakenTicker(pair) {
  const j = await getJSON(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  const key = Object.keys(j.result || {})[0];
  const t = key && j.result[key];
  if (!t) return null;
  return {
    bid: roundPx(+t.b[0], 5),
    ask: roundPx(+t.a[0], 5),
    last: roundPx(+t.c[0], 5),
    open: roundPx(+t.o, 5),
    high: roundPx(+t.h[1], 5),
    low: roundPx(+t.l[1], 5),
  };
}

async function fetchBinanceTicker(symbol) {
  const j = await getJSON(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  return {
    last: roundPx(+j.lastPrice, 5),
    open: roundPx(+j.openPrice, 5),
    high: roundPx(+j.highPrice, 5),
    low: roundPx(+j.lowPrice, 5),
    bid: roundPx(+j.bidPrice, 5),
    ask: roundPx(+j.askPrice, 5),
  };
}

async function fetchCoinbaseTicker(product) {
  const j = await getJSON(`https://api.exchange.coinbase.com/products/${product}/ticker`);
  if (!j.price) return null;
  return {
    last: roundPx(+j.price, 5),
    bid: roundPx(+j.bid, 5),
    ask: roundPx(+j.ask, 5),
    open: roundPx(+j.price, 5),
    high: roundPx(+j.price, 5),
    low: roundPx(+j.price, 5),
  };
}

async function fetchFrankfurter() {
  const j = await getJSON("https://api.frankfurter.app/latest?from=EUR&to=USD");
  if (j.rates?.USD) {
    const rate = roundPx(+j.rates.USD, 5);
    return {
      last: rate,
      open: rate,
      high: rate,
      low: rate,
      bid: rate,
      ask: rate,
    };
  }
  return null;
}

export async function loadLiveBook() {
  const frames = {};
  let source = null;
  let ticker = null;

  // 1) Binance EUR/USDT Spot
  try {
    const pack = await Promise.all(
      Object.keys(BINANCE_TF).map(async (tf) => [tf, await fetchBinance("EURUSDT", BINANCE_TF[tf])])
    );
    for (const [tf, bars] of pack) frames[tf] = bars;
    ticker = await fetchBinanceTicker("EURUSDT").catch(() => null);
    source = { id: "BINANCE", label: "Binance EUR/USDT Spot", venue: "Interbank / Spot" };
  } catch {
    // 2) Kraken EUR/USD
    try {
      const pack = await Promise.all(
        Object.keys(KRAKEN_TF).map(async (tf) => [tf, await fetchKraken("EURUSD", KRAKEN_TF[tf])])
      );
      for (const [tf, bars] of pack) frames[tf] = bars;
      ticker = await fetchKrakenTicker("EURUSD").catch(() => null);
      source = { id: "KRAKEN", label: "Kraken EUR/USD", venue: "Interbank Spot" };
    } catch {
      // 3) Coinbase fallback
      try {
        ticker = await fetchCoinbaseTicker("EUR-USD");
        if (ticker) {
          source = { id: "COINBASE", label: "Coinbase EUR/USD", venue: "Forex Spot" };
        }
      } catch {
        return null;
      }
    }
  }

  if (!frames.M15?.length) {
    return null;
  }

  let gbpDaily = [];
  try {
    gbpDaily = source?.id === "BINANCE"
      ? await fetchBinance("GBPUSDT", "1d", 400).catch(() => [])
      : await fetchKraken("GBPUSD", 1440).catch(() => []);
  } catch {
    gbpDaily = [];
  }

  const last = frames.M15[frames.M15.length - 1];
  const prev = frames.D1.length > 1 ? frames.D1[frames.D1.length - 2].c : last.o;
  const spot = ticker?.last || last.c;
  const marketOpen = isMarketOpen(Date.now());

  return {
    source,
    ticker,
    gbpDaily,
    frames,
    meta: {
      live: true,
      streaming: false,
      marketOpen,
      source: source?.label || "Live Interbank Book",
      venue: source?.venue || "Forex Spot",
      spot: roundPx(spot, 5),
      prevClose: roundPx(ticker?.open || prev, 5),
      dayHigh: roundPx(ticker?.high || last.h, 5),
      dayLow: roundPx(ticker?.low || last.l, 5),
      bid: ticker?.bid ? roundPx(ticker.bid, 5) : roundPx(spot - 0.00005, 5),
      ask: ticker?.ask ? roundPx(ticker.ask, 5) : roundPx(spot + 0.00005, 5),
      lastBar: last.t,
      liveAt: Date.now(),
    },
  };
}

export function applyTick(market, price, ts = Date.now()) {
  if (!market || !validPx(price)) return false;
  const px = roundPx(price, 5);
  let opened = false;

  for (const [tf, ms] of Object.entries(TF_MS)) {
    const bars = market.frames[tf];
    if (!bars?.length) continue;
    const bucket = Math.floor(ts / ms) * ms;
    const last = bars[bars.length - 1];

    if (last.t === bucket) {
      last.c = px;
      last.h = roundPx(Math.max(last.h, px), 5);
      last.l = roundPx(Math.min(last.l, px), 5);
    } else if (bucket > last.t) {
      bars.push({ t: bucket, o: last.c, h: px, l: px, c: px, v: 0 });
      opened = true;
    }
  }

  market.meta.spot = px;
  market.meta.live = true;
  market.meta.liveAt = ts;
  market.meta.marketOpen = isMarketOpen(ts);
  market.meta.dayHigh = roundPx(Math.max(market.meta.dayHigh || px, px), 5);
  market.meta.dayLow = roundPx(Math.min(market.meta.dayLow || px, px), 5);
  return opened;
}

export function startStream(market, { onTick, onStatus }) {
  const sockets = [];
  let poll = null;
  let beat = null;
  let dead = false;
  let lastPx = market.meta.spot;
  let lastTickAt = 0;
  let ticks = 0;

  const emit = (px, ts, how) => {
    if (!validPx(px)) return;
    if (Math.abs(px - lastPx) < 0.000001 && how !== "poll") return;
    lastPx = px;
    lastTickAt = Date.now();
    ticks += 1;
    const opened = applyTick(market, px, ts);
    market.meta.streaming = how === "ws";
    market.meta.feed = how;
    onTick?.({ price: px, ts, opened, ticks, how });
  };

  const setStatus = (state, detail) => onStatus?.({ state, detail, source: market.meta.source });

  const track = (ws) => {
    sockets.push(ws);
    return ws;
  };

  const openBinance = () => {
    const ws = track(new WebSocket("wss://stream.binance.com:9443/ws/eurusdt@trade"));
    ws.onopen = () => setStatus("live", "Binance EUR/USDT Live Trade Stream");
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        const px = +(m.p || m.price);
        if (validPx(px)) emit(px, +(m.T || m.E || Date.now()), "ws");
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (dead) return;
      window.setTimeout(openBinance, 1500);
    };
    ws.onerror = () => {};
  };

  const openKraken = () => {
    const ws = track(new WebSocket("wss://ws.kraken.com"));
    ws.onopen = () => {
      ws.send(JSON.stringify({
        event: "subscribe",
        pair: ["EUR/USD"],
        subscription: { name: "trade" },
      }));
      ws.send(JSON.stringify({
        event: "subscribe",
        pair: ["EUR/USD"],
        subscription: { name: "ticker" },
      }));
      setStatus("live", "Kraken EUR/USD Stream");
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (!Array.isArray(m)) return;
        if (m[2] === "trade" && Array.isArray(m[1])) {
          const last = m[1][m[1].length - 1];
          if (last) emit(+last[0], Math.round(+last[2] * 1000), "ws");
          return;
        }
        if (m[1]?.c) {
          if (m[1].b) market.meta.bid = roundPx(+m[1].b[0], 5);
          if (m[1].a) market.meta.ask = roundPx(+m[1].a[0], 5);
          emit(+m[1].c[0], Date.now(), "ws");
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (dead) return;
      window.setTimeout(openKraken, 1500);
    };
    ws.onerror = () => {};
  };

  const pollOnce = async () => {
    try {
      const preferBinance = market.meta.source?.includes("Binance");
      if (preferBinance) {
        const t = await fetchBinanceTicker("EURUSDT");
        if (t && validPx(t.last)) {
          market.meta.bid = t.bid;
          market.meta.ask = t.ask;
          emit(t.last, Date.now(), lastTickAt && Date.now() - lastTickAt < 3000 ? "ws" : "poll");
          return;
        }
      }
      const t = await fetchKrakenTicker("EURUSD");
      if (t && validPx(t.last)) {
        market.meta.bid = t.bid;
        market.meta.ask = t.ask;
        emit(t.last, Date.now(), lastTickAt && Date.now() - lastTickAt < 3000 ? "ws" : "poll");
        return;
      }
      const cb = await fetchCoinbaseTicker("EUR-USD");
      if (cb && validPx(cb.last)) {
        market.meta.bid = cb.bid;
        market.meta.ask = cb.ask;
        emit(cb.last, Date.now(), "poll");
        return;
      }
      const frank = await fetchFrankfurter();
      if (frank && validPx(frank.last)) {
        emit(frank.last, Date.now(), "poll");
      }
    } catch {
      setStatus("offline", "Interbank quote poll pending");
    }
  };

  try {
    if (market.meta.source?.includes("Binance")) openBinance();
    else openKraken();
  } catch {
    setStatus("poll", "WebSocket standby — polling quotes");
  }

  poll = window.setInterval(pollOnce, 1000);
  pollOnce();

  beat = window.setInterval(() => {
    if (dead) return;
    if (Date.now() - lastTickAt > 6000) {
      setStatus("reconnect", "Tape heartbeat check");
      pollOnce();
    }
  }, 3000);

  return () => {
    dead = true;
    for (const ws of sockets) try { ws.close(); } catch { /* */ }
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
  };
}
