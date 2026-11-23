// Original model families from 1f2f68e, with snapshot prices replaced by observed levels.
// Does NOT compute timeframe direction and does NOT add new sweep/MSS/ATR/RR entry gates.
const PIP=0.0001;
const rounded=n=>n==null?null:+n.toFixed(5);
export function buildOriginalSetups(ctx){
  const {price,bias,po3,d1r,frames}=ctx;
  const m=frames.M15,h=frames.H1;
  const pools=[...(m.liq?.pools||[]),...(h.liq?.pools||[])].filter(p=>!p.swept);
  const range=m.range;
  const gaps=[...h.gaps,...m.gaps].filter(g=>g.fill<.85);
  const bear=gaps.filter(g=>g.type==='BEAR'&&g.ce>=price).sort((a,b)=>Math.abs(a.ce-price)-Math.abs(b.ce-price))[0];
  const bull=gaps.filter(g=>g.type==='BULL'&&g.ce<=price&&g.top<price+40*PIP).sort((a,b)=>Math.abs(a.ce-price)-Math.abs(b.ce-price))[0];
  // Targets must be observed liquidity/range levels, not old constants or invented R multiples.
  const levels=[...pools.map(p=>p.price),range.low,range.high,h.range.low,h.range.high,...(m.struct.swingHighs||[]).map(p=>p.price),...(m.struct.swingLows||[]).map(p=>p.price)];
  const plans=[];
  function add(id,model,side,entry,sl,title,condition,anchor){
    const long=side==='LONG';
    const targets=[...new Set(levels.filter(Number.isFinite).map(rounded))].filter(p=>long?p>Math.max(price,entry)+2*PIP:p<Math.min(price,entry)-2*PIP).sort((a,b)=>long?a-b:b-a);
    const t1=targets[0],t2=targets[1]??null;
    entry=rounded(entry);sl=rounded(sl);
    // Geometry validation is not a minimum reward/risk or volatility strategy filter.
    if(!Number.isFinite(entry)||!Number.isFinite(sl)||!Number.isFinite(t1)||!(long?sl<entry&&entry<t1:sl>entry&&entry>t1))return;
    const risk=Math.abs(entry-sl),reward=Math.abs(t1-entry);
    plans.push({id:`${id}-${anchor}`,model,side,title,entry,sl,t1,t2,rr:+(reward/risk).toFixed(2),invalid:sl,riskPips:+(risk/PIP).toFixed(1),t1Pips:+(reward/PIP).toFixed(1),window:'Observed entry touch in an eligible kill zone; healthy venue quotes required',condition,phase:'WATCHLIST',alignment:(long&&bias.shortTerm==='BEARISH'||!long&&bias.shortTerm==='BULLISH')?'Counter-session reaction plan':'Session-aligned or mixed direction',thesis:`${condition} Current M15/H1 arrays provide the levels. This is a conditional plan, not an observed entry or broker order.`,levelBasis:'Live closed-candle M15/H1 liquidity, gaps and dealing ranges'});
  }
  const anchor=m.bars.at(-1).t;
  // Original ICT 2022 short: bearish short-term bias OR buy-side Judas.
  if(bias.shortTerm==='BEARISH'||po3.judas?.side==='BSL'){
    const entry=bear?.ce??Math.max(price+6*PIP,range.eq);
    const nextBSL=pools.filter(p=>p.side==='BSL'&&p.price>price+2*PIP).sort((a,b)=>a.price-b.price)[0]?.price;
    const stopBase=Math.max(entry,bear?.top??entry,po3.judas?.side==='BSL'?po3.judas.price:entry,nextBSL??range.high);
    add('2022-SHORT','ICT 2022 Model','SHORT',entry,stopBase+1.8*PIP,'Premium continuation / scalp watch','Original bearish-bias or BSL-Judas condition.',bear?.t??anchor);
  }
  // Original discount long. Historical absolute-price alternative is replaced by live discount location.
  const nearSSL=pools.filter(p=>p.side==='SSL'&&p.price<price).sort((a,b)=>b.price-a.price)[0]?.price;
  if(d1r.zone==='DISCOUNT'||Number.isFinite(nearSSL)&&price<=nearSSL+12*PIP){
    const entry=bull?.ce??Math.min(price,range.oteBuy?.[1]??range.eq);
    const demand=Math.min(entry,range.low,bull?.bot??entry);
    add('HTF-LONG','OTE + HTF Discount','LONG',entry,demand-5*PIP,'Discount reaction / scalp watch','Original discount or near-SSL condition (historical 1.1500 reference updated to observed SSL). Watch for the bullish shift described by this model; not a guaranteed reversal.',bull?.t??anchor);
  }
  // Original code arms this family on bullish FVG + bullish HTF; it does not verify breaker overlap.
  if(bull&&bias.htf==='BULLISH'){
    add('UNICORN','Unicorn watch (original family)','LONG',bull.ce,Math.min(range.low,bull.bot)-4*PIP,'Bullish FVG / Unicorn watch','Original bullish-FVG and bullish-HTF condition. Breaker overlap is not independently confirmed; do not describe this as a confirmed Unicorn.',bull.t);
  }
  return plans;
}
