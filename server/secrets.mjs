import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
function crypt(value, encrypt) {
  return new Promise((resolve, reject) => {
    const script = encrypt
      ? '$s=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
      : '$s=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', b => { out += b; });
    child.stderr.resume(); child.on('error', reject);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows credential storage timed out.')); }, 15000);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error('Windows could not protect the API key.')); });
    child.stdin.on('error', () => {}); child.stdin.end(value);
  });
}
export async function loadKey(root, appRoot = path.dirname(root), env = process.env) {
  // Load at runtime so the private module is never included by the bundler.
  const localFile = path.join(appRoot, 'api-key.local.mjs');
  if (existsSync(localFile)) {
    let value;
    try { value = (await import(pathToFileURL(localFile).href)).OPENAI_API_KEY; }
    catch { throw new Error('Could not read api-key.local.mjs. Keep the key inside quotes, save the file, and restart.'); }
    if (typeof value !== 'string' || value.trim().length > 1000 || /\s/.test(value.trim())) {
      throw new Error('Invalid OPENAI_API_KEY in api-key.local.mjs. Use a quoted key without spaces, or an empty string.');
    }
    if (value.trim()) return value.trim();
  }
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
  const file = path.join(root, 'openai-key.dpapi');
  if (!existsSync(file)) return '';
  return crypt(readFileSync(file, 'utf8'), false).catch(() => '');
}
export async function saveKey(root, value) {
  const file = path.join(root, 'openai-key.dpapi');
  if (!value) { if (existsSync(file)) unlinkSync(file); return; }
  if (process.platform !== 'win32') throw new Error('Use OPENAI_API_KEY on non-Windows systems.');
  writeFileSync(file, await crypt(value, true), { mode: 0o600 });
}
