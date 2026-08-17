import { getMarket, hydrateFromLive, MARKET_META } from "./data.js";
import { analyze, killZones, executionFrom } from "./ict.js";
import { DeskChart } from "./chart.js";
import { loadLiveBook, startStream } from "./live.js";
import { mailEnabled, setMailEnabled, maybeNotify, sendAlert, lastMail, ALERT_EMAIL } from "./notify.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const PIP = MARKET_META.pip; // 0.0001

const state = {
  tf: "H1",
  market: null,
  analysis: null,
  chart: null,
  live: false,
  stopStream: null,
};

function fmt(n, d = 5) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

function pips(n) {
  return (n / PIP).toFixed(1);
}

function clsBias(v) {
  if (v === "BULLISH" || v === "UP" || v === "LONG" || v === "BUY") return "up";
  if (v === "BEARISH" || v === "DOWN" || v === "SHORT" || v === "SELL") return "down";
  return "flat";
}

function actionOf(side) {
  if (side === "LONG" || side === "BUY" || side === "BULLISH" || side === "UP") return "BUY";
  if (side === "SHORT" || side === "SELL" || side === "BEARISH" || side === "DOWN") return "SELL";
  return "FLAT";
}

function feedLabel(meta) {
  if (meta?.streaming) return `LIVE · ${meta.source || "STREAM"}`;
  if (meta?.live && meta?.feed === "poll") return `LIVE POLL · ${meta.source || "REST"}`;
  if (meta?.live) return `LIVE BOOK · ${meta.source || "INTERBANK"}`;
  return "COMPOSITE TAPE · CONNECTING INTERBANK FEED";
}

function setFeedStatus(stateName, detail) {
  const el = $("#feedStatus");
  if (!el) return;
  el.dataset.state = stateName;
  el.textContent = detail || stateName;
}

function renderClock() {
  const kz = killZones(new Date());
  $("#nyClock").textContent = kz.ny;
  const active = kz.active[0];
  const pill = $("#kzPill");
  if (pill) {
    if (active) {
      pill.textContent = active.name;
      pill.dataset.on = "1";
    } else {
      pill.textContent = "Outside kill zone";
      pill.dataset.on = "0";
    }
  }
  const list = $("#kzList");
  if (list) {
    list.innerHTML = kz.zones
      .map(
        (z) => `<li class="${z.on ? "on" : ""}">
          <i></i><span>${z.name}</span><em>${z.note}</em>
        </li>`
      )
      .join("");
  }
}

