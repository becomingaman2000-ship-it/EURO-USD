// Dependency-free DOM/canvas harness. This tests UI boot/render contracts, not browser networking.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {TF_MS,bucketStart} from '../js/safety.js';
test('UI boots in blocked/offline mode with all DOM IDs and canvas render paths intact',async()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),elements=new Map(),handlers=new Map(),timers=[];
  const ctx=new Proxy({measureText:()=>({width:50})},{get:(t,k)=>t[k]??(()=>{})});
  for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set('#'+id,{dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},addEventListener(name,fn){handlers.set(id+':'+name,fn);},getContext:()=>ctx,parentElement:{clientWidth:1000,clientHeight:500},querySelector(){return null;},textContent:'',innerHTML:''});
  const original={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout,requestAnimationFrame:globalThis.requestAnimationFrame};
  let boot;
  globalThis.document={querySelector:s=>{assert.ok(elements.has(s),`DOM selector ${s} exists`);return elements.get(s);},querySelectorAll:()=>[],addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')boot=fn;else handlers.set('document:'+name,fn);}};
  const storage={getItem:()=>null,setItem(){}};
  globalThis.window={devicePixelRatio:1,addEventListener:(name,fn)=>handlers.set("window:"+name,fn),setTimeout(){},setInterval(){}};
  globalThis.localStorage=globalThis.sessionStorage=storage;
  globalThis.setInterval=(fn)=>{timers.push(fn);return 1;};globalThis.setTimeout=()=>1;globalThis.requestAnimationFrame=fn=>fn();
  globalThis.fetch=async()=>{throw new Error('simulated venue outage');};
  try{
    await import('../js/app.js');assert.equal(typeof boot,'function');boot();
    assert.equal(elements.get('#exState').textContent,'CONNECTING');
    assert.equal(elements.get('#exEntry').textContent,'—');
    assert.equal(elements.get('#actionWord').textContent,'WAIT');
    assert.equal(elements.has('#confirmCalendar'),false);
    handlers.get('resetSignals:click')();
    assert.match(elements.get('#resetStatus').textContent,/Automatic monitoring continues/);
    assert.equal(elements.get('#mailToggle').checked,true);
    elements.get('#mailToggle').checked=false;handlers.get('mailToggle:change')();
    assert.match(elements.get('#mailStatus').textContent,/OFF/);
    await handlers.get('mailTest:click')();
    assert.equal(elements.get('#mailTest').disabled,false);
    assert.match(elements.get('#mailStatus').textContent,/outage/);
    for(const fn of timers.slice(0,2))fn();
    await new Promise(resolve=>original.setTimeout(resolve,0));
    assert.match(elements.get('#feedStatus').textContent,/blocked|unavailable|stale|required/i);
    assert.equal(elements.get('#exState').textContent,'WAIT — NO LIVE DATA');
    assert.match(elements.get('#systemState').textContent,/Reconnecting/);
    // Simulate network recovery: exercise the entire real loader -> analysis -> UI pipeline.
    globalThis.fetch=async url=>{
      let result;const now=Date.now();
      if(url.includes('OHLC')){
        const minutes=+new URL(url).searchParams.get('interval'),tf=Object.keys(TF_MS).find(k=>TF_MS[k]===minutes*60000);
        result={ZEURZUSD:Array.from({length:80},(_,i)=>{const c=1.15+Math.sin(i*.7)*.001;return [(bucketStart(now,tf)-(79-i)*TF_MS[tf])/1000,c,c+.0003,c-.0003,c,c,10,1];}),last:1};
      }else if(url.includes('Ticker'))result={ZEURZUSD:{b:['1.14995'],a:['1.15005']}};
      else result={ZEURZUSD:[['1.15','1',now/1000,'b','m','']],last:1};
      return {ok:true,json:async()=>({error:[],result})};
    };
    handlers.get('window:online')();
    await new Promise(resolve=>original.setTimeout(resolve,0));
    assert.match(elements.get('#systemState').textContent,/Live/);
    assert.match(elements.get('#systemDetail').textContent,/Kraken EUR\/USD/);
    assert.match(elements.get('#dirGrid').innerHTML,/15 MIN/);
    assert.match(elements.get('#dirGrid').innerHTML,/1 WEEK/);
    assert.doesNotMatch(elements.get('#dirGrid').innerHTML,/UNVERIFIED/);
    assert.doesNotMatch(elements.get('#exNote').textContent,/calendar|30-minute/);
    assert.notEqual(elements.get('#spot').textContent,'—');
    assert.ok(handlers.has('document:visibilitychange'));

  }finally{Object.assign(globalThis,original);}
});
