import React from 'react';
export function Icon({ name, size = 22, ...props }) {
  const paths = {
    flag: <><path d="M6 22V2l14 6-14 6M2 22h12"/></>,
    camera: <><path d="M8 5l2-3h4l2 3h4a2 2 0 0 1 2 2v13H2V7a2 2 0 0 1 2-2z"/><circle cx="12" cy="12" r="4"/></>,
    external: <><path d="M14 3h7v7M21 3l-9 9M10 5H4v16h16v-6"/></>,
    maximize: <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>,
    minimize: <path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3"/>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 6"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    print: <><path d="M6 8V2h12v6M6 17H2V8h20v9h-4M6 14h12v8H6zM18 11h1"/></>,
    plug: <><path d="M8 2v6M16 2v6M5 8h14v3a7 7 0 0 1-14 0zM12 18v4"/></>,
    check: <path d="m5 12 4 4L20 5"/>,
    settings: <><path d="m9 3 1-1h4l1 3 2 1 3-.5 2 3.5-2 2v2l2 2-2 3.5-3-.5-2 1-1 3h-4l-1-3-2-1-3 .5-2-3.5 2-2v-2l-2-2L4 5.5 7 6l2-1z"/><circle cx="12" cy="12" r="3"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.camera}</svg>;
}
export function Button({ children, secondary, className = '', ...props }) { return <button className={`button ${secondary ? 'secondary' : ''} ${className}`} {...props}>{children}</button>; }
export function Field({ label, hint, children }) { return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>; }
export function Empty({ children }) { return <div className="empty"><Icon name="image"/>{children}</div>; }
