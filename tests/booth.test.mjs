import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Booth } from '../server/engine.mjs';
import { createServers } from '../server/http.mjs';
import { generatePortrait } from '../server/provider.mjs';
import { randomUUID } from 'node:crypto';
const testRoot = path.resolve('../../work/test-runs');
mkdirSync(testRoot,{recursive:true});
const photo = await sharp({create:{width:600,height:900,channels:3,background:'#bfd5c7'}}).jpeg().toBuffer();
// Synthetic references keep tests independent of private event artwork.
const appRoot=path.join(testRoot,'synthetic-app');
mkdirSync(path.join(appRoot,'assets'),{recursive:true});
for (const name of ['golf-reference.jpg','golf-outfit-reference.jpg']) writeFileSync(path.join(appRoot,'assets',name),photo);
function boothFor(t,extra={}) {
  const root=mkdtempSync(path.join(testRoot,'booth-'));
  const booth=new Booth({root,appRoot,...extra});
  t.after(()=>{booth.stop();if(root.startsWith(testRoot+path.sep))rmSync(root,{recursive:true,force:true});});
  return booth;
}
async function until(fn) { for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out waiting for test result'); }
test('rehearsal produces a 4x6 result and independent guest links without calling AI',async t=>{
  const booth=boothFor(t,{generate:()=>{throw new Error('Must not call AI in rehearsal');}});
  const a=await booth.captureBuffer(photo),b=await booth.captureBuffer(photo);
  await until(()=>b.status==='complete');
  assert.equal(a.status,'complete');assert.notEqual(a.token,b.token);assert.equal(a.token.length,32);
  const meta=await sharp(booth.file('results',a.id+'.jpg')).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,1800);
  assert.equal(meta.chromaSubsampling,'4:4:4');
});
test('queue snapshots settings and prevents duplicate paid generations',async t=>{
  let calls=0,received; const booth=boothFor(t,{generate:async args=>{calls++;received=args;return photo;}});
  booth.key='test-key';booth.configure({mode:'live',autoGenerate:false,prompt:'Original event prompt'});booth.state.paused=true;
  const job=await booth.captureBuffer(photo);booth.enqueue(job.id);assert.throws(()=>booth.enqueue(job.id),/already/);
  booth.configure({prompt:'Different event prompt'});booth.state.paused=false;await booth.drain();
  assert.equal(calls,1);assert.equal(received.prompt,'Original event prompt');assert.equal(job.status,'complete');
  assert(!readFileSync(path.join(booth.root,'state.json'),'utf8').includes('test-key'));
});
test('failure is visible and does not automatically retry or publish a result',async t=>{
  let calls=0;const booth=boothFor(t,{generate:async()=>{calls++;throw new Error('Simulated connection failure');}});
  booth.key='test-key';booth.configure({mode:'live'});const job=await booth.captureBuffer(photo);await until(()=>job.status==='failed');
  assert.equal(calls,1);assert.match(job.error,/connection/);assert(!existsSync(booth.file('results',job.id+'.jpg')));
});
test('restart flags interrupted jobs for operator review rather than billing again',async t=>{
  const booth=boothFor(t);booth.configure({autoGenerate:false});const job=await booth.captureBuffer(photo);job.status='generating';booth.persist();
  const restarted=new Booth({root:booth.root,appRoot});t.after(()=>restarted.stop());assert.equal(restarted.getJob(job.id).status,'failed');
});
test('provider sends guest first and reference second with high-fidelity model handling',async()=>{
  for(const model of ['gpt-image-2','gpt-image-1.5','gpt-image-2.5-sunburst','gpt-image-2.5-flare']) {
    const newer=model.startsWith('gpt-image-2.5-');
    await generatePortrait({guest:photo,reference:photo,prompt:'Golf',model,size:newer?'1536x2304':'1024x1536',quality:newer?'max':'high',key:'test-key',fetchImpl:async(url,request)=>{
      assert.equal(url,'https://api.openai.com/v1/images/edits');const images=request.body.getAll('image[]');assert.equal(images.length,2);assert.equal(images[0].name,'guest.jpg');assert.equal(images[1].name,'golf-reference.jpg');
      assert.equal(request.body.get('input_fidelity'),model==='gpt-image-1.5'?'high':null);
      assert.equal(request.body.get('output_format'),'png');
      assert(!request.body.get('prompt').includes('IMAGE 3'));
      assert.equal(request.body.get('model'),model);assert.equal(request.body.get('quality'),newer?'max':'high');assert.equal(request.body.get('size'),newer?'1536x2304':'1024x1536');
      return new Response(JSON.stringify({data:[{b64_json:photo.toString('base64')}]}),{status:200});
    }});
  }
});

