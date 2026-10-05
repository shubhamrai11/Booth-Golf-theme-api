import { createClient } from '@supabase/supabase-js';
export function createStore(env) {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) },
  });
  const bucket = client.storage.from('booth-private');
  const unwrap = async query => {
    const { data, error } = await query;
    if (error) { if (error.code==='P0001') throw Object.assign(new Error(error.message.slice(0,500)),{status:400}); throw new Error('Cloud storage/database request failed. Check the Supabase connection and schema.'); }
    return data;
  };
  const one = (table, id) => unwrap(client.from(table).select('*').eq('id', id).maybeSingle());
  return {
    settings: () => one('booth_settings', 1),
    loginAttempt: key => unwrap(client.rpc('booth_login_attempt',{p_key:key})),
    patchConfig: patch => unwrap(client.rpc('booth_config', { p_patch: patch })),
    pause: paused => unwrap(client.from('booth_settings').update({ paused }).eq('id', 1)),
    heartbeat: device => unwrap(client.from('booth_settings').update({ device }).eq('id', 1)),
    jobs: () => unwrap(client.from('booth_jobs').select('*').neq('status','deleting').order('created_at', { ascending: false }).limit(200)),
    job: id => one('booth_jobs', id),
    tokenJob: token => unwrap(client.from('booth_jobs').select('*').eq('data->>token', token).eq('status','complete').gt('expires_at', new Date().toISOString()).maybeSingle()),
    createJob: async job => {
      await unwrap(client.from('booth_jobs').upsert(job, { onConflict: 'id', ignoreDuplicates: true }));
      return one('booth_jobs', job.id);
    },
    enqueue: (id, snapshot, retry, approval=id) => unwrap(client.rpc('booth_enqueue', { p_id: id, p_snapshot: snapshot, p_retry: retry, p_approval:approval })),
    claim: (worker, seconds) => unwrap(client.rpc('booth_claim', { p_worker: worker, p_seconds: seconds })),
    finish: (id, worker, status, data, expiresAt) => unwrap(client.from('booth_jobs').update({ status, data, worker: null, lease_until: null, ...(expiresAt ? { expires_at: expiresAt } : {}) }).eq('id',id).eq('worker',worker).eq('status','generating').select('*').maybeSingle()),
    markDeleting: id => unwrap(client.from('booth_jobs').update({ status:'deleting' }).eq('id',id).not('status','in','(generating,queued)').select('*').maybeSingle()),
    deleteJob: id => unwrap(client.from('booth_jobs').delete().eq('id',id).eq('status','deleting')),
    expired: () => unwrap(client.from('booth_jobs').select('*').lt('expires_at',new Date().toISOString()).not('status','in','(generating,queued)').limit(20)),
    command: id => one('booth_commands',id),
    commands: () => unwrap(client.from('booth_commands').select('*').order('created_at',{ascending:false}).limit(30)),
    createCommand: async command => {
      const existing = await one('booth_commands', command.id);
      if (existing) return existing;
      const { data, error } = await client.from('booth_commands').insert(command).select('*').single();
      if (error?.code === '23505') {
        const duplicate = await one('booth_commands',command.id);
        if (duplicate) return duplicate;
        throw Object.assign(new Error('A camera or print command is already waiting. Check the Windows helper.'),{status:409});
      }
      if (error) throw new Error('Could not save the Windows command.');
      return data;
    },
    claimCommand: () => unwrap(client.rpc('booth_command_claim')),
    ackCommand: (id, status, data) => unwrap(client.from('booth_commands').update({ status, data }).eq('id',id).eq('status','claimed').select('*').maybeSingle()),
    cancelCapture: target => unwrap(client.from('booth_commands').update({ status:'canceled' }).eq('target',target).eq('kind','capture').in('status',['pending','claimed'])),
    put: (name, buffer, contentType) => unwrap(bucket.upload(name,buffer,{ contentType, upsert:false })),
    get: async name => Buffer.from(await (await unwrap(bucket.download(name))).arrayBuffer()),
    remove: names => names.length ? unwrap(bucket.remove(names)) : Promise.resolve(),
    signed: async name => (await unwrap(bucket.createSignedUrl(name,60))).signedUrl,
  };
}
