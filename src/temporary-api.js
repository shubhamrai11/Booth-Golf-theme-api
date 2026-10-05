export const isLocal = ['127.0.0.1','localhost'].includes(location.hostname);
export const helperOrigin = 'http://127.0.0.1:4314';
const connectionKey='fairway-helper-connection-v4';
let csrf;
let connection;
try{connection=JSON.parse(sessionStorage.getItem(connectionKey)||'null');}catch{}
async function checked(response){if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'The connection ended. No automatic retry was made.');}return response;}
export async function helperFetch(route,options={}){
  const headers={...options.headers};
  if(isLocal){if(!csrf)csrf=(await (await checked(await fetch('/api/bootstrap'))).json()).token;headers['X-Booth-Token']=csrf;}
  else{if(!connection?.token||connection.expires<Date.now())throw new Error('Connect the Windows helper in Settings before using the camera, printer or live AI.');headers.Authorization='Bearer '+connection.token;}
  try{return await checked(await fetch((isLocal?'':helperOrigin)+route,{...options,headers}));}
  catch(e){if(e instanceof TypeError)throw new Error('The Windows helper is unavailable. Start it on this PC, connect in Settings, and allow local network access if the browser asks.');throw e;}
}
export const helperJson=async(route,data)=> (await helperFetch(route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
export async function getInfo(){return isLocal?helperJson('/api/temporary/info'):(await checked(await fetch('/api/temporary/info'))).json();}
export async function getPresets(info){return Object.fromEntries(await Promise.all((info.presets||[]).map(async name=>[name,new File([await (await helperFetch('/api/temporary/preset/'+name)).blob()],name==='reference'?'saved-golf-reference.jpg':'saved-outfit-reference.jpg',{type:'image/jpeg'})])));}
export async function connectHelper(approvedWindow,onProgress,signal){
  const call=async(route,data)=>(await checked(await fetch(helperOrigin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal}))).json();
  const {id}=await call('/api/temporary/pair/start',{});
  const url=helperOrigin+'/?connect='+encodeURIComponent(id);
  if(approvedWindow)approvedWindow.location=url;
  onProgress(url);
  for(let i=0;i<110;i++){
    if(signal.aborted)throw new DOMException('Canceled','AbortError');
    const result=await call('/api/temporary/pair/status',{id});
    if(result.approved){connection={token:result.token,expires:Date.now()+12*3600000};sessionStorage.setItem(connectionKey,JSON.stringify(connection));return helperJson('/api/temporary/info');}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Connection expired. Connect again and select Allow in the Windows helper.');
}
export const connected=()=>isLocal||!!(connection?.token&&connection.expires>Date.now());
export function disconnectHelper(){connection=null;sessionStorage.removeItem(connectionKey);}
export async function compressPhoto(blob){
  const image=await createImageBitmap(blob,{imageOrientation:'from-image'});
  try{const scale=Math.min(1,1920/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const result=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.94));if(!result)throw new Error('This photo could not be prepared.');return result;}finally{image.close();}
}
export async function generateTemporary(guest,config,scene,assets,signal){
  const form=new FormData();form.set('guest',await compressPhoto(guest),'guest.jpg');form.set('config',JSON.stringify(config));form.set('scene',scene);
  for(const name of ['reference','outfitReference','overlay'])if(assets[name])form.set(name,name==='overlay'?assets[name]:await compressPhoto(assets[name]),name==='overlay'?'branding.png':name+'.jpg');
  const encoded=new Request(location.origin+'/api/temporary/generate',{method:'POST',body:form});const body=await encoded.arrayBuffer();
  if(body.byteLength>4*1024*1024)throw new Error('The combined photos exceed 4 MB. Choose smaller reference or branding images. No AI request was made.');
  const headers={'Content-Type':encoded.headers.get('content-type'),'X-Request-Id':crypto.randomUUID()};
  if(!isLocal&&config.mode==='live'){
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(x=>x.toString(16).padStart(2,'0')).join('');
    headers['X-Booth-Proof']=(await helperJson('/api/temporary/authorize',{digest,id:headers['X-Request-Id'],audience:location.origin})).proof;
  }
  const timeout=AbortSignal.timeout(isLocal?640000:270000),combined=AbortSignal.any([signal,timeout]);
  try{const response=isLocal?await helperFetch('/api/temporary/generate',{method:'POST',headers,body,signal:combined}):await checked(await fetch('/api/temporary/generate',{method:'POST',headers,body,signal:combined}));if(!response.headers.get('content-type')?.startsWith('image/'))throw new Error('No image arrived. The provider may have charged. Review before starting again.');return response.blob();}
  catch(e){if(['AbortError','TimeoutError'].includes(e.name)||e instanceof TypeError)throw new Error('The AI connection ended or timed out. The provider may have charged. No automatic retry was made.');throw e;}
}
