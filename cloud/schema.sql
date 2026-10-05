-- Run once in the Supabase SQL editor. One Supabase project per booth/event.
create table if not exists public.booth_settings (
  id integer primary key check (id = 1),
  config jsonb not null default '{}',
  paused boolean not null default false,
  device jsonb not null default '{}'
);
insert into public.booth_settings(id) values (1) on conflict do nothing;

create table if not exists public.booth_jobs (
  id uuid primary key,
  request_id uuid not null unique,
  status text not null check (status in ('captured','queued','generating','complete','failed','deleting')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_until timestamptz,
  worker uuid,
  data jsonb not null
);
create index if not exists booth_jobs_queue on public.booth_jobs(created_at) where status = 'queued';
create index if not exists booth_jobs_expiry on public.booth_jobs(expires_at);
create unique index if not exists booth_jobs_download_token on public.booth_jobs((data->>'token'));

create table if not exists public.booth_commands (
  id uuid primary key,
  kind text not null check (kind in ('capture','print')),
  target uuid not null,
  status text not null default 'pending' check (status in ('pending','claimed','complete','failed','canceled')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  data jsonb not null
);
create unique index if not exists booth_commands_one_active_capture on public.booth_commands(kind)
  where kind = 'capture' and status in ('pending','claimed');
create unique index if not exists booth_commands_one_active_print on public.booth_commands(target)
  where kind = 'print' and status in ('pending','claimed');
create index if not exists booth_commands_pending on public.booth_commands(created_at) where status in ('pending','claimed');

create table if not exists public.booth_login_limits (
  id text primary key, attempts integer not null default 1, expires_at timestamptz not null
);
alter table public.booth_login_limits enable row level security;
revoke all on public.booth_login_limits from anon, authenticated;
grant all on public.booth_login_limits to service_role;
create or replace function public.booth_login_attempt(p_key text) returns boolean
language plpgsql set search_path = '' as $$
declare n integer;
begin
  delete from public.booth_login_limits where expires_at < now();
  insert into public.booth_login_limits(id,expires_at) values(p_key,now()+interval '10 minutes')
    on conflict (id) do update set attempts = public.booth_login_limits.attempts + 1 returning attempts into n;
  return n <= 15;
end;
$$;
revoke all on function public.booth_login_attempt(text) from public, anon, authenticated;
grant execute on function public.booth_login_attempt(text) to service_role;

alter table public.booth_settings enable row level security;
alter table public.booth_jobs enable row level security;
alter table public.booth_commands enable row level security;
revoke all on public.booth_settings, public.booth_jobs, public.booth_commands from anon, authenticated;
grant all on public.booth_settings, public.booth_jobs, public.booth_commands to service_role;

create or replace function public.booth_config(p_patch jsonb) returns jsonb
language sql set search_path = '' as $$
  update public.booth_settings set config = config || p_patch where id = 1 returning config;
$$;

create or replace function public.booth_enqueue(p_id uuid, p_snapshot jsonb, p_retry boolean, p_approval uuid) returns public.booth_jobs
language plpgsql set search_path = '' as $$
declare j public.booth_jobs;
begin
  perform 1 from public.booth_settings where id = 1 for update;
  select * into j from public.booth_jobs where id = p_id for update;
  if not found then raise exception 'Photo not found.'; end if;
  if j.data->>'lastApprovalId' = p_approval::text then return j; end if;
  -- Duplicate delivery of an approval is harmless. Only explicit retry can re-bill a failed job.
  if j.status in ('queued','generating','complete') then return j; end if;
  if not (j.status = 'captured' or (p_retry and j.status = 'failed')) then
    raise exception 'Review this failed request before retrying.';
  end if;
  if (select count(*) from public.booth_jobs where status in ('queued','generating')) >= 20 then
    raise exception 'The queue is full. Wait for the current guests.';
  end if;
  update public.booth_jobs set status = 'queued', worker = null, lease_until = null,
    data = data || jsonb_build_object('snapshot',p_snapshot,'mode',p_snapshot->>'mode','error','','lastApprovalId',p_approval)
    where id = p_id returning * into j;
  return j;
end;
$$;

create or replace function public.booth_claim(p_worker uuid, p_seconds integer) returns public.booth_jobs
language plpgsql set search_path = '' as $$
declare j public.booth_jobs;
begin
  perform 1 from public.booth_settings where id = 1 for update;
  update public.booth_jobs set status = 'failed',
    data = data || jsonb_build_object('error','This queued photo expired before generation. No AI request was made.')
    where status = 'queued' and expires_at < now();
  update public.booth_jobs set status = 'failed', worker = null, lease_until = null,
    data = data || jsonb_build_object('error','Generation was interrupted. The provider may have charged. Ask the operator to review before retrying.')
    where status = 'generating' and lease_until < now();
  if (select paused from public.booth_settings where id = 1) or
    exists(select 1 from public.booth_jobs where status = 'generating') then return null; end if;
  select * into j from public.booth_jobs where status = 'queued' order by created_at
    limit 1 for update skip locked;
  if not found then return null; end if;
  update public.booth_jobs set status = 'generating', worker = p_worker,
    lease_until = now() + make_interval(secs => greatest(60,least(p_seconds,780))),
    data = data || jsonb_build_object('startedAt',now(),
      'outputPaths',coalesce(data->'outputPaths','[]'::jsonb) || jsonb_build_array('results/' || j.id::text || '-' || p_worker::text || '.jpg'))
    where id = j.id returning * into j;
  return j;
end;
$$;

create or replace function public.booth_command_claim() returns public.booth_commands
language plpgsql set search_path = '' as $$
declare c public.booth_commands;
begin
  perform 1 from public.booth_settings where id = 1 for update;
  update public.booth_commands set status = 'failed',
    data = data || jsonb_build_object('error','Windows helper did not confirm completion. Check the camera/printer before trying again.')
    where status = 'claimed' and claimed_at < now() - interval '4 minutes';
  update public.booth_commands set status = 'failed',
    data = data || jsonb_build_object('error','The Windows command expired before it started.')
    where status = 'pending' and created_at < now() - interval '3 minutes';
  -- Return an outstanding command for acknowledgment recovery. The Windows ledger prevents re-execution.
  select * into c from public.booth_commands where status = 'claimed' order by created_at limit 1;
  if found then return c; end if;
  select * into c from public.booth_commands where status = 'pending' order by created_at
    limit 1 for update skip locked;
  if not found then return null; end if;
  update public.booth_commands set status = 'claimed', claimed_at = now()
    where id = c.id returning * into c;
  return c;
end;
$$;

revoke all on function public.booth_config(jsonb), public.booth_enqueue(uuid,jsonb,boolean,uuid),
  public.booth_claim(uuid,integer), public.booth_command_claim() from public, anon, authenticated;
grant execute on function public.booth_config(jsonb), public.booth_enqueue(uuid,jsonb,boolean,uuid),
  public.booth_claim(uuid,integer), public.booth_command_claim() to service_role;

-- Private bucket: no public policies and no browser service key.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('booth-private','booth-private',false,20971520,array['image/jpeg','image/png'])
on conflict (id) do update set public = false;
