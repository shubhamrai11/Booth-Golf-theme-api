import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { Booth } from './Booth';
import { Setup } from './Setup';
import { Sessions } from './Sessions';
import { Display } from './Display';
import { GuestKiosk } from './GuestKiosk';
import { Icon } from './ui';
import { CloudAccess } from './CloudAccess';
import { WindowsHelper } from './WindowsHelper';
import './styles.css';
const initialParams = new URLSearchParams(location.search);
const openedFromKiosk = initialParams.get('from') === 'kiosk';
function App() {
  const [state,setState] = useState(null), [tab,setTab] = useState(() => initialParams.get('view') === 'setup' ? 'Setup' : 'Booth'), [toast,setToast] = useState(null), [offline,setOffline] = useState(false);
  const [attention,setAttention]=useState(null);
  const refresh=useCallback(async()=>{try {const view=location.pathname==='/kiosk'?'kiosk':location.pathname==='/display'?'display':'operator';const data=await api('/api/state?view='+view);setState(data);setAttention(null);setOffline(false);return data;}catch(e){if(e.data?.cloud && (e.status===401 || e.status===503)){setState(null);setAttention(e.data);}throw e;}},[]);
  const notify=useCallback((message,error=false)=>setToast({message,error,at:Date.now()}),[]);
  useEffect(()=>{let canceled=false;let timer; async function poll(){try{if(!canceled)await refresh();}catch{if(!canceled)setOffline(true);}if(!canceled)timer=setTimeout(poll,1500);}poll();return()=>{canceled=true;clearTimeout(timer);};},[refresh]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(null),toast.error?15000:6500);return()=>clearTimeout(t);},[toast]);
  if(attention)return <CloudAccess attention={attention} refresh={refresh}/>;
  if(!state)return <div className="boot"><Icon name="flag" size={44}/><h1>Fairway Studio</h1><p>{offline?'The booth cannot connect. Check the server connection and refresh.':'Preparing your studio…'}</p></div>;
  if(state.helper)return <><WindowsHelper state={state} refresh={refresh} notify={notify}/>{toast?<div className={`toast ${toast.error?'error':''}`} role={toast.error?'alert':'status'}><span>{toast.message}</span><button onClick={()=>setToast(null)} aria-label="Dismiss notification">×</button></div>:null}</>;
  if(location.pathname==='/display')return <Display state={state}/>;
  if(location.pathname==='/kiosk')return <GuestKiosk state={state} refresh={refresh} offline={offline}/>;
  return <><header className="app-header"><a className="brand" href="/"><Icon name="flag" size={30}/>Fairway Studio</a><nav aria-label="Main navigation">{['Booth','Sessions','Setup'].map(t=><button key={t} className={tab===t?'selected':''} onClick={()=>setTab(t)}>{t}</button>)}</nav><div className="operator-screen-links"><a className="button secondary header-display" href="/kiosk" target={openedFromKiosk ? undefined : '_blank'} rel="noreferrer"><Icon name="camera" size={19}/>{openedFromKiosk ? 'Back to welcome' : 'Guest screen'}</a><a className="button secondary header-display" href="/display" target="_blank" rel="noreferrer"><Icon name="external" size={19}/>Open display</a></div></header>
    {offline?<div className="offline-banner" role="alert">Connection to the booth was lost. Reconnecting…</div>:null}
    <main className="app-main">{tab==='Booth'?<><Booth state={state} refresh={refresh} notify={notify} goSetup={()=>setTab('Setup')}/><Sessions state={state} refresh={refresh} notify={notify} compact onViewAll={()=>setTab('Sessions')}/></>:tab==='Sessions'?<Sessions state={state} refresh={refresh} notify={notify}/>:<Setup state={state} refresh={refresh} notify={notify} returnToKiosk={openedFromKiosk}/>}</main>
    {state.watchError?<div className="watch-error" role="status">{state.watchError}</div>:null}
    {toast?<div className={`toast ${toast.error?'error':''}`} role={toast.error?'alert':'status'}><span>{toast.message}</span><button onClick={()=>setToast(null)} aria-label="Dismiss notification">×</button></div>:null}
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
