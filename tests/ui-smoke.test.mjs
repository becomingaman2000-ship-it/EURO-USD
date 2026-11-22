// Dependency-free DOM/canvas harness. This tests UI boot/render contracts, not browser networking.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('UI boots in blocked/offline mode with all DOM IDs and canvas render paths intact',async()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),elements=new Map(),handlers=new Map(),timers=[];
  const ctx=new Proxy({measureText:()=>({width:50})},{get:(t,k)=>t[k]??(()=>{})});
  for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set('#'+id,{dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},addEventListener(name,fn){handlers.set(id+':'+name,fn);},getContext:()=>ctx,parentElement:{clientWidth:1000,clientHeight:500},querySelector(){return null;},textContent:'',innerHTML:''});
  const original={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout,requestAnimationFrame:globalThis.requestAnimationFrame};
  let boot;
  globalThis.document={querySelector:s=>{assert.ok(elements.has(s),`DOM selector ${s} exists`);return elements.get(s);},querySelectorAll:()=>[],addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')boot=fn;}};
  const storage={getItem:()=>null,setItem(){}};
  globalThis.window={devicePixelRatio:1,addEventListener(){},setTimeout(){},setInterval(){}};
  globalThis.localStorage=globalThis.sessionStorage=storage;
  globalThis.setInterval=(fn)=>{timers.push(fn);return 1;};globalThis.setTimeout=()=>1;globalThis.requestAnimationFrame=fn=>fn();
  globalThis.fetch=async()=>{throw new Error('simulated venue outage');};
  try{
    await import('../js/app.js');assert.equal(typeof boot,'function');boot();
    assert.equal(elements.get('#exState').textContent,'SIGNALS BLOCKED');assert.equal(elements.get('#exEntry').textContent,'—');
    assert.equal(elements.get('#actionWord').textContent,'FLAT');
    assert.match(elements.get('#predGrid').innerHTML,/UNVERIFIED/);
    handlers.get('confirmCalendar:click')();assert.equal(elements.get('#exEntry').textContent,'—');
    handlers.get('resetSignals:click')();assert.equal(elements.get('#exState').textContent,'SIGNALS BLOCKED');
    for(const fn of timers.slice(0,2))fn();
    await new Promise(resolve=>original.setTimeout(resolve,0));
    assert.match(elements.get('#feedStatus').textContent,/blocked|unavailable|stale|required/i);
  }finally{Object.assign(globalThis,original);}
});
