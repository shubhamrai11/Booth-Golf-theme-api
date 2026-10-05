import React, { useEffect, useState } from 'react';
import { Icon } from './ui';

const activeFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

export function FullscreenButton({ className = '', showLabel = false }) {
  const [active, setActive] = useState(activeFullscreen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => { setActive(activeFullscreen()); setError(''); };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  async function toggle() {
    if (busy) return;
    setError(''); setBusy(true);
    try {
      if (activeFullscreen()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (!exit) throw new Error('unsupported');
        await exit.call(document);
      } else {
        const element = document.documentElement;
        const enter = element.requestFullscreen || element.webkitRequestFullscreen;
        if (!enter) throw new Error('unsupported');
        await enter.call(element);
      }
      setActive(activeFullscreen());
    } catch (e) {
      setError(e.message === 'unsupported'
        ? 'This browser does not support full screen. You can use its Add to Home Screen option instead.'
        : 'Full screen could not open. Try again in your browser, or use its full-screen option.');
    } finally { setBusy(false); }
  }

  const label = active ? 'Exit full screen' : 'Enter full screen';
  return <div className={`fullscreen-control ${className}`}>
    <button type="button" className="fullscreen-button" onClick={toggle} disabled={busy}
      aria-label={label} aria-pressed={active} title={`${label}${active ? ' (Esc to exit)' : ''}`}>
      <Icon name={active ? 'minimize' : 'maximize'} size={23}/>
      {showLabel ? <span>{active ? 'Exit full screen' : 'Full screen'}</span> : null}
    </button>
    {error ? <div className="fullscreen-notice" role="status"><p>{error}</p><button type="button" onClick={() => setError('')} aria-label="Dismiss full-screen message">×</button></div> : null}
  </div>;
}
