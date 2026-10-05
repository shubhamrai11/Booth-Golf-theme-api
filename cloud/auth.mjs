import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
export const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const mac = (value, secret) => createHmac('sha256',secret).update(value).digest('base64url');
const cookies = request => Object.fromEntries((request.headers.get('cookie') || '').split(';').map(c => c.trim().split('=')));
export function issueSession(role, secret, now = Date.now()) {
  const session = { role, subject: randomBytes(16).toString('hex'), expires: now + 12*3600000 };
  const value = Buffer.from(JSON.stringify(session)).toString('base64url');
  return { session, value: value + '.' + mac(value,secret) };
}
export function readSession(request, secret, adminOnly = false, now = Date.now()) {
  const values = cookies(request);
  for (const name of adminOnly ? ['booth_admin'] : ['booth_admin','booth_kiosk']) {
    const [value,signature] = (values[name] || '').split('.');
    if (!value || !equal(signature,mac(value,secret))) continue;
    try { const session = JSON.parse(Buffer.from(value,'base64url').toString());
      if (session.expires > now && ['admin','kiosk'].includes(session.role) && session.role === name.slice(6)) return session;
    } catch {}
  }
  return null;
}
export const csrfFor = (session, secret) => mac('csrf:' + session.subject,secret);
export const cookie = (role,value,secure=true) => `booth_${role}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? 43200 : 0}${secure ? '; Secure' : ''}`;
export function cloudEnvironment(env) {
  const missing = ['SUPABASE_URL','BOOTH_ADMIN_PASSWORD','BOOTH_SESSION_SECRET','BOOTH_PUBLIC_URL'].filter(k => !env[k]);
  if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SECRET_KEY');
  if (env.BOOTH_ADMIN_PASSWORD && env.BOOTH_ADMIN_PASSWORD.length < 12) missing.push('BOOTH_ADMIN_PASSWORD (at least 12 characters)');
  if (env.BOOTH_SESSION_SECRET && env.BOOTH_SESSION_SECRET.length < 32) missing.push('BOOTH_SESSION_SECRET (at least 32 characters)');
  if (env.BOOTH_DEVICE_TOKEN && env.BOOTH_DEVICE_TOKEN.length < 32) missing.push('BOOTH_DEVICE_TOKEN (at least 32 characters)');
  if (env.BOOTH_DEVICE_TOKEN && (/\s/.test(env.BOOTH_DEVICE_TOKEN) || env.BOOTH_DEVICE_TOKEN.length>200)) missing.push('BOOTH_DEVICE_TOKEN (32–200 characters, no spaces)');
  if (env.BOOTH_PUBLIC_URL) {
    try { const url = new URL(env.BOOTH_PUBLIC_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) missing.push('BOOTH_PUBLIC_URL (HTTPS site address only)');
    } catch { missing.push('BOOTH_PUBLIC_URL (valid HTTPS address)'); }
  }
  return [...new Set(missing)];
}
