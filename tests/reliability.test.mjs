import test from 'node:test';
import assert from 'node:assert/strict';
import {TF_MS, bucketStart, validBar, normalizeBars, forexOpen, marketHealth, createSignalTracker} from '../js/safety.js';
import {applyTick, loadLiveBook} from '../js/live.js';
import {analyze,executionFrom,killZones} from '../js/ict.js';
import {getMarket,hydrateFromLive} from '../js/data.js';
import {runBacktest} from '../js/backtest.js';
const now=Date.parse('2026-08-14T14:30:00Z');
function fixture(time=now){
  const frames=Object.fromEntries(Object.entries(TF_MS).map(([tf,ms])=>[tf,Array.from({length:80},(_,i)=>{
    const t=bucketStart(time,tf)-(79-i)*ms,c=1.15+Math.sin(i*.7)*.001;
    return {t,o:c-.00005,h:c+.0003,l:c-.0003,c,v:10};
  })]));
  return {meta:{source:'Kraken EUR/USD',instrument:'EUR/USD',synthetic:false,live:true,quoteAt:now,tradeAt:now,historyAt:now,newsCheckedUntil:now+1800000,bid:1.14995,ask:1.15005,spot:1.15},frames,gbpDaily:[]};
}
test('healthy sourced fixture; fail closed on demo, stale, proxy, spread, news, and malformed history',()=>{
  assert.equal(marketHealth(fixture(),now).ok,true);
  for(const patch of [{synthetic:true},{live:false},{instrument:'EUR/USDT'},{tradeAt:now-61000},{quoteAt:now-16000},{historyAt:now-181000},{ask:1.151},{newsCheckedUntil:0}]){
    const m=fixture();Object.assign(m.meta,patch);assert.equal(marketHealth(m,now).ok,false,JSON.stringify(patch));
  }
  const m=fixture();m.frames.H1.at(-1).h=0;assert.equal(marketHealth(m,now).ok,false);
});
test('FX weekends and DST-aware session ranges',()=>{
  for(const date of ['2026-08-15T14:00Z','2026-08-16T14:00Z','2026-08-14T22:00Z']) {assert.equal(forexOpen(Date.parse(date)),false);assert.equal(killZones(Date.parse(date)).active.length,0);}
  assert.equal(forexOpen(Date.parse('2026-08-16T22:00Z')),true);
  for(const [date,start] of [['2026-08-14T14:30Z',Date.parse('2026-08-14T00:00Z')],['2026-01-14T15:30Z',Date.parse('2026-01-14T01:00Z')]]) {
    const time=Date.parse(date),m=fixture(Date.parse(date));m.frames.M15=Array.from({length:160},(_,i)=>({t:time-(159-i)*900000,o:1.15,h:1.151,l:1.149,c:1.15,v:1}));
    const a=analyze(m,time);assert.equal(a.sessions.asian.bars,24);assert.ok(m.frames.M15.some(b=>b.t===start));
  }
});
test('ticks never make invalid OHLC; weekly bucket is Monday; historical duplicates deduplicated',()=>{
  const m=fixture();const ts=Date.now();for(const [tf,ms]of Object.entries(TF_MS))m.frames[tf]=[{t:bucketStart(ts,tf)-ms,o:1.14,h:1.15,l:1.13,c:1.14,v:1}];
  applyTick(m,1.16,ts);for(const bars of Object.values(m.frames))assert.ok(validBar(bars.at(-1)));
  assert.equal(new Date(bucketStart(now,'W1')).getUTCDay(),1);
  const b=m.frames.M15[0];assert.equal(normalizeBars([b,b]).length,1);
});
test('execution does not infer a trade fill from current spot',()=>{
  const s={side:'LONG',entry:1.15,sl:1.145,t1:1.16,t2:1.17,model:'test'};
  assert.notEqual(executionFrom([s],1.155,now,{},{}).status,'IN_TRADE');
});
test('paper tracker requires observation after arming, freezes levels and marks monitoring gaps',()=>{
  const tracker=createSignalTracker(),m=fixture();
  const c={side:'LONG',status:'ENTER',entry:1.15,sl:1.145,t1:1.16,t2:1.17,model:'test'};
  assert.equal(tracker.update(c,m,now).status,'ARM');
  assert.equal(tracker.update(c,m,now+1000).status,'ENTER');
  assert.equal(tracker.update({...c,entry:1.151},m,now+2000).entry,1.15);
  assert.equal(tracker.update(c,m,now+16000).status,'STAND_ASIDE');
  Object.assign(m.meta,{quoteAt:now+17000,tradeAt:now+17000});
  assert.equal(tracker.update(c,m,now+17000).status,'REVIEW');
});
test('paper stop/target events are observed, not guessed from setup regeneration',()=>{
  const tracker=createSignalTracker(),m=fixture(),c={side:'LONG',status:'ENTER',entry:1.15,sl:1.145,t1:1.16,t2:1.17,model:'test'};
  tracker.update(c,m,now);tracker.update(c,m,now+1000);
  m.meta.bid=1.16;m.meta.ask=1.1601;
  assert.equal(tracker.update(c,m,now+2000).status,'TAKE_PROFIT');
});
test('forecasts adapt to translated prices and remain directionally consistent; forming candles excluded',()=>{
  const m=fixture();const a=analyze(m,now);assert.ok(a.frames.M15.bars.every(b=>b.t+TF_MS.M15<=now));
  for(const bars of Object.values(m.frames))for(const b of bars)for(const k of ['o','h','l','c'])b[k]+=.03;
  m.meta.spot+=.03;m.meta.bid+=.03;m.meta.ask+=.03;
  const shifted=analyze(m,now);
  assert.ok(Math.abs(shifted.predictions.day.target-a.predictions.day.target-.03)<1e-8);
  for(const p of [shifted.predictions.intraday,shifted.predictions.day,shifted.predictions.swing])if(p.direction==='UP')assert.ok(p.target>m.meta.spot);else if(p.direction==='DOWN')assert.ok(p.target<m.meta.spot);
});
test('demo is never actionable; demo H1 timestamps unique; no fake GBP fallback',()=>{
  const m=getMarket(),a=analyze(m,now);assert.equal(a.execution.status,'STAND_ASIDE');assert.deepEqual(a.setups,[]);
  assert.equal(new Set(m.frames.H1.map(b=>b.t)).size,m.frames.H1.length);
  const live=fixture();const hydrated=hydrateFromLive(live);assert.deepEqual(hydrated.gbpDaily,[]);assert.equal(hydrated.meta.sma100,undefined);
});
test('replacement backtest rejects synthetic or unsourced market history',()=>{
  assert.throws(()=>runBacktest(),/Genuine historical/);const m=fixture();m.meta.synthetic=true;assert.throws(()=>runBacktest({market:m}),/Genuine historical/);
});
test('live loader requests only Kraken EURUSD plus independent GBPUSD; validates full book',async()=>{
  const originalFetch=globalThis.fetch,originalNow=Date.now,urls=[];Date.now=()=>now;
  globalThis.fetch=async url=>{
    urls.push(url);let result;
    if(url.includes('OHLC')){const interval=+new URL(url).searchParams.get('interval'),ms=interval*60000;
      result={PAIR:Array.from({length:80},(_,i)=>[(bucketStart(now,interval===10080?'W1':Object.keys(TF_MS).find(k=>TF_MS[k]===ms))-(79-i)*ms)/1000,'1.15','1.151','1.149','1.15','1.15','10','2']),last:1};}
    else if(url.includes('Ticker')) result={PAIR:{b:['1.14995'],a:['1.15005']}};
    else result={PAIR:[['1.15','1',now/1000,'b','m','']],last:'1'};
    return {ok:true,json:async()=>({error:[],result})};
  };
  try{const book=await loadLiveBook();assert.ok(book);assert.equal(book.meta.instrument,'EUR/USD');assert.equal(book.meta.tradeAt,now);assert.equal(Object.keys(book.frames).length,6);assert.ok(urls.every(u=>u.startsWith('https://api.kraken.com/')));assert.ok(!urls.some(u=>u.includes('USDT')));}
  finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
test('extreme volatility and missing trading-session bars are explicitly blocked',()=>{
  const m=fixture();m.frames.M15.at(-2).h+=.03;
  assert.ok(marketHealth(m,now).reasons.some(x=>/Volatility|Extreme/.test(x)));
  const gap=fixture();gap.frames.M15.splice(-10,4);
  assert.ok(marketHealth(gap,now).reasons.some(x=>/gap/.test(x)));
});
test('replay accepts supplied sourced fixture without synthetic fallback',()=>{
  const result=runBacktest({market:fixture(),from:'2026-08-14',to:'2026-08-14'});
  assert.equal(result.source,'Kraken EUR/USD');assert.ok(result.equityCurve.length>0);
  assert.ok(result.equityCurve.every(x=>Number.isFinite(x.eq)));
  assert.match(result.executionModel,/simulation/);
});

test('direction data can be healthy while entries are calendar-gated',async()=>{
  const {dataHealth}=await import('../js/safety.js');
  const m=fixture();m.meta.newsCheckedUntil=0;
  assert.equal(dataHealth(m,now).ok,true);assert.equal(marketHealth(m,now).ok,false);
});
test('six directional periods require agreement, expose closed time, and WAIT on conflict',async()=>{
  const {directionsFrom}=await import('../js/ict.js');
  const frames=Object.fromEntries(Object.entries(TF_MS).map(([tf,ms])=>{
    const bars=Array.from({length:40},(_,i)=>({t:bucketStart(now,tf)-(40-i)*ms,c:1.14+i*.0001}));
    return [tf,{bars,atr:.0005,struct:{trend:'BULLISH',lastEvent:{i:38},lastLow:{price:1.13}},liq:{pools:[]},range:{high:1.16,low:1.13,eq:1.145}}];
  }));
  const rows=directionsFrom(frames,1.145,{asOf:now});assert.equal(rows.length,6);assert.ok(rows.every(r=>r.bias==='BUY'&&r.target>1.145&&r.closedAt<=now));
  frames.M15.bars.at(-1).c=1.12;
  assert.equal(directionsFrom(frames,1.145,{asOf:now})[0].bias,'FLAT');
  assert.equal(directionsFrom(frames,1.12,{asOf:now})[1].bias,'FLAT');
});
test('Binance fallback replaces the entire book, labels proxy, and requires explicit acceptance',async()=>{
  const {dataHealth}=await import('../js/safety.js');
  const originalFetch=globalThis.fetch,originalNow=Date.now,urls=[];Date.now=()=>now;
  globalThis.fetch=async url=>{
    urls.push(url);if(url.includes('kraken.com'))throw new Error('Kraken blocked in fixture');
    const u=new URL(url);let result;
    if(u.pathname.endsWith('klines')){
      const tf=({ '15m':'M15','30m':'M30','1h':'H1','4h':'H4','1d':'D1','1w':'W1'})[u.searchParams.get('interval')];
      result=fixture().frames[tf].map(b=>[b.t,b.o,b.h,b.l,b.c,b.v]);
    } else if(u.pathname.endsWith('bookTicker'))result={bidPrice:'1.14995',askPrice:'1.15005'};
    else result=[{price:'1.15',time:now}];
    return {ok:true,json:async()=>result};
  };
  try{
    const book=await loadLiveBook({mode:'AUTO'});
    assert.equal(book.source.id,'BINANCE');assert.equal(book.meta.instrument,'EUR/USDT');assert.equal(book.meta.proxy,true);assert.match(book.meta.source,/PROXY/);
    assert.equal(dataHealth(book,now).ok,true);book.meta.proxyAccepted=false;assert.equal(dataHealth(book,now).ok,false);
    assert.deepEqual(book.gbpDaily,[]);assert.ok(urls.some(u=>u.includes('kraken.com')));assert.ok(urls.filter(u=>u.includes('binance')).every(u=>u.includes('EURUSDT')));
    assert.equal(Object.keys(book.frames).length,6);
    assert.equal(await loadLiveBook({mode:'KRAKEN'}),null);
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
test('source switch cannot inherit an armed or active signal',()=>{
  const m=fixture(),t=createSignalTracker(),c={side:'LONG',status:'ENTER',entry:1.15,sl:1.145,t1:1.16,t2:1.17,model:'test'};
  t.update(c,m,now);assert.equal(t.update(c,m,now+1000).status,'ENTER');
  Object.assign(m.meta,{source:'Binance EUR/USDT · FX PROXY',provider:'BINANCE',instrument:'EUR/USDT',proxy:true,proxyAccepted:true});
  assert.equal(t.update(c,m,now+2000).status,'ARM');
});
test('locally quote-built candles are not promoted to confirmed historical structure',()=>{
  const m=fixture();m.frames.M15.at(-2).provisional=true;
  const a=analyze(m,now);assert.ok(a.frames.M15.bars.every(b=>!b.provisional));
});
test('invalid or geometrically reversed setup cannot arm a live paper signal',()=>{
  const m=fixture(),t=createSignalTracker();
  assert.equal(t.update({side:'LONG',status:'ENTER',entry:1.15,sl:1.16,t1:1.14,t2:1.13,model:'bad'},m,now).status,'INVALID');
});
