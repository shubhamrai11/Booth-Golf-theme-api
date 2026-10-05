import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MemoryPortrait } from '../src/memory-portrait.mjs';
import { TemporaryGeneration, temporaryDefaults, defaultReference } from '../server/temporary-generation.mjs';
import { TemporaryHelper } from '../server/temporary-helper.mjs';
import { checkProof, issueProof } from '../server/temporary-auth.mjs';
const pixel=await sharp({create:{width:400,height:600,channels:3,background:'#69aa76'}}).jpeg().toBuffer();
const key='test-only-memory-key',audience='https://booth.example',base='http://127.0.0.1:4314';
async function request({config={mode:'live'},guest=pixel,id=randomUUID(),signed=true,scene='classic'}={}){
  const form=new FormData();form.set('config',JSON.stringify(config));form.set('scene',scene);if(guest)form.set('guest',new Blob([guest]),'guest.jpg');
  const original=new Request(audience+'/api/temporary/generate',{method:'POST',body:form}),body=Buffer.from(await original.arrayBuffer());
  const headers={'Content-Type':original.headers.get('content-type'),'X-Request-Id':id,'Origin':audience};
  if(signed)headers['X-Booth-Proof']=issueProof({id,digest:createHash('sha256').update(body).digest('hex'),audience},key);
  return new Request(original.url,{method:'POST',headers,body});
}
function booth(options={}){return new TemporaryGeneration({key,reference:async()=>pixel,generate:async()=>pixel,...options});}
function memory(){const created=[],revoked=[],published=[],changes=[];const m=new MemoryPortrait({urls:{createObjectURL:blob=>{const u='blob:'+created.length;created.push({u,blob});return u;},revokeObjectURL:u=>revoked.push(u)},publish:v=>published.push(v),changed:j=>changes.push(j)});return {m,created,revoked,published,changes};}
test('one guest lives in RAM, original is released on completion, and clear releases the result',async()=>{
  const {m,created,revoked,published}=memory();const guest=new Blob([pixel]);m.capture(guest);await m.generate(async()=>new Blob([pixel]),'live');
  assert.equal(m.guest,null);assert.equal(m.job.status,'complete');assert.deepEqual(revoked,['blob:0']);assert(published.at(-1).blob instanceof Blob);
  m.clear();assert.equal(m.result,null);assert.equal(m.job,null);assert.deepEqual(revoked,created.map(i=>i.u));assert.equal(published.at(-1),null);
});
test('clear during generation aborts and discards a late result without allocating its URL',async()=>{
  const {m,created,published}=memory();m.capture(new Blob([pixel]));let resolve,signal;
  const pending=m.generate((_guest,s)=>{signal=s;return new Promise(r=>{resolve=r;});},'live');m.clear();resolve(new Blob([pixel]));assert.equal(await pending,false);assert(signal.aborted);assert.equal(created.length,1);assert.equal(m.job,null);assert.equal(published.at(-1),null);
});
test('failed and completed photos cannot be submitted a second time',async()=>{
  const {m}=memory();m.capture(new Blob([pixel]));let calls=0;await assert.rejects(m.generate(async()=>{calls++;throw Error('May have charged');},'live'));
  await assert.rejects(m.generate(async()=>{calls++;return new Blob([pixel]);},'live'),/already submitted/);assert.equal(calls,1);assert.equal(m.job.status,'failed');
});
test('request proofs bind exact image bytes, website, ID, key and expiry',()=>{
  const id=randomUUID(),digest='a'.repeat(64),now=100000;const proof=issueProof({id,digest,audience},key,now);
  assert.equal(checkProof(proof,digest,key,audience,now).id,id);
  for(const args of [[proof,'b'.repeat(64),key,audience,now],[proof,digest,'other',audience,now],[proof,digest,key,'https://other.example',now],[proof,digest,key,audience,now+60000],[proof+'x',digest,key,audience,now]])assert.equal(checkProof(...args),null);
});
test('live images return directly with no cache; duplicate approval cannot repeat the paid call',async()=>{
  let calls=0;const b=booth({generate:async input=>{calls++;assert.equal(input.model,temporaryDefaults.model);assert.match(input.prompt,/identity|facial|face/);return pixel;}}),r=await request();
  const again=r.clone(),response=await b.handle(r);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'image/jpeg');
  const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,1800);
  assert.equal((await b.handle(again)).status,409);assert.equal(calls,1);assert.equal(b.attempts.size,1);assert([...b.attempts.values()].every(x=>typeof x==='number'));
});
test('anonymous rehearsal has no key requirement and never calls AI',async()=>{
  let calls=0;const b=booth({key:'',generate:async()=>{calls++;return pixel;}}),response=await b.handle(await request({config:{mode:'rehearsal'},signed:false}));assert.equal(response.status,200);assert.equal(calls,0);
});
test('unpaired website cannot spend API credits',async()=>{let calls=0;const b=booth({generate:async()=>{calls++;return pixel;}});assert.equal((await b.handle(await request({signed:false}))).status,403);assert.equal(calls,0);});
test('invalid input is rejected before AI approval is consumed',async()=>{
  let calls=0;const b=booth({generate:async()=>{calls++;return pixel;}});
  for(const options of [{guest:null},{guest:Buffer.from('broken-image')},{scene:'unknown'},{config:{mode:'live',model:'invalid'}}])assert.equal((await b.handle(await request(options))).status,400);
  assert.equal(calls,0);assert.equal(b.attempts.size,0);
});
test('deadline too short does not start a paid request',async()=>{let calls=0;const b=booth({getDeadline:()=>new Date(Date.now()+40000),generate:async()=>{calls++;return pixel;}});const r=await b.handle(await request());assert.equal(r.status,503);assert.equal(calls,0);assert.match((await r.json()).error,/No AI request/);});
test('ambiguous AI failure never retries and keeps the provider explanation',async()=>{let calls=0;const b=booth({generate:async()=>{calls++;throw Error('The provider may have charged. No automatic retry was made.');}}),r=await request(),again=r.clone();const response=await b.handle(r);assert.equal(response.status,502);assert.match((await response.json()).error,/may have charged/);assert.equal((await b.handle(again)).status,409);assert.equal(calls,1);});
test('oversize payload and old history/download routes have no storage fallback',async()=>{const b=booth();const r=new Request(audience+'/api/temporary/generate',{method:'POST',headers:{'Content-Length':String(5*1024*1024)},body:'x'});assert.equal((await b.handle(r)).status,413);for(const route of ['/api/state','/api/media/results/test.jpg','/api/qr/test','/download/test'])assert.equal((await b.handle(new Request(audience+route))).status,404);});
test('bundled golf reference is available for a clean deployment',async()=>{const ref=await defaultReference(process.cwd()),meta=await sharp(ref).metadata();assert(meta.width>0&&meta.height>0);});

