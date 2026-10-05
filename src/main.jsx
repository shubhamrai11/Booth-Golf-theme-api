import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GuestKiosk } from './GuestKiosk';
import { TemporarySettings } from './TemporarySettings';
import { TemporaryDisplay } from './TemporaryDisplay';
import { FullscreenButton } from './FullscreenButton';
import { Icon, Button } from './ui';
import { connected, getInfo, getPresets, helperJson, isLocal } from './temporary-api';
import './styles.css';
import './responsive.css';
import './temporary.css';
const preferencesKey='fairway-preferences-v4';
const params=new URLSearchParams(location.search);
function App(){
  const [state,setState]=useState(null),[error,setError]=useState(''),[assets,setAssets]=useState({}),[settings,setSettings]=useState(params.get('view')==='setup'),[pair,setPair]=useState(null),[paired,setPaired]=useState(false);
  useEffect(()=>{let live=true;getInfo().then(async data=>{let saved={};if(!isLocal)try{saved=JSON.parse(localStorage.getItem(preferencesKey)||'{}');}catch{}if(live)setState({...data,config:{...data.config,...saved}});if(connected()){const presets=await getPresets(isLocal?data:await helperJson('/api/temporary/info'));if(live)setAssets(presets);}}).catch(e=>{if(live)setError(e.message);});if(isLocal&&params.get('connect'))helperJson('/api/temporary/pair/details',{id:params.get('connect')}).then(p=>{if(live)setPair(p);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
  useEffect(()=>{const pop=()=>setSettings(new URLSearchParams(location.search).get('view')==='setup');window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{window.scrollTo(0,0);},[settings]);
  function navigateSetup(value){history.pushState({},'',value?'/?view=setup&from=kiosk':'/kiosk');setSettings(value);}
  async function save(config,equipment){if(isLocal){const data=await helperJson('/api/temporary/settings',{...config,...equipment});setState(data);}else{localStorage.setItem(preferencesKey,JSON.stringify(config));setState(s=>({...s,config}));}}
  if(pair)return <div className="temporary-pair"><Icon name="plug" size={36}/><h1>{paired?'Website connected.':'Connect this website?'}</h1><p>The website below will be able to capture from this camera, send prints, and request paid AI images while this helper is running.</p><p className="temporary-pair-url">{pair.origin}</p>{paired?<p role="status">Return to the website. Keep the Windows helper running during the event.</p>:<Button onClick={async()=>{try{await helperJson('/api/temporary/pair/approve',{id:params.get('connect')});setPaired(true);}catch(e){setError(e.message);}}}>Allow connection</Button>}<Button secondary onClick={()=>{history.replaceState({},'','/?view=setup');setPair(null);setSettings(true);}}>Open settings</Button>{error?<p role="alert">{error}</p>:null}</div>;
  if(!state)return <div className="boot"><div className="boot-tools"><FullscreenButton/></div><Icon name="flag" size={44}/><h1>Fairway Studio</h1><p role={error?'alert':'status'}>{error||'Preparing your studio…'}</p></div>;
  const view={...state,assets,openSettings:()=>navigateSetup(true),jobs:[]};
  if(location.pathname==='/display')return <TemporaryDisplay config={state.config}/>;
  if(settings)return <TemporarySettings state={view} save={save} back={()=>navigateSetup(false)} setAssets={setAssets}/>;
  return <GuestKiosk state={view}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
