// Real-network diagnostic, deliberately separate from deterministic regression tests.
import { writeFileSync, appendFileSync } from 'node:fs';
import { loadLiveBook, getJSON } from '../js/live.js';
import { dataHealth, forexOpen } from '../js/safety.js';
const report={checkedAt:new Date().toISOString(),fxMarketOpen:forexOpen(Date.now()),regressionTests:'Run separately with npm test',liveFeedVerified:false,predictionAccuracy:'Not established by connectivity or regression tests'};
try{
  const [ticker,trades]=await Promise.all([getJSON('Ticker?pair=EURUSD'),getJSON('Trades?pair=EURUSD&count=1')]);
  const key=Object.keys(ticker)[0],t=ticker[key],rows=trades[Object.keys(trades).find(k=>k!=='last')];
  const tradeAt=+rows.at(-1)[2]*1000;
  report.kraken={reachable:true,pairKey:key,bid:+t.b[0],ask:+t.a[0],spreadPips:(+t.a[0]-+t.b[0])/.0001,tradeAgeSeconds:Math.round((Date.now()-tradeAt)/1000)};
}catch(e){report.kraken={reachable:false,error:e.message};}
const book=await loadLiveBook({mode:'AUTO'});
if(book){
  const health=dataHealth(book);
  report.liveFeedVerified=health.ok;
  report.feed={source:book.meta.source,instrument:book.meta.instrument,proxy:book.meta.proxy,bid:book.meta.bid,ask:book.meta.ask,tradeAgeSeconds:Math.round((Date.now()-book.meta.tradeAt)/1000),health,candles:Object.fromEntries(Object.entries(book.frames).map(([tf,bars])=>[tf,{count:bars.length,lastBar:new Date(bars.at(-1).t).toISOString()}]))};
}else report.feed={verified:false,error:loadLiveBook.lastError};
report.note='A GitHub runner check does not verify phone-browser CORS or regional access. Binance EUR/USDT is not Pepperstone EUR/USD. Closed/stale FX data must not generate entries.';
writeFileSync('live-feed-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Live feed diagnostic\n\nFull fresh feed verified: **${report.liveFeedVerified}**\n\nKraken reachable: **${report.kraken.reachable}**\n\nFX hours open: **${report.fxMarketOpen}**\n\n\`\`\`json\n${JSON.stringify(report,null,2)}\n\`\`\`\n`);
// A successful workflow means the diagnostic completed, not necessarily that the feed is fresh.