test('provider adds the optional outfit as image three without changing the guest or scene inputs',async()=>{
  const guest=Buffer.from('guest-image'),reference=Buffer.from('scene-image'),outfitReference=Buffer.from('outfit-image');
  const result=await generatePortrait({guest,reference,outfitReference,prompt:'Golf',model:'gpt-image-2.5-sunburst',size:'1536x2304',quality:'max',key:'test-key',fetchImpl:async(url,request)=>{
    const images=request.body.getAll('image[]');
    assert.deepEqual(images.map(image=>image.name),['guest.jpg','golf-reference.jpg','golf-outfit-reference.jpg']);
    assert.deepEqual(await Promise.all(images.map(async image=>Buffer.from(await image.arrayBuffer()))),[guest,reference,outfitReference]);
    assert.match(request.body.get('prompt'),/IMAGE 3: an additional tailored golf-outfit/);
    assert.equal(request.body.get('n'),'1');
    return new Response(JSON.stringify({data:[{b64_json:photo.toString('base64')}]}),{status:200});
  }});
  assert.deepEqual(result,photo);
});

test('outfit reference API preserves queued templates, protects changes, and keeps removal after restart',async t=>{
  const received=[],booth=boothFor(t),servers=createServers(booth),ports=await servers.listen(0,0);t.after(()=>servers.close());
  booth.key='test-key';booth.configure({mode:'live',autoGenerate:false});booth.state.paused=true;
  const admin='http://127.0.0.1:'+ports.adminPort,guest='http://127.0.0.1:'+ports.guestPort;
  const {token}=await(await fetch(admin+'/api/bootstrap')).json(),headers={'X-Booth-Token':token};
  const initial=booth.state.config.outfitReference;assert(existsSync(booth.file('assets',initial)));
  assert.equal((await fetch(admin+'/api/outfit-reference',{method:'POST',body:photo})).status,403);
  assert.equal((await fetch(admin+'/api/outfit-reference',{method:'DELETE'})).status,403);
  assert.equal((await fetch(guest+'/api/outfit-reference',{method:'POST',headers,body:photo})).status,405);
  assert.equal((await fetch(admin+'/api/outfit-reference',{method:'POST',headers,body:'invalid image'})).status,400);
  assert.equal(booth.state.config.outfitReference,initial);
  const upload=await fetch(admin+'/api/outfit-reference',{method:'POST',headers,body:photo});assert.equal(upload.status,200);
  const {name}=await upload.json(),savedBytes=readFileSync(booth.file('assets',name));
  assert.equal(booth.state.config.outfitReference,name);
  assert.equal((await fetch(admin+'/api/media/assets/'+name+'?thumb=1')).headers.get('content-type'),'image/jpeg');
  const queued=await booth.captureBuffer(photo);booth.enqueue(queued.id);
  const replacement=await fetch(admin+'/api/outfit-reference',{method:'POST',headers,body:readFileSync(booth.file('assets',initial))});
  assert.equal(replacement.status,200);assert.notEqual((await replacement.json()).name,name);
  assert.equal((await fetch(admin+'/api/outfit-reference',{method:'DELETE',headers})).status,200);
  assert.equal(booth.state.config.outfitReference,'');assert(existsSync(booth.file('assets',name)));assert.equal(queued.snapshot.outfitReference,name);
  booth.stop();
  const restarted=new Booth({root:booth.root,appRoot,generate:async args=>{received.push(args);return photo;}});t.after(()=>restarted.stop());
  restarted.key='test-key';assert.equal(restarted.state.config.outfitReference,'');restarted.state.paused=false;await restarted.drain();
  assert.equal(restarted.getJob(queued.id).status,'complete');assert.deepEqual(received[0].outfitReference,savedBytes);
  const next=await restarted.captureBuffer(photo);restarted.enqueue(next.id);await until(()=>next.status==='complete');
  assert.equal(received.length,2);assert.equal(received[1].outfitReference,undefined);
});