function renderTape(a) {
  const chg = a.price - (a.meta.prevClose || a.price);
  const pct = (chg / (a.meta.prevClose || a.price)) * 100;
  const pipsChg = chg / PIP;

  $("#spot").textContent = fmt(a.price, 5);
  $("#spotChg").textContent = `${chg >= 0 ? "+" : ""}${fmt(chg, 5)} (${chg >= 0 ? "+" : ""}${pipsChg.toFixed(1)} pips · ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  $("#spotChg").className = "chg " + (chg >= 0 ? "up" : "down");
  $("#asOf").textContent = feedLabel(a.meta);
  $("#biasHtf").textContent = a.bias.htf;
  $("#biasHtf").className = "seal " + clsBias(a.bias.htf);
  $("#biasLtf").textContent = a.bias.shortTerm;
  $("#biasLtf").className = "seal " + clsBias(a.bias.shortTerm);

  const live = $("#livePill");
  if (live) {
    live.dataset.on = a.meta.live ? "1" : "0";
    live.dataset.stream = a.meta.streaming ? "1" : "0";
    live.textContent = a.meta.streaming
      ? "STREAMING"
      : a.meta.live
        ? "LIVE BOOK"
        : a.meta.marketOpen === false
          ? "WEEKEND CLOSED"
          : "STANDBY";
  }

  const feed = $("#feedLine");
  if (feed) {
    const age = a.meta.liveAt ? Math.max(0, Math.round((Date.now() - a.meta.liveAt) / 1000)) : "—";
    const ba = a.meta.bid && a.meta.ask ? `  ·  ${fmt(a.meta.bid, 5)} / ${fmt(a.meta.ask, 5)}` : "";
    feed.textContent = `${a.meta.source || "Composite Interbank Tape"}${ba}  ·  ${age === "—" ? "Connecting" : age + "s ago"}`;
  }

  const g = $("#gaugeFill");
  if (g) {
    const ang = (a.confluence.score / 100) * 180;
    g.style.transform = `rotate(${ang - 90}deg)`;
  }
  $("#confScore").textContent = a.confluence.score;
  $("#confNotes").textContent = a.confluence.notes.join(" · ") || "Balanced read";

  const act = actionOf(a.execution?.side || a.bias.shortTerm);
  const flag = $("#actionFlag");
  const word = $("#actionWord");
  if (flag && word) {
    flag.dataset.action = act;
    word.textContent = act;
  }
}

function renderMTF(a) {
  const grid = $("#mtfGrid");
  if (!grid) return;
  const rows = [
    ["W1", a.structure.W1.trend, a.structure.W1.lastEvent?.kind || "—", a.dealing.week.zone],
    ["D1", a.structure.D1.trend, a.structure.D1.lastEvent?.kind || "—", a.dealing.day.zone],
    ["H4", a.structure.H4.trend, a.structure.H4.lastEvent?.kind || "—", a.dealing.h4.zone],
    ["H1", a.structure.H1.trend, a.structure.H1.lastEvent?.kind || "—", a.dealing.h1.zone],
    ["M15", a.structure.M15.trend, a.structure.M15.lastEvent?.kind || "—", a.bias.shortTerm],
  ];
  grid.innerHTML = rows
    .map(
      ([tf, tr, ev, zn]) => `
      <div class="mtf-row">
        <b>${tf}</b>
        <span class="seal ${clsBias(tr)}">${tr}</span>
        <em>${ev}</em>
        <small>${zn}</small>
      </div>`
    )
    .join("");
}

function renderExecution(ex, meta) {
  const panel = $("#execute");
  if (!panel || !ex) return;
  panel.dataset.status = ex.status;

  const act = actionOf(ex.side);
  const exAction = $("#exAction");
  const exActionWord = $("#exActionWord");
  const exActionSub = $("#exActionSub");
  if (exAction && exActionWord && exActionSub) {
    exAction.dataset.action = act;
    exActionWord.textContent = act;
    exActionSub.textContent = ex.label || "Reading tape…";
  }

  $("#exState").textContent = ex.label || "READING THE TAPE";
  $("#exWhen").textContent = ex.when || "Standby";

  $("#exEntry").textContent = ex.entry != null ? fmt(ex.entry, 5) : "—";
  $("#exEntryDist").textContent = ex.pipsToEntry != null ? `${ex.pipsToEntry} pips away` : "—";

  $("#exSl").textContent = ex.sl != null ? fmt(ex.sl, 5) : "—";
  $("#exSlDist").textContent = ex.pipsToSl != null ? `${ex.pipsToSl} pips risk` : "—";

  $("#exTp1").textContent = ex.t1 != null ? fmt(ex.t1, 5) : "—";
  $("#exTp1Dist").textContent = ex.pipsToTp != null ? `${ex.pipsToTp} pips target` : "—";

  $("#exTp2").textContent = ex.t2 != null ? fmt(ex.t2, 5) : "—";
  $("#exTp2Dist").textContent = ex.t2 != null && ex.entry != null ? `${pips(Math.abs(ex.t2 - ex.entry))} pips stretch` : "—";

  $("#exWindow").textContent = ex.when || "—";
  $("#exCount").textContent = ex.countdown ? `in ${ex.countdown}` : "—";

  $("#exModel").textContent = ex.model || "—";
  $("#exRr").textContent = ex.rr ? `1:${ex.rr} R:R` : "—";

  const bar = $("#exBar");
  if (bar) bar.style.width = `${ex.progress || 0}%`;

  $("#exNote").textContent = ex.note || "Aligning PD arrays…";
}

function renderLimits(limits) {
  const board = $("#limitBoard");
  if (!board || !limits) return;
  board.innerHTML = limits
    .map((t) => {
      const cls = t.action === "BUY" ? "up" : t.action === "SELL" ? "down" : "flat";
      const tag = t.fill === "WORKING" ? "LIVE" : t.fill === "REST" ? "LIMIT RESTING" : t.fill;
      return `
        <div class="limit-card ${cls} ${t.live ? "active" : ""}">
          <div class="l-head">
            <span class="l-sess">${t.session}</span>
            <span class="l-tag">${tag}</span>
          </div>
          <div class="l-clock">${t.clock}</div>
          <div class="l-action">${t.order}</div>
          <div class="l-grid">
            <div><span>Limit</span><b>${t.limit ? fmt(t.limit, 5) : "—"}</b></div>
            <div><span>Stop</span><b>${t.sl ? fmt(t.sl, 5) : "—"}</b></div>
            <div><span>TP1</span><b>${t.tp1 ? fmt(t.tp1, 5) : "—"}</b></div>
            <div><span>TP2</span><b>${t.tp2 ? fmt(t.tp2, 5) : "—"}</b></div>
          </div>
          <p class="l-why">${t.why}</p>
        </div>`;
    })
    .join("");
}

function renderSetups(setups) {
  const box = $("#setups");
  if (!box || !setups) return;
  box.innerHTML = setups
    .map(
      (s) => `
      <article class="setup-card ${s.side === "SHORT" ? "down" : "up"}">
        <header>
          <span class="model-tag">${s.model}</span>
          <span class="side-pill">${s.side}</span>
        </header>
        <h3>${s.title}</h3>
        <div class="s-grid">
          <div><span>Entry</span><b>${fmt(s.entry, 5)}</b></div>
          <div><span>Stop</span><b>${fmt(s.sl, 5)}</b></div>
          <div><span>TP1</span><b>${fmt(s.t1, 5)}</b></div>
          <div><span>R:R</span><b>1:${s.rr}</b></div>
        </div>
        <p>${s.thesis}</p>
      </article>`
    )
    .join("");
}

function renderPredictions(p) {
  const grid = $("#predGrid");
  if (!grid || !p) return;
  const cards = [
    ["Intraday", p.intraday],
    ["Daily (24h)", p.day],
    ["Swing (1–3w)", p.swing],
  ];
  grid.innerHTML = cards
    .map(
      ([title, c]) => `
      <article class="pred-card">
        <header>
          <span>${title}</span>
          <b class="${clsBias(c.direction)}">${c.direction}</b>
        </header>
        <div class="p-main">
          <div><span>Target</span><b>${fmt(c.target, 5)}</b></div>
          <div><span>Stretch</span><b>${fmt(c.stretch, 5)}</b></div>
          <div><span>Invalidation</span><b>${fmt(c.invalid, 5)}</b></div>
          <div><span>Confidence</span><b>${c.confidence}%</b></div>
        </div>
        <p>${c.text}</p>
      </article>`
    )
    .join("");

  const sc = $("#scenarios");
  if (sc && p.scenarios) {
    sc.innerHTML = p.scenarios
      .map(
        (s) => `
        <li>
          <div class="sc-head">
            <strong>${s.name}</strong>
            <span>${Math.round(s.odds * 100)}% probability</span>
          </div>
          <p>${s.path}</p>
        </li>`
      )
      .join("");
  }
}

function renderNarrative(n) {
  if (!n) return;
  $("#storyHead").textContent = n.headline;
  $("#storyBody").innerHTML = n.paragraphs.map((p) => `<p>${p}</p>`).join("");
  $("#storyBullets").innerHTML = n.bullets.map((b) => `<li>${b}</li>`).join("");
}

function renderPDArrays(a) {
  const pdZone = $("#pdZone");
  if (pdZone) pdZone.textContent = a.dealing.year.zone;
  const pdLow = $("#pdLow");
  if (pdLow) pdLow.textContent = fmt(a.dealing.year.low, 5);
  const pdEq = $("#pdEq");
  if (pdEq) pdEq.textContent = fmt(a.dealing.year.eq, 5);
  const pdHigh = $("#pdHigh");
  if (pdHigh) pdHigh.textContent = fmt(a.dealing.year.high, 5);

  const meter = $("#pdMeter i");
  if (meter) meter.style.left = `${Math.max(0, Math.min(100, a.dealing.year.pos * 100))}%`;

  $("#po3Phase").textContent = a.po3.phase;
  $("#po3Text").textContent = a.po3.narrative;

  const fvgList = $("#fvgList");
  if (fvgList) {
    fvgList.innerHTML = a.pdArrays.fvgs
      .map(
        (g) =>
          `<li><b class="${g.type === "BULL" ? "up" : "down"}">${g.tf} ${g.type}</b> <span>${fmt(g.bot, 5)} – ${fmt(g.top, 5)}</span> <em>${g.sizePips}p</em></li>`
      )
      .join("");
  }

  const obList = $("#obList");
  if (obList) {
    obList.innerHTML = a.pdArrays.orderBlocks
      .map(
        (o) =>
          `<li><b class="${o.type === "BULL" ? "up" : "down"}">${o.tf} ${o.breaker ? "BREAKER" : "OB"}</b> <span>${fmt(o.bot, 5)} – ${fmt(o.top, 5)}</span></li>`
      )
      .join("");
  }

  const smtBox = $("#smtBox");
  if (smtBox && a.smt) {
    smtBox.innerHTML = `
      <div class="smt-card ${a.smt.type === "BULLISH" ? "up" : a.smt.type === "BEARISH" ? "down" : ""}">
        <header>
          <span>Intermarket SMT</span>
          <b>${a.smt.label}</b>
        </header>
        <p>${a.smt.detail}</p>
      </div>`;
  }
}

function updateOHLCTooltip(h) {
  const el = $("#ohlc");
  if (!el) return;
  if (!h) {
    el.innerHTML = `<span>Hover candlesticks to inspect institutional tape</span>`;
    return;
  }
  const b = h.bar;
  const d = new Date(b.t);
  const time = `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  el.innerHTML = `
    <b>${time}</b>
    <span>O: <em>${fmt(b.o, 5)}</em></span>
    <span>H: <em>${fmt(b.h, 5)}</em></span>
    <span>L: <em>${fmt(b.l, 5)}</em></span>
    <span>C: <em>${fmt(b.c, 5)}</em></span>
    <span>V: <em>${b.v.toLocaleString()}</em></span>
  `;
}

