import { useEffect, useRef, useState } from 'react';
import { api, post } from './api';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const storageKey = 'fairway-guest-capture';
export function useGuestSession(state, refresh) {
  const [requestId, setRequestId] = useState(() => sessionStorage.getItem(storageKey) || '');
  const [phase, setPhase] = useState(() => sessionStorage.getItem(storageKey) ? 'waiting' : 'welcome');
  const [count, setCount] = useState(null), [error, setError] = useState('');
  const [scene, setScene] = useState('classic'), [working, setWorking] = useState(false), [notice, setNotice] = useState('');
  const video = useRef(null), stream = useRef(null), operation = useRef(0), locked = useRef(false), seenJob = useRef('');
  const job = state.jobs.find(j => requestId && j.captureRequestId === requestId);
  function stopCamera() { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; }
  useEffect(() => () => { operation.current++; stopCamera(); }, []);
  useEffect(() => {
    if (job) seenJob.current = job.id;
    else if (requestId && seenJob.current) { setError('This photo is no longer available. Please start a new photo.'); setPhase('error'); seenJob.current = ''; }
  }, [job, requestId]);
  useEffect(() => {
    if (phase !== 'waiting' || job) return;
    const timer = setTimeout(() => { setError('No photo has arrived yet. Ask the booth operator to check the camera.'); setPhase('error'); }, 180000);
    return () => clearTimeout(timer);
  }, [phase, job]);
  async function reset() {
    if (working) return;
    operation.current++; stopCamera(); locked.current = false;
    if (!job && requestId) {
      try { await post('/api/capture/cancel', { requestId }); } catch(e) { setError(e.message); return; }
    }
    seenJob.current = ''; setRequestId(''); sessionStorage.removeItem(storageKey); setPhase('welcome'); setCount(null); setError(''); setNotice('');
  }
  async function start() {
    if (locked.current || working || state.capturing) return;
    locked.current = true; const current = ++operation.current;
    setError(''); setNotice(''); setPhase('capture'); setCount(null);
    try {
      if (state.config.cameraMode === 'webcam') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('The camera is not available in this browser. Ask the booth operator for help.');
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (operation.current !== current) { mediaStream.getTracks().forEach(t => t.stop()); return; }
        stream.current = mediaStream;
        for (let i = 0; i < 100 && !video.current; i++) await pause(50);
        if (!video.current) throw new Error('Camera preview could not open. Please try again.');
        video.current.srcObject = mediaStream; await video.current.play();
        for (let i = 0; i < 100 && !video.current?.videoWidth; i++) await pause(50);
        if (!video.current?.videoWidth) throw new Error('The camera is not sending a picture yet. Please try again.');
      }
      for (let n = 6; n > 0; n--) {
        if (current !== operation.current) return;
        setCount(n); await pause(1000);
      }
      if (current !== operation.current) return;
      setCount(null); setPhase('sending');
      const id = crypto.randomUUID(); setRequestId(id); sessionStorage.setItem(storageKey, id);
      const query = '?scene=' + scene + '&requestId=' + id + '&review=true';
      let response;
      if (state.config.cameraMode === 'webcam') {
        const camera = video.current, canvas = document.createElement('canvas');
        canvas.width = camera.videoWidth; canvas.height = camera.videoHeight;
        canvas.getContext('2d').drawImage(camera, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.96));
        if (!blob) throw new Error('Could not capture the camera picture. Please try again.');
        response = await api('/api/capture/webcam' + query, { method: 'POST', body: blob });
      } else response = await post('/api/capture' + query);
      if (current !== operation.current) return;
      setPhase(response.waiting ? 'waiting' : 'processing'); await refresh();
    } catch(e) {
      if (current === operation.current) { setError(e.name === 'NotAllowedError' ? 'Camera access was not allowed. Ask the booth operator to enable it.' : e.message); setPhase('error'); }
    } finally {
      if (current === operation.current) { stopCamera(); setCount(null); locked.current = false; }
    }
  }
  async function action(name) {
    if (locked.current || !job) return false;
    locked.current = true; setWorking(true); setError(''); setNotice('');
    try {
      await post(`/api/sessions/${job.id}/${name}`);
      if (name === 'delete') { seenJob.current = ''; setRequestId(''); sessionStorage.removeItem(storageKey); setPhase('welcome'); }
      if (name === 'print') setNotice('Sent to the printer. Please collect your photo.');
      if (name === 'generate' || name === 'retry') setPhase('processing');
      await refresh(); return true;
    } catch(e) { setError(e.message); return false; }
    finally { setWorking(false); locked.current = false; }
  }
  async function retake() {
    if (job?.status === 'captured' && await action('delete')) await start();
  }
  return { phase, count, scene, setScene, job, video, start, reset, action, retake, error, notice, working, clearMessage: () => { setError(''); setNotice(''); } };
}
