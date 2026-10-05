let token;
let bootstrap;
export const resetApiSession = () => { token=undefined; bootstrap=undefined; };
export class ApiError extends Error { constructor(message,status,data) { super(message); this.status=status; this.data=data; } }
export async function api(url, options = {}) {
  const { withoutToken, ...requestOptions }=options;
  if (options.method && options.method !== 'GET' && !withoutToken) {
    if (!bootstrap) bootstrap = api('/api/bootstrap').then(j => { token = j.token; }).catch(e=>{resetApiSession();throw e;});
    await bootstrap;
  }
  const response = await fetch(url, { ...requestOptions, headers: { ...(options.method && token && !withoutToken ? { 'X-Booth-Token': token } : {}), ...options.headers } });
  let data; try { data=await response.json(); } catch { throw new ApiError('The server returned an incomplete response. Refresh and check the connection.',response.status,{}); }
  if (!response.ok) { if ([401,403].includes(response.status)) resetApiSession(); throw new ApiError(data.error || 'Something went wrong.',response.status,data); }
  return data;
}
export const post = (url, data = {}) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': crypto.randomUUID() }, body: JSON.stringify(data) });
export const media = (job, thumb = false) => `/api/media/${job.status === 'complete' ? 'results' : 'originals'}/${job.id}.jpg${thumb ? '?thumb=1' : ''}`;
