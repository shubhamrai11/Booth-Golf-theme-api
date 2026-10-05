import React, { useEffect, useRef, useState } from 'react';
import { api, post, media } from './api';
import { Button, Icon } from './ui';

export function Booth({ state, refresh, notify, goSetup, kiosk = false }) {
  const [busy, setBusy] = useState(false), [count, setCount] = useState(null), [focus, setFocus] = useState(null);
  const [prompt, setPrompt] = useState(state.config.prompt), [waiting, setWaiting] = useState(false);
  const [cameraError, setCameraError] = useState(''), [printing, setPrinting] = useState(false);
  const video = useRef(null), stream = useRef(null), mounted = useRef(true), first = useRef(true);
  const job = state.jobs.find(j => j.id === focus);
  const latestId = state.jobs[0]?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (latestId) { setFocus(latestId); setWaiting(false); }
  }, [latestId]);
  useEffect(() => {
    if (state.config.cameraMode !== 'webcam') return;
    let canceled = false;
    navigator.mediaDevices?.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(s => {
      if (canceled) { s.getTracks().forEach(t => t.stop()); return; }
      stream.current = s; if (video.current) video.current.srcObject = s; setCameraError('');
    }).catch(() => setCameraError('Camera permission is needed. Allow access in the browser or select the Canon camera in Setup.'));
    return () => { canceled = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  }, [state.config.cameraMode]);
  async function capture() {
    if (busy) return; setBusy(true); setFocus(null);
    try {
      if (state.config.cameraMode === 'webcam' && !video.current?.videoWidth) throw new Error(cameraError || 'The camera is not ready. Check its connection and permissions.');
      for (let i = 3; i > 0; i--) { if (!mounted.current) return; setCount(i); await new Promise(r => setTimeout(r, 850)); }
      if (!mounted.current) return; setCount(null);
      let response;
      if (state.config.cameraMode === 'webcam') {
        const v = video.current, canvas = document.createElement('canvas');
        canvas.width = v.videoWidth; canvas.height = v.videoHeight; canvas.getContext('2d').drawImage(v, 0, 0);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.96));
        response = await api('/api/capture/webcam', { method: 'POST', body: blob });
      } else response = await post('/api/capture?requestId='+crypto.randomUUID());
      if (response.waiting) { setWaiting(true); notify(state.cloud && state.config.cameraMode==='canon' ? 'Waiting for the Windows camera to capture.' : 'Take the photo in EOS Utility or with the camera shutter. It will appear automatically.'); }
      else setFocus(response.id);
      await refresh();
    } catch(e) { notify(e.message, true); }
    finally { if (mounted.current) { setBusy(false); setCount(null); } }
  }
  const ready = job?.status === 'complete', processing = ['queued','generating'].includes(job?.status);
  async function action(name) { if (name === 'print' && printing) return; try { if (name === 'print') setPrinting(true); const response=await post(`/api/sessions/${job.id}/${name}`); if (name === 'print') notify(response.queued ? 'Print queued for the Windows booth.' : 'Photo sent to the Windows print queue.'); await refresh(); } catch(e) { notify(e.message, true); } finally { setPrinting(false); } }
  return <>
    <div className={`booth-layout ${kiosk ? 'kiosk-layout' : ''}`}>
      <section className="capture-section">
        <h1>{ready ? 'A moment worth keeping.' : 'Your next great shot.'}</h1>
        <p className="lead">{ready ? 'Your golf portrait is ready.' : 'One guest. A whole new game.'}</p>
        <div className={`camera-stage ${job ? 'has-photo' : ''}`}>
          {state.config.cameraMode === 'webcam' ? <video className={!job ? 'live visible' : 'live'} ref={video} autoPlay playsInline muted/> : null}
          {job ? <img className="captured" src={media(job)} alt={ready ? 'Finished guest portrait' : 'Captured guest photo'}/> : null}
          {!job && (state.config.cameraMode !== 'webcam' || cameraError) ? <div className="camera-empty"><div className="portrait-guide"/><Icon name="camera" size={46}/><strong>{waiting ? 'Waiting for your camera' : 'Ready for your guest'}</strong><span>{cameraError || (state.config.cameraMode === 'canon' ? 'Canon R100 / EOS 200D · USB capture' : 'Capture your photo to get started')}</span></div> : null}
          {count ? <div className="countdown" aria-live="assertive">{count}</div> : null}
          {processing ? <div className="processing"><div className="spinner"/><strong>{job.status === 'queued' ? 'Your portrait is in the queue' : job.mode === 'rehearsal' ? 'Preparing rehearsal print' : 'Creating your golf portrait'}</strong><span>{job.mode === 'rehearsal' ? 'Testing the flow. No AI transformation.' : 'Your face. A whole new setting.'}</span></div> : null}
          {job?.status === 'failed' ? <div className="processing error-pane"><strong>Let’s try that again.</strong><p>{job.error}</p><Button onClick={() => action('retry')}>Retry generation</Button></div> : null}
        </div>
        <div className="capture-actions">
          <Button onClick={capture} disabled={busy || state.capturing}><Icon name="camera"/>{busy ? 'Taking photo…' : 'Capture photo'}</Button>
          {ready ? <Button secondary disabled={printing} onClick={() => action('print')}><Icon name="print"/>{printing ? 'Sending…' : 'Print photo'}</Button> : null}
          {job?.status === 'captured' ? <Button secondary onClick={() => action('generate')}>Generate portrait</Button> : null}
        </div>
        {ready ? <div className="result-note">{job.mode === 'rehearsal' ? 'Rehearsal result · The original photo is framed; AI has not been applied.' : 'AI modified portrait'}{job.lastPrintedAt ? ' · Sent to printer' : ''}</div> : null}
      </section>
      {!kiosk ? <aside className="experience"><h2>Golf experience</h2>
        <button className="reference-preview" onClick={goSetup} aria-label="Change golf reference in Setup">{state.config.reference ? <img src={`/api/media/assets/${state.config.reference}?thumb=1`} alt="Your golf composition reference"/> : <div className="camera-empty">Add your golf reference in Setup</div>}<span>Saved golf reference <Icon name="chevron" size={17}/></span></button>
        <label className="field prompt-field"><span>Generation prompt</span><textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={6}/></label>
        <div className="connection"><span>Connection</span><button onClick={goSetup}><Icon name="plug"/><span>{state.config.mode === 'rehearsal' ? 'Rehearsal mode · no AI' : state.hasKey ? 'Live AI configured' : 'Setup needed'}</span><Icon name="chevron" size={16}/></button></div>
        <Button onClick={async () => { try { await post('/api/settings', { prompt }); await refresh(); notify('Golf experience saved.'); } catch(e) { notify(e.message, true); } }}>Save experience</Button>
      </aside> : null}
    </div>
    {kiosk && ready ? <div className="kiosk-share">{job.downloadUrl ? <img width="150" src={`/api/qr/${job.id}`} alt="QR code to download this portrait"/> : null}<p>Keep your portrait.<br/>Print here or scan to download.</p></div> : null}
  </>;
}
