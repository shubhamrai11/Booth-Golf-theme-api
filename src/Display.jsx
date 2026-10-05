import React, { useEffect, useRef, useState } from 'react';
import { media } from './api';
import { Button, Icon } from './ui';
export function Display({ state }) {
  const ready = state.jobs.filter(j => j.status === 'complete').sort((a,b)=>b.completedAt.localeCompare(a.completedAt));
  const [selected,setSelected] = useState(null), newest = ready[0]?.id, previous = useRef(null);
  useEffect(() => { if(newest && newest !== previous.current) { setSelected(newest); previous.current = newest; } },[newest]);
  useEffect(() => { const timer=setInterval(()=>{setSelected(current=>{const idx=ready.findIndex(j=>j.id===current);return ready[(idx+1)%ready.length]?.id;});},state.config.displaySeconds*1000);return()=>clearInterval(timer); },[ready.map(j=>j.id).join(','),state.config.displaySeconds, newest]);
  const job=ready.find(j=>j.id===selected)||ready[0];
  return <div className="display-screen"><header><div className="brand"><Icon name="flag" size={30}/>{state.config.eventName}</div><button className="display-fullscreen" onClick={()=>document.documentElement.requestFullscreen?.()}>Full screen</button></header>{job ? <div className="display-result"><img key={job.id} className="display-photo" src={media(job)} alt="Latest golf portrait"/><div className="display-copy"><h1>Your moment<br/>on the green.</h1><p>Made for you.<br/>Ready to take home.</p>{job.downloadUrl ? <><img className="display-qr" src={`/api/qr/${job.id}`} alt="Scan to download this exact portrait"/><strong>Scan for your photo</strong><small>{state.config.downloadBaseUrl ? 'Your personal download link' : 'Connect to the booth’s Wi-Fi to download'}</small></> : null}<span className="print-caption"><Icon name="print"/>Collect your print at the booth</span>{job.mode === 'rehearsal' ? <small className="rehearsal-label">Rehearsal photo · No AI applied</small> : null}</div></div> : <div className="display-waiting"><Icon name="flag" size={70}/><h1>The next great shot<br/>could be yours.</h1><p>Visit the photo booth. Your portrait appears here.</p></div>}</div>;
}
