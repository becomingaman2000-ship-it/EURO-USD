/* Institutional Canvas Candlestick Chart with ICT Overlays for EUR/USD. */

import { MARKET_META, roundPx, nyParts } from "./data.js";

const PIP = MARKET_META.pip;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function fmt(n, d = 5) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

export class DeskChart {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = canvas.getContext("2d");
    this.octx = overlay.getContext("2d");
    this.bars = [];
    this.analysis = null;
    this.tf = "H1";
    this.overlays = {
      fvg: true,
      ob: true,
      liq: true,
      eq: true,
      sessions: true,
      setup: true,
      sma: true,
    };
    this.view = { end: 0, count: 80 };
    this.hover = null;
    this.drag = null;
    this.dpr = 1;
    this.pad = { l: 12, r: 76, t: 18, b: 28 };
    this.onHover = null;
    this.bind();
  }

  bind() {
    const ov = this.overlay;
    ov.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1.12 : 0.88;
        const mid = this.hover?.i ?? this.view.end - this.view.count / 2;
        this.view.count = Math.round(
          clamp(this.view.count * dir, 20, Math.min(400, this.bars.length))
        );
        this.view.end = clamp(
          Math.round(mid + this.view.count / 2),
          this.view.count,
          this.bars.length
        );
        this.draw();
      },
      { passive: false }
    );

    ov.addEventListener("pointerdown", (e) => {
      ov.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, end: this.view.end };
    });
    ov.addEventListener("pointerup", () => (this.drag = null));
    ov.addEventListener("pointerleave", () => {
      this.hover = null;
      this.draw();
      this.onHover?.(null);
    });
    ov.addEventListener("pointermove", (e) => {
      const rect = ov.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (this.drag) {
        const w = this.inner().w;
        const px = w / this.view.count;
        const dx = Math.round((this.drag.x - e.clientX) / Math.max(px, 1));
        this.view.end = clamp(this.drag.end + dx, this.view.count, this.bars.length);
      }
      this.hover = this.hit(x, y);
      this.draw();
      this.onHover?.(this.hover);
    });
  }

  setData(bars, analysis, tf, opts = {}) {
    const pinned = this.view.end >= this.bars.length - 1;
    const prevCount = this.view.count;
    this.bars = bars;
    this.analysis = analysis;
    const tfChanged = tf && tf !== this.tf;
    this.tf = tf || this.tf;

    if (!opts.preserve || tfChanged || !prevCount) {
      this.view.end = bars.length;
      this.view.count =
        this.tf === "M15" ? 96 : this.tf === "H1" ? 90 : this.tf === "H4" ? 80 : this.tf === "D1" ? 120 : 64;
      this.view.count = Math.min(this.view.count, bars.length);
      if (!opts.soft) this.resize();
      else this.draw();
      return;
    }
    this.view.count = Math.min(prevCount, bars.length);
    this.view.end = pinned ? bars.length : Math.min(this.view.end, bars.length);
    this.draw();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth || 800;
    const h = parent.clientHeight || 450;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = w + "px";
      c.style.height = h + "px";
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  inner() {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    return {
      x: this.pad.l,
      y: this.pad.t,
      w: Math.max(10, w - this.pad.l - this.pad.r),
      h: Math.max(10, h - this.pad.t - this.pad.b),
      W: w,
      H: h,
    };
  }

  windowBars() {
    const end = this.view.end;
    const start = Math.max(0, end - this.view.count);
    return { start, end, bars: this.bars.slice(start, end) };
  }

  minMax(bars) {
    if (!bars.length) return { min: 1.0800, max: 1.0900, span: 0.0100 };
    let min = Infinity;
    let max = -Infinity;
    for (const b of bars) {
      if (b.l < min) min = b.l;
      if (b.h > max) max = b.h;
    }
    const pad = Math.max((max - min) * 0.08, 0.0006);
    min -= pad;
    max += pad;
    return { min, max, span: Math.max(max - min, 0.0010) };
  }

  coordMapper(inner, mm, count) {
    const step = inner.w / Math.max(count, 1);
    const xOf = (slot) => inner.x + (slot + 0.5) * step;
    const yOf = (p) => inner.y + ((mm.max - p) / mm.span) * inner.h;
    const pOf = (y) => mm.max - ((y - inner.y) / inner.h) * mm.span;
    return { step, xOf, yOf, pOf };
  }

  hit(x, y) {
    const inn = this.inner();
    if (x < inn.x || x > inn.x + inn.w || y < inn.y || y > inn.y + inn.h) return null;
    const { start, bars } = this.windowBars();
    if (!bars.length) return null;
    const mm = this.minMax(bars);
    const m = this.coordMapper(inn, mm, bars.length);
    const slot = Math.floor((x - inn.x) / m.step);
    if (slot < 0 || slot >= bars.length) return null;
    const bar = bars[slot];
    return {
      slot,
      i: start + slot,
      bar,
      x: m.xOf(slot),
      y: m.yOf(bar.c),
      price: m.pOf(y),
    };
  }

  draw() {
    const ctx = this.ctx;
    const octx = this.octx;
    const inn = this.inner();
    ctx.clearRect(0, 0, inn.W, inn.H);
    octx.clearRect(0, 0, inn.W, inn.H);

    const { start, end, bars } = this.windowBars();
    if (!bars.length) return;

    const mm = this.minMax(bars);
    const m = this.coordMapper(inn, mm, bars.length);

    this.drawGrid(ctx, inn, mm, m, bars);
    if (this.overlays.sessions && (this.tf === "M15" || this.tf === "H1")) {
      this.drawSessions(ctx, inn, m, bars, start);
    }
    if (this.overlays.eq && this.analysis) {
      this.drawDealingRange(ctx, inn, m, mm);
    }
    if (this.overlays.fvg && this.analysis) {
      this.drawFVGs(ctx, inn, m, start, end, bars);
    }
    if (this.overlays.ob && this.analysis) {
      this.drawOBs(ctx, inn, m, start, end, bars);
    }
    if (this.overlays.liq && this.analysis) {
      this.drawLiquidity(ctx, inn, m, mm, bars);
    }
    this.drawCandles(ctx, inn, m, bars);
    if (this.overlays.setup && this.analysis?.execution) {
      this.drawSetup(ctx, inn, m, mm);
    }
    this.drawCrosshair(octx, inn, m, mm);
  }

  drawGrid(ctx, inn, mm, m, bars) {
    ctx.save();
    ctx.strokeStyle = "rgba(196, 163, 90, 0.08)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#8a8478";
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Dynamic price grid lines for EUR/USD (every 10–25 pips)
    const rawStep = mm.span / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const nice = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= rawStep) || rawStep;
    const first = Math.ceil(mm.min / nice) * nice;

    for (let p = first; p <= mm.max; p += nice) {
      const y = Math.round(m.yOf(p));
      if (y < inn.y || y > inn.y + inn.h) continue;
      ctx.beginPath();
      ctx.moveTo(inn.x, y);
      ctx.lineTo(inn.x + inn.w, y);
      ctx.stroke();
      ctx.fillText(fmt(p, 5), inn.x + inn.w + 6, y);
    }

    // Time axis markers
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xStep = Math.max(1, Math.floor(bars.length / 7));
    for (let i = 0; i < bars.length; i += xStep) {
      const b = bars[i];
      const x = Math.round(m.xOf(i));
      ctx.beginPath();
      ctx.moveTo(x, inn.y);
      ctx.lineTo(x, inn.y + inn.h);
      ctx.stroke();

      const d = new Date(b.t);
      const label =
        this.tf === "D1" || this.tf === "W1"
          ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
          : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      ctx.fillText(label, x, inn.y + inn.h + 8);
    }
    ctx.restore();
  }

  drawSessions(ctx, inn, m, bars, start) {
    ctx.save();
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const { hour, minute } = nyParts(b.t);
      const t = hour + minute / 60;

      let color = null;
      // Asian Range (20:00 - 00:00 NY)
      if (t >= 20 || t < 0) color = "rgba(122, 155, 184, 0.05)";
      // London Kill Zone (02:00 - 05:00 NY)
      else if (t >= 2 && t < 5) color = "rgba(196, 163, 90, 0.06)";
      // NY AM Kill Zone (07:00 - 10:00 NY)
      else if (t >= 7 && t < 10) color = "rgba(111, 191, 154, 0.06)";

      if (color) {
        const x1 = m.xOf(i) - m.step / 2;
        ctx.fillStyle = color;
        ctx.fillRect(x1, inn.y, m.step, inn.h);
      }
    }
    ctx.restore();
  }

  drawDealingRange(ctx, inn, m, mm) {
    const range = this.analysis?.dealing?.day || this.analysis?.dealing?.week;
    if (!range) return;

    const eq = range.eq;
    const yEq = m.yOf(eq);

    ctx.save();
    // EQ Line
    ctx.strokeStyle = "rgba(196, 163, 90, 0.6)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(inn.x, yEq);
    ctx.lineTo(inn.x + inn.w, yEq);
    ctx.stroke();

    ctx.fillStyle = "#c4a35a";
    ctx.font = "9px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText(`EQ ${fmt(eq, 5)}`, inn.x + 8, yEq - 4);

    // OTE Golden Zone Shading (62% – 79%)
    if (range.oteBuy?.length >= 3) {
      const topBuy = m.yOf(range.oteBuy[0]);
      const botBuy = m.yOf(range.oteBuy[2]);
      ctx.fillStyle = "rgba(111, 191, 154, 0.07)";
      ctx.fillRect(inn.x, topBuy, inn.w, Math.max(botBuy - topBuy, 2));
    }
    ctx.restore();
  }

  drawFVGs(ctx, inn, m, start, end, bars) {
    const gaps = this.analysis?.frames?.[this.tf]?.gaps || [];
    ctx.save();

    for (const g of gaps) {
      if (g.i + 2 < start || g.i > end) continue;
      const x1 = Math.max(inn.x, m.xOf(Math.max(0, g.i - start)));
      const x2 = inn.x + inn.w;
      const yTop = m.yOf(g.top);
      const yBot = m.yOf(g.bot);
      const yCe = m.yOf(g.ce);
      const height = Math.max(yBot - yTop, 1);

      if (g.type === "BULL") {
        ctx.fillStyle = g.inverted
          ? "rgba(211, 106, 106, 0.12)"
          : g.virgin
            ? "rgba(111, 191, 154, 0.22)"
            : "rgba(111, 191, 154, 0.10)";
        ctx.strokeStyle = g.inverted ? "rgba(211, 106, 106, 0.4)" : "rgba(111, 191, 154, 0.45)";
      } else {
        ctx.fillStyle = g.inverted
          ? "rgba(111, 191, 154, 0.12)"
          : g.virgin
            ? "rgba(211, 106, 106, 0.22)"
            : "rgba(211, 106, 106, 0.10)";
        ctx.strokeStyle = g.inverted ? "rgba(111, 191, 154, 0.4)" : "rgba(211, 106, 106, 0.45)";
      }

      ctx.fillRect(x1, yTop, x2 - x1, height);
      ctx.strokeRect(x1, yTop, x2 - x1, height);

      // Consequent Encroachment (CE 50%) line
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, yCe);
      ctx.lineTo(x2, yCe);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawOBs(ctx, inn, m, start, end, bars) {
    const obs = this.analysis?.frames?.[this.tf]?.obs || [];
    ctx.save();

    for (const ob of obs) {
      if (ob.i < start - 20 || ob.i > end) continue;
      const x1 = Math.max(inn.x, m.xOf(Math.max(0, ob.i - start)));
      const x2 = inn.x + inn.w;
      const yTop = m.yOf(ob.top);
      const yBot = m.yOf(ob.bot);
      const height = Math.max(yBot - yTop, 1);

      if (ob.breaker) {
        ctx.fillStyle = ob.type === "BULL" ? "rgba(211, 106, 106, 0.15)" : "rgba(111, 191, 154, 0.15)";
        ctx.strokeStyle = ob.type === "BULL" ? "#d36a6a" : "#6fbf9a";
        ctx.setLineDash([3, 2]);
      } else {
        ctx.fillStyle = ob.type === "BULL" ? "rgba(111, 191, 154, 0.12)" : "rgba(211, 106, 106, 0.12)";
        ctx.strokeStyle = ob.type === "BULL" ? "rgba(111, 191, 154, 0.5)" : "rgba(211, 106, 106, 0.5)";
        ctx.setLineDash([]);
      }

      ctx.fillRect(x1, yTop, x2 - x1, height);
      ctx.strokeRect(x1, yTop, x2 - x1, height);
    }
    ctx.restore();
  }

  drawLiquidity(ctx, inn, m, mm, bars) {
    const liq = this.analysis?.frames?.[this.tf]?.liq;
    if (!liq) return;
    ctx.save();

    // Key calendar liquidity lines (PDH, PDL, PWH, PWL)
    for (const ext of liq.extras || []) {
      const y = Math.round(m.yOf(ext.price));
      if (y < inn.y || y > inn.y + inn.h) continue;

      ctx.strokeStyle = ext.side === "BSL" ? "rgba(211, 106, 106, 0.75)" : "rgba(111, 191, 154, 0.75)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(inn.x, y);
      ctx.lineTo(inn.x + inn.w, y);
      ctx.stroke();

      ctx.fillStyle = ext.side === "BSL" ? "#d36a6a" : "#6fbf9a";
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${ext.id} · ${fmt(ext.price, 5)}`, inn.x + inn.w - 8, y - 3);
    }
    ctx.restore();
  }

  drawCandles(ctx, inn, m, bars) {
    ctx.save();
    const halfW = Math.max(1, Math.min(8, (m.step * 0.72) / 2));

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const x = Math.round(m.xOf(i));
      const yO = m.yOf(b.o);
      const yC = m.yOf(b.c);
      const yH = m.yOf(b.h);
      const yL = m.yOf(b.l);
      const bull = b.c >= b.o;

      // Wick
      ctx.strokeStyle = bull ? "#6fbf9a" : "#d36a6a";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();

      // Body
      const top = Math.min(yO, yC);
      const height = Math.max(Math.abs(yC - yO), 1);
      ctx.fillStyle = bull ? "#6fbf9a" : "#d36a6a";
      ctx.fillRect(x - halfW, top, halfW * 2, height);
    }
    ctx.restore();
  }

  drawSetup(ctx, inn, m, mm) {
    const ex = this.analysis.execution;
    if (!ex || !ex.entry) return;

    ctx.save();
    const yEntry = m.yOf(ex.entry);
    const ySl = m.yOf(ex.sl);
    const yTp = m.yOf(ex.t1);

    // Entry line
    ctx.strokeStyle = "#c4a35a";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(inn.x, yEntry);
    ctx.lineTo(inn.x + inn.w, yEntry);
    ctx.stroke();

    // Stop Loss line
    ctx.strokeStyle = "#d36a6a";
    ctx.beginPath();
    ctx.moveTo(inn.x, ySl);
    ctx.lineTo(inn.x + inn.w, ySl);
    ctx.stroke();

    // Take Profit line
    ctx.strokeStyle = "#6fbf9a";
    ctx.beginPath();
    ctx.moveTo(inn.x, yTp);
    ctx.lineTo(inn.x + inn.w, yTp);
    ctx.stroke();

    ctx.restore();
  }

  drawCrosshair(ctx, inn, m, mm) {
    if (!this.hover) return;
    const { x, y, price, bar } = this.hover;

    ctx.save();
    ctx.strokeStyle = "rgba(196, 163, 90, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(x, inn.y);
    ctx.lineTo(x, inn.y + inn.h);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(inn.x, y);
    ctx.lineTo(inn.x + inn.w, y);
    ctx.stroke();

    // Price badge on Y axis
    ctx.fillStyle = "#c4a35a";
    ctx.fillRect(inn.x + inn.w + 2, y - 8, inn.r - 4, 16);
    ctx.fillStyle = "#0c0d11";
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fmt(price, 5), inn.x + inn.w + 6, y);

    ctx.restore();
  }
}