function fullRender() {
  const a = state.analysis;
  if (!a) return;
  renderTape(a);
  renderExecution(a.execution, a.meta);
  renderLimits(a.limits);
  renderPredictions(a.predictions);
  renderNarrative(a.narrative);
  renderPDArrays(a);
  renderMTF(a);
  renderSetups(a.setups);
  state.chart.setData(state.market.frames[state.tf], a, state.tf, { preserve: true });
}

function rescan() {
  state.analysis = analyze(state.market);
  fullRender();
  maybeNotify(state.analysis.execution, state.market, (status, detail) => {
    const el = $("#mailStatus");
    if (el) el.textContent = detail;
  });
}

function initUI() {
  // Timeframe buttons
  $$(".toolbar .tf button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".toolbar .tf button").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      state.tf = btn.dataset.tf;
      state.chart.setData(state.market.frames[state.tf], state.analysis, state.tf);
    });
  });

  // Overlay toggles
  $$(".toolbar .ovs button").forEach((btn) => {
    const k = btn.dataset.ov;
    if (state.chart.overlays[k]) btn.classList.add("on");
    btn.addEventListener("click", () => {
      state.chart.overlays[k] = !state.chart.overlays[k];
      btn.classList.toggle("on", state.chart.overlays[k]);
      state.chart.draw();
    });
  });

  // Rescan button
  $("#rescan")?.addEventListener("click", rescan);

  // Email alerts toggle
  const mailToggle = $("#mailToggle");
  if (mailToggle) {
    mailToggle.checked = mailEnabled();
    mailToggle.addEventListener("change", (e) => setMailEnabled(e.target.checked));
  }

  // Test mail button
  $("#mailTest")?.addEventListener("click", async () => {
    const status = $("#mailStatus");
    if (status) status.textContent = "Sending test alert…";
    try {
      await sendAlert(state.analysis.execution, state.market, { force: true });
      if (status) status.textContent = `Test alert dispatched to ${ALERT_EMAIL}`;
    } catch (err) {
      if (status) status.textContent = err.message || "Failed to send test alert";
    }
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const key = e.key;
    if (key === "1") switchTF("M15");
    if (key === "2") switchTF("H1");
    if (key === "3") switchTF("H4");
    if (key === "4") switchTF("D1");
    if (key === "5") switchTF("W1");
    if (key.toLowerCase() === "r") rescan();
  });

  window.addEventListener("resize", () => {
    state.chart.resize();
  });
}

