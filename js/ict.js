import { TF_MS, nyParts, forexOpen, marketHealth, dataHealth } from './safety.js';
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
    if (hi) out.push({ i, confirmedI: i + right, t: bars[i].t, price: bars[i].h, type: "H" });
    if (lo) out.push({ i, confirmedI: i + right, t: bars[i].t, price: bars[i].l, type: "L" });
  }
  return out;
}

function structure(bars, sw) {
  let trend='RANGE', lastHigh=null,lastLow=null;
  const events=[], broken=new Set();
  // Pivots become usable only once their right-hand confirmation bars close.
  for(let i=0;i<bars.length;i++) {
    for(const pivot of sw) if(pivot.confirmedI===i) {if(pivot.type==='H')lastHigh=pivot;else lastLow=pivot;}
    for(const [pivot,up] of [[lastHigh,true],[lastLow,false]]) {
      if(!pivot||broken.has(pivot)||!(up?bars[i].c>pivot.price:bars[i].c<pivot.price))continue;
      const next=up?'BULLISH':'BEARISH';
      events.push({kind:trend!=='RANGE'&&trend!==next?'CHOCH':'BOS',dir:up?'BULL':'BEAR',t:bars[i].t,price:bars[i].c,i,ref:pivot.price});
      trend=next;broken.add(pivot);
    }
  }
  return {trend,lastEvent:events.at(-1)||null,events:events.slice(-12),lastHigh,lastLow,swingHighs:sw.filter(s=>s.type==='H').slice(-8),swingLows:sw.filter(s=>s.type==='L').slice(-8)};
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
  if(!bars.length)return [];
  const key=ts=>{const p=nyParts(ts);const d=new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);if(+p.hour>=17)d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
  const last=bars.at(-1), today=key(last.t);
  const days=[...new Set(bars.map(b=>key(b.t)))].filter(k=>k<today).sort();
  const prev=bars.filter(b=>key(b.t)===days.at(-1));
  const weekKey=k=>{const d=new Date(k+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);};
  const thisWeek=weekKey(today), weeks=[...new Set(days.map(weekKey))].filter(k=>k<thisWeek).sort();
  const prevWeek=bars.filter(b=>weekKey(key(b.t))===weeks.at(-1));
  const out=[];
  for(const [a,hi,lo] of [[prev,'PDH','PDL'],[prevWeek,'PWH','PWL']])if(a.length){out.push({id:hi,label:hi,price:Math.max(...a.map(b=>b.h)),side:'BSL'},{id:lo,label:lo,price:Math.min(...a.map(b=>b.l)),side:'SSL'});}
  return out;
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
    oteBuy: [fib(0.62), fib(0.705), fib(0.79)],
    oteSell: [lo + (hi - lo) * 0.62, lo + (hi - lo) * 0.705, lo + (hi - lo) * 0.79],
    fibs: [0, 0.21, 0.5, 0.62, 0.705, 0.79, 1].map((f) => ({ f, price: lo + (hi - lo) * f })),
  };
}

