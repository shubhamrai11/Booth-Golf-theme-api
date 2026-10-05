import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { normalizeImage, normalizeOverlay, composePortrait } from '../server/media.mjs';
import { generatePortrait } from '../server/provider.mjs';
import { captureOptions, scenePrompt } from '../shared/scenes.mjs';
import { cloudDefaults, settingsPatch } from './settings.mjs';
import { cloudEnvironment, equal, issueSession, readSession, csrfFor, cookie } from './auth.mjs';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = (data,status=200) => Response.json(data,{status});
const failure = (message,status=400) => Object.assign(new Error(message),{status});
const viewJob = row => { const data=Object.fromEntries(['token','scene','captureRequestId','error','mode','completedAt','startedAt','eventName','lastPrintedAt'].filter(k=>k in row.data).map(k=>[k,row.data[k]]));return { ...data, id:row.id, status:row.status, createdAt:row.created_at, expiresAt:row.expires_at }; };
async function bytes(request, limit=4*1024*1024) {
  if (Number(request.headers.get('content-length')) > limit) throw failure('Photo is too large. Use a JPEG below 4 MB.',413);
  const reader = request.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const chunks=[]; let size=0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size+=value.length;
    if (size>limit) { await reader.cancel(); throw failure('Photo is too large. Use a JPEG below 4 MB.',413); } chunks.push(value);
  }
  return Buffer.concat(chunks);
}
const body = async request => { try { return JSON.parse((await bytes(request,200000)).toString() || '{}'); } catch(e) { if (e.status) throw e; throw failure('Invalid request.'); } };

