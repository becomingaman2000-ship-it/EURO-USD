import test from 'node:test';import assert from 'node:assert/strict';
import {buildOriginalSetups} from '../js/setups.js';
function ctx(){
 const range={low:1.149,high:1.152,eq:1.1505,oteBuy:[1.14963,1.14988,1.15014]};
 const pools=[{side:'BSL',price:1.1508},{side:'BSL',price:1.1516},{side:'SSL',price:1.1495},{side:'SSL',price:1.1485}];
 const m={bars:[{t:1}],atr:.0001,disp:[],range,struct:{trend:'BEARISH',lastEvent:null,swingHighs:[],swingLows:[]},liq:{pools},gaps:[{type:'BULL',ce:1.1498,top:1.1499,bot:1.1497,fill:.2,t:10},{type:'BEAR',ce:1.1503,top:1.1504,bot:1.1502,fill:.2,t:11}]};
 const h={...structuredClone(m),range:{low:1.147,high:1.154,eq:1.1505},struct:{...m.struct,trend:'BULLISH'}};
 return {price:1.15,bias:{shortTerm:'BEARISH',htf:'BULLISH'},po3:{judas:null},d1r:{zone:'DISCOUNT'},frames:{M15:m,H1:h,H4:{struct:{trend:'BULLISH'}}}};
}
test('original three model families return plans without introduced MSS/displacement, H1/H4 veto or minimum RR',()=>{
 const plans=buildOriginalSetups(ctx());assert.equal(plans.length,3);
 assert.deepEqual(plans.map(s=>s.id.split('-').slice(0,-1).join('-')),['2022-SHORT','HTF-LONG','UNICORN']);
 const short=plans.find(s=>s.side==='SHORT');assert.ok(short.rr<1.5);assert.ok(short.riskPips>4);
 for(const s of plans){assert.equal(s.phase,'WATCHLIST');assert.ok(s.side==='LONG'?s.sl<s.entry&&s.entry<s.t1:s.sl>s.entry&&s.entry>s.t1);}
});
test('original activation predicates: BSL Judas can arm short; premium and no bullish HTF do not arm longs',()=>{
 const c=ctx();c.bias={shortTerm:'RANGE',htf:'RANGE'};c.d1r.zone='PREMIUM';
 for(const f of [c.frames.M15,c.frames.H1])f.liq.pools=f.liq.pools.filter(p=>p.side!=='SSL');
 assert.deepEqual(buildOriginalSetups(c),[]);
 c.po3.judas={side:'BSL',price:1.151};
 const p=buildOriginalSetups(c);assert.equal(p.length,1);assert.equal(p[0].side,'SHORT');
});
test('planning prices translate with market levels, not the historic snapshot',()=>{
 const c=ctx(),base=buildOriginalSetups(c);c.price+=.04;
 for(const f of [c.frames.M15,c.frames.H1]){
  for(const k of ['low','high','eq'])f.range[k]+=.04;
  if(f.range.oteBuy)f.range.oteBuy=f.range.oteBuy.map(x=>x+.04);
  for(const g of f.gaps)for(const k of ['ce','top','bot'])g[k]+=.04;
  for(const p of f.liq.pools)p.price+=.04;
 }
 const shifted=buildOriginalSetups(c);assert.equal(base.length,shifted.length);
 for(let i=0;i<base.length;i++)for(const k of ['entry','sl','t1','t2'])assert.ok(Math.abs(shifted[i][k]-base[i][k]-.04)<1e-8);
});
test('no second observed target is not replaced with a made-up risk multiple',()=>{
 const c=ctx();c.bias={shortTerm:'RANGE',htf:'RANGE'};
 c.frames.M15.liq.pools=[];c.frames.H1.liq.pools=[];
 c.frames.H1.range={...c.frames.M15.range};
 const p=buildOriginalSetups(c);assert.equal(p.length,1);assert.equal(p[0].t1,1.152);assert.equal(p[0].t2,null);
});

test('original near-support alternative uses current SSL instead of historical 1.1512 threshold',()=>{
 const c=ctx();c.bias={shortTerm:'RANGE',htf:'RANGE'};c.d1r.zone='PREMIUM';
 const p=buildOriginalSetups(c);assert.equal(p.length,1);assert.ok(p[0].id.startsWith('HTF-LONG'));
});