function sessionsFrom(bars) {
  const last = bars.at(-1); if (!last) return {};
  const dateKey = ts => { const p=nyParts(ts); return `${p.year}-${p.month}-${p.day}`; };
  const lp=nyParts(last.t);
  // Asian 20:00 prior local date to 02:00 current local date; DST handled by Intl.
  const anchor=last.t+(+lp.hour>=20?86400000:0);
  const today=dateKey(anchor), yesterday=dateKey(anchor-86400000);
  const select = kind => bars.filter(b=>{
    const p=nyParts(b.t), h=+p.hour + +p.minute/60, key=dateKey(b.t);
    if(kind==='asian') return (key===yesterday && h>=20)||(key===today && h<2);
    return key===today && (kind==='london' ? h>=2&&h<5 : h>=7&&h<17);
  });
  const pack=key=>{ const a=select(key);return a.length?{key,high:Math.max(...a.map(b=>b.h)),low:Math.min(...a.map(b=>b.l)),open:a[0].o,close:a.at(-1).c,bars:a.length}:null; };
  return {asian:pack('asian'),london:pack('london'),ny:pack('ny')};
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
      detail: "EUR printed a fresh sell-side low while GBP refused. This is a conditional divergence, not entry confirmation.",
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
  const {price,frames,bias,po3}=ctx;
  const side=bias.shortTerm==='BULLISH'?'LONG':bias.shortTerm==='BEARISH'?'SHORT':null;
  if(!side) return [];
  const bullish=side==='LONG', type=bullish?'BULL':'BEAR';
  const opposite=bullish?'BEARISH':'BULLISH';
  if(frames.H1.struct.trend===opposite||frames.H4.struct.trend===opposite)return [];
  const recent=frames.M15.bars.slice(-16), atr=frames.M15.atr;
  // Require a recent directional structure break AND displacement, followed by a retracement array.
  const event=frames.M15.struct.lastEvent;
  const fresh=event && event.dir===type && recent.some(b=>b.t===event.t);
  const impulse=frames.M15.disp.some(d=>d.dir===type && recent.some(b=>b.t===d.t));
  const swept=po3.judas?.side===(bullish?'SSL':'BSL') || frames.M15.liq.pools.some(p=>p.side===(bullish?'SSL':'BSL')&&p.swept&&p.reclaimed&&p.sweepT>=recent[0].t);
  if(!fresh||!impulse||!swept) return [];
  const gaps=frames.M15.gaps.filter(g=>g.type===type&&g.fill<0.85&&g.t>=recent[0].t&&Math.abs(g.ce-price)<=atr*2 && (bullish?g.ce<=price:g.ce>=price));
  const gap=gaps.at(-1);if(!gap)return [];
  const entry=gap.ce;
  const sl=bullish?Math.min(...recent.map(b=>b.l))-atr*.2:Math.max(...recent.map(b=>b.h))+atr*.2;
  const risk=bullish?entry-sl:sl-entry;
  if(!(risk>=3*PIP&&risk<=atr*4))return [];
  const targets=frames.H1.liq.pools.filter(p=>!p.swept && (bullish?p.price>entry+risk*1.5:p.price<entry-risk*1.5)).map(p=>p.price).sort((a,b)=>bullish?a-b:b-a);
  if(!targets.length)return [];
  const t1=targets[0],t2=targets[1]??(bullish?t1+risk:t1-risk);
  return [{id:`ICT-${side}-${event.t}`,model:'ICT sweep + structure + FVG',side,title:'Confirmed sweep / displacement retracement',entry:+entry.toFixed(5),sl:+sl.toFixed(5),t1:+t1.toFixed(5),t2:+t2.toFixed(5),rr:+(Math.abs(t1-entry)/risk).toFixed(2),riskPips:+(risk/PIP).toFixed(1),t1Pips:+(Math.abs(t1-entry)/PIP).toFixed(1),invalid:sl,window:'Kill zone only; fresh quotes required',thesis:'Recent liquidity reclaim, directional structure and displacement; retrace to an unfilled M15 FVG. Paper setup, not a broker order.'}];
}