function switchTF(tf) {
  state.tf = tf;
  $$(".toolbar .tf button").forEach((b) => b.classList.toggle("on", b.dataset.tf === tf));
  state.chart.setData(state.market.frames[tf], state.analysis, tf);
}

async function boot() {
  state.market = getMarket();
  state.analysis = analyze(state.market);

  const canvas = $("#tape");
  const overlay = $("#tapeOv");
  state.chart = new DeskChart(canvas, overlay);
  state.chart.onHover = updateOHLCTooltip;

  initUI();
  fullRender();
  renderClock();
  window.setInterval(renderClock, 1000);

  // Fade out boot screen
  setTimeout(() => {
    $("#boot")?.classList.add("off");
  }, 400);

  // Connect live interbank feed
  setFeedStatus("seek", "Connecting to live EUR/USD feed…");
  try {
    const liveBook = await loadLiveBook();
    if (liveBook) {
      state.market = hydrateFromLive(liveBook);
      state.analysis = analyze(state.market);
      fullRender();
      setFeedStatus("live", `Connected to ${state.market.meta.source}`);
    }
  } catch (err) {
    setFeedStatus("fallback", "Using interbank composite tape");
  }

  // Start real-time tick streaming
  let lastBarCount = state.market.frames.M15.length;
  state.stopStream = startStream(state.market, {
    onTick: ({ price, ts, opened }) => {
      // If a new candle opened or 30s elapsed, rescan the full ICT engine
      if (opened || state.market.frames.M15.length !== lastBarCount) {
        lastBarCount = state.market.frames.M15.length;
        rescan();
      } else {
        // Fast UI tick update
        state.analysis.price = price;
        state.analysis.execution = executionFrom(
          state.analysis.setups,
          price,
          Date.now(),
          state.analysis.po3,
          state.analysis.bias
        );
        renderTape(state.analysis);
        renderExecution(state.analysis.execution, state.analysis.meta);
        state.chart.draw();
      }
    },
    onStatus: ({ state: st, detail }) => {
      setFeedStatus(st, detail);
    },
  });

  // Periodic ICT full rescan every 20 seconds
  window.setInterval(rescan, 20000);
}

boot();
