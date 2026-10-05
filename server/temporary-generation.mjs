import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { defaults } from './defaults.mjs';
import { normalizeImage, normalizeOverlay, composePortrait } from './media.mjs';
import { generatePortrait } from './provider.mjs';
import { scenePrompt, captureOptions } from '../shared/scenes.mjs';
import { imageModels, qualityOptions, sizeOptions } from '../shared/image-models.mjs';
import { checkProof } from './temporary-auth.mjs';
export const temporaryDefaults = {eventName:defaults.eventName,mode:'rehearsal',cameraMode:'canon',prompt:defaults.prompt,model:defaults.model,quality:defaults.quality,size:defaults.size,frameEnabled:true,frameColor:defaults.frameColor,footerTitle:defaults.footerTitle,footerSubtitle:defaults.footerSubtitle};
export const fail = (message,status=400) => Object.assign(new Error(message),{status});
export function temporaryConfig(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw fail('Invalid photo settings.');
  const c={...temporaryDefaults};
  for(const [name,max] of Object.entries({eventName:80,prompt:12000,footerTitle:36,footerSubtitle:64})) if(name in input){if(typeof input[name]!=='string'||input[name].length>max)throw fail('Invalid '+name+'.');c[name]=input[name].trim();}
  for(const [name,values] of Object.entries({mode:['rehearsal','live'],cameraMode:['canon','webcam'],model:imageModels}))if(name in input){if(!values.includes(input[name]))throw fail('Invalid '+name+'.');c[name]=input[name];}
  c.quality=input.quality??c.quality;c.size=input.size??c.size;
  if(!qualityOptions(c.model).includes(c.quality)||!sizeOptions(c.model).includes(c.size))throw fail('Choose a quality and image size supported by this model.');
  if('frameEnabled' in input){if(typeof input.frameEnabled!=='boolean')throw fail('Invalid frame setting.');c.frameEnabled=input.frameEnabled;}
  if('frameColor' in input){if(!/^#[a-f0-9]{6}$/i.test(input.frameColor))throw fail('Invalid frame colour.');c.frameColor=input.frameColor;}
  return c;
}
export async function readRequest(request,max=4*1024*1024) {
  if(Number(request.headers.get('content-length'))>max)throw fail('The photo request is too large. Use smaller reference images.',413);
  const reader=request.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw fail('The photo request is too large. Use smaller reference images.',413);}chunks.push(value);}
  return Buffer.concat(chunks);
}
export async function defaultReference(appRoot) {
  const file=path.join(appRoot,'public','assets','golf-scenes.png');const image=sharp(readFileSync(file)),info=await image.metadata();
  return image.extract({left:0,top:0,width:Math.floor(info.width/4),height:info.height}).jpeg({quality:94}).toBuffer();
}
export class TemporaryGeneration {
  constructor({key='',appRoot=process.cwd(),generate=generatePortrait,reference,now=()=>Date.now(),timeoutMs=240000,getDeadline=()=>undefined,requireProof=true}={}){Object.assign(this,{key,appRoot,generate,reference,now,timeoutMs,getDeadline,requireProof});this.attempts=new Map();}
  async handle(request) {
    try {return await this.route(request);}catch(e){return Response.json({error:e.status?e.message:'Generation could not finish. The provider may have charged. Review before starting a new photo.'},{status:e.status||502,headers:{'Cache-Control':'no-store'}});}
  }
  async route(request) {
    const url=new URL(request.url),route=url.searchParams.get('route')||url.pathname;
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    if(route==='/api/temporary/info' && request.method==='GET')return Response.json({temporary:true,hasKey:!!this.key,config:temporaryDefaults},{headers});
    if(route!=='/api/temporary/generate'||request.method!=='POST')throw fail('This version uses temporary photos. Refresh the booth page.',404);
    if(request.headers.get('origin') && request.headers.get('origin')!==url.origin)throw fail('Untrusted origin.',403);
    const raw=await readRequest(request),digest=createHash('sha256').update(raw).digest('hex');
    const form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('content-type')||''},body:raw}).formData().catch(()=>{throw fail('Invalid photo request.');});
    let input;try{input=JSON.parse(form.get('config')||'{}');}catch{throw fail('Invalid photo settings.');}
    const config=temporaryConfig(input);let scene;try{scene=captureOptions({scene:form.get('scene')||'classic'}).scene;}catch{throw fail('Choose one of the available golf scenes.');}
    if(config.mode==='live' && !this.key)throw fail('Add OPENAI_API_KEY in Vercel, or save it in Windows helper Setup.',503);
    const proof=this.requireProof && config.mode==='live' ? checkProof(request.headers.get('x-booth-proof'),digest,this.key,url.origin,this.now()) : null;
    if(this.requireProof && config.mode==='live' && !proof)throw fail('Connect the Windows helper using the same OpenAI API key before live generation.',403);
    const id=proof?.id || request.headers.get('x-request-id');if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))throw fail('Invalid photo request ID.');
    for(const [saved,at]of this.attempts)if(at<this.now()-3600000)this.attempts.delete(saved);
    if(this.attempts.has(id))throw fail('This generation was already submitted. No automatic retry was made.',409);
    if(this.attempts.size>=10000)throw fail('The booth is busy. Wait before starting another photo.',429);
    const deadline=this.getDeadline()?.getTime()??Infinity;
    if(config.mode==='live' && deadline-this.now()<90000)throw fail('This request has too little time left to start AI generation. No AI request was made.',503);
    const image=async(name,required=false)=>{const file=form.get(name);if(!file){if(required)throw fail('Capture a guest photo first.');return undefined;}if(typeof file.arrayBuffer!=='function'||file.size>3*1024*1024)throw fail('Invalid or oversized '+name+' image.');try{return await normalizeImage(Buffer.from(await file.arrayBuffer()));}catch{throw fail('Use a valid JPEG, PNG or WebP for '+name+'.');}};
    const [guest,customReference,outfitReference,overlay]=await Promise.all([image('guest',true),image('reference'),image('outfitReference'),(async()=>{const f=form.get('overlay');if(!f)return undefined;if(typeof f.arrayBuffer!=='function'||f.size>1024*1024)throw fail('Use a branding PNG under 1 MB.');try{return await normalizeOverlay(Buffer.from(await f.arrayBuffer()));}catch{throw fail('Use a valid transparent PNG for branding.');}})()]);
    const reference=customReference || (this.reference ? await this.reference() : await defaultReference(this.appRoot));
    this.attempts.set(id,this.now());
    let output=guest;
    if(config.mode==='live')try{output=await this.generate({guest,reference,outfitReference,overlay,prompt:scenePrompt(config.prompt,scene),model:config.model,quality:config.quality,size:config.size,key:this.key,timeoutMs:Math.max(1000,Math.min(this.timeoutMs,deadline-this.now()-20000)),signal:request.signal});}catch(e){throw fail(e.message,502);}
    const result=await composePortrait(output,config,overlay);
    if(result.length>4*1024*1024)throw fail('The finished image exceeds the deployment response limit. The provider may have charged. No automatic retry was made.',502);
    return new Response(result,{headers:{...headers,'Content-Type':'image/jpeg','Content-Disposition':'inline; filename="golf-portrait.jpg"'}});
  }
}