function predictions(ctx, setups) {
  const {price,frames,bias}=ctx;
  const make=(pack,direction,horizon)=>{
    const up=direction==='UP',down=direction==='DOWN';
    const levels=pack.liq.pools.filter(p=>!p.swept&&(up?p.price>price:down?p.price<price:false)).map(p=>p.price).sort((a,b)=>up?a-b:b-a);
    const target=up?(levels[0]??price+pack.atr):(down?(levels[0]??price-pack.atr):price);
    return {horizon,direction,target,stretch:up?Math.max(levels[1]??target+pack.atr,target):down?Math.min(levels[1]??target-pack.atr,target):price,invalid:up?price-pack.atr:down?price+pack.atr:price,confidence:'—',text:'Conditional structural scenario from closed candles, not a calibrated probability or guaranteed price forecast.'};
  };
  const dir=x=>x==='BULLISH'?'UP':x==='BEARISH'?'DOWN':'RANGE';
  return {intraday:make(frames.H1,dir(bias.shortTerm),'Current session'),day:make(frames.D1,dir(frames.D1.struct.trend),'Next daily session'),swing:make(frames.W1,dir(bias.htf),'Multi-session'),scenarios:[],smt:ctx.smtData,levels:{resistance:frames.H1.liq.pools.filter(p=>p.price>price).map(p=>p.price),support:frames.H1.liq.pools.filter(p=>p.price<price).map(p=>p.price)}};
}
function narrative(ctx,pred,setups,confluence) {
  return {headline:`${ctx.bias.shortTerm} closed-candle structure`,paragraphs:[`EUR/USD ${pad(ctx.price)}. Analysis uses the available venue history; exchange prices may differ from your broker.`,`Range ${pad(ctx.d1r.low)}–${pad(ctx.d1r.high)}; equilibrium ${pad(ctx.d1r.eq)}. Range location is not proof of a buy or sell program.`,`No live economic calendar or macro feed is connected. Check scheduled releases independently; this system cannot certify a news-safe entry.`],bullets:[`HTF: ${ctx.bias.htf}; LTF: ${ctx.bias.shortTerm}`,`PO3: ${ctx.po3.phase}`,`Validated setups: ${setups.length}`,`Confluence ${confluence.score} is a heuristic score, not a win probability.`]};
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


  let shortTerm = h4 === "RANGE" ? h1 : h4;
  if (frames.H1.struct.lastEvent?.kind === "CHOCH") {
    shortTerm = frames.H1.struct.lastEvent.dir === "BEAR" ? "BEARISH" : "BULLISH";
  }
  if (po3?.judas?.side === "BSL" && spot < po3.judas.price - 6 * PIP) shortTerm = "BEARISH";
  if (po3?.judas?.side === "SSL" && spot > po3.judas.price + 6 * PIP) shortTerm = "BULLISH";
  return { htf, shortTerm, votes: { W1: w, D1: d, H4: h4, H1: h1, M30: frames.M30.struct.trend, M15: frames.M15.struct.trend } };
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
      const inTrade = false; // Lifecycle is tracked separately; never infer a fill from spot.
      const atEntry = !dead && !tpHit && toEntry <= 3.2;
      return { s, past, toEntry, toTp, toSl, dead, tpHit, inTrade, atEntry };
    })
    .sort((a, b) => a.toEntry - b.toEntry);

  const pick = ranked.find((r) => !r.dead && !r.tpHit && (!prefer || r.s.side === prefer)) || ranked[0];
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
    status = "INVALID";
    label = "SETUP EXPIRED";
    when = "Bank T1 now";
    note = "Target has passed; no trade fill is inferred. Wait for a new setup.";
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
    setupId: s.id,
    rr: s.rr,
    window: s.window,
  };
}

function nextWindow(kz) {
  const ids=['LONDON','SB_LON','NY_AM','SB_NY','NY_PM','SB_PM'];
  const live=kz.active.find(z=>ids.includes(z.id));
  if(live)return {label:`${live.name} is OPEN (not entry confirmation)`,countdown:'now',id:live.id};
  const now=kz.asOf||Date.now(),p=nyParts(now),candidates=[];
  const starts={LONDON:2,SB_LON:3,NY_AM:7,SB_NY:10,NY_PM:13.5,SB_PM:14};
  for(let day=0;day<8;day++)for(const id of ids){
    const date=new Date(Date.UTC(+p.year,+p.month-1,+p.day+day));
    const wall=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),Math.floor(starts[id]),(starts[id]%1)*60);
    let ts=wall;
    for(let i=0;i<2;i++){const n=nyParts(ts);const shown=Date.UTC(+n.year,+n.month-1,+n.day,+n.hour,+n.minute);ts+=wall-shown;}
    if(ts>now&&forexOpen(ts))candidates.push({ts,id});
  }
  const next=candidates.sort((a,b)=>a.ts-b.ts)[0];
  if(!next)return {label:'No eligible window',countdown:'—',id:null};
  const mins=Math.ceil((next.ts-now)/60000),h=Math.floor(mins/60);
  return {label:`Next ${next.id.replaceAll('_',' ')} window (not a trade ETA)`,countdown:`${h}h ${mins%60}m`,id:next.id};
}

function pickGap(gaps, type, price) {
  const open = (gaps || []).filter((g) => g.type === type && g.fill < 0.85);
  if (!open.length) return null;
  return open.slice().sort((a, b) => Math.abs(a.ce - price) - Math.abs(b.ce - price))[0];
}

