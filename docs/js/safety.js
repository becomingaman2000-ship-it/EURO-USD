// Shared market clock, data validation and fail-closed signal policy.
export const TF_MS = { M15: 900000, M30: 1800000, H1: 3600000, H4: 14400000, D1: 86400000, W1: 604800000 };
const nyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clockCache = new Map();
export function nyParts(ts) {
  const key=Math.floor(ts/60000);
  if(clockCache.has(key))return clockCache.get(key);
  const result=Object.fromEntries(nyFormatter.formatToParts(new Date(ts)).map(p=>[p.type,p.value]));
  if(clockCache.size>20000)clockCache.clear();clockCache.set(key,result);return result;
}
export function forexOpen(ts) {
  const p = nyParts(ts), h = +p.hour + +p.minute / 60;
  return p.weekday !== 'Sat' && !(p.weekday === 'Sun' && h < 17) && !(p.weekday === 'Fri' && h >= 17) && !(h >= 17 && h < 17.0833334);
}
export function bucketStart(ts, tf) {
  // Kraken weeks start on Monday, not the Unix epoch's Thursday.
  const offset = tf === 'W1' ? 4 * 86400000 : 0;
  return Math.floor((ts - offset) / TF_MS[tf]) * TF_MS[tf] + offset;
}
export function validBar(b) {
  return ['t','o','h','l','c'].every(k => Number.isFinite(b[k])) && b.l > 0 && b.h >= Math.max(b.o,b.c) && b.l <= Math.min(b.o,b.c);
}
export function normalizeBars(bars) {
  const sorted = [...bars].sort((a,b) => a.t-b.t);
  const map = new Map();
  for (const b of sorted) { if (!validBar(b)) throw new Error('Invalid OHLC candle'); map.set(b.t, {...b}); }
  return [...map.values()];
}
export function dataHealth(market, now = Date.now()) {
  const meta = market.meta || {};
  const reasons = [];
  const acceptedProxy=meta.instrument==='EUR/USDT' && meta.proxy===true && meta.proxyAccepted===true && meta.provider==='BINANCE';
  if (!meta.live || meta.synthetic || !(meta.instrument==='EUR/USD'||acceptedProxy) || !meta.source) reasons.push('Verified EUR/USD feed or explicitly accepted EUR/USDT proxy required');
  if (!Number.isFinite(meta.quoteAt) || now-meta.quoteAt > 15000 || meta.quoteAt > now+2000) reasons.push('Executable quote stale or unavailable');
  if (!Number.isFinite(meta.tradeAt) || now-meta.tradeAt > 60000 || meta.tradeAt > now+2000) reasons.push('Recent venue trade required (maximum age 60 seconds)');
  const spread = (meta.ask-meta.bid)/0.0001;
  if (!(meta.bid > 0 && meta.ask >= meta.bid) || !Number.isFinite(spread) || spread > 2) reasons.push('Spread unavailable or above 2 pips');
  for (const [tf,ms] of Object.entries(TF_MS)) {
    const bars = market.frames?.[tf];
    if (!bars || bars.length < 30 || !bars.every(validBar) || bars.some((b,i) => i && b.t <= bars[i-1].t)) { reasons.push(`${tf} history invalid or insufficient`); continue; }
    if(tf==='M15') {
      const tail=bars.slice(-16);
      if(tail.some((b,i)=>i&&b.t-tail[i-1].t>2*ms&&forexOpen(tail[i-1].t+ms)&&forexOpen(b.t-ms)))reasons.push('M15 history has an unfilled trading-session gap');
    }
    const latest = bars.at(-1);
    if (latest.t > now || now-latest.t > ms+60000) reasons.push(`${tf} history stale`);
  }
  if (!meta.historyAt || now-meta.historyAt > 180000) reasons.push('History refresh overdue');
  return {ok:reasons.length===0,reasons,spreadPips:Number.isFinite(spread)?+spread.toFixed(2):null,proxy:acceptedProxy};
}
export function marketHealth(market,now=Date.now()) {
  const data=dataHealth(market,now),reasons=[...data.reasons],meta=market.meta||{};
  if(!forexOpen(now))reasons.push('FX market closed / rollover');
  // News is explicitly unverified, not a manual time-lock masquerading as a data check.
  return {...data,ok:reasons.length===0,reasons};
}

