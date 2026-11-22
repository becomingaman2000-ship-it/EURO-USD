/* Closed-candle research replay of the live analyze() engine.
   Requires explicitly supplied genuine historical EUR/USD bars. Never uses demo fabric.
   Bar-based execution is an approximation, not tick/broker execution verification. */
import { analyze } from './ict.js';
import { TF_MS, normalizeBars, forexOpen, bucketStart } from './safety.js';
export const SPEC={startEquity:500,lots:0.01,pipValuePerLot:10,spreadPips:1,slippagePips:0.2,commissionPerLotSide:3.5};
export function runBacktest(opts={}) {
  const spec={...SPEC,...opts}, market=opts.market;
  if(!market || market.meta?.synthetic!==false || market.meta?.instrument!=='EUR/USD' || !market.meta?.source) throw new Error('Genuine historical EUR/USD candles with source provenance required. Synthetic backtests are disabled.');
  if(!(spec.lots>0&&spec.startEquity>0&&spec.spreadPips>=0&&spec.slippagePips>=0))throw new Error('Invalid execution/cost settings');
  const frames=Object.fromEntries(Object.keys(TF_MS).map(tf=>[tf,normalizeBars(market.frames[tf]||[])]));
  const start=opts.from?Date.parse(opts.from+'T00:00:00Z'):-Infinity,end=opts.to?Date.parse(opts.to+'T23:59:59Z'):Infinity;
  const spread=spec.spreadPips*.0001,slip=spec.slippagePips*.0001,unit=spec.lots*spec.pipValuePerLot;
  const comm=spec.lots*spec.commissionPerLotSide*2;
  let equity=spec.startEquity,peak=equity,maxDD=0,maxDDPct=0,open=null,pending=null;
  const trades=[],equityCurve=[];
  function close(b,px,reason){
    const pips=(open.side==='LONG'?px-open.entry:open.entry-px)/.0001,pnl=pips*unit-comm;
    equity+=pnl;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);maxDDPct=Math.max(maxDDPct,(peak-equity)/peak*100);
    trades.push({...open,exit:px,exitT:b.t,reason,pips,pnl,equity});open=null;
  }
  for(const b of frames.M15){
    if(b.t<start||b.t>end)continue;
    // Only a candidate computed at the previous close may execute at this open.
    if(pending&&!open&&forexOpen(b.t)) {
      const entry=pending.side==='LONG'?b.o+spread/2+slip:b.o-spread/2-slip;
      if(Math.abs(entry-pending.entry)<=1.5*.0001 && (pending.side==='LONG'?entry>pending.sl&&entry<pending.t1:entry<pending.sl&&entry>pending.t1))open={...pending,entry,t:b.t};
    }
    pending=null;
    if(open){
      const long=open.side==='LONG',lo=b.l+(long?-spread/2:spread/2),hi=b.h+(long?-spread/2:spread/2);
      const stop=long?lo<=open.sl:hi>=open.sl,target=long?hi>=open.t1:lo<=open.t1;
      if(stop)close(b,long?Math.min(open.sl,b.o-spread/2)-slip:Math.max(open.sl,b.o+spread/2)+slip,'SL (stop first if ambiguous)');
      else if(target)close(b,open.t1,'TP1');
    }
    const now=b.t+TF_MS.M15;
    const available=Object.fromEntries(Object.entries(frames).map(([tf,bars])=>[tf,bars.filter(x=>x.t+TF_MS[tf]<=now)]));
    if(Object.values(available).some(bars=>bars.length<30))continue;
    // Reconstruct only the known portion of a forming HTF candle from observed M15 bars.
    // Never borrow its eventual high/low/close from the completed historical HTF candle.
    const knownM15=frames.M15.filter(x=>x.t+TF_MS.M15<=now);
    const replayFrames=Object.fromEntries(Object.entries(available).map(([tf,bars])=>{
      const bucket=bucketStart(now-1,tf),part=knownM15.filter(x=>x.t>=bucket);
      if(!part.length||bars.at(-1)?.t===bucket)return [tf,bars];
      return [tf,[...bars,{t:bucket,o:part[0].o,h:Math.max(...part.map(x=>x.h)),l:Math.min(...part.map(x=>x.l)),c:part.at(-1).c,v:part.reduce((s,x)=>s+(x.v||0),0)}]];
    }));
    const daily=replayFrames.D1.at(-1);
    const replay={meta:{synthetic:false,instrument:'EUR/USD',source:market.meta.source,live:true,spot:b.c,bid:b.c-spread/2,ask:b.c+spread/2,quoteAt:now,tradeAt:now,historyAt:now,newsCheckedUntil:now+1,dayHigh:daily.h,dayLow:daily.l,prevClose:daily.o},frames:replayFrames,gbpDaily:(market.gbpDaily||[]).filter(x=>x.t+TF_MS.D1<=now)};
    const analysis=analyze(replay,now);
    // Health in replay uses closed bars, not live forming bars. A 30-bar warmup is required.
    if(!open&&analysis.health.ok&&analysis.execution.status==='ENTER')pending={...analysis.execution};
    equityCurve.push({t:now,eq:equity});
    if(equity<=0)break;
  }
  if(open){const b=frames.M15.filter(b=>b.t<=end).at(-1);close(b,open.side==='LONG'?b.c-spread/2-slip:b.c+spread/2+slip,'End of sample');}
  const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<=0),grossWin=wins.reduce((a,t)=>a+t.pnl,0),grossLoss=-losses.reduce((a,t)=>a+t.pnl,0);
  return {source:market.meta.source,executionModel:'M15 next-open simulation; fixed spread and slippage; no tick fills, historical news filter, or swaps modeled',spec:{startEquity:spec.startEquity,lots:spec.lots,spreadPips:spec.spreadPips,slippagePips:spec.slippagePips,commissionPerLotSide:spec.commissionPerLotSide},equity,profit:equity-spec.startEquity,returnPct:(equity/spec.startEquity-1)*100,maxDD,maxDDPct,trades:trades.length,wins:wins.length,losses:losses.length,winRate:trades.length?wins.length/trades.length*100:0,profitFactor:grossLoss?grossWin/grossLoss:null,tradeList:trades,equityCurve};
}