function buildSessionLimits(ctx,setups,kz) {
  return ['Daily','Asian','London','New York AM','New York PM'].map((session,i)=>{
    const ids=['DAILY','ASIAN','LONDON','NY_AM','NY_PM'];
    const setup=setups[0], live=i!==1&&forexOpen(ctx.now)&&kz.active.some(z=>z.id===ids[i]);
    return {session,clock:'New York local time',action:setup?(setup.side==='LONG'?'BUY':'SELL'):'FLAT',order:setup?`${setup.side==='LONG'?'BUY':'SELL'} LIMIT (PAPER)`:'NO ORDER',fill:setup?'UNCONFIRMED':'SKIP',live,limit:setup?.entry??null,sl:setup?.sl??null,tp1:setup?.t1??null,tp2:setup?.t2??null,rr:setup?.rr??null,dist:setup?+(Math.abs(setup.entry-ctx.price)/PIP).toFixed(1):null,why:'Reference levels only. No broker fill is inferred; Asian window is observation only.'};
  });
}

export function analyze(market, now = Date.now()) {
  const closed = Object.fromEntries(Object.entries(market.frames).map(([tf,bars])=>[tf,bars.filter(b=>!b.provisional&&b.t+TF_MS[tf]<=now)]));
  const frames = {
    M15: framePack(closed.M15, 2),
    M30: framePack(closed.M30, 2),
    H1: framePack(closed.H1, 2),
    H4: framePack(closed.H4, 3),
    D1: framePack(closed.D1, 2),
    W1: framePack(closed.W1, 1),
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
  const common = closed.D1.filter(b => market.gbpDaily?.some(g => g.t===b.t && g.t+TF_MS.D1<=now));
  const smtData = common.length>=8 ? smt(common,common.map(b=>market.gbpDaily.find(g=>g.t===b.t))) : null;
  const rangeBars=closed.D1.slice(-252);
  const high=Math.max(...rangeBars.map(b=>b.h)),low=Math.min(...rangeBars.map(b=>b.l)),eq=(high+low)/2;
  const d1rYear={high,low,eq,pos:(price-low)/Math.max(high-low,PIP),zone:price>=eq?'PREMIUM':'DISCOUNT'};

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
  const health=marketHealth(market,now);
  const execution = executionFrom(health.ok ? setups : [], price, now, po3, bias, kzNow);
  if(!health.ok) { execution.label="SIGNALS BLOCKED"; execution.note=health.reasons.join(" · "); }
  const limits = buildSessionLimits(ctx, health.ok ? setups : [], kzNow);
  const directions = directionsFrom(frames, price, kzNow);
  const directionHealth=dataHealth(market,now);

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
      M30: frames.M30.struct,
      M15: frames.M15.struct,
    },
    frames,
    pdArrays,
    setups: health.ok ? setups : [],
    health,
    directionHealth,
    execution,
    limits,
    directions,
    predictions: pred,
    narrative: story,
    smt: smtData,
    keyLevels: uniqueLevels([...frames.H1.liq.pools.map(p=>({price:p.price,kind:p.side})),{price:d1rYear.eq,kind:'Rolling range EQ'}]),
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

/* ── Multi-timeframe direction board ─────────────────────────────────────
   Reads the strategy's own structure on M15 / M30 / H1 / H4 / D1 / W1 and
   publishes, per timeframe: direction, confidence, the liquidity draw,
   how long until a trade can be taken (next kill zone) and how long the
   move should take to reach its target (ATR-scaled bar projection). */

const DIR_TF = [
  { tf: "M15", label: "15 MIN", hours: 0.25 },
  { tf: "M30", label: "30 MIN", hours: 0.5 },
  { tf: "H1", label: "1 HOUR", hours: 1 },
  { tf: "H4", label: "4 HOUR", hours: 4 },
  { tf: "D1", label: "1 DAY", hours: 24 },
  { tf: "W1", label: "1 WEEK", hours: 168 },
];

const DIR_KZ_ORDER = ["LONDON", "SB_LON", "NY_AM", "SB_NY", "NY_PM", "SB_PM"];
const DIR_KZ_STARTS = { LONDON: 2, SB_LON: 3, NY_AM: 7, SB_NY: 10, NY_PM: 13.5, SB_PM: 14 };

// Structural magnets used to size each timeframe's next draw.
const DIR_LEVELS = [];

function fmtHours(h) {
  if (h == null || !Number.isFinite(h) || h <= 0) return "—";
  if (h < 1) {
    const m = Math.max(1, Math.round((h * 60) / 5) * 5);
    return m >= 60 ? "~1h" : `~${m}m`;
  }
  const d = Math.floor(h / 24);
  const hh = Math.round(h % 24);
  if (d >= 1) {
    if (hh >= 24) return `~${d + 1}d`;
    return hh === 0 ? `~${d}d` : `~${d}d ${hh}h`;
  }
  return hh <= 0 ? "~1h" : `~${hh}h`;
}

function frameTarget(pack, price, bias) {
  const pools = pack.liq?.pools || [];
  if (bias === "BUY") {
    const cands = [
      ...pools.filter((p) => p.side === "BSL").map((p) => p.price),
      pack.range?.high,
      ...DIR_LEVELS,
    ].filter((p) => p != null && Number.isFinite(p) && p > price + PIP);
    const above = cands.sort((a, b) => a - b)[0];
    return above ?? price + pack.atr;
  }
  if (bias === "SELL") {
    const cands = [
      ...pools.filter((p) => p.side === "SSL").map((p) => p.price),
      pack.range?.low,
      ...DIR_LEVELS,
    ].filter((p) => p != null && Number.isFinite(p) && p < price - PIP);
    const below = cands.sort((a, b) => b - a)[0];
    return below ?? price - pack.atr;
  }
  return pack.range?.eq ?? price;
}

function frameNote(pack, trend, target, bias) {
  const zone = (pack.range?.zone || "equilibrium").toLowerCase();
  const ev = pack.struct?.lastEvent;
  const sig = ev ? ` (${ev.kind} ${ev.dir})` : "";
  const tgt = target != null ? target.toFixed(5) : "equilibrium";
  if (trend === "BULLISH") return `Bullish structure${sig} — drawing ${zone} liquidity toward ${tgt}.`;
  if (trend === "BEARISH") return `Bearish structure${sig} — delivering ${zone} toward ${tgt}.`;
  return `No decisive structure — RANGE / WAIT. No directional entry instruction.`;
}

export function directionsFrom(frames, price, kz) {
  const now=kz?.asOf||Date.now();
  return DIR_TF.map(({tf,label})=>{
    const pack=frames[tf];if(!pack?.bars?.length)return null;
    const bars=pack.bars,last=bars.at(-1),trend=pack.struct.trend;
    const prior=bars[Math.max(0,bars.length-9)],momentum=(last.c-prior.c)/Math.max(pack.atr,PIP);
    const event=pack.struct.lastEvent, eventAge=event?bars.length-1-event.i:Infinity;
    let bias='FLAT',reason='No recent directional structure confirmation';
    if(trend==='BULLISH'&&eventAge<=12&&momentum>.25){bias='BUY';reason='Bullish structure and 8-bar momentum agree';}
    else if(trend==='BEARISH'&&eventAge<=12&&momentum<-.25){bias='SELL';reason='Bearish structure and 8-bar momentum agree';}
    else if(trend!=='RANGE'&&eventAge<=12)reason='Structure / momentum conflict or weak momentum — WAIT';
    if((bias==='BUY'&&pack.struct.lastLow&&price<pack.struct.lastLow.price)||(bias==='SELL'&&pack.struct.lastHigh&&price>pack.struct.lastHigh.price)){bias='FLAT';reason='Live price invalidates the last confirmed swing — wait for candle close';}
    if(last.t+TF_MS[tf]>now||now-(last.t+TF_MS[tf])>TF_MS[tf]+60000){bias='FLAT';reason='Closed-candle analysis stale — WAIT';}
    const target=bias==='FLAT'?null:frameTarget(pack,price,bias);
    const closedAt=last.t+TF_MS[tf];
    return {tf,label,trend,bias,confidence:'not probability-rated',target,targetLabel:target===null?'—':target.toFixed(5),finishHours:null,finishLabel:'Not predictable',entryHours:null,entryLabel:'Separate setup required',closedAt,nextClose:closedAt+TF_MS[tf],momentum:+momentum.toFixed(2),note:reason+'. Direction is not an entry order.'};
  }).filter(Boolean);
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
    { id: "ASIAN", name: "Asian Range", start: 20, end: 2, note: "Build the box. Do not hunt entries." },
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
    asOf: +new Date(now),
    ny: `${get("weekday")} ${get("hour")}:${get("minute")}:${get("second")} NY`,
    hour,
    minute,
    active: forexOpen(+new Date(now)) ? zones.filter(wraps) : [],
    zones: zones.map((z) => ({ ...z, on: forexOpen(+new Date(now)) && wraps(z) })),
  };
}