const testRoot=path.resolve('../../work/test-runs');mkdirSync(testRoot,{recursive:true});
function fixture(t,options={}){
  const root=mkdtempSync(path.join(testRoot,'temporary-helper-'));t.after(()=>{if(root.startsWith(testRoot+path.sep))rmSync(root,{recursive:true,force:true});});
  const helper=new TemporaryHelper({root,appRoot:root,key,generate:async()=>pixel,...options});
  const call=(route,{body,bytes,origin,token=helper.csrf,id=randomUUID(),method=body||bytes?'POST':'GET'}={})=>helper.handle(new Request(base+route,{method,headers:{...(origin?{Origin:origin}:{}),...(origin&&origin!==base?{Authorization:'Bearer '+token}:{'X-Booth-Token':token}),'X-Request-Id':id,'Content-Type':bytes?'image/jpeg':'application/json'},body:bytes|| (body?JSON.stringify(body):undefined)}));
  return {helper,root,call};
}
test('helper exposes no credentials and blocks untrusted cross-origin equipment requests',async t=>{
  const {call}=fixture(t);const r=await call('/api/temporary/info');assert.equal(r.status,200);assert(!(JSON.stringify(await r.json())).includes(key));
  assert.equal((await call('/api/temporary/info',{token:'wrong'})).status,403);
  assert.equal((await call('/api/temporary/print',{origin:'https://evil.example',bytes:pixel})).status,403);
});
test('operator-approved pairing scopes equipment access to the exact HTTPS website',async t=>{
  const {call}=fixture(t);const start=await (await call('/api/temporary/pair/start',{origin:audience,body:{}})).json();
  assert.equal((await call('/api/temporary/pair/approve',{origin:audience,body:{id:start.id}})).status,403);
  await call('/api/temporary/pair/approve',{body:{id:start.id}});
  const pair=await (await call('/api/temporary/pair/status',{origin:audience,body:{id:start.id}})).json();assert(pair.approved);assert(pair.token);
  const response=await call('/api/temporary/info',{origin:audience,token:pair.token});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),audience);
  assert.equal((await call('/api/temporary/info',{origin:'https://other.example',token:pair.token})).status,403);
  assert.equal((await call('/api/temporary/key',{origin:audience,token:pair.token,body:{key:'replacement'}})).status,404);
});
test('capture and print use native pipes with no guest image files, and repeated commands cannot execute',async t=>{
  const calls=[];const {helper,root,call}=fixture(t,{runNative:async(exe,args,input)=>{calls.push({exe,args,input});return args[0]==='-'?Buffer.from('Sent to printer'):pixel;}});
  writeFileSync(path.join(root,'EDSDK.dll'),'mock-sdk');await call('/api/temporary/settings',{body:{sdkPath:root,printerName:'Test printer'}});
  const captureId=randomUUID(),capture=await call('/api/temporary/capture',{body:{},id:captureId});assert.equal(capture.status,200);assert((await capture.arrayBuffer()).byteLength>0);assert.equal(calls[0].args[1],'-');
  assert.equal((await call('/api/temporary/capture',{body:{},id:captureId})).status,409);
  const printId=randomUUID();assert.equal((await call('/api/temporary/print',{bytes:pixel,id:printId})).status,200);assert.equal(calls[1].args[0],'-');assert(calls[1].input instanceof Buffer);
  assert.equal((await call('/api/temporary/print',{bytes:pixel,id:printId})).status,409);assert.equal(calls.length,2);
  const files=readdirSync(root);assert.deepEqual(files.sort(),['EDSDK.dll','command-ids.json','temporary-settings.json']);
  const saved=readFileSync(helper.ledgerFile,'utf8');assert(!saved.includes(pixel.toString('base64')));assert(!saved.includes(key));
});
test('restart preserves only equipment metadata and cannot replay uncertain prints',async t=>{
  let prints=0;const {root,call}=fixture(t,{runNative:async()=>{prints++;throw Error('Lost print confirmation');}});await call('/api/temporary/settings',{body:{printerName:'Test printer'}});const id=randomUUID();assert.equal((await call('/api/temporary/print',{bytes:pixel,id})).status,500);
  const restarted=new TemporaryHelper({root,appRoot:root,key,runNative:async()=>{prints++;return Buffer.from('ok');}});assert.equal(restarted.ledger[id].status,'uncertain');
  const response=await restarted.handle(new Request(base+'/api/temporary/print',{method:'POST',headers:{'X-Booth-Token':restarted.csrf,'X-Request-Id':id},body:pixel}));assert.equal(response.status,409);assert.equal(prints,1);
});
test('local hardware ID ledger signs each AI approval only once and stores no pixels/key/proof',async t=>{
  const {helper,call}=fixture(t);const input={id:randomUUID(),digest:'d'.repeat(64),audience:base};const r=await call('/api/temporary/authorize',{body:input});const {proof}=await r.json();assert(checkProof(proof,input.digest,key,base));assert.equal((await call('/api/temporary/authorize',{body:input})).status,409);const saved=readFileSync(helper.ledgerFile,'utf8');assert(!saved.includes(proof));assert(!saved.includes(key));assert(!saved.includes(input.digest));
});