test('existing installations gain the bundled outfit but older queued snapshots keep their two inputs',async t=>{
  let received;const booth=boothFor(t);booth.key='test-key';booth.configure({mode:'live',autoGenerate:false});booth.state.paused=true;
  const job=await booth.captureBuffer(photo);booth.enqueue(job.id);
  delete booth.state.config.outfitReference;delete job.snapshot.outfitReference;booth.persist();booth.stop();
  const restarted=new Booth({root:booth.root,appRoot,generate:async args=>{received=args;return photo;}});t.after(()=>restarted.stop());
  assert.equal(restarted.state.config.outfitReference,'golf-outfit-reference.jpg');
  restarted.key='test-key';restarted.state.paused=false;await restarted.drain();
  assert.equal(restarted.getJob(job.id).status,'complete');assert.equal(received.outfitReference,undefined);
});

test('Sunburst defaults support maximum detail while incompatible legacy combinations are rejected',async t=>{
  const booth=boothFor(t);
  assert.equal(booth.state.config.model,'gpt-image-2.5-sunburst');assert.equal(booth.state.config.quality,'max');assert.equal(booth.state.config.size,'1536x2304');
  assert.throws(()=>booth.configure({model:'gpt-image-2'}),/quality setting/);
  assert.throws(()=>booth.configure({model:'gpt-image-1.5',quality:'high'}),/image size/);
  booth.configure({model:'gpt-image-1.5',quality:'high',size:'1024x1536'});
  assert.throws(()=>booth.configure({quality:'max'}),/quality setting/);
  booth.configure({model:'gpt-image-2.5-sunburst',quality:'max',size:'1536x2304',autoGenerate:false});
  const job=await booth.captureBuffer(photo);booth.state.paused=true;booth.enqueue(job.id);
  booth.configure({model:'gpt-image-2',quality:'high'});
  assert.equal(job.snapshot.model,'gpt-image-2.5-sunburst');assert.equal(job.snapshot.quality,'max');assert.equal(job.snapshot.size,'1536x2304');
});
test('operator API rejects cross-origin commands; guest listener exposes only token-scoped finished photos',async t=>{
  const booth=boothFor(t),servers=createServers(booth),ports=await servers.listen(0,0);t.after(()=>servers.close());
  const admin='http://127.0.0.1:'+ports.adminPort,guest='http://127.0.0.1:'+ports.guestPort;
  let r=await fetch(admin+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
  r=await fetch(admin+'/api/state',{headers:{Origin:'https://example.com'}});assert.equal(r.status,403);
  r=await fetch(guest+'/api/state');assert.equal(r.status,404);
  r=await fetch(guest+'/api/capture',{method:'POST'});assert.equal(r.status,405);
  const job=await booth.captureBuffer(photo);await until(()=>job.status==='complete');
  r=await fetch(guest+'/p/'+job.token);assert.equal(r.status,200);assert.match(await r.text(),/Download photo/);
  r=await fetch(guest+'/download/'+job.token);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.match(r.headers.get('content-disposition'),/attachment/);
  r=await fetch(admin+'/api/qr/'+job.id);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
  job.expiresAt=new Date(Date.now()-1000).toISOString();r=await fetch(guest+'/p/'+job.token);assert.equal(r.status,404);
  booth.expire();assert(!existsSync(booth.file('originals',job.id+'.jpg')));
});
test('camera folder waits for completed files and ignores pre-existing photos',async t=>{
  const booth=boothFor(t);const watch=mkdtempSync(path.join(testRoot,'camera-'));t.after(()=>{if(watch.startsWith(testRoot+path.sep))rmSync(watch,{recursive:true,force:true});});
  writeFileSync(path.join(watch,'old.jpg'),photo);booth.configure({watchFolder:watch,watchEnabled:true,autoGenerate:false});await booth.scanFolder();assert.equal(booth.state.jobs.length,0);
  writeFileSync(path.join(watch,'new.jpg'),photo);await booth.scanFolder();assert.equal(booth.state.jobs.length,0);
  booth.seen.get('new.jpg').stableSince-=2000;await booth.scanFolder();assert.equal(booth.state.jobs.length,1);await booth.scanFolder();assert.equal(booth.state.jobs.length,1);
});
test('Canon capture fails clearly without a licensed SDK and invalid images are rejected',async t=>{
  const booth=boothFor(t);await assert.rejects(booth.captureCanon(),/EDSDK/);await assert.rejects(booth.captureBuffer(Buffer.from('not an image')));
  assert.throws(()=>booth.configure({downloadBaseUrl:'javascript:alert(1)'}));assert.throws(()=>booth.configure({mode:'live'}),/API key/);
});
test('scene selections are per guest, snapshots preserve identity instructions, and duplicate captures cannot create two jobs',async t=>{
  const booth=boothFor(t);booth.configure({autoGenerate:false,prompt:'Preserve IMAGE 1 identity; use IMAGE 2 only for the setting.'});
  const requestId=randomUUID();
  const [first,duplicate]=await Promise.all([booth.captureBuffer(photo,{scene:'swing',requestId}),booth.captureBuffer(photo,{scene:'swing',requestId})]);
  assert.equal(first.id,duplicate.id);assert.equal(booth.state.jobs.length,1);
  booth.state.paused=true;booth.enqueue(first.id);
  assert.match(first.snapshot.prompt,/Preserve IMAGE 1 identity/);assert.match(first.snapshot.prompt,/golf swing/);
  assert.equal(first.captureRequestId,requestId);assert.equal(first.scene,'swing');
  const classic=await booth.captureBuffer(photo,{scene:'classic',requestId:randomUUID()});booth.enqueue(classic.id);
  assert.equal(classic.snapshot.prompt,booth.state.config.prompt);
  await assert.rejects(booth.captureBuffer(photo,{scene:'unknown'}),/available golf scenes/);
});
test('folder capture associates only the armed guest with the selected scene',async t=>{
  const booth=boothFor(t),watch=mkdtempSync(path.join(testRoot,'scene-camera-'));
  t.after(()=>{if(watch.startsWith(testRoot+path.sep))rmSync(watch,{recursive:true,force:true});});
  booth.configure({autoGenerate:true,watchFolder:watch,watchEnabled:true});
  const requestId=randomUUID();booth.armFolderCapture({scene:'trophy',requestId,review:true});
  assert.throws(()=>booth.armFolderCapture({scene:'cart',requestId:randomUUID()}),/Another guest/);
  writeFileSync(path.join(watch,'guest.jpg'),photo);await booth.scanFolder();booth.seen.get('guest.jpg').stableSince-=2000;await booth.scanFolder();
  const job=booth.state.jobs[0];assert.equal(job.captureRequestId,requestId);assert.equal(job.scene,'trophy');assert.equal(booth.pendingCapture,null);
  await booth.drain();assert.equal(job.status,'captured');
});

test('guest review defers paid generation; retake costs nothing and approval generates once',async t=>{
  let calls=0;const booth=boothFor(t,{generate:async()=>{calls++;return photo;}});
  booth.key='test-key';booth.configure({mode:'live',cameraMode:'webcam',autoGenerate:true});
  const servers=createServers(booth),ports=await servers.listen(0,0);t.after(()=>servers.close());
  const base='http://127.0.0.1:'+ports.adminPort;
  const {token}=await(await fetch(base+'/api/bootstrap')).json(),headers={'X-Booth-Token':token};
  const capture=async(requestId)=>{
    const response=await fetch(base+'/api/capture/webcam?scene=classic&review=true&requestId='+requestId,{method:'POST',headers,body:photo});
    assert.equal(response.status,200);return response.json();
  };
  const rejected=await capture(randomUUID());await booth.drain();assert.equal(calls,0);assert.equal(rejected.status,'captured');
  const deletion=await fetch(base+'/api/sessions/'+rejected.id+'/delete',{method:'POST',headers});assert.equal(deletion.status,200);
  assert(!existsSync(booth.file('originals',rejected.id+'.jpg')));assert.equal(calls,0);
  const requestId=randomUUID(),accepted=await capture(requestId);
  assert.equal((await capture(requestId)).id,accepted.id);assert.equal(calls,0);
  const approval=await fetch(base+'/api/sessions/'+accepted.id+'/generate',{method:'POST',headers});assert.equal(approval.status,200);
  await until(()=>booth.getJob(accepted.id).status==='complete');assert.equal(calls,1);
  const duplicate=await fetch(base+'/api/sessions/'+accepted.id+'/generate',{method:'POST',headers});assert.equal(duplicate.status,400);assert.equal(calls,1);
  const invalid=await fetch(base+'/api/capture/webcam?review=invalid',{method:'POST',headers,body:photo});assert.equal(invalid.status,400);assert.equal(calls,1);
});
