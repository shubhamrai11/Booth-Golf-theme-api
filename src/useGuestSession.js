import { useEffect, useRef, useState } from 'react';
import { MemoryPortrait } from './memory-portrait.mjs';
import { helperFetch, generateTemporary, connected } from './temporary-api';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function useGuestSession(state) {
  const [phase,setPhase]=useState('welcome'),[job,setJob]=useState(null),[count,setCount]=useState(null),[scene,setScene]=useState('classic'),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[browserPrinted,setBrowserPrinted]=useState(false);
  const video=useRef(null),stream=useRef(null),operation=useRef(0),locked=useRef(false),channel=useRef(null),printFrame=useRef(null),printRequestId=useRef(null);
  const memory=useRef(null);if(!memory.current)memory.current=new MemoryPortrait({changed:setJob,publish:value=>channel.current?.postMessage({type:value?'photo':'clear',value})});
  function stopCamera(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;}
  function clear(){operation.current++;stopCamera();memory.current.clear();printFrame.current?.remove();printFrame.current=null;printRequestId.current=null;locked.current=false;setWorking(false);setCount(null);setError('');setNotice('');setBrowserPrinted(false);setPhase('welcome');}
  useEffect(()=>{
    // Remove the older version's resumable photo ID. No pixels are written to storage.
    sessionStorage.removeItem('fairway-guest-capture');
    channel.current=new BroadcastChannel('fairway-temporary-display-v4');channel.current.postMessage({type:'clear'});
    channel.current.onmessage=event=>{if(event.data?.type==='request'&&memory.current.result)channel.current.postMessage({type:'photo',value:{blob:memory.current.result,job:{...memory.current.job,url:undefined}}});};
    const heartbeat=setInterval(()=>{if(memory.current.result)channel.current?.postMessage({type:'alive'});},2000);
    const discard=()=>{operation.current++;stopCamera();memory.current.clear();printFrame.current?.remove();};
    const restored=event=>{if(event.persisted)clear();};
    window.addEventListener('pagehide',discard);window.addEventListener('pageshow',restored);
    return()=>{discard();clearInterval(heartbeat);channel.current.close();channel.current=null;window.removeEventListener('pagehide',discard);window.removeEventListener('pageshow',restored);};
  },[]);
  async function start(){
    if(locked.current)return;clear();locked.current=true;const current=++operation.current;setPhase('capture');
    try{
      if(state.config.cameraMode==='webcam'){
        const mediaStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080}},audio:false});
        if(current!==operation.current){mediaStream.getTracks().forEach(t=>t.stop());return;}stream.current=mediaStream;
        for(let i=0;i<100&&!video.current;i++)await pause(50);if(!video.current)throw new Error('Camera preview could not open.');
        video.current.srcObject=mediaStream;await video.current.play();for(let i=0;i<100&&!video.current?.videoWidth;i++)await pause(50);if(!video.current?.videoWidth)throw new Error('The camera is not sending a picture.');
      }else if(!connected())throw new Error('Ask the operator to connect the Windows helper in Settings.');
      for(let n=6;n>0;n--){if(current!==operation.current)return;setCount(n);await pause(1000);}
      if(current!==operation.current)return;setCount(null);setPhase('sending');let blob;
      if(state.config.cameraMode==='webcam'){
        const canvas=document.createElement('canvas');canvas.width=video.current.videoWidth;canvas.height=video.current.videoHeight;canvas.getContext('2d').drawImage(video.current,0,0);blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.96));
        if(!blob)throw new Error('The camera photo could not be captured.');
      }else blob=await (await helperFetch('/api/temporary/capture',{method:'POST',headers:{'X-Request-Id':crypto.randomUUID()}})).blob();
      if(current!==operation.current)return;memory.current.capture(blob);setPhase('review');
    }catch(e){if(current===operation.current){setError(e.name==='NotAllowedError'?'Camera access was not allowed. Enable it in browser settings.':e.message);setPhase('error');}}
    finally{if(current===operation.current){stopCamera();setCount(null);locked.current=false;}}
  }
  async function action(name){
    if(locked.current||!memory.current.job)return false;
    if(name==='delete'){clear();return true;}
    locked.current=true;setWorking(true);setError('');setNotice('');const current=operation.current;
    try{
      if(name==='generate'){
        setPhase('processing');await memory.current.generate((blob,signal)=>generateTemporary(blob,state.config,scene,state.assets||{},signal),state.config.mode);
      }else if(name==='print'){
        if(connected()){
          printRequestId.current ||= crypto.randomUUID();
          await helperFetch('/api/temporary/print',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Request-Id':printRequestId.current},body:memory.current.result});
          if(current===operation.current){clear();setNotice('Sent to the Windows print queue. Please collect your photo.');}
        }else{
          // A print dialog cannot reliably report cancellation. Keep the result until Done.
          printFrame.current?.remove();const frame=document.createElement('iframe');frame.title='Print your golf portrait';frame.style.cssText='position:fixed;left:-10000px;width:400px;height:600px';printFrame.current=frame;document.body.appendChild(frame);
          const doc=frame.contentDocument;doc.open();doc.write('<html><head><title>Golf portrait</title><style>@page{size:4in 6in;margin:0}html,body{margin:0}img{width:100%;height:100%;object-fit:contain}</style></head><body><img alt="Golf portrait"></body></html>');doc.close();
          const image=doc.querySelector('img');image.src=memory.current.job.url;await image.decode();frame.contentWindow.focus();frame.contentWindow.print();setBrowserPrinted(true);setNotice('After printing, choose Done & clear photo. If you canceled, you can print again.');
        }
      }
      return true;
    }catch(e){if(current===operation.current)setError(e.message);return false;}
    finally{if(current===operation.current){setWorking(false);locked.current=false;}}
  }
  async function retake(){if(!locked.current)await start();}
  return {phase,count,scene,setScene,job,video,start,reset:clear,action,retake,error,notice,working,browserPrinted,clearMessage:()=>{setError('');setNotice('');}};
}
