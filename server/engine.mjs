import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { defaults } from './defaults.mjs';
import { normalizeImage, normalizeOverlay, composePortrait } from './media.mjs';
import { generatePortrait } from './provider.mjs';
import { captureOptions, scenePrompt } from '../shared/scenes.mjs';
import { imageModels, qualityOptions, sizeOptions } from '../shared/image-models.mjs';
const exec = promisify(execFile);

export class Booth extends EventEmitter {
  constructor({ root, appRoot, generate = generatePortrait }) {
    super(); this.root = root; this.appRoot = appRoot; this.generate = generate; this.key = ''; this.busy = false; this.capturing = false; this.stopped = false; this.watchError = ''; this.seen = new Map();
    for (const folder of ['originals','results','generated','assets']) mkdirSync(path.join(root, folder), { recursive: true });
    const file = path.join(root, 'state.json');
    this.state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { config: { ...defaults }, jobs: [], paused: false };
    this.state.config = { ...defaults, ...this.state.config, watchEnabled: false };
    this.state.jobs.forEach(job => { if (job.status === 'generating') { job.status = 'failed'; job.error = 'The app closed during generation. Check your AI account before retrying; the previous request may have been charged.'; } });
    for (const name of ['golf-reference.jpg', 'golf-outfit-reference.jpg']) {
      if (!existsSync(path.join(root, 'assets', name)) && existsSync(path.join(appRoot,'assets',name))) copyFileSync(path.join(appRoot, 'assets', name), path.join(root, 'assets', name));
    }
    for (const key of ['reference','outfitReference']) if (!existsSync(path.join(root,'assets',this.state.config[key]))) this.state.config[key]='';
    this.persist();
  }
  persist() {
    const file = path.join(this.root, 'state.json');
    writeFileSync(file + '.tmp', JSON.stringify(this.state, null, 2));
    renameSync(file + '.tmp', file); this.emit('change');
  }
  file(kind, name) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid file name.');
    return path.join(this.root, kind, name);
  }
  getJob(id) { const job = this.state.jobs.find(j => j.id === id); if (!job) throw new Error('Session not found.'); return job; }
  view() {
    return { config: this.state.config, hasKey: !!this.key, paused: this.state.paused, capturing: this.capturing, watchError: this.watchError, helper:!!this.helper, cloudConnection: this.relay?.view(),
      jobs: this.state.jobs.slice(-200).reverse().map(({ snapshot, ...j }) => j) };
  }
  configure(input) {
    const c = { ...this.state.config };
    const strings = { eventName: 80, prompt: 12000, sdkPath: 1000, watchFolder: 1000, cameraLabel: 80, footerTitle: 36, footerSubtitle: 64, printerName: 240 };
    for (const [key,max] of Object.entries(strings)) if (key in input) {
      if (typeof input[key] !== 'string' || input[key].length > max) throw new Error('Invalid setting: ' + key);
      c[key] = input[key].trim();
    }
    for (const key of ['watchEnabled','autoGenerate','frameEnabled']) if (key in input) {
      if (typeof input[key] !== 'boolean') throw new Error('Invalid setting: ' + key); c[key] = input[key];
    }
    const enums = { mode: ['rehearsal','live'], cameraMode: ['canon','webcam','folder'], model: imageModels, quality: ['low','medium','high','xhigh','max'], size: ['1024x1536','1536x1024','1024x1024','1536x2304'] };
    for (const [key, values] of Object.entries(enums)) if (key in input) {
      if (!values.includes(input[key])) throw new Error('Invalid setting: ' + key); c[key] = input[key];
    }
    if (!qualityOptions(c.model).includes(c.quality)) throw new Error('This quality setting is not supported by the selected image model. Choose High, Medium or Low.');
    if (!sizeOptions(c.model).includes(c.size)) throw new Error('This image size is not supported by the selected image model. Choose 1024x1536 for portrait output.');
    if (c.mode === 'live' && !this.key) throw new Error('Save your API key before enabling live AI.');
    if ('frameColor' in input) { if (!/^#[0-9a-fA-F]{6}$/.test(input.frameColor)) throw new Error('Choose a valid frame colour.'); c.frameColor = input.frameColor; }
    for (const [key,min,max] of [['displaySeconds',5,120],['retentionDays',1,90]]) if (key in input) {
      const n = Number(input[key]); if (!Number.isInteger(n) || n < min || n > max) throw new Error('Invalid setting: ' + key); c[key] = n;
    }
    if ('downloadBaseUrl' in input) {
      const value = String(input.downloadBaseUrl).trim().replace(/\/$/, '');
      if (value) { const u = new URL(value); if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Use a base http(s) address without a path, query or password.'); }
      c.downloadBaseUrl = value;
    }
    if (c.watchEnabled && (!c.watchFolder || !existsSync(c.watchFolder) || !statSync(c.watchFolder).isDirectory())) throw new Error('Choose an existing camera download folder.');
    if (c.watchEnabled && path.resolve(c.watchFolder).toLowerCase().startsWith(path.resolve(this.root).toLowerCase() + path.sep)) throw new Error('Use a separate camera folder outside the app data folder.');
    const resetWatch = c.watchFolder !== this.state.config.watchFolder || c.watchEnabled !== this.state.config.watchEnabled;
    this.state.config = c; if (resetWatch) this.resetWatcher(); this.persist(); return this.view();
  }
  async setAsset(buffer, kind = 'reference') {
    if (!['reference', 'outfitReference', 'overlay'].includes(kind)) throw new Error('Invalid asset type.');
    const normalized = kind === 'overlay' ? await normalizeOverlay(buffer) : await normalizeImage(buffer);
    const name = randomUUID() + (kind === 'overlay' ? '.png' : '.jpg');
    writeFileSync(this.file('assets', name), normalized);
    this.state.config[kind] = name; this.persist(); return name;
  }
  async captureBuffer(buffer, input = {}) {
    const options = captureOptions(input);
    if (options.requestId) { const existing = this.state.jobs.find(j => j.captureRequestId === options.requestId); if (existing) return existing; }
    const normalized = await normalizeImage(buffer);
    if (options.requestId) { const existing = this.state.jobs.find(j => j.captureRequestId === options.requestId); if (existing) return existing; }
    const id = randomUUID(), token = randomBytes(24).toString('base64url');
    writeFileSync(this.file('originals', id + '.jpg'), normalized);
    const job = { id, token, scene: options.scene, captureRequestId: options.requestId, status: 'captured', createdAt: new Date().toISOString(), error: '', expiresAt: null };
    this.state.jobs.push(job); this.persist();
    if (this.state.config.autoGenerate && !options.review && !this.relay?.config.enabled) this.enqueue(id);
    return job;
  }
  async captureCanon(input = {}) {
    const options = captureOptions(input);
    if (options.requestId) { const existing = this.state.jobs.find(j => j.captureRequestId === options.requestId); if (existing) return existing; }
    if (this.capturing) throw new Error('The camera is already taking a photo.');
    const sdk = this.state.config.sdkPath;
    if (!sdk || !existsSync(path.join(sdk, 'EDSDK.dll'))) throw new Error('Add the folder containing Canon’s 64-bit EDSDK.dll in Setup. Canon capture cannot start until it is installed.');
    const bridge = path.join(this.appRoot, 'native', 'CanonCapture.exe');
    if (!existsSync(bridge)) throw new Error('The Canon capture bridge is missing from this installation.');
    this.capturing = true; this.emit('change');
    const target = path.join(this.root, 'canon-' + randomUUID() + '.jpg');
    try {
      await exec(bridge, [sdk, target], { windowsHide: true, timeout: 65000, maxBuffer: 1024 * 64 });
      if (!existsSync(target)) throw new Error('The camera did not send a JPEG. Set the camera to JPEG and try again.');
      return await this.captureBuffer(readFileSync(target), options);
    } catch (error) {
      throw new Error(error.stderr?.trim() || error.message || 'Canon capture failed. Close EOS Utility and check the USB connection.');
    } finally { if (existsSync(target)) unlinkSync(target); this.capturing = false; this.emit('change'); }
  }
  enqueue(id) {
    if (this.helper || this.relay?.config.enabled) throw new Error('Use the Vercel booth screen to generate while using the cloud helper.');
    const job = this.getJob(id);
    if (!['captured','failed'].includes(job.status)) throw new Error('This session is already queued or finished.');
    if (this.state.jobs.filter(j => ['queued','generating'].includes(j.status)).length >= 20) throw new Error('The queue is full. Let the current guests finish first.');
    const config = { ...this.state.config };
    if (config.mode === 'live' && (!config.prompt || !config.reference)) throw new Error('Save a golf reference and prompt first.');
    config.prompt = scenePrompt(config.prompt, job.scene);
    if (config.mode === 'live' && !this.key) throw new Error('An API key is required for live AI.');
    job.snapshot = config; job.status = 'queued'; job.error = ''; job.mode = config.mode; this.persist();
    queueMicrotask(() => this.drain()); return job;
  }
  async drain() {
    if (this.busy || this.state.paused || this.stopped) return;
    const job = this.state.jobs.find(j => j.status === 'queued'); if (!job) return;
    this.busy = true; job.status = 'generating'; job.startedAt = new Date().toISOString(); this.persist();
    const config = job.snapshot;
    try {
      const guest = readFileSync(this.file('originals', job.id + '.jpg'));
      const reference = config.reference ? readFileSync(this.file('assets', config.reference)) : undefined;
      const outfitReference = config.outfitReference ? readFileSync(this.file('assets', config.outfitReference)) : undefined;
      this.controller = new AbortController();
      const result = config.mode === 'rehearsal' ? guest : await this.generate({ guest, reference, outfitReference, prompt: config.prompt, model: config.model, size: config.size, quality: config.quality, key: this.key, signal: this.controller.signal });
      writeFileSync(this.file('generated', job.id + '.jpg'), await normalizeImage(result, { maxEdge: 4096 }));
      const overlay = config.overlay ? readFileSync(this.file('assets', config.overlay)) : undefined;
      const output = await composePortrait(result, config, overlay);
      writeFileSync(this.file('results', job.id + '.jpg'), output);
      job.status = 'complete'; job.completedAt = new Date().toISOString();
      job.expiresAt = new Date(Date.now() + config.retentionDays * 86400000).toISOString();
      job.eventName = config.eventName;
    } catch (e) { job.status = 'failed'; job.error = e.message; }
    finally { this.busy = false; this.controller = null; this.persist(); if (!this.stopped) queueMicrotask(() => this.drain()); }
  }
  remove(id) {
    const job = this.getJob(id); if (job.status === 'generating') throw new Error('Wait for this generation to finish before deleting it.');
    for (const dir of ['originals','results','generated']) { const p = this.file(dir, id + '.jpg'); if (existsSync(p)) unlinkSync(p); }
    this.state.jobs = this.state.jobs.filter(j => j.id !== id); this.persist();
  }
  resetWatcher() {
    this.seen.clear(); this.watchError = ''; this.pendingCapture = null;
    const c = this.state.config;
    if (c.watchEnabled && existsSync(c.watchFolder)) for (const name of readdirSync(c.watchFolder)) this.seen.set(name, { imported: true });
  }
  armFolderCapture(input) {
    const options = captureOptions(input);
    if (this.pendingCapture && this.pendingCapture.until > Date.now() && this.pendingCapture.requestId !== options.requestId) throw new Error('Another guest is waiting for the camera. Finish that capture first.');
    this.pendingCapture = { ...options, until: Date.now() + 180000 };
    return { waiting: true, requestId: options.requestId };
  }
  async scanFolder() {
    const c = this.state.config; if (!c.watchEnabled || this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      for (const name of readdirSync(c.watchFolder)) {
        if (!/\.(jpg|jpeg|png)$/i.test(name)) continue;
        const item = this.seen.get(name); if (item?.imported) continue;
        const full = path.join(c.watchFolder, name); const st = statSync(full);
        if (!st.isFile()) continue;
        const signature = st.size + ':' + st.mtimeMs;
        if (!item || item.signature !== signature) { this.seen.set(name, { signature, stableSince: Date.now() }); continue; }
        if (Date.now() - item.stableSince < 1500 || st.size === 0) continue;
        try {
          const pending = this.pendingCapture?.until > Date.now() ? this.pendingCapture : {};
          await this.captureBuffer(readFileSync(full), pending);
          this.pendingCapture = null; item.imported = true; this.watchError = '';
        }
        catch(e) { this.watchError = 'Camera folder: ' + e.message; if (Date.now() - item.stableSince > 30000) item.imported = true; }
      }
    } catch { this.watchError = 'The camera download folder is unavailable.'; }
    finally { this.scanning = false; }
  }
  start() {
    this.timer = setInterval(() => this.scanFolder(), 750); this.timer.unref();
    this.cleanup = setInterval(() => this.expire(), 60000); this.cleanup.unref(); this.expire(); this.drain();
  }
  expire() {
    for (const job of [...this.state.jobs]) {
      const expires = job.expiresAt || new Date(new Date(job.createdAt).getTime() + this.state.config.retentionDays * 86400000).toISOString();
      if (expires < new Date().toISOString() && !['generating','queued'].includes(job.status)) this.remove(job.id);
    }
  }
  stop() { this.stopped = true; clearInterval(this.timer); clearInterval(this.cleanup); this.controller?.abort(); this.relay?.stop(); }
}
