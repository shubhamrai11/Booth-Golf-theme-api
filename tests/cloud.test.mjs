import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { CloudBooth } from '../cloud/service.mjs';
import { issueSession, csrfFor, cloudEnvironment } from '../cloud/auth.mjs';
import { MemoryStore } from './cloud-memory.mjs';
const image=await sharp({create:{width:600,height:900,channels:3,background:'#d7e5df'}}).jpeg().toBuffer();
export const testEnv={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-key',BOOTH_ADMIN_PASSWORD:'test-password-12345',BOOTH_SESSION_SECRET:'test-session-secret-12345678901234567890',BOOTH_PUBLIC_URL:'https://booth.example',BOOTH_DEVICE_TOKEN:'test-device-token-12345678901234567890',OPENAI_API_KEY:'test-ai-key'};
function setup(extra={}){const store=new MemoryStore(extra.now),tasks=[];const booth=new CloudBooth({env:testEnv,store,schedule:p=>tasks.push(p),...extra});store.row.config.cameraMode='webcam';const auth=role=>{const {session,value}=issueSession(role,testEnv.BOOTH_SESSION_SECRET,extra.now?.());return {session,headers:{cookie:'booth_'+role+'='+value,'X-Booth-Token':csrfFor(session,testEnv.BOOTH_SESSION_SECRET)}};};const admin=auth('admin');const req=(path,{headers=admin.headers,method='GET',data,buffer}={})=>booth.handle(new Request(testEnv.BOOTH_PUBLIC_URL+path,{method,headers:{...headers,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:buffer?{body:buffer}:{})}));return {store,booth,tasks,auth,admin,req};}
test('cloud secrets remain server-side; login, CSRF, origin and kiosk controls are enforced',async()=>{
  const {req,auth,store}=setup();
  let r=await req('/api/state',{headers:{}});assert.equal(r.status,401);
  r=await req('/api/login',{headers:{},method:'POST',data:{password:'wrong'}});assert.equal(r.status,401);
  r=await req('/api/login',{headers:{},method:'POST',data:{password:testEnv.BOOTH_ADMIN_PASSWORD}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.match(r.headers.get('set-cookie'),/Secure/);
  const kiosk=auth('kiosk');r=await req('/api/settings',{headers:kiosk.headers,method:'POST',data:{prompt:'change'}});assert.equal(r.status,403);
  r=await req('/api/state?view=operator',{headers:kiosk.headers});assert.equal(r.status,401);
  r=await req('/api/state?view=kiosk',{headers:kiosk.headers});const state=await r.json();assert.equal(state.role,'kiosk');assert(!('prompt' in state.config));assert(!JSON.stringify(state).includes(testEnv.OPENAI_API_KEY));assert(!JSON.stringify(state).includes(testEnv.SUPABASE_SERVICE_ROLE_KEY));
  r=await req('/api/settings',{headers:{cookie:kiosk.headers.cookie},method:'POST',data:{}});assert.equal(r.status,403);
  r=await req('/api/login',{headers:{Origin:'https://evil.example'},method:'POST',data:{password:testEnv.BOOTH_ADMIN_PASSWORD}});assert.equal(r.status,403);
  r=await req('/api/kiosk/start',{method:'POST'});assert.match(r.headers.get('set-cookie'),/booth_admin=;/);assert.match(r.headers.get('set-cookie'),/booth_kiosk=/);
  store.logins.set([...store.logins.keys()][0],15);r=await req('/api/login',{headers:{},method:'POST',data:{password:'wrong'}});assert.equal(r.status,429);
  const missing=cloudEnvironment({...testEnv,BOOTH_SESSION_SECRET:'short'});assert(missing.some(s=>s.startsWith('BOOTH_SESSION_SECRET')));
});
test('cloud review captures once, snapshots references, and parallel workers make one paid request',async()=>{
  let calls=0,received;const {req,booth,store,tasks}=setup({generate:async args=>{calls++;received=args;return image;}});
  store.row.config.mode='live';await store.put('assets/golf.jpg',image);store.row.config.reference='golf.jpg';store.row.config.prompt='Identity preserved.';
  const id=randomUUID(),url='/api/capture/webcam?review=true&scene=swing&requestId='+id;
  const responses=await Promise.all([req(url,{method:'POST',buffer:image}),req(url,{method:'POST',buffer:image})]);assert(responses.every(r=>r.status===200));assert.equal(store.rows.size,1);assert.equal(store.files.size,2);assert.equal(calls,0);
  store.row.paused=true;await req('/api/sessions/'+id+'/generate',{method:'POST'});await Promise.all(tasks.splice(0));assert.equal(calls,0);
  store.row.config.prompt='New prompt.';store.row.config.reference='other.jpg';store.row.paused=false;
  await Promise.all([booth.pump(),booth.pump(),booth.pump()]);assert.equal(calls,1);assert.match(received.prompt,/Identity preserved/);assert.match(received.prompt,/golf swing/);assert.equal(received.timeoutMs,240000);assert.deepEqual(received.reference,image);
  const row=await store.job(id);assert.equal(row.status,'complete');assert.equal((await sharp(await store.get(row.data.result)).metadata()).width,1200);
  await req('/api/sessions/'+id+'/generate',{method:'POST'});await Promise.all(tasks);assert.equal(calls,1);
});
test('failed and abandoned paid jobs never auto-retry; only an admin can explicitly retry',async()=>{
  let calls=0,now=Date.now();const {req,booth,store,auth,tasks}=setup({now:()=>now,generate:async()=>{calls++;throw new Error('The AI connection ended or timed out. The provider may have charged.');}});
  store.row.config.mode='live';store.row.config.reference='golf.jpg';await store.put('assets/golf.jpg',image);
  const kiosk=auth('kiosk'),id=randomUUID();await req('/api/capture/webcam?review=true&requestId='+id,{headers:kiosk.headers,method:'POST',buffer:image});
  await req('/api/sessions/'+id+'/generate',{headers:kiosk.headers,method:'POST'});await Promise.all(tasks.splice(0));assert.equal(calls,1);assert.equal((await store.job(id)).status,'failed');
  await Promise.all([booth.pump(),booth.pump()]);assert.equal(calls,1);
  assert.equal((await req('/api/sessions/'+id+'/generate',{headers:kiosk.headers,method:'POST'})).status,400);
  assert.equal((await req('/api/sessions/'+id+'/retry',{headers:kiosk.headers,method:'POST'})).status,403);
  const retryHeaders={...setup().admin.headers};const retryAuth=issueSession('admin',testEnv.BOOTH_SESSION_SECRET,now);Object.assign(retryHeaders,{cookie:'booth_admin='+retryAuth.value,'X-Booth-Token':csrfFor(retryAuth.session,testEnv.BOOTH_SESSION_SECRET),'X-Request-Id':randomUUID()});await req('/api/sessions/'+id+'/retry',{headers:retryHeaders,method:'POST'});await Promise.all(tasks.splice(0));assert.equal(calls,2);await req('/api/sessions/'+id+'/retry',{headers:retryHeaders,method:'POST'});await Promise.all(tasks.splice(0));assert.equal(calls,2);
  const row=store.rows.get(id);row.status='generating';row.worker=randomUUID();row.lease_until=now-1;await booth.pump();assert.equal(row.status,'failed');assert.equal(calls,2);assert.equal(await store.finish(id,row.worker,'complete',row.data),null);
});
test('private photos need authentication or one unexpired guest token; deletion revokes links',async()=>{
  let now=Date.now();const {req,booth,store,auth}=setup({now:()=>now});
  const owner=auth('kiosk'),other=auth('kiosk'),id=randomUUID();await req('/api/capture/webcam?review=true&requestId='+id,{headers:owner.headers,method:'POST',buffer:image});
  assert.equal((await req('/api/media/originals/'+id+'.jpg',{headers:other.headers})).status,404);
  assert.equal((await req('/api/sessions/'+id+'/delete',{headers:other.headers,method:'POST'})).status,403);
  let state=await (await req('/api/state?view=kiosk',{headers:other.headers})).json();assert.equal(state.jobs.length,0);
  store.row.paused=false;await store.enqueue(id,{...store.row.config},false);await booth.pump();const row=await store.job(id);
  assert.equal((await req('/photo/'+row.data.token,{headers:{}})).status,302);
  assert.equal((await req('/p/'+row.data.token,{headers:{}})).status,200);
  assert.equal((await req('/api/media/results/'+id+'.jpg',{headers:{}})).status,401);
  assert.equal((await req('/api/qr/'+id,{headers:owner.headers})).headers.get('content-type'),'image/png');
  now=new Date(row.expires_at).getTime()+1;assert.equal((await req('/photo/'+row.data.token,{headers:{}})).status,404);await booth.cleanup();assert.equal(store.rows.size,0);assert.equal(store.files.size,0);
});
test('Windows device token only grants command access and duplicate print requests queue once',async()=>{
  const {req,booth,store}=setup();const device={Authorization:'Bearer '+testEnv.BOOTH_DEVICE_TOKEN};
  assert.equal((await req('/api/device/next',{headers:{}})).status,401);assert.equal((await req('/api/state',{headers:device})).status,401);
  await req('/api/device/heartbeat',{headers:device,method:'POST',data:{cameraMode:'canon',printerName:'Test printer',printers:['Test printer']}});
  store.row.config.cameraMode='canon';const requestId=randomUUID();await req('/api/capture?review=true&requestId='+requestId,{method:'POST'});
  let c=(await (await req('/api/device/next',{headers:device})).json()).command;assert.equal(c.id,requestId);assert.equal(c.kind,'capture');
  await req('/api/device/commands/'+c.id+'/photo',{headers:device,method:'POST',buffer:image});await req('/api/device/commands/'+c.id+'/photo',{headers:device,method:'POST',buffer:image});assert.equal(store.rows.size,1);
  await req('/api/device/commands/'+c.id+'/ack',{headers:device,method:'POST',data:{ok:true}});
  await store.enqueue(requestId,{...store.row.config},false);await booth.pump();const printId=randomUUID();
  const issue=issueSession('admin',testEnv.BOOTH_SESSION_SECRET);const authHeaders={cookie:'booth_admin='+issue.value,'X-Booth-Token':csrfFor(issue.session,testEnv.BOOTH_SESSION_SECRET),'X-Request-Id':printId};
  const a=await req('/api/sessions/'+requestId+'/print',{headers:authHeaders,method:'POST'}),b=await req('/api/sessions/'+requestId+'/print',{headers:authHeaders,method:'POST'});assert.equal(a.status,200);assert.equal(b.status,200);assert.equal([...store.cmds.values()].filter(c=>c.kind==='print').length,1);
  c=(await (await req('/api/device/next',{headers:device})).json()).command;assert.equal(c.id,printId);
  assert.equal((await req('/api/device/commands/'+printId+'/result',{headers:device})).status,302);
});
test('a lost database completion response cannot delete an already finished portrait',async()=>{
  const {booth,store}=setup(),id=randomUUID();await booth.capture(image,{requestId:id,review:true,scene:'classic'},'test-owner');await store.enqueue(id,{...store.row.config},false);
  const finish=store.finish.bind(store);store.finish=async(...args)=>{const result=await finish(...args);if(args[2]==='complete')throw new Error('Connection lost after commit.');return result;};
  await booth.pump();const row=await store.job(id);assert.equal(row.status,'complete');assert(store.files.has(row.data.result));assert.equal(row.data.outputPaths.length,1);
  await booth.remove(id);assert.equal(store.files.size,0);
});
test('generation respects the invocation deadline and leaves short-budget jobs queued without billing',async()=>{
  const now=Date.now();let remaining=80000,calls=0,budget;const {booth,store}=setup({now:()=>now,getDeadline:()=>new Date(now+remaining),generate:async args=>{calls++;budget=args.timeoutMs;return image;}});
  store.row.config.mode='live';store.row.config.reference='ref.jpg';await store.put('assets/ref.jpg',image);const id=randomUUID();await booth.capture(image,{requestId:id,review:true,scene:'classic'},'test-owner');await store.enqueue(id,{...store.row.config},false);
  await booth.pump();assert.equal(calls,0);assert.equal((await store.job(id)).status,'queued');
  remaining=100000;await booth.pump();assert.equal(calls,1);assert.equal(budget,65000);
});
