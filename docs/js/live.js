/* Complete single-venue books only. Binance is EUR/USDT, NOT broker EUR/USD. */
import { TF_MS, bucketStart, normalizeBars, dataHealth } from './safety.js';
const INTERVALS={M15:15,M30:30,H1:60,H4:240,D1:1440,W1:10080};
const BINANCE_INTERVALS={M15:'15m',M30:'30m',H1:'1h',H4:'4h',D1:'1d',W1:'1w'};
const BINANCE_HOSTS=['https://data-api.binance.vision','https://api.binance.com'];
async function json(url,ms=8000){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),ms);
  try{const res=await fetch(url,{signal:ctrl.signal,cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);return await res.json();}
  finally{clearTimeout(timer);}
}
export async function getJSON(path,ms=8000){
  const j=await json(`https://api.kraken.com/0/public/${path}`,ms);
  if(j.error?.length)throw new Error(j.error.join(', '));
  if(!j.result)throw new Error('Missing Kraken result');return j.result;
}
function checkBars(rows){const bars=normalizeBars(rows);if(bars.length<31)throw new Error('Insufficient venue history');return bars;}
async function krakenCandles(pair,interval){
  const result=await getJSON(`OHLC?pair=${pair}&interval=${interval}`);
  const rows=result[Object.keys(result).find(k=>k!=='last')];
  if(!Array.isArray(rows))throw new Error('Kraken history empty');
  return checkBars(rows.map(r=>({t:+r[0]*1000,o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[6]})));
}
async function krakenQuote(){
  const [ticker,trades]=await Promise.all([getJSON('Ticker?pair=EURUSD'),getJSON('Trades?pair=EURUSD&count=1')]);
  const t=ticker[Object.keys(ticker)[0]],rows=trades[Object.keys(trades).find(k=>k!=='last')],trade=rows?.at(-1);
  if(!t||!trade)throw new Error('Missing Kraken quote/trade');
  return makeQuote(+t.b[0],+t.a[0],+trade[2]*1000);
}
function makeQuote(bid,ask,tradeAt){
  if(!(Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0&&ask>=bid&&Number.isFinite(tradeAt)))throw new Error('Invalid bid/ask or trade timestamp');
  return {bid,ask,spot:(bid+ask)/2,tradeAt,quoteAt:Date.now()};
}
async function binanceCandles(host,interval){
  const rows=await json(`${host}/api/v3/klines?symbol=EURUSDT&interval=${interval}&limit=720`);
  if(!Array.isArray(rows))throw new Error(rows?.msg||'Binance history empty');
  return checkBars(rows.map(r=>({t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[5]})));
}
async function binanceQuote(host){
  if(!BINANCE_HOSTS.includes(host))throw new Error('Unrecognized Binance endpoint');
  const [t,trades]=await Promise.all([json(`${host}/api/v3/ticker/bookTicker?symbol=EURUSDT`),json(`${host}/api/v3/trades?symbol=EURUSDT&limit=1`)]);
  if(!Array.isArray(trades)||!trades.length)throw new Error('Missing Binance trade');
  return makeQuote(+t.bidPrice,+t.askPrice,+trades.at(-1).time);
}
async function buildBook(provider,host){
  const proxy=provider==='BINANCE';
  const pack=await Promise.all(Object.entries(INTERVALS).map(async([tf,i])=>[tf,proxy?await binanceCandles(host,BINANCE_INTERVALS[tf]):await krakenCandles('EURUSD',i)]));
  const frames=Object.fromEntries(pack);
  for(const [tf,bars]of Object.entries(frames))if(bars.filter(b=>b.t+TF_MS[tf]<=Date.now()).length<30)throw new Error(`Insufficient closed ${tf} candles`);
  const gbpDaily=proxy?[]:await krakenCandles("GBPUSD",1440).catch(()=>[]);
  const q=proxy?await binanceQuote(host):await krakenQuote();
  const label=proxy?'Binance EUR/USDT · FX PROXY':'Kraken EUR/USD',d=frames.D1.at(-1);
  const book={source:{id:provider,label,venue:proxy?'stablecoin FX proxy':'exchange FX',apiHost:host},frames,gbpDaily,meta:{...q,provider,instrument:proxy?'EUR/USDT':'EUR/USD',proxy,proxyAccepted:proxy,synthetic:false,live:true,streaming:false,feed:'poll',source:label,venue:proxy?'stablecoin FX proxy':'exchange FX',historyAt:Date.now(),liveAt:q.quoteAt,lastBar:frames.M15.at(-1).t,prevClose:frames.D1.at(-2)?.c||d.o,dayHigh:d.h,dayLow:d.l}};
  const health=dataHealth(book);
  if(!health.ok)throw new Error(health.reasons.join(' · '));
  // SMT is unavailable on the proxy; never fabricate a correlated GBP instrument.
  return book;
}
export async function loadLiveBook({mode='KRAKEN'}={}){
  const errors=[];
  if(mode!=='BINANCE')try{return await buildBook('KRAKEN');}catch(e){errors.push(`Kraken: ${e.message}`);}
  if(mode==='AUTO'||mode==='BINANCE')for(const host of BINANCE_HOSTS)try{return await buildBook('BINANCE',host);}catch(e){errors.push(`Binance: ${e.message}`);}
  loadLiveBook.lastError=errors.join(' | ')||'Invalid feed selection';
  console.warn('Live book unavailable:',loadLiveBook.lastError);return null;
}
export function applyTick(market,price,ts=Date.now()){
  if(!Number.isFinite(price)||price<=0||ts<Date.now()-60000||ts>Date.now()+2000)return false;
  let opened=false;
  for(const tf of Object.keys(TF_MS)){
    const bars=market.frames[tf];if(!bars?.length)continue;
    const last=bars.at(-1),bucket=bucketStart(ts,tf);
    if(bucket===last.t){last.provisional=true;last.c=price;last.h=Math.max(last.h,price);last.l=Math.min(last.l,price);}
    else if(bucket>last.t){bars.push({t:bucket,o:price,h:price,l:price,c:price,v:0,provisional:true});if(bars.length>1200)bars.shift();opened=true;}
  }
  market.meta.spot=price;market.meta.lastBar=market.frames.M15.at(-1).t;
  const day=market.frames.D1.at(-1);market.meta.dayHigh=day.h;market.meta.dayLow=day.l;return opened;
}
export function startStream(market,{onTick,onStatus}){
  let dead=false,busy=false,ticks=0;
  // Capture identity: ticks may never change venue underneath an existing book.
  const provider=market.source?.id||'KRAKEN',host=market.source?.apiHost;
  async function poll(){
    if(dead||busy)return;busy=true;
    try{
      const q=provider==='BINANCE'?await binanceQuote(host):await krakenQuote();if(dead)return;
      Object.assign(market.meta,q,{live:true,streaming:false,feed:'poll',liveAt:q.quoteAt});
      const opened=applyTick(market,q.spot,q.quoteAt);
      onStatus?.({state:'poll',detail:`${market.meta.source} · bid/ask + venue trade time`,source:market.meta.source});
      onTick?.({price:q.spot,ts:q.quoteAt,opened,ticks:++ticks,how:'poll'});
    }catch(e){if(!dead)onStatus?.({state:'offline',detail:`${provider} quote failed: ${e.message}`});}
    finally{busy=false;}
  }
  poll();const timer=setInterval(poll,5000);return()=>{dead=true;clearInterval(timer);};
}
