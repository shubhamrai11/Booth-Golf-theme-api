import React, { useEffect, useRef, useState } from 'react';
import { scenes } from '../shared/scenes.mjs';
import { media } from './api';
import { useGuestSession } from './useGuestSession';
import { Icon } from './ui';
import { FullscreenButton } from './FullscreenButton';
import './guest.css';

function GuestIcon({ name, size = 30 }) {
  const paths = {
    camera: <><path d="M8 5l2-3h4l2 3h5a2 2 0 0 1 2 2v13H1V7a2 2 0 0 1 2-2z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="4" fill="none" stroke="var(--icon-cutout, #078127)" strokeWidth="2.6"/></>,
    print: <><path d="M6 8V2h12v6M6 17H2V8h20v9h-4M6 14h12v8H6zM18 11h1"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 16h12l1-16M10 10v8M14 10v8"/></>,
    arrow: <path d="m9 4 8 8-8 8"/>,
    qr: <><path d="M2 2h7v7H2zM15 2h7v7h-7zM2 15h7v7H2zM15 15h3v3h4v4h-7zM12 2v10H2M12 15v7M18 12h4"/></>,
    sparkle: <><path d="M13 1c1.5 8 2.5 9 10 11-7.5 2-8.5 3-10 11-1.5-8-2.5-9-10-11 7.5-2 8.5-3 10-11" fill="currentColor" stroke="none"/><path d="m3 17 1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="currentColor" stroke="none"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function GuestDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current?.focus(); return () => previous?.focus(); }, []);
  return <div className="guest-dialog-backdrop"><section ref={ref} tabIndex={-1} className="guest-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Tab') { const items = ref.current.querySelectorAll('button,a[href]'); const first = items[0], last = items[items.length - 1]; if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><h2>{title}</h2>{children}</section></div>;
}
function Welcome({ guest, disabled, rehearsal }) {
  return <div className="guest-welcome"><section className="guest-welcome-controls">
    <div className="guest-welcome-copy"><h1>Hello!</h1><h2>Click a Golf Photo</h2><p>Choose your favorite golf scene and get your AI photo!</p></div>
    <div className="guest-scenes" role="group" aria-label="Choose your golf scene">{scenes.map((scene, index) => <button key={scene.id} aria-pressed={guest.scene === scene.id} aria-label={scene.label + ' scene'} className={`guest-scene ${guest.scene === scene.id ? 'is-selected' : ''}`} onClick={() => guest.setScene(scene.id)}><span className={`guest-scene-photo ${scene.id === 'classic' ? 'classic-scene-photo' : ''}`} style={{ backgroundPosition: `${index * 100 / 3}% center` }}/>{guest.scene === scene.id ? <span className="scene-selected-check" aria-hidden="true"><Icon name="check" size={16}/></span> : null}<span className="guest-scene-name">{scene.label}</span></button>)}</div>
    <div className="guest-start-area"><button className="guest-primary guest-start" onClick={guest.start} disabled={disabled}><GuestIcon name="camera" size={34}/>CLICK TO START</button><p className="guest-mode">{rehearsal ? 'Rehearsal mode · No AI transformation' : 'Your photo. Your golf moment.'}</p></div>
  </section><div className="guest-welcome-image" role="img" aria-label="A sunny golf course beside a lake"/></div>;
}
function Capture({ guest, config, paused, canRetry }) {
  const { job, phase, count, error } = guest;
  const failed = job?.status === 'failed' || (!job && phase === 'error');
  const processing = ['queued', 'generating'].includes(job?.status);
  const waiting = phase === 'waiting' && !job;
  const captured = job?.status === 'captured';
  const title = failed ? 'Let’s try that again.' : captured ? 'Check your photo' : processing ? 'Looking good!' : waiting ? 'Ready for your photo' : 'Get Ready!';
  const subtitle = captured ? 'A relaxed face makes a better portrait' : processing ? 'Your photo has been captured' : failed ? 'The booth needs a little help' : 'Chin level. Relax your eyes. Small smile.';
  const status = failed ? 'Please ask the booth operator' : captured ? 'Happy with this photo?' : job?.status === 'queued' ? 'Your photo is in the queue…' : processing ? (job.mode === 'rehearsal' ? 'Preparing Your Rehearsal Photo…' : 'Generating Your Golf Photo…') : waiting ? 'Waiting for the camera…' : phase === 'sending' ? 'Taking your photo…' : count ? 'Look straight into the lens' : 'Connecting to the camera…';
  return <div className={`guest-capture${captured ? ' guest-photo-review' : ''}`}>
    <header className="guest-capture-heading"><h1>{title}</h1><p>{subtitle}</p></header>
    <div className="guest-camera-window">
      <video ref={guest.video} autoPlay playsInline muted className={config.cameraMode === 'webcam' && !job && !failed ? 'show-video' : ''}/>
      {job ? <img src={media(job)} alt="Your captured photo"/> : config.cameraMode !== 'webcam' || failed ? <div className="guest-position-guide"><GuestIcon name="camera" size={44}/><p>{failed ? 'Camera capture' : 'Face the camera'}</p><small>{config.cameraMode === 'canon' ? 'Your photo appears after capture' : 'The operator will take your photo'}</small></div> : null}
      <div className="guest-viewfinder" aria-hidden="true"><i/><i/><i/><i/></div>
      {count !== null ? <div className="guest-countdown" role="timer" aria-label={`Photo in ${count} seconds`}><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="53"/><circle cx="60" cy="60" r="53" style={{strokeDashoffset:333 * (1 - count / 6)}}/></svg><span>{count}</span></div> : null}
    </div>
    <div className="guest-generation" aria-live="polite"><h2>{status}</h2>
      {processing || phase === 'sending' || waiting ? <><div className="guest-sparkle"><GuestIcon name="sparkle" size={46}/></div><div className="guest-progress" role="progressbar" aria-label={status}><span/></div></> : null}
      {failed ? <><p className="guest-error" role="alert">{job?.error || error}{!canRetry && job?.status==='failed' ? ' Ask the operator to review this request.' : ''}</p><div className="guest-recovery">{job?.status === 'failed' && canRetry ? <button className="guest-primary" disabled={guest.working} onClick={() => {if(window.confirm('The earlier request may have been charged. Retry after reviewing the AI account?'))guest.action('retry');}}>Retry generation</button> : null}<button className="guest-secondary" onClick={guest.reset}>Back to start</button></div></> : captured ? <><p>Choose a clear photo with your head upright,<br/>eyes relaxed and both shoulders visible.</p><div className="guest-recovery"><button className="guest-primary" disabled={guest.working} onClick={() => guest.action('generate')}>Use this photo</button><button className="guest-secondary" disabled={guest.working} onClick={guest.retake}>Retake photo</button></div></> : <p>{processing ? paused && job.status === 'queued' ? 'The operator will continue shortly.' : job.mode === 'rehearsal' ? 'Testing the print layout. No AI transformation.' : 'This can take a little while.\nPlease stay on this screen.' : waiting ? 'Take the photo using the camera shutter or EOS Utility.' : 'Keep your whole head and shoulders in view.\nFor best results, place the camera at eye level.'}</p>}
      {error && job && !failed ? <p className="guest-error" role="alert">{error}</p> : null}
      {(phase === 'capture' || waiting) && !job ? <button className="guest-link" onClick={guest.reset}>Cancel</button> : null}
    </div>
  </div>;
}
function Result({ guest, cloud }) {
  const [dialog, setDialog] = useState(null);
  const { job, working, error, notice } = guest;
  return <div className="guest-result"><div className="guest-result-media"><div className="guest-result-photo"><img src={media(job)} alt="Your finished golf portrait"/></div></div><section className="guest-result-copy">
    <h1>Your photo is ready!</h1>
    <p className="guest-result-intro">Print your portrait or scan to take it with you.</p>
    {job.mode === 'rehearsal' ? <p className="guest-result-mode">Rehearsal · No AI transformation</p> : null}
    <div className="guest-result-actions"><button className="guest-secondary" onClick={() => { guest.clearMessage(); setDialog('delete'); }} disabled={working}><GuestIcon name="trash" size={31}/><span><strong>DELETE</strong><small>Try again</small></span></button><button className="guest-primary" onClick={() => guest.action('print')} disabled={working}><GuestIcon name="print" size={33}/><span><strong>{working ? 'SENDING…' : 'PRINT'}</strong><small>Get your photo</small></span></button></div>
    <div className="guest-result-links"><button className="guest-link" disabled={working} onClick={guest.reset}>Next guest <GuestIcon name="arrow" size={18}/></button>{job.downloadUrl ? <button className="guest-link" onClick={() => { guest.clearMessage(); setDialog('qr'); }}><GuestIcon name="qr" size={21}/>Scan to download</button> : null}</div>
    {notice || error ? <p className={`guest-result-notice ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p> : null}
    </section>
    {dialog === 'delete' ? <GuestDialog title="Delete this photo?" onClose={() => !working && setDialog(null)}><p>This removes your photo and its download link. You can then take a new photo.</p>{error ? <p className="guest-error" role="alert">{error}</p> : null}<button className="guest-danger" disabled={working} onClick={async () => { if (await guest.action('delete')) setDialog(null); }}>Delete and try again</button><button className="guest-secondary" disabled={working} onClick={() => setDialog(null)}>Keep my photo</button></GuestDialog> : dialog === 'qr' ? <GuestDialog title="Keep your golf photo" onClose={() => setDialog(null)}><img className="guest-qr" src={`/api/qr/${job.id}`} alt="Scan this QR code to download your photo"/><p>Scan with your phone camera.<br/>{cloud ? 'Download using Wi-Fi or mobile data.' : 'Ask the operator for the booth Wi-Fi.'}</p><button className="guest-primary" onClick={() => setDialog(null)}>Done</button></GuestDialog> : null}
  </div>;
}
export function GuestKiosk({ state, refresh, offline }) {
  const guest = useGuestSession(state, refresh);
  const screen = guest.job?.status === 'complete' ? 'result' : guest.phase === 'welcome' ? 'welcome' : 'capture';
  return <main className={`guest-shell guest-${screen}-shell`}><div className={`guest-experience ${screen}`}>
    <header className="guest-welcome-header"><div className="guest-logo"><Icon name="flag" size={44}/><span>YOUR LOGO</span></div><div className="guest-header-actions">{screen === 'welcome' ? <a className="guest-settings" href="/?view=setup&from=kiosk" aria-label="Admin settings"><Icon name="settings" size={20}/><span>Settings</span></a> : null}<FullscreenButton/></div></header>
    {offline ? <div className="guest-offline" role="alert">Connection lost. Reconnecting to the booth…</div> : null}
    {screen === 'welcome' ? <Welcome guest={guest} disabled={offline || state.capturing} rehearsal={state.config.mode === 'rehearsal'}/> : screen === 'result' ? <Result key={guest.job.id} guest={guest} cloud={state.cloud}/> : <Capture guest={guest} config={state.config} paused={state.paused} canRetry={!state.cloud || state.role==='admin'}/>}
  </div></main>;
}
