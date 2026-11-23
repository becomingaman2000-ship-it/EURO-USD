import test from 'node:test';import assert from 'node:assert/strict';
import {mailEnabled,setMailEnabled,sendTestAlert,sendAlert,maybeNotify}from '../js/notify.js';
test('email switch persists; explicit test is non-trading, rejects service failure, and does not enable alerts',async()=>{
 const originals={localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const data=new Map();globalThis.localStorage=globalThis.sessionStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))};
 const calls=[];globalThis.fetch=async(url,opts)=>{assert.ok(opts.body instanceof URLSearchParams);assert.equal(opts.headers["Content-Type"],undefined);calls.push(Object.fromEntries(opts.body));return {ok:true,status:200,json:async()=>({success:'true'})};};
 try{
  assert.equal(mailEnabled(),true);setMailEnabled(false);assert.equal(mailEnabled(),false);
  const out=await sendTestAlert();assert.equal(out.ok,true);assert.match(calls[0]._subject,/TEST/);assert.equal(calls[0]['Enter at'],'—');assert.equal(calls[0].email,undefined);assert.equal(mailEnabled(),false);
  let status;await maybeNotify({status:'ENTER'},{},(s)=>status=s);assert.equal(status,'off');assert.equal(calls.length,1);
  setMailEnabled(true);await maybeNotify({status:'ARM'},{},()=>{});assert.equal(calls.length,1);
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({success:'false',message:'Activation required'})});
  await assert.rejects(sendTestAlert(),/Activation required/);
  await assert.rejects(sendAlert({status:'WAIT'},{meta:{}}),/observed ENTER/);
  await assert.rejects(sendAlert({status:'ENTER'},{meta:{}}),/Alert blocked/);
 }finally{Object.assign(globalThis,originals);}
});
test('duplicate test taps share a single in-flight submission',async()=>{
 const original=globalThis.fetch;let finish,count=0;
 globalThis.fetch=()=>{count++;return new Promise(r=>finish=r);};
 try{const first=sendTestAlert();assert.equal((await sendTestAlert()).skipped,true);assert.equal(count,1);finish({ok:true,status:200,json:async()=>({success:true})});assert.equal((await first).ok,true);}
 finally{globalThis.fetch=original;}
});
test('unavailable browser storage does not break alert controls',()=>{
 const old=globalThis.localStorage;
 globalThis.localStorage={getItem(){throw new Error('storage unavailable');},setItem(){throw new Error('storage unavailable');}};
 try{setMailEnabled(false);assert.equal(mailEnabled(),false);setMailEnabled(true);assert.equal(mailEnabled(),true);}
 finally{globalThis.localStorage=old;}
});

test('fetch failures and timeouts produce actionable messages without reporting acceptance',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};
  await assert.rejects(sendTestAlert(),/Could not reach.*network.*VPN.*CORS/);
  globalThis.fetch=async()=>{const e=new Error('aborted');e.name='AbortError';throw e;};
  await assert.rejects(sendTestAlert(),/timed out.*Delivery is unknown/);
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>{throw Error('HTML instead of JSON');}});
  await assert.rejects(sendTestAlert(),/did not confirm acceptance/);
 }finally{globalThis.fetch=original;}
});
