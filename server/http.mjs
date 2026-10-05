import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { saveKey } from './secrets.mjs';
const exec = promisify(execFile);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(data)); };
async function body(req, limit = 20 * 1024 * 1024) {
  if (Number(req.headers['content-length']) > limit) throw new Error('Request too large (20 MB maximum).');
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > limit) throw new Error('Request too large.'); parts.push(part); }
  return Buffer.concat(parts);
}
async function readJson(req) { return JSON.parse((await body(req, 200000)).toString() || '{}'); }
export function lanAddresses() { return Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address); }
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };
function staticFile(res, file) {
  if (!existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' }); res.end(readFileSync(file));
}
export function createServers(booth) {
  const csrf = randomBytes(32).toString('hex'); let publicPort = 4311;
  const downloadUrl = job => {
    const base = booth.state.config.downloadBaseUrl || (lanAddresses()[0] ? 'http://' + lanAddresses()[0] + ':' + publicPort : '');
    return base ? base + '/p/' + job.token : '';
  };
  const headers = res => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  };
  const admin = http.createServer(async (req,res) => {
    headers(res);
    try {
      const host = req.headers.host || '', port = admin.address()?.port;
      if (!['127.0.0.1:' + port, 'localhost:' + port].includes(host)) return json(res,403,{ error:'Operator controls are available only on this PC.' });
      if (req.headers.origin && !['http://127.0.0.1:' + port, 'http://localhost:' + port].includes(req.headers.origin)) return json(res,403,{ error:'Untrusted origin.' });
      const u = new URL(req.url, 'http://' + host), route = u.pathname;
      if (!['GET','HEAD'].includes(req.method)) {
        const token = String(req.headers['x-booth-token'] || '');
        if (token.length !== csrf.length || !timingSafeEqual(Buffer.from(token),Buffer.from(csrf))) return json(res,403,{ error:'Refresh the booth screen and try again.' });
      }
      if (route === '/api/bootstrap' && req.method === 'GET') return json(res,200,{ token:csrf });
      if (route === '/api/state' && req.method === 'GET') return json(res,200,{ ...booth.view(), addresses:lanAddresses(), publicPort, jobs:booth.view().jobs.map(j => ({ ...j, downloadUrl:j.status === 'complete' ? downloadUrl(j) : '' })) });
      if (route === '/api/settings' && req.method === 'POST') return json(res,200,booth.configure(await readJson(req)));
      if (route === '/api/cloud-connection' && req.method === 'POST') {
        if (!booth.relay) throw new Error('The Windows cloud helper is not available.');
        return json(res,200,await booth.relay.configure(await readJson(req)));
      }
      if (route === '/api/key' && req.method === 'POST') {
        const { key } = await readJson(req);
        if (typeof key !== 'string' || key.length > 1000 || /\s/.test(key)) throw new Error('Enter a valid API key without spaces.');
        await saveKey(booth.root, key); booth.key = key;
        if (!key) booth.state.config.mode = 'rehearsal'; booth.persist(); return json(res,200,{ saved:!!key });
      }
      const assetKinds = { '/api/reference': 'reference', '/api/outfit-reference': 'outfitReference', '/api/overlay': 'overlay' };
      if (Object.hasOwn(assetKinds, route) && req.method === 'POST') return json(res,200,{ name:await booth.setAsset(await body(req),assetKinds[route]) });
      if (route === '/api/outfit-reference' && req.method === 'DELETE') { booth.state.config.outfitReference = ''; booth.persist(); return json(res,200,{ ok:true }); }
      if (route === '/api/overlay' && req.method === 'DELETE') { booth.state.config.overlay = ''; booth.persist(); return json(res,200,{ ok:true }); }
      if (route === '/api/capture' && req.method === 'POST') {
        const options = { scene: u.searchParams.get('scene') || 'classic', requestId: u.searchParams.get('requestId') || '', review: u.searchParams.get('review') };
        if (booth.state.config.cameraMode === 'canon') return json(res,200,await booth.captureCanon(options));
        if (booth.state.config.cameraMode === 'folder') { if (!booth.state.config.watchEnabled) throw new Error('Enable camera folder monitoring in Setup first.'); return json(res,200,booth.armFolderCapture(options)); }
        throw new Error('Use the connected webcam to capture a photo.');
      }
      if (route === '/api/capture/cancel' && req.method === 'POST') {
        const { requestId } = await readJson(req);
        if (requestId && booth.pendingCapture?.requestId === requestId) booth.pendingCapture = null;
        return json(res,200,{ok:true});
      }
      if (route === '/api/capture/webcam' && req.method === 'POST') {
        if (booth.state.config.cameraMode !== 'webcam') throw new Error('Select the webcam camera mode first.');
        return json(res,200,await booth.captureBuffer(await body(req), { scene: u.searchParams.get('scene') || 'classic', requestId: u.searchParams.get('requestId') || '', review: u.searchParams.get('review') }));
      }
      const action = route.match(/^\/api\/sessions\/([a-f0-9-]+)\/(generate|retry|delete|print)$/);
      if (action && req.method === 'POST') {
        const job = booth.getJob(action[1]);
        if (['generate','retry'].includes(action[2])) return json(res,200,booth.enqueue(job.id));
        if (action[2] === 'delete') { booth.remove(job.id); return json(res,200,{ok:true}); }
        if (action[2] === 'print') {
          if (job.status !== 'complete') throw new Error('This photo is not ready to print.');
          if (!booth.state.config.printerName) throw new Error('Choose your Windows printer in Setup first.');
          await exec(path.join(booth.appRoot,'native','PrintPhoto.exe'), [booth.file('results',job.id + '.jpg'),booth.state.config.printerName], { windowsHide:true,timeout:30000,maxBuffer:65536 }).catch(e => { throw new Error(e.stderr?.trim() || 'Could not send the photo to the printer. Check its driver and paper settings.'); });
          job.lastPrintedAt = new Date().toISOString(); booth.persist(); return json(res,200,{ok:true});
        }
      }
      if (route === '/api/printers' && req.method === 'GET') { const { stdout } = await exec(path.join(booth.appRoot,'native','PrintPhoto.exe'),['--list'],{windowsHide:true,timeout:15000}); return json(res,200,JSON.parse(stdout)); }
      if (route === '/api/queue' && req.method === 'POST') { const { paused } = await readJson(req); booth.state.paused = !!paused; booth.persist(); booth.drain(); return json(res,200,{ok:true}); }
      const media = route.match(/^\/api\/media\/(originals|results|assets)\/([a-zA-Z0-9_.-]+)$/);
      if (media && req.method === 'GET') {
        const file = booth.file(media[1],media[2]);
        if (u.searchParams.get('thumb') === '1' && existsSync(file)) { const buffer = await sharp(file).resize(450,450,{fit:'inside'}).jpeg({quality:80}).toBuffer(); res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'}); return res.end(buffer); }
        return staticFile(res,file);
      }
      const qr = route.match(/^\/api\/qr\/([a-f0-9-]+)$/);
      if (qr && req.method === 'GET') { const job = booth.getJob(qr[1]), url = downloadUrl(job); if (!url || job.status !== 'complete') throw new Error('No download address is available.'); res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'}); return res.end(await QRCode.toBuffer(url,{width:360,margin:4,errorCorrectionLevel:'M'})); }
      if (route === '/api/shutdown' && req.method === 'POST') { json(res,200,{ok:true}); setTimeout(() => { booth.stop(); admin.close(); guest.close(); admin.closeAllConnections(); guest.closeAllConnections(); },300); return; }
      if (route.startsWith('/api/')) return json(res,404,{error:'Not found.'});
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Method not allowed.'});
      const dist = path.resolve(booth.appRoot,'dist');
      if (route.startsWith('/assets/')) { const file = path.resolve(dist,'.' + decodeURIComponent(route)); if (!file.startsWith(dist + path.sep)) return json(res,404,{error:'Not found.'}); return staticFile(res,file); }
      return staticFile(res,path.join(dist,'index.html'));
    } catch(e) { if (!res.headersSent) json(res,400,{error:e.message || 'The request failed.'}); else res.end(); }
  });
  const guest = http.createServer((req,res) => {
    headers(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Read only.'); }
    const u = new URL(req.url,'http://localhost');
    const match = u.pathname.match(/^\/(p|photo|download)\/([a-zA-Z0-9_-]{32})$/);
    const job = match && booth.state.jobs.find(j => j.token === match[2] && j.status === 'complete' && new Date(j.expiresAt) > new Date());
    if (!job) { res.writeHead(404,{'Content-Type':'text/plain'}); return res.end('This photo link is unavailable or has expired. Please ask the booth operator.'); }
    if (match[1] !== 'p') { res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, no-store',...(match[1] === 'download' ? {'Content-Disposition':'attachment; filename="golf-portrait.jpg"'} : {})}); return res.end(readFileSync(booth.file('results',job.id + '.jpg'))); }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your golf portrait</title><style>body{margin:0;background:#f4f6f4;color:#123d30;font:16px Arial;text-align:center;padding:28px 16px}main{max-width:540px;margin:auto}h1{font:36px Georgia}img{display:block;max-width:100%;max-height:70vh;margin:24px auto;border-radius:4px}a{display:block;background:#123d30;color:white;padding:18px;border-radius:6px;text-decoration:none}small{display:block;margin-top:20px;color:#5a6761}</style></head><body><main><h1>Your moment on the green.</h1><p>' + esc(job.eventName) + (job.mode === 'rehearsal' ? ' · Rehearsal photo — no AI applied' : '') + '</p><img alt="Your golf portrait" src="/photo/' + job.token + '"><a href="/download/' + job.token + '" download>Download photo</a><small>Available until ' + esc(new Date(job.expiresAt).toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata'})) + '. Keep this link to access your photo.</small></main></body></html>');
  });
  return { admin, guest, async listen(adminPort=4310, guestPort=4311) {
    await new Promise((resolve,reject) => admin.once('error',reject).listen(adminPort,'127.0.0.1',resolve));
    try { await new Promise((resolve,reject) => guest.once('error',reject).listen(guestPort,'0.0.0.0',resolve)); } catch(e) { admin.close(); throw e; }
    publicPort = guest.address().port; return { adminPort:admin.address().port, guestPort:publicPort };
  }, async close() { booth.stop(); admin.closeAllConnections(); guest.closeAllConnections(); await Promise.all([new Promise(r => admin.close(r)), new Promise(r => guest.close(r))]); } };
}
