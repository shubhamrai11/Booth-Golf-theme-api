import React, { useState } from 'react';
import { api, post, resetApiSession } from './api';
import { Button, Field, Icon } from './ui';
import { FullscreenButton } from './FullscreenButton';
import './cloud.css';
export function CloudAccess({ attention, refresh }) {
  const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/login',{method:'POST',withoutToken:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({password})}); resetApiSession();setPassword('');await refresh(); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="cloud-access"><div className="cloud-access-tools"><FullscreenButton/></div><section className="cloud-access-card"><Icon name="flag" size={40}/><p className="cloud-eyebrow">FAIRWAY STUDIO</p><h1>{attention.loginRequired ? 'Welcome, operator.' : 'Connect your cloud booth.'}</h1><p>{attention.loginRequired ? 'Sign in to prepare the camera, printer and golf experience.' : 'Finish the secure server setup in your Vercel project, then redeploy.'}</p>
    {attention.loginRequired ? <form onSubmit={login}><Field label="Admin password"><input autoFocus type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></Field><Button disabled={busy || !password}>{busy?'Signing in…':'Open studio'}</Button></form> : <><ul className="cloud-missing">{attention.missing?.map(name=><li key={name}>{name}</li>)}</ul><p>{attention.error}</p><a className="button secondary" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Open Vercel settings</a><p className="help">Your API key and database credentials stay in Vercel. Add the variables from the repository’s Vercel setup guide.</p><Button onClick={()=>refresh().catch(e=>setError(e.message))}>Check setup again</Button></>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section></main>;
}
export function CloudConnection({ state, refresh, notify, beforeConnect }) {
  const connection=state.cloudConnection || {};
  const [url,setUrl]=useState(connection.url || ''),[token,setToken]=useState(''),[enabled,setEnabled]=useState(!!connection.enabled),[busy,setBusy]=useState(false);
  async function save() {
    setBusy(true); try { await beforeConnect?.(); await post('/api/cloud-connection',{url,token,enabled});setToken('');await refresh();notify('Cloud helper connection saved.'); }
    catch(e) {notify(e.message,true);} finally {setBusy(false);}
  }
  return <section className="cloud-connection"><h2>Connect this Windows booth</h2><p className="help">Keep this app running on the camera and printer PC. It receives capture and print commands from your Vercel website.</p><p className={`connection-status ${connection.online?'is-online':''}`}>{connection.online?'Connected to cloud':connection.enabled?'Waiting for cloud connection':'Cloud helper is off'}</p>
    <Field label="Vercel website address"><input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://your-booth.vercel.app"/></Field><Field label="Device token" hint="Use the same BOOTH_DEVICE_TOKEN saved in Vercel. It is encrypted on this Windows PC."><input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder={connection.hasToken?'Token saved · leave blank to keep':'Your device token'}/></Field><label className="check-row"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enable cloud camera and printer connection</label><Button secondary onClick={save} disabled={busy || !url}>{busy?'Connecting…':'Save cloud connection'}</Button>{connection.error?<p className="inline-error" role="alert">{connection.error}</p>:null}
  </section>;
}
