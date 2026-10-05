import React, { useEffect, useState } from 'react';
import { Display } from './Display';
export function TemporaryDisplay({config}){
  const [job,setJob]=useState(null);
  useEffect(()=>{
    const channel=new BroadcastChannel('fairway-temporary-display-v4');let url,last=Date.now();
    const clear=()=>{if(url)URL.revokeObjectURL(url);url=null;setJob(null);};
    channel.onmessage=({data})=>{
      if(data?.type==='clear')clear();
      if(data?.type==='alive')last=Date.now();
      if(data?.type==='photo'&&data.value?.blob instanceof Blob){clear();last=Date.now();url=URL.createObjectURL(data.value.blob);setJob({...data.value.job,url});}
    };
    channel.postMessage({type:'request'});const timer=setInterval(()=>{if(Date.now()-last>10000)clear();},2000);
    const discard=()=>clear();window.addEventListener('pagehide',discard);
    return()=>{clear();clearInterval(timer);channel.close();window.removeEventListener('pagehide',discard);};
  },[]);
  return <Display state={{config:{...config,displaySeconds:30},jobs:job?[job]:[]}}/>;
}
