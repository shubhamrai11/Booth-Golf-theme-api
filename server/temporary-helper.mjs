import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TemporaryGeneration, temporaryConfig, readRequest, fail } from './temporary-generation.mjs';
import { equal, issueProof } from './temporary-auth.mjs';
import { normalizeImage } from './media.mjs';
import { saveKey } from './secrets.mjs';
export const validId = id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '');
const randomToken = () => randomBytes(32).toString('base64url');
const json = (data, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function native(executable,args,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const output=[];let length=0,error='',settled=false;
    const finish=(e,value)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(fail('The equipment did not confirm completion. Check it before trying again.',502));},65000);
    child.stdout.on('data',b=>{length+=b.length;if(length>50*1024*1024){child.kill();finish(fail('Camera JPEG exceeds 50 MB.',413));}else output.push(b);});
    child.stderr.on('data',b=>{if(error.length<4000)error+=b.toString();});
    child.on('error',()=>finish(fail('The Windows camera/printer bridge could not start. Rebuild or install the complete helper.',503)));
    child.on('close',code=>finish(code===0?null:fail(error.trim()||'The equipment action failed. Check the camera or printer.',502),Buffer.concat(output)));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
// Disk contains settings, encrypted credentials and command IDs, never guest pixels.
export class TemporaryHelper {
  constructor({root,appRoot,key='',now=()=>Date.now(),runNative=native,saveCredential=saveKey,generate}={}) {
    Object.assign(this,{root,appRoot,key,now,runNative,saveCredential});mkdirSync(root,{recursive:true});
    this.settingsFile=path.join(root,'temporary-settings.json');this.ledgerFile=path.join(root,'command-ids.json');
    this.settings=existsSync(this.settingsFile)?JSON.parse(readFileSync(this.settingsFile,'utf8')):{};
    this.settings={...temporaryConfig(this.settings),sdkPath:this.settings.sdkPath||'',printerName:this.settings.printerName||''};
    this.ledger=existsSync(this.ledgerFile)?JSON.parse(readFileSync(this.ledgerFile,'utf8')):{};
    for(const item of Object.values(this.ledger))if(item.status==='executing')item.status='uncertain';
    this.persist(this.ledgerFile,this.ledger);
    this.csrf=randomToken();this.pairings=new Map();this.sessions=new Map();this.busy=false;
    this.generation=new TemporaryGeneration({key,appRoot,generate,requireProof:false,timeoutMs:600000});
  }
  persist(file,value){writeFileSync(file+'.tmp',JSON.stringify(value,null,2));renameSync(file+'.tmp',file);}
  info(){return {temporary:true,local:true,hasKey:!!this.key,config:temporaryConfig(this.settings),equipment:{sdkPath:this.settings.sdkPath,printerName:this.settings.printerName},presets:['reference','outfitReference'].filter(name=>existsSync(this.presetPath(name)))};}
  presetPath(name){return path.join(this.appRoot,'assets',name==='reference'?'golf-reference.jpg':'golf-outfit-reference.jpg');}
  clean(){for(const [id,p]of this.pairings)if(p.expires<this.now())this.pairings.delete(id);for(const [id,p]of this.sessions)if(p.expires<this.now())this.sessions.delete(id);}
  trusted(request,url){
    const origin=request.headers.get('origin');
    if(!origin||origin===url.origin)return equal(request.headers.get('x-booth-token'),this.csrf)?'local':false;
    const token=request.headers.get('authorization')?.replace(/^Bearer /,'');const session=this.sessions.get(token);
    return session?.origin===origin && session.expires>this.now()?'paired':false;
  }
  async input(request,max=16000){try{return JSON.parse((await readRequest(request,max)).toString());}catch(e){if(e.status)throw e;throw fail('Invalid settings request.');}}
  async once(id,kind,fn){
    if(!validId(id))throw fail('Invalid command ID.');
    if(this.ledger[id])throw fail('This equipment command was already used. No second capture or print was made. Check the equipment before starting a new action.',409);
    if(this.busy)throw fail('The equipment is already working. Please wait.',409);
    if(Object.keys(this.ledger).length>=10000)throw fail('The command log needs operator maintenance before more equipment actions.',503);
    this.ledger[id]={kind,status:'executing',at:this.now()};this.persist(this.ledgerFile,this.ledger);this.busy=true;
    try{const value=await fn();this.ledger[id].status='complete';return value;}
    catch(e){this.ledger[id].status='uncertain';throw e;}
    finally{this.busy=false;this.persist(this.ledgerFile,this.ledger);}
  }
  async handle(request){
    const url=new URL(request.url),origin=request.headers.get('origin'),route=url.pathname;this.clean();
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url.host))return json({error:'Use the helper through localhost.'},403);
    const pairingRoute=['/api/temporary/pair/start','/api/temporary/pair/status'].includes(route);
    const cross=origin && origin!==url.origin;
    const session=[...this.sessions.values()].some(s=>s.origin===origin && s.expires>this.now());
    const secureOrigin=(()=>{try{const u=new URL(origin);return u.origin===origin && u.protocol==='https:';}catch{return false;}})();
    const corsAllowed=cross && secureOrigin && (pairingRoute||session);
    if(cross&&!corsAllowed)return json({error:'Connect this website from Windows helper Setup first.'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsAllowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Request-Id','Access-Control-Max-Age':'600','Vary':'Origin'}:{}});
    let response;
    try{
      if(route==='/api/bootstrap' && request.method==='GET' && !cross)response=json({temporary:true,version:'0.4.0',token:this.csrf});
      else if(pairingRoute && request.method==='POST'){
        if(!secureOrigin)throw fail('Pairing requires the HTTPS website address.',403);
        const body=await this.input(request);
        if(route.endsWith('/start')){
          if(this.pairings.size>=8)throw fail('Too many pending connections. Wait two minutes and try again.',429);
          const id=randomToken();this.pairings.set(id,{origin,expires:this.now()+120000});response=json({id});
        }else{
          const p=this.pairings.get(body.id);if(!p||p.origin!==origin)throw fail('The connection request expired. Connect again.',410);
          response=json({approved:!!p.token,token:p.token});
        }
      }else{
        const access=this.trusted(request,url);if(!access)throw fail('Open the helper on this Windows PC or connect it from Settings.',403);
        const local=access==='local';
        if(route==='/api/temporary/info' && request.method==='GET')response=json(this.info());
        else if(route.startsWith('/api/temporary/preset/') && request.method==='GET'){
          const name=route.split('/').at(-1);if(!['reference','outfitReference'].includes(name)||!existsSync(this.presetPath(name)))throw fail('Preset not found.',404);
          response=new Response(await normalizeImage(readFileSync(this.presetPath(name))),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'}});
        }
        else if(route==='/api/temporary/pair/details' && request.method==='POST' && local){const p=this.pairings.get((await this.input(request)).id);if(!p)throw fail('The connection request expired.',410);response=json({origin:p.origin,approved:!!p.token});}
        else if(route==='/api/temporary/pair/approve' && request.method==='POST' && local){
          const p=this.pairings.get((await this.input(request)).id);if(!p)throw fail('The connection request expired.',410);
          if(!p.token){p.token=randomToken();this.sessions.set(p.token,{origin:p.origin,expires:this.now()+12*3600000});}response=json({approved:true});
        }else if(route==='/api/temporary/settings' && request.method==='POST' && local){
          const body=await this.input(request,20000);const config=temporaryConfig({...this.settings,...body});
          for(const name of ['sdkPath','printerName']){if(name in body && (typeof body[name]!=='string'||body[name].length>1000))throw fail('Invalid equipment setting.');}
          this.settings={...config,sdkPath:body.sdkPath??this.settings.sdkPath,printerName:body.printerName??this.settings.printerName};this.persist(this.settingsFile,this.settings);response=json(this.info());
        }else if(route==='/api/temporary/key' && request.method==='POST' && local){
          const {key}=await this.input(request);if(typeof key!=='string'||key.length>1000||/\s/.test(key))throw fail('Use an API key without spaces.');
          await this.saveCredential(this.root,key);this.key=key;this.generation.key=key;response=json({hasKey:!!key});
        }else if(route==='/api/temporary/printers' && request.method==='GET'){
          const bytes=await this.runNative(path.join(this.appRoot,'native','PrintPhoto.exe'),['--list']);response=json({printers:JSON.parse(bytes.toString())});
        }else if(route==='/api/temporary/authorize' && request.method==='POST'){
          const body=await this.input(request);if(!validId(body.id)||!/^[a-f0-9]{64}$/.test(body.digest||'')||body.audience!==(cross?origin:url.origin))throw fail('Invalid generation approval.');
          if(!this.key)throw fail('Save the same OpenAI API key in Windows helper Setup and Vercel.',503);
          if(this.ledger[body.id])throw fail('This AI request was already approved. No automatic retry was made.',409);
          if(Object.keys(this.ledger).length>=10000)throw fail('The command log needs operator maintenance.',503);
          const proof=issueProof(body,this.key,this.now());this.ledger[body.id]={kind:'generation',status:'approved',at:this.now()};this.persist(this.ledgerFile,this.ledger);response=json({proof});
        }else if(route==='/api/temporary/capture' && request.method==='POST'){
          const sdk=this.settings.sdkPath;if(!sdk||!existsSync(path.join(sdk,'EDSDK.dll')))throw fail('Select the folder containing your licensed 64-bit Canon EDSDK.dll in Windows helper Settings.',503);
          const bytes=await this.once(request.headers.get('x-request-id'),'capture',async()=>normalizeImage(await this.runNative(path.join(this.appRoot,'native','CanonCapture.exe'),[sdk,'-'])));
          response=new Response(bytes,{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'}});
        }else if(route==='/api/temporary/print' && request.method==='POST'){
          if(!this.settings.printerName)throw fail('Choose a Windows printer in helper Settings first.',503);
          const bytes=await normalizeImage(await readRequest(request,4*1024*1024));
          await this.once(request.headers.get('x-request-id'),'print',()=>this.runNative(path.join(this.appRoot,'native','PrintPhoto.exe'),['-',this.settings.printerName],bytes));response=json({printed:true});
        }else if(route==='/api/temporary/generate' && request.method==='POST' && local)response=await this.generation.handle(request);
        else throw fail('This route is not available in temporary photo mode.',404);
      }
    }catch(e){response=json({error:e.status?e.message:'The helper could not finish. Check the equipment before starting again.'},e.status||500);}
    if(corsAllowed){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');}
    response.headers.set('X-Content-Type-Options','nosniff');return response;
  }
}
