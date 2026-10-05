import React from 'react';
import { media } from './api';
import { Icon } from './ui';
import { FullscreenButton } from './FullscreenButton';
export function Display({state}){
  const job=state.jobs.find(j=>j.status==='complete');
  return <div className="display-screen"><header><div className="brand"><Icon name="flag" size={30}/>{state.config.eventName}</div><FullscreenButton showLabel/></header>{job?<div className="display-result"><img key={job.id} className="display-photo" src={media(job)} alt="Latest golf portrait"/><div className="display-copy"><h1>Your moment<br/>on the green.</h1><p>Made for you.<br/>Ready to take home.</p><span className="print-caption"><Icon name="print"/>Collect your print at the booth</span>{job.mode==='rehearsal'?<small className="rehearsal-label">Rehearsal photo · No AI applied</small>:null}</div></div>:<div className="display-waiting"><Icon name="flag" size={70}/><h1>The next great shot<br/>could be yours.</h1><p>Visit the photo booth. Your portrait appears here.</p></div>}</div>;
}