// Paper signal lifecycle only. Never implies a broker order was submitted or filled.
export function createSignalTracker() {
  let pending = null, active = null, previousAt = 0, identity=null;
  return { reset() { pending = active = null; previousAt = 0; identity=null; }, update(candidate, market, now = Date.now()) {
    const nextIdentity=`${market.meta.provider||market.meta.source}:${market.meta.instrument}`;
    if(identity!==null&&identity!==nextIdentity){pending=active=null;previousAt=0;}identity=nextIdentity;
    const health = marketHealth(market, now);
    const base = {...candidate};
    const result = (status,label,note, extra={}) => ({...base,...extra,status,label,note});
    if (!health.ok) { if(active) active.uncertain=true; pending = null; previousAt = 0; return result('STAND_ASIDE','SIGNALS BLOCKED',health.reasons.join(' · '),{side:'FLAT',entry:null,sl:null,t1:null,t2:null,health}); }
    const gap = previousAt && now-previousAt > 15000; previousAt = now;
    if (active) {
      Object.assign(base,active);
      if (gap || active.uncertain) { active.uncertain = true; return result('REVIEW','PAPER SIGNAL — REVIEW','Monitoring gap: stop/target path is unknown. Reset monitoring before tracking a new signal.'); }
      const px = active.side === 'LONG' ? market.meta.bid : market.meta.ask;
      const stopped = active.side === 'LONG' ? px <= active.sl : px >= active.sl;
      const target = active.side === 'LONG' ? px >= active.t1 : px <= active.t1;
      if (stopped || target) { const closed = {...active}; active = null; pending = null; return result(stopped?'INVALID':'TAKE_PROFIT',stopped?'PAPER STOP REACHED':'PAPER TARGET REACHED','Observed quote reached the paper signal level; not a broker fill.',closed); }
      return result('IN_TRADE','PAPER SIGNAL — TRACKING','An entry touch was observed after arming. This is not confirmation of a broker trade.');
    }
    if (!candidate || !candidate.entry || candidate.side === 'FLAT') { pending = null; return base; }
    const geometry=['entry','sl','t1'].every(k=>Number.isFinite(candidate[k])) && (candidate.side==='LONG'?candidate.sl<candidate.entry&&candidate.entry<candidate.t1&&(candidate.t2==null||Number.isFinite(candidate.t2)&&candidate.t1<candidate.t2):candidate.side==='SHORT'&&candidate.sl>candidate.entry&&candidate.entry>candidate.t1&&(candidate.t2==null||Number.isFinite(candidate.t2)&&candidate.t1>candidate.t2));
    if(!geometry||!['ENTER','ARM','WAIT'].includes(candidate.status)){pending=null;return result('INVALID','NO VALID ENTRY','Invalid or expired setup; monitoring will not infer an entry.');}
    const key = `${candidate.setupId||candidate.model}-${candidate.side}`;
    if (!pending || pending.key !== key || now-pending.at > 3600000 || gap) {
      pending = {...candidate,key,at:now};
      return result('ARM','SETUP WATCH — NOT AN ENTRY','Levels are armed for observation. Wait for an entry touch in an eligible window; no historical fill is inferred.');
    }
    Object.assign(base,pending);
    const px = pending.side === 'LONG' ? market.meta.ask : market.meta.bid;
    const invalid = pending.side === 'LONG' ? px <= pending.sl || px >= pending.t1 : px >= pending.sl || px <= pending.t1;
    if (invalid) { pending=null; return result('INVALID','SETUP EXPIRED','Stop or target reached before a valid observed entry touch.'); }
    if (candidate.status === 'ENTER' && Math.abs(px-pending.entry) <= 3.2*0.0001) {
      active = {...pending,triggeredAt:now}; pending=null;
      return result('ENTER',`PAPER ${active.side} TRIGGER`,'Entry touch observed during the permitted window. Confirm independently with your broker.',active);
    }
    return result('WAIT','WAIT FOR ENTRY TOUCH','Waiting for an observed entry touch during a permitted window.');
  }};
}
