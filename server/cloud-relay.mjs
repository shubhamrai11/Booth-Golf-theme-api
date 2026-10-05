import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { loadDeviceToken, saveDeviceToken } from './secrets.mjs';
const exec=promisify(execFile);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function saveJson(file,data) { writeFileSync(file+'.tmp',JSON.stringify(data,null,2)); renameSync(file+'.tmp',file); }
export class CloudRelay {
  constructor(booth,{fetchImpl=fetch,saveToken=saveDeviceToken,loadToken=loadDeviceToken,print,printers}={}) {
    this.booth=booth; this.fetch=fetchImpl; this.saveToken=saveToken; this.loadToken=loadToken;
    this.print=print || ((file,name)=>exec(path.join(booth.appRoot,'native','PrintPhoto.exe'),[file,name],{windowsHide:true,timeout:30000,maxBuffer:65536}));
    this.printers=printers || (async()=>JSON.parse((await exec(path.join(booth.appRoot,'native','PrintPhoto.exe'),['--list'],{windowsHide:true,timeout:15000,maxBuffer:65536})).stdout));
    this.configFile=path.join(booth.root,'cloud-connection.json'); this.ledgerFile=path.join(booth.root,'cloud-commands.json');
    this.config=existsSync(this.configFile)?JSON.parse(readFileSync(this.configFile,'utf8')):{url:'',enabled:false};
    this.ledger=existsSync(this.ledgerFile)?JSON.parse(readFileSync(this.ledgerFile,'utf8')):{};
    for (const entry of Object.values(this.ledger)) if (entry.phase==='executing') { entry.phase='error'; entry.error='The helper restarted during a camera/print action. Check whether it completed before trying again.'; }
    saveJson(this.ledgerFile,this.ledger); this.error=''; this.lastSeen=0; this.stopped=false; this.token='';
  }
  view() { return {...this.config,hasToken:!!this.token,online:this.lastSeen>Date.now()-30000,error:this.error,busy:!!this.busy}; }
  async configure({url,token,enabled}) {
    if (this.busy) throw new Error('Wait for the current Windows command before changing the connection.');
    if (typeof url!=='string' || typeof enabled!=='boolean' || typeof token!=='string') throw new Error('Invalid cloud connection.');
    const parsed=new URL(url);
    if (parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname!=='/') throw new Error('Use your Vercel HTTPS site address without a path.');
    if (token && (token.length<32 || token.length>200 || /\s/.test(token))) throw new Error('Use a device token of 32–200 characters without spaces.');
    if (token) { await this.saveToken(this.booth.root,token); this.token=token; }
    if (enabled && !this.token) throw new Error('Enter the BOOTH_DEVICE_TOKEN saved in Vercel.');
    this.config={url:parsed.origin,enabled}; saveJson(this.configFile,this.config); this.error=''; this.lastSeen=0;
    return this.view();
  }
  async start() { this.token=await this.loadToken(this.booth.root); this.timer=setInterval(()=>this.tick(),2000); this.timer.unref(); this.tick(); }
  stop() { this.stopped=true; clearInterval(this.timer); }
  async request(route,options={}) {
    const response=await this.fetch(this.config.url+route,{...options,headers:{Authorization:'Bearer '+this.token,...options.headers},signal:AbortSignal.timeout(20000)});
    if (!response.ok) { let message; try {message=(await response.json()).error;} catch {} throw Object.assign(new Error(message || 'The cloud connection could not finish.'),{status:response.status}); }
    return response;
  }
  async send(route,data) { return this.request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  persist() { saveJson(this.ledgerFile,this.ledger); }
  async tick() {
    if (this.stopped || !this.config.enabled || !this.token) return;
    if (this.busy) { if (!this.heartbeatBusy && Date.now()-(this.heartbeatAt || 0)>10000) await this.heartbeat().catch(e=>{this.error=e.message;}); return; }
    this.busy=true;
    try {
      if (!this.heartbeatAt || Date.now()-this.heartbeatAt>10000) {
        await this.heartbeat();
      }
      for (const [id,entry] of Object.entries(this.ledger)) if (!entry.acknowledgedAt && ['done','error','ready'].includes(entry.phase)) await this.execute({id,kind:entry.kind});
      const {command}=await (await this.request('/api/device/next')).json(); this.lastSeen=Date.now(); this.error='';
      if (command) await this.execute(command);
    } catch(e) { this.error=e.message; }
    finally { this.busy=false; }
  }
  async heartbeat() {
    if (this.heartbeatBusy) return;
    this.heartbeatBusy=true;
    try { const config=this.booth.state.config,printers=await this.printers().catch(()=>[]);
      await this.send('/api/device/heartbeat',{cameraMode:config.cameraMode,printerName:config.printerName,printers}); this.heartbeatAt=Date.now();this.lastSeen=Date.now();
    } finally {this.heartbeatBusy=false;}
  }
  async execute(command) {
    if (!/^[a-f0-9-]{36}$/.test(command.id) || !['capture','print'].includes(command.kind)) throw new Error('Invalid cloud command.');
    let entry=this.ledger[command.id];
    if (!entry) {
      entry=this.ledger[command.id]={phase:'executing',kind:command.kind}; this.persist();
      try {
        if (command.kind==='capture') {
          const options={...command.data.options,review:true};
          let job;
          if (this.booth.state.config.cameraMode==='canon') job=await this.booth.captureCanon(options);
          else if (this.booth.state.config.cameraMode==='folder') {
            if (!this.booth.state.config.watchEnabled) throw new Error('Enable camera folder monitoring on the Windows booth first.');
            this.booth.armFolderCapture(options); const until=Date.now()+180000;
            while (!this.stopped && Date.now()<until) { job=this.booth.state.jobs.find(j=>j.captureRequestId===options.requestId); if (job) break; await pause(500); }
            if (!job) throw new Error('No camera photo arrived. Check EOS Utility and the download folder.');
          } else throw new Error('Use the cloud browser for webcam capture.');
          const photo=await sharp(this.booth.file('originals',job.id+'.jpg')).rotate().resize(2048,2048,{fit:'inside',withoutEnlargement:true}).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
          if (photo.length>4*1024*1024) throw new Error('The camera photo exceeds the cloud upload limit. Use a smaller JPEG.');
          const file=path.join(this.booth.root,'cloud-'+command.id+'.jpg'); writeFileSync(file,photo);
          entry.phase='ready'; entry.file=file; entry.localJob=job.id;
        } else {
          const printer=this.booth.state.config.printerName; if (!printer) throw new Error('Choose a Windows printer in local Setup first.');
          const response=await this.request('/api/device/commands/'+command.id+'/result');
          const photo=Buffer.from(await response.arrayBuffer());
          const metadata=await sharp(photo,{limitInputPixels:50000000}).metadata(); if (metadata.format!=='jpeg') throw new Error('Cloud print image was not a JPEG.');
          const file=path.join(this.booth.root,'cloud-print-'+command.id+'.jpg'); writeFileSync(file,photo);
          try { await this.print(file,printer); } finally { if (existsSync(file)) unlinkSync(file); }
          entry.phase='done';
        }
      } catch(e) { entry.phase='error'; entry.error=command.kind==='print' ? 'Printer action did not confirm completion. It may have printed; check the printer before trying again.' : e.message; }
      this.persist();
    }
    // Only photo upload and acknowledgments can repeat. Hardware actions cannot.
    if (entry.phase==='ready') {
      try { await this.request('/api/device/commands/'+command.id+'/photo',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:readFileSync(entry.file)}); entry.phase='done'; }
      catch(e) {if (![404,409].includes(e.status)) throw e; entry.phase='error';entry.error='The capture command expired or was canceled.';}
      this.persist();
    }
    await this.send('/api/device/commands/'+command.id+'/ack',{ok:entry.phase==='done',error:entry.error || ''});
    if (entry.file && existsSync(entry.file)) unlinkSync(entry.file);
    if (entry.localJob) { try { this.booth.remove(entry.localJob); } catch {} delete entry.localJob; }
    delete entry.file; entry.acknowledgedAt=new Date().toISOString(); this.persist();
  }
}
