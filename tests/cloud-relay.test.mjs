import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Booth } from '../server/engine.mjs';
import { CloudRelay } from '../server/cloud-relay.mjs';
import { CloudBooth } from '../cloud/service.mjs';
import { MemoryStore } from './cloud-memory.mjs';
import { issueSession, csrfFor } from '../cloud/auth.mjs';
const image=await sharp({create:{width:600,height:900,channels:3,background:'#d9e6dc'}}).jpeg().toBuffer();
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-key',BOOTH_ADMIN_PASSWORD:'test-password-12345',BOOTH_SESSION_SECRET:'test-session-secret-12345678901234567890',BOOTH_PUBLIC_URL:'https://booth.example',BOOTH_DEVICE_TOKEN:'test-device-token-12345678901234567890'};
function fixture(t){
  const parent=path.resolve('../../work/relay-tests');mkdirSync(parent,{recursive:true});const root=mkdtempSync(path.join(parent,'helper-'));t.after(()=>{if(path.resolve(root).startsWith(parent+path.sep))rmSync(root,{recursive:true,force:true});});
  const local=new Booth({root,appRoot:process.cwd()});local.state.config.printerName='Test printer';local.state.config.cameraMode='canon';t.after(()=>local.stop());
  const store=new MemoryStore(),cloud=new CloudBooth({env,store,schedule:p=>p.catch(()=>{})});
  let captures=0,prints=0,dropAck=false,dropUpload=false;
  local.captureCanon=async options=>{captures++;return local.captureBuffer(image,options);};
  const fetchImpl=async(url,options={})=>{
    const response=await cloud.handle(new Request(url,options));
    if(response.status===302)return new Response(await store.get(new URL(response.headers.get('location')).pathname.replace('/private/','')),{headers:{'Content-Type':'image/jpeg'}});
    if(dropAck && url.endsWith('/ack')){dropAck=false;throw new Error('Connection lost after server acknowledgment.');}
    if(dropUpload && url.endsWith('/photo')){dropUpload=false;throw new Error('Connection lost after photo upload.');}
    return response;
  };
  const relay=new CloudRelay(local,{fetchImpl,saveToken:async()=>{},loadToken:async()=>env.BOOTH_DEVICE_TOKEN,printers:async()=>['Test printer'],print:async()=>{prints++;}});local.relay=relay;
  relay.config={url:env.BOOTH_PUBLIC_URL,enabled:true};relay.token=env.BOOTH_DEVICE_TOKEN;
  const {session,value}=issueSession('admin',env.BOOTH_SESSION_SECRET),headers={cookie:'booth_admin='+value,'X-Booth-Token':csrfFor(session,env.BOOTH_SESSION_SECRET)};
  const command=async(kind,id=randomUUID(),target=id)=>store.createCommand({id,kind,target,data:{owner:session.subject,options:{requestId:target,review:true,scene:'classic'}}});
  return {local,relay,cloud,store,root,fetchImpl,headers,command,counts:()=>({captures,prints}),dropAck:()=>{dropAck=true;},dropUpload:()=>{dropUpload=true;}};
}
test('Windows capture upload can recover a lost response without another shutter release or local AI generation',async t=>{
  const f=fixture(t);await f.relay.configure({url:env.BOOTH_PUBLIC_URL,token:env.BOOTH_DEVICE_TOKEN,enabled:true});const c=await f.command('capture');f.dropUpload();await f.relay.tick();assert.equal(f.counts().captures,1);assert.equal(f.store.rows.size,1);assert.equal(f.local.state.jobs[0].status,'captured');
  await f.relay.tick();assert.equal(f.counts().captures,1);assert.equal(f.store.cmds.get(c.id).status,'complete');assert.equal(f.local.state.jobs.length,0);
  assert.equal(Object.values(f.relay.ledger)[0].phase,'done');assert(!JSON.stringify(f.relay.view()).includes(env.BOOTH_DEVICE_TOKEN));assert(!readFileSync(f.relay.configFile,'utf8').includes(env.BOOTH_DEVICE_TOKEN));
});
test('Windows print acknowledgment can recover without printing twice, including after a helper restart',async t=>{
  const f=fixture(t),id=randomUUID();await f.cloud.capture(image,{requestId:id,review:true,scene:'classic'},'test-owner');await f.store.enqueue(id,{...f.store.row.config},false);await f.cloud.pump();const c=await f.command('print',randomUUID(),id);
  f.dropAck();await f.relay.tick();assert.equal(f.counts().prints,1);assert.equal(f.store.cmds.get(c.id).status,'complete');
  const restarted=new CloudRelay(f.local,{fetchImpl:f.fetchImpl,loadToken:async()=>env.BOOTH_DEVICE_TOKEN,printers:async()=>[],print:async()=>{throw new Error('Must not print twice');}});restarted.config=f.relay.config;restarted.token=env.BOOTH_DEVICE_TOKEN;await restarted.tick();assert.equal(f.counts().prints,1);assert(restarted.ledger[c.id].acknowledgedAt);
});
test('a helper restart during an uncertain hardware action reports failure and never repeats it',async t=>{
  const f=fixture(t),c=await f.command('print');await f.store.claimCommand();writeFileSync(f.relay.ledgerFile,JSON.stringify({[c.id]:{kind:'print',phase:'executing'}}));
  const restarted=new CloudRelay(f.local,{fetchImpl:f.fetchImpl,printers:async()=>[],print:async()=>{throw new Error('Must not rerun uncertain print');}});restarted.config=f.relay.config;restarted.token=env.BOOTH_DEVICE_TOKEN;await restarted.tick();assert.equal(f.store.cmds.get(c.id).status,'failed');assert.equal(f.counts().prints,0);assert.match(f.store.cmds.get(c.id).data.error,/restarted/);
});