export class CloudBooth {
  constructor({ env, store, generate=generatePortrait, schedule=p=>p.catch(()=>{}), now=()=>Date.now(), getDeadline=()=>undefined }) {
    this.env=env; this.store=store; this.generate=generate; this.schedule=schedule; this.now=now;
    this.getDeadline=getDeadline;
    this.base=(env.BOOTH_PUBLIC_URL || '').replace(/\/$/,'');
    this.timeoutSeconds=Math.max(30,Math.min(720,Number(env.BOOTH_AI_TIMEOUT_SECONDS) || 240));
  }
  async settings() { const row=await this.store.settings(); if (!row) throw failure('Run cloud/schema.sql in Supabase first.',503); return { ...row, config:{...cloudDefaults,...row.config} }; }
  kick() { this.schedule(this.pump().catch(()=>{})); }
  async pump() {
    // Each invocation owns at most one paid call. Its persisted lease is never re-queued automatically.
    const invocationDeadline=this.getDeadline()?.getTime() ?? Infinity;
    if (invocationDeadline-this.now()<90000) return;
    const worker=randomUUID(), row=await this.store.claim(worker,Math.min(this.timeoutSeconds+45,Math.floor((invocationDeadline-this.now())/1000)));
    if (!row?.id) return;
    const config=row.data.snapshot; let resultName='';const deadline=Math.min(invocationDeadline,this.now()+(this.timeoutSeconds+40)*1000);
    try {
      const [guest,reference,outfitReference,overlay]=await Promise.all([this.store.get(row.data.original),config.reference ? this.store.get('assets/'+config.reference) : undefined,config.outfitReference ? this.store.get('assets/'+config.outfitReference) : undefined,config.overlay ? this.store.get('assets/'+config.overlay) : undefined]);
      const timeoutMs=Math.max(1000,Math.min(this.timeoutSeconds*1000,deadline-this.now()-35000));
      const output=config.mode==='rehearsal' ? guest : await this.generate({guest,reference,outfitReference,prompt:config.prompt,model:config.model,size:config.size,quality:config.quality,key:this.env.OPENAI_API_KEY,timeoutMs});
      const framed=await composePortrait(output,config,overlay);
      resultName='results/'+row.id+'-'+worker+'.jpg';
      await this.store.put(resultName,framed,'image/jpeg');
      const data={...row.data,result:resultName,completedAt:new Date(this.now()).toISOString(),eventName:config.eventName,error:''};
      const expiresAt=new Date(this.now()+config.retentionDays*86400000).toISOString();
      const saved=await this.store.finish(row.id,worker,'complete',data,expiresAt);
      if (!saved) await this.store.remove([resultName]);
    } catch(e) {
      // A lost completion response can follow a successful database commit. Keep the saved image.
      // All attempt paths were persisted at claim time and are removed with this job at expiry.
      const known=/^(The AI |The provider |AI service |Your OpenAI |The API |The AI account|Add your OpenAI)/.test(e.message);
      const message=known ? e.message : 'Generation could not finish or save its result. The provider may have charged. Review before retrying.';
      await this.store.finish(row.id,worker,'failed',{...row.data,error:message}).catch(()=>{});
    }
  }
  async cleanup() {
    for (const row of await this.store.expired()) await this.remove(row.id).catch(()=>{});
  }
  async remove(id) {
    const row=await this.store.markDeleting(id); if (!row) throw failure('Wait for generation to finish before deleting this photo.');
    // Keep the tombstone if storage deletion fails; cleanup can safely resume on the next poll.
    await this.store.remove([...new Set([row.data.original,row.data.result,...(row.data.outputPaths || [])].filter(Boolean))]); await this.store.deleteJob(id);
  }
  async capture(buffer, options, owner) {
    const requestId=options.requestId || randomUUID(); if (!uuid.test(requestId)) throw failure('Invalid capture request.');
    const previous=await this.store.job(requestId);
    if (previous) { if (previous.data.owner!==owner) throw failure('Capture request belongs to another screen.',403); return previous; }
    const normalized=await normalizeImage(buffer);
    const config=(await this.settings()).config;
    const name='originals/'+requestId+'-'+randomUUID()+'.jpg';
    await this.store.put(name,normalized,'image/jpeg');
    try {
      const row=await this.store.createJob({id:requestId,request_id:requestId,status:'captured',expires_at:new Date(this.now()+config.retentionDays*86400000).toISOString(),data:{owner,original:name,token:randomBytes(24).toString('base64url'),captureRequestId:requestId,scene:options.scene,error:'',mode:config.mode}});
      if (row.data.original!==name) await this.store.remove([name]);
      if (row.data.owner!==owner) throw failure('Capture request belongs to another screen.',403);
      if (config.autoGenerate && !options.review && row.status==='captured') await this.enqueue(row,false);
      return row;
    } catch(e) { await this.store.remove([name]).catch(()=>{}); throw e; }
  }
  async enqueue(row,retry,approval=row.id) {
    if (row.status==='failed' && !retry) throw failure('Review the previous request and use Retry generation from the admin screen.');
    const config=(await this.settings()).config;
    if (config.mode==='live' && (!this.env.OPENAI_API_KEY || !config.reference || !config.prompt)) throw failure('Add OPENAI_API_KEY in Vercel and save a golf reference and prompt in Setup first.');
    const queued=await this.store.enqueue(row.id,{...config,prompt:scenePrompt(config.prompt,row.data.scene)},retry,approval);
    this.kick(); return viewJob(queued);
  }
  async handle(request) {
    let response;
    try { response=await this.route(request); }
    catch(e) { response=json({cloud:true,error:e.status ? e.message : 'Cloud request failed. Check the Supabase connection and schema, then refresh.'},e.status || 503); }
    response.headers.set('Cache-Control','private, no-store');
    response.headers.set('X-Content-Type-Options','nosniff'); response.headers.set('Referrer-Policy','no-referrer'); response.headers.set('X-Frame-Options','DENY');
    return response;
  }
  async route(request) {
    const url=new URL(request.url); if (url.searchParams.has('route')) { url.pathname=url.searchParams.get('route'); url.searchParams.delete('route'); }
    const path=url.pathname, method=request.method, missing=cloudEnvironment(this.env);
    const operatorView=url.searchParams.get('view')==='operator';
    if (path==='/api/health' && method==='GET') return json({cloud:true,configured:!missing.length,missing});
    if (missing.length) return json({error:'Cloud setup is incomplete.',cloud:true,missing},503);
    if (request.headers.get('origin') && request.headers.get('origin')!==url.origin) throw failure('Untrusted origin.',403);
    if (path==='/api/login' && method==='POST') {
      const ip=request.headers.get('x-vercel-forwarded-for')?.split(',')[0] || 'local';
      const rateKey=createHmac('sha256',this.env.BOOTH_SESSION_SECRET).update(ip).digest('hex');
      if (!await this.store.loginAttempt(rateKey)) throw failure('Too many sign-in attempts. Wait ten minutes before trying again.',429);
      const input=await body(request);
      if (!equal(input.password,this.env.BOOTH_ADMIN_PASSWORD)) throw failure('The admin password was not accepted.',401);
      const {value}=issueSession('admin',this.env.BOOTH_SESSION_SECRET,this.now());
      const res=json({ok:true}); res.headers.append('Set-Cookie',cookie('admin',value)); return res;
    }
    const publicPhoto=path.match(/^\/(p|photo|download)\/([a-zA-Z0-9_-]{32})$/);
    if (publicPhoto && ['GET','HEAD'].includes(method)) {
      const row=await this.store.tokenJob(publicPhoto[2]); if (!row || row.status!=='complete' || new Date(row.expires_at).getTime()<=this.now()) throw failure('This photo link is unavailable or has expired.',404);
      if (publicPhoto[1]!=='p') return new Response(null,{status:302,headers:{Location:await this.store.signed(row.data.result)}});
      const token=publicPhoto[2];
      return new Response(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your golf portrait</title><style>body{font:18px Arial;background:#f4f6f4;color:#123d30;text-align:center;padding:20px}main{max-width:540px;margin:auto}img{max-width:100%;max-height:70vh}a{display:block;padding:18px;background:#123d30;color:white;border-radius:8px;text-decoration:none}</style></head><body><main><h1>Your moment on the green.</h1><p>${esc(row.data.eventName || 'Golf experience')}${row.data.mode==='rehearsal' ? ' · Rehearsal photo' : ''}</p><img src="/photo/${token}" alt="Your golf portrait"><a href="/download/${token}">Open and save photo</a><p>Available until ${esc(new Date(row.expires_at).toLocaleDateString('en-GB'))}.</p></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
    if (path.startsWith('/api/device/')) {
      if (!this.env.BOOTH_DEVICE_TOKEN || !equal(request.headers.get('authorization'), 'Bearer '+this.env.BOOTH_DEVICE_TOKEN)) throw failure('Windows helper is not paired.',401);
      return this.deviceRoute(request,url);
    }
    const session=readSession(request,this.env.BOOTH_SESSION_SECRET,operatorView,this.now());
    if (!session) return json({error:'Sign in with your admin password to open this booth.',cloud:true,loginRequired:true},401);
    const isAdmin=session.role==='admin';
    const admin=()=>{ if (!isAdmin) throw failure('Admin sign-in is required for this action.',403); };
    if (!['GET','HEAD'].includes(method) && !equal(request.headers.get('x-booth-token'),csrfFor(session,this.env.BOOTH_SESSION_SECRET))) throw failure('Refresh the booth screen and try again.',403);
    if (path==='/api/bootstrap' && method==='GET') return json({token:csrfFor(session,this.env.BOOTH_SESSION_SECRET)});
    if (path==='/api/logout' && method==='POST') { const res=json({ok:true}); res.headers.append('Set-Cookie',cookie('admin','')); return res; }
    if (path==='/api/kiosk/start' && method==='POST') {
      admin(); const {value}=issueSession('kiosk',this.env.BOOTH_SESSION_SECRET,this.now());
      const res=json({ok:true}); res.headers.append('Set-Cookie',cookie('kiosk',value)); res.headers.append('Set-Cookie',cookie('admin','')); return res;
    }
    if (path==='/api/state' && method==='GET') {
      this.kick(); this.schedule(this.cleanup().catch(()=>{}));
      const [{config,paused,device},rows,commands]=await Promise.all([this.settings(),this.store.jobs(),this.store.commands()]);
      const online=new Date(device.seenAt || 0).getTime()>this.now()-30000;
      const jobs=rows.filter(row=>new Date(row.expires_at).getTime()>this.now() && (isAdmin || row.data.owner===session.subject || (url.searchParams.get('view')==='display' && row.status==='complete'))).map(row=>({...viewJob(row),downloadUrl:row.status==='complete' ? this.base+'/p/'+row.data.token : ''}));
      const publicConfig=isAdmin ? config : Object.fromEntries(['eventName','cameraMode','displaySeconds','mode'].map(k=>[k,config[k]]));
      return json({cloud:true,role:session.role,config:publicConfig,hasKey:!!this.env.OPENAI_API_KEY,paused,jobs,addresses:[],publicPort:null,capturing:commands.some(c=>c.kind==='capture' && ['pending','claimed'].includes(c.status)),device:{...device,online},commands:commands.filter(c=>isAdmin || c.data.owner===session.subject).map(c=>({id:c.id,kind:c.kind,status:c.status,target:c.target,error:c.data.error || ''})),timeoutSeconds:this.timeoutSeconds});
    }
    if (path==='/api/settings' && method==='POST') { admin(); const current=(await this.settings()).config; let patch; try { patch=settingsPatch(current,await body(request),!!this.env.OPENAI_API_KEY); } catch(e) { throw failure(e.message); } await this.store.patchConfig(patch); return json({ok:true}); }
    if (path==='/api/key') { admin(); throw failure('Set OPENAI_API_KEY in Vercel Environment Variables and redeploy.'); }
    const assetKinds={'/api/reference':'reference','/api/outfit-reference':'outfitReference','/api/overlay':'overlay'};
    if (Object.hasOwn(assetKinds,path)) {
      admin(); const kind=assetKinds[path];
      if (method==='POST') { const buffer=kind==='overlay' ? await normalizeOverlay(await bytes(request)) : await normalizeImage(await bytes(request)); const name=randomUUID()+(kind==='overlay'?'.png':'.jpg'); await this.store.put('assets/'+name,buffer,kind==='overlay'?'image/png':'image/jpeg'); await this.store.patchConfig({[kind]:name}); return json({name}); }
      if (method==='DELETE' && kind!=='reference') { await this.store.patchConfig({[kind]:''}); return json({ok:true}); }
    }
    if (path==='/api/capture/cancel' && method==='POST') { const {requestId}=await body(request); if (!uuid.test(requestId)) throw failure('Invalid capture request.'); const c=await this.store.command(requestId); if (c && !isAdmin && c.data.owner!==session.subject) throw failure('Not your capture request.',403); await this.store.cancelCapture(requestId); return json({ok:true}); }
    if (['/api/capture','/api/capture/webcam'].includes(path) && method==='POST') {
      const config=(await this.settings()).config;
      const options=captureOptions({scene:url.searchParams.get('scene') || 'classic',requestId:url.searchParams.get('requestId') || randomUUID(),review:url.searchParams.get('review') ?? 'false'});
      if (!uuid.test(options.requestId)) throw failure('Invalid capture request.');
      if (path.endsWith('/webcam')) { if (config.cameraMode!=='webcam') throw failure('Choose Webcam in Setup first.'); return json(viewJob(await this.capture(await bytes(request),options,session.subject))); }
      if (config.cameraMode==='webcam') throw failure('Use the browser camera capture.');
      const {device}=await this.settings();
      if (new Date(device.seenAt || 0).getTime()<this.now()-30000) throw failure('Connect the Windows helper before capturing with Canon.');
      if (device.cameraMode!==config.cameraMode) throw failure('Choose the same camera connection in cloud Setup and Windows Setup.');
      const command=await this.store.createCommand({id:options.requestId,kind:'capture',target:options.requestId,data:{options,owner:session.subject}});
      if (command.data.owner!==session.subject && !isAdmin) throw failure('Not your capture request.',403);
      return json({waiting:true,requestId:options.requestId});
    }
    const action=path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/(generate|retry|delete|print)$/i);
    if (action && method==='POST') {
      const row=await this.store.job(action[1]); if (!row || row.status==='deleting') throw failure('Photo not found.',404);
      if (action[2]!=='delete' && new Date(row.expires_at).getTime()<=this.now()) throw failure('This photo has expired. Capture a new photo.',404);
      if (!isAdmin && row.data.owner!==session.subject) throw failure('Not your photo.',403);
      if (action[2]==='retry') admin();
      if (['generate','retry'].includes(action[2])) { const approval=request.headers.get('x-request-id') || (action[2]==='generate' ? row.id : ''); if (!uuid.test(approval)) throw failure('Refresh and submit this retry once.'); return json(await this.enqueue(row,action[2]==='retry',approval)); }
      if (action[2]==='delete') { await this.remove(row.id); return json({ok:true}); }
      if (row.status!=='complete') throw failure('Photo is not ready to print.');
      const {device}=await this.settings(); if (new Date(device.seenAt || 0).getTime()<this.now()-30000 || !device.printerName) throw failure('Connect the Windows helper and choose its printer first.');
      const id=request.headers.get('x-request-id') || randomUUID(); if (!uuid.test(id)) throw failure('Invalid print request.');
      await this.store.createCommand({id,kind:'print',target:row.id,data:{owner:session.subject}}); return json({ok:true,queued:true,commandId:id});
    }
    if (path==='/api/printers' && method==='GET') { admin(); return json((await this.settings()).device.printers || []); }
    if (path==='/api/queue' && method==='POST') { admin(); const {paused}=await body(request); if (typeof paused!=='boolean') throw failure('Invalid queue setting.'); await this.store.pause(paused); if (!paused) this.kick(); return json({ok:true}); }
    const media=path.match(/^\/api\/media\/(assets|originals|results)\/([a-zA-Z0-9_.-]+)$/);
    if (media && method==='GET') {
      let name;
      if (media[1]==='assets') { admin(); name='assets/'+media[2]; }
      else { const id=media[2].replace(/\.jpg$/,''); if (!uuid.test(id)) throw failure('Photo not found.',404); const row=await this.store.job(id);
        if (!row || row.status==='deleting' || new Date(row.expires_at).getTime()<=this.now() || (!isAdmin && row.data.owner!==session.subject && !(media[1]==='results' && row.status==='complete'))) throw failure('Photo not found.',404);
        name=row.data[media[1]==='results'?'result':'original'];
      }
      if (!name) throw failure('Photo not ready.',404);
      if (url.searchParams.get('thumb')==='1') return new Response(await sharp(await this.store.get(name)).resize(450,450,{fit:'inside'}).jpeg({quality:80}).toBuffer(),{headers:{'Content-Type':'image/jpeg'}});
      return new Response(null,{status:302,headers:{Location:await this.store.signed(name)}});
    }
    const qr=path.match(/^\/api\/qr\/([a-f0-9-]{36})$/i);
    if (qr && method==='GET') { const row=await this.store.job(qr[1]); if (!row || row.status!=='complete' || new Date(row.expires_at).getTime()<=this.now()) throw failure('Photo not available.',404); return new Response(await QRCode.toBuffer(this.base+'/p/'+row.data.token,{width:360,margin:4}),{headers:{'Content-Type':'image/png'}}); }
    throw failure('Not found.',404);
  }
  async deviceRoute(request,url) {
    const path=url.pathname;
    if (path==='/api/device/heartbeat' && request.method==='POST') {
      const input=await body(request);
      if (!['canon','folder','webcam'].includes(input.cameraMode) || typeof input.printerName!=='string' || input.printerName.length>240 || !Array.isArray(input.printers) || input.printers.length>100 || input.printers.some(p=>typeof p!=='string' || p.length>240)) throw failure('Invalid Windows helper status.');
      await this.store.heartbeat({cameraMode:input.cameraMode,printerName:input.printerName,printers:input.printers,seenAt:new Date(this.now()).toISOString()});
      this.kick(); this.schedule(this.cleanup().catch(()=>{})); return json({ok:true});
    }
    if (path==='/api/device/next' && request.method==='GET') return json({command:await this.store.claimCommand()});
    const match=path.match(/^\/api\/device\/commands\/([a-f0-9-]{36})\/(photo|result|ack)$/i);
    if (!match) throw failure('Not found.',404);
    const command=await this.store.command(match[1]); if (!command) throw failure('Command not found.',404);
    if (match[2]==='ack' && request.method==='POST') {
      const {ok,error}=await body(request); if (typeof ok!=='boolean') throw failure('Invalid command confirmation.');
      if (command.status==='claimed') {
        if (ok && command.kind==='capture' && !await this.store.job(command.target)) throw failure('Photo upload is not complete.');
        await this.store.ackCommand(command.id,ok?'complete':'failed',{...command.data,error:ok?'':String(error || 'Windows command failed.').slice(0,500)});
      }
      return json({ok:true});
    }
    if (command.status!=='claimed') throw failure('This command has expired or was canceled.',409);
    if (match[2]==='photo' && request.method==='POST' && command.kind==='capture') return json(viewJob(await this.capture(await bytes(request),command.data.options,command.data.owner)));
    if (match[2]==='result' && request.method==='GET' && command.kind==='print') {
      const row=await this.store.job(command.target); if (!row || row.status!=='complete' || new Date(row.expires_at).getTime()<=this.now()) throw failure('Photo is no longer available.',404);
      return new Response(null,{status:302,headers:{Location:await this.store.signed(row.data.result)}});
    }
    throw failure('Not found.',404);
  }
}
