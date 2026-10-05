let token;
let bootstrap;
export async function api(url, options = {}) {
  if (options.method && options.method !== 'GET') {
    if (!bootstrap) bootstrap = fetch('/api/bootstrap').then(r => r.json()).then(j => { token = j.token; });
    await bootstrap;
  }
  const response = await fetch(url, { ...options, headers: { ...(options.method ? { 'X-Booth-Token': token } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
export const post = (url, data = {}) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const media = (job, thumb = false) => `/api/media/${job.status === 'complete' ? 'results' : 'originals'}/${job.id}.jpg${thumb ? '?thumb=1' : ''}`;
