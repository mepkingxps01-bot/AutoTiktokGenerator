-- Dr.Trader AI Carousel Factory: initial schema
-- Run with `supabase db push`, or paste into the Supabase SQL editor.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Generation jobs (one batch = one job)
-- ---------------------------------------------------------------------------
create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('auto', 'custom')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  stage text not null default 'ideation' check (stage in ('ideation', 'production', 'done')),
  input jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  error text,
  ideation_attempts int not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  actual_cost_usd numeric(12, 6) not null default 0,
  mock boolean not null default false,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- At most ONE active job at a time: blocks duplicate jobs from repeated clicks
-- even when requests race.
create unique index if not exists generation_jobs_single_active
  on public.generation_jobs ((true)) where status in ('queued', 'running');
create index if not exists generation_jobs_created_idx on public.generation_jobs (created_at desc);

-- ---------------------------------------------------------------------------
-- Carousels (5 per batch). `stage` = next pipeline stage to run.
-- ---------------------------------------------------------------------------
create table if not exists public.carousels (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs (id) on delete cascade,
  position int not null check (position between 1 and 5),
  version int not null default 1,
  stage text not null default 'topic' check (stage in ('topic', 'script', 'illustrate', 'render', 'done')),
  status text not null default 'queued' check (status in ('queued', 'completed', 'failed', 'cancelled')),
  title text,
  normalized_topic text,
  category text,
  angle text,
  learning_objective text,
  script jsonb,
  caption text,
  hashtags text[] not null default '{}',
  layout text,
  artwork_id uuid,
  slide_keys text[] not null default '{}',
  similarity jsonb not null default '[]'::jsonb,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  error text,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (job_id, position)
);
create index if not exists carousels_job_idx on public.carousels (job_id, position);

-- ---------------------------------------------------------------------------
-- Topic memory (anti-duplicate system)
-- status: reserved (in progress) | completed | failed | discarded
-- ---------------------------------------------------------------------------
create table if not exists public.topic_history (
  id uuid primary key default gen_random_uuid(),
  carousel_id uuid references public.carousels (id) on delete set null,
  job_id uuid references public.generation_jobs (id) on delete set null,
  title text not null,
  normalized_topic text not null,
  category text,
  angle text,
  learning_objective text,
  summary text,
  embedding extensions.vector(1536),
  embedding_model text,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed', 'discarded')),
  source text not null default 'auto' check (source in ('auto', 'custom')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists topic_history_normalized_idx on public.topic_history (normalized_topic);
create index if not exists topic_history_status_idx on public.topic_history (status, created_at desc);
create index if not exists topic_history_carousel_idx on public.topic_history (carousel_id);
create index if not exists topic_history_title_trgm on public.topic_history using gin (title extensions.gin_trgm_ops);
create index if not exists topic_history_embedding_idx
  on public.topic_history using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Reusable artwork library (reduces image API cost)
-- ---------------------------------------------------------------------------
create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  category text,
  motif text not null,
  source text not null check (source in ('openai', 'procedural', 'mock')),
  prompt text not null default '',
  storage_key text not null,
  usage_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists artworks_lookup_idx on public.artworks (category, motif, usage_count);

-- ---------------------------------------------------------------------------
-- API usage and cost tracking
-- ---------------------------------------------------------------------------
create table if not exists public.api_usage (
  id bigint generated always as identity primary key,
  job_id uuid references public.generation_jobs (id) on delete set null,
  carousel_id uuid references public.carousels (id) on delete set null,
  stage text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  images int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  estimated boolean not null default true,
  mock boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_created_idx on public.api_usage (created_at);

create table if not exists public.daily_counters (
  day date primary key,
  carousels int not null default 0
);

create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id, value) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security: the app talks to the database only with the service-role
-- key on the server. Enabling RLS with no policies denies anon/authenticated
-- clients completely.
-- ---------------------------------------------------------------------------
alter table public.generation_jobs enable row level security;
alter table public.carousels enable row level security;
alter table public.topic_history enable row level security;
alter table public.artworks enable row level security;
alter table public.api_usage enable row level security;
alter table public.daily_counters enable row level security;
alter table public.rate_limits enable row level security;
alter table public.app_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Functions (atomic operations)
-- ---------------------------------------------------------------------------

-- Internal: consume daily quota + check monthly budget. Raises on violation.
create or replace function public._consume_quota(p_count int, p_daily_limit int, p_monthly_budget numeric, p_extra_cost numeric)
returns void language plpgsql as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_month_start timestamptz := (date_trunc('month', now() at time zone 'Asia/Bangkok')) at time zone 'Asia/Bangkok';
  v_used int;
  v_spent numeric;
begin
  insert into public.daily_counters (day, carousels) values (v_day, 0) on conflict (day) do nothing;
  select carousels into v_used from public.daily_counters where day = v_day for update;
  if v_used + p_count > p_daily_limit then
    raise exception 'quota_daily:%:%', v_used, p_daily_limit using errcode = 'P0001';
  end if;
  select coalesce(sum(cost_usd), 0) into v_spent from public.api_usage where created_at >= v_month_start;
  if p_monthly_budget > 0 and v_spent + p_extra_cost > p_monthly_budget then
    raise exception 'quota_budget:%:%', round(v_spent, 2), p_monthly_budget using errcode = 'P0001';
  end if;
  update public.daily_counters set carousels = carousels + p_count where day = v_day;
end $$;

create or replace function public.consume_carousel_quota(p_count int, p_daily_limit int, p_monthly_budget numeric)
returns void language plpgsql as $$
begin
  perform public._consume_quota(p_count, p_daily_limit, p_monthly_budget, 0);
end $$;

-- Create a job and its carousels in one transaction.
create or replace function public.create_generation_job(
  p_mode text,
  p_input jsonb,
  p_idempotency_key text,
  p_estimated_cost numeric,
  p_mock boolean,
  p_carousels jsonb,
  p_daily_limit int,
  p_monthly_budget numeric
) returns table (job jsonb, created boolean)
language plpgsql as $$
declare
  v_job public.generation_jobs;
  v_active uuid;
  v_count int := jsonb_array_length(p_carousels);
  v_stage text;
begin
  if p_idempotency_key is not null then
    select * into v_job from public.generation_jobs where idempotency_key = p_idempotency_key;
    if found then
      return query select to_jsonb(v_job), false;
      return;
    end if;
  end if;

  select id into v_active from public.generation_jobs where status in ('queued', 'running') limit 1;
  if v_active is not null then
    raise exception 'active_job:%', v_active using errcode = 'P0001';
  end if;

  perform public._consume_quota(v_count, p_daily_limit, p_monthly_budget, p_estimated_cost);

  v_stage := case when exists (select 1 from jsonb_array_elements(p_carousels) c where c->>'stage' = 'topic')
                  then 'ideation' else 'production' end;

  begin
    insert into public.generation_jobs (mode, input, idempotency_key, estimated_cost_usd, mock, stage)
    values (p_mode, p_input, p_idempotency_key, p_estimated_cost, p_mock, v_stage)
    returning * into v_job;
  exception when unique_violation then
    -- lost a race against a concurrent click
    select id into v_active from public.generation_jobs where status in ('queued', 'running') limit 1;
    raise exception 'active_job:%', coalesce(v_active::text, '') using errcode = 'P0001';
  end;

  insert into public.carousels (job_id, position, stage, title, normalized_topic, category, similarity)
  select v_job.id,
         (c->>'position')::int,
         c->>'stage',
         c->>'title',
         c->>'normalized_topic',
         c->>'category',
         coalesce(c->'similarity', '[]'::jsonb)
  from jsonb_array_elements(p_carousels) c;

  return query select to_jsonb(v_job), true;
end $$;

-- Claim a job lease (durable worker). SKIP LOCKED prevents two workers
-- from processing the same job.
create or replace function public.claim_generation_job(p_worker text, p_lease_seconds int, p_job_id uuid default null)
returns setof public.generation_jobs language plpgsql as $$
begin
  return query
  update public.generation_jobs j
     set lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         status = case when j.status = 'queued' then 'running' else j.status end,
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
   where j.id = (
     select id from public.generation_jobs
      where status in ('queued', 'running')
        and (lease_expires_at is null or lease_expires_at < now() or lease_owner = p_worker)
        and (p_job_id is null or id = p_job_id)
      order by created_at
      limit 1
      for update skip locked)
  returning j.*;
end $$;

create or replace function public.release_generation_job(p_job_id uuid, p_worker text)
returns void language sql as $$
  update public.generation_jobs set lease_owner = null, lease_expires_at = null
   where id = p_job_id and lease_owner = p_worker;
$$;

-- Reopen a finished job for retry/regenerate unless another job is active.
create or replace function public.reactivate_generation_job(p_job_id uuid)
returns setof public.generation_jobs language plpgsql as $$
declare v_other uuid;
begin
  select id into v_other from public.generation_jobs
   where status in ('queued', 'running') and id <> p_job_id limit 1;
  if v_other is not null then
    raise exception 'active_job:%', v_other using errcode = 'P0001';
  end if;
  return query
  update public.generation_jobs
     set status = case when status in ('queued', 'running') then status else 'queued' end,
         finished_at = case when status in ('queued', 'running') then finished_at else null end,
         error = case when status in ('queued', 'running') then error else null end,
         updated_at = now()
   where id = p_job_id
  returning *;
end $$;

-- Compare-and-set carousel update (prevents a stale worker from overwriting a regenerated carousel).
create or replace function public.update_carousel_cas(p_id uuid, p_expected_version int, p_patch jsonb)
returns setof public.carousels language plpgsql as $$
begin
  return query
  update public.carousels c set
    version            = coalesce((p_patch->>'version')::int, c.version),
    stage              = coalesce(p_patch->>'stage', c.stage),
    status             = coalesce(p_patch->>'status', c.status),
    title              = case when p_patch ? 'title' then p_patch->>'title' else c.title end,
    normalized_topic   = case when p_patch ? 'normalized_topic' then p_patch->>'normalized_topic' else c.normalized_topic end,
    category           = case when p_patch ? 'category' then p_patch->>'category' else c.category end,
    angle              = case when p_patch ? 'angle' then p_patch->>'angle' else c.angle end,
    learning_objective = case when p_patch ? 'learning_objective' then p_patch->>'learning_objective' else c.learning_objective end,
    script             = case when p_patch ? 'script' then p_patch->'script' else c.script end,
    caption            = case when p_patch ? 'caption' then p_patch->>'caption' else c.caption end,
    hashtags           = case when p_patch ? 'hashtags' then array(select jsonb_array_elements_text(p_patch->'hashtags')) else c.hashtags end,
    layout             = case when p_patch ? 'layout' then p_patch->>'layout' else c.layout end,
    artwork_id         = case when p_patch ? 'artwork_id' then (p_patch->>'artwork_id')::uuid else c.artwork_id end,
    slide_keys         = case when p_patch ? 'slide_keys' then array(select jsonb_array_elements_text(p_patch->'slide_keys')) else c.slide_keys end,
    similarity         = case when p_patch ? 'similarity' then p_patch->'similarity' else c.similarity end,
    attempts           = coalesce((p_patch->>'attempts')::int, c.attempts),
    next_attempt_at    = case when p_patch ? 'next_attempt_at' then (p_patch->>'next_attempt_at')::timestamptz else c.next_attempt_at end,
    error              = case when p_patch ? 'error' then p_patch->>'error' else c.error end,
    cost_usd           = coalesce((p_patch->>'cost_usd')::numeric, c.cost_usd),
    completed_at       = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else c.completed_at end,
    updated_at         = now()
  where c.id = p_id and c.version = p_expected_version
  returning c.*;
end $$;

create or replace function public.add_generation_cost(p_job_id uuid, p_carousel_id uuid, p_cost numeric)
returns void language plpgsql as $$
begin
  if p_job_id is not null then
    update public.generation_jobs set actual_cost_usd = actual_cost_usd + p_cost where id = p_job_id;
  end if;
  if p_carousel_id is not null then
    update public.carousels set cost_usd = cost_usd + p_cost where id = p_carousel_id;
  end if;
end $$;

-- Semantic duplicate search (cosine similarity = 1 - cosine distance).
create or replace function public.match_topics(
  p_embedding extensions.vector(1536),
  p_embedding_model text,
  p_count int,
  p_exclude_carousels uuid[] default '{}'
) returns table (topic_id uuid, title text, similarity float, created_at timestamptz)
language sql stable set search_path = public, extensions as $$
  select t.id, t.title, 1 - (t.embedding <=> p_embedding) as similarity, t.created_at
    from public.topic_history t
   where t.status in ('completed', 'reserved')
     and t.embedding is not null
     and t.embedding_model = p_embedding_model
     and (t.carousel_id is null or not (t.carousel_id = any (p_exclude_carousels)))
   order by t.embedding <=> p_embedding
   limit p_count;
$$;

-- Fixed-window rate limiter.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, current_count int, reset_at timestamptz)
language plpgsql as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  -- opportunistic cleanup of old windows
  delete from public.rate_limits where window_start < now() - interval '2 days';
  return query select v_count <= p_max, v_count, v_window + make_interval(secs => p_window_seconds);
end $$;

create or replace function public.increment_artwork_use(p_id uuid)
returns void language sql as $$
  update public.artworks set usage_count = usage_count + 1 where id = p_id;
$$;

-- Functions are called only with the service-role key.
do $$
declare f text;
begin
  foreach f in array array[
    'public._consume_quota(int,int,numeric,numeric)',
    'public.consume_carousel_quota(int,int,numeric)',
    'public.create_generation_job(text,jsonb,text,numeric,boolean,jsonb,int,numeric)',
    'public.claim_generation_job(text,int,uuid)',
    'public.release_generation_job(uuid,text)',
    'public.reactivate_generation_job(uuid)',
    'public.update_carousel_cas(uuid,int,jsonb)',
    'public.add_generation_cost(uuid,uuid,numeric)',
    'public.match_topics(extensions.vector,text,int,uuid[])',
    'public.rate_limit_hit(text,int,int)',
    'public.increment_artwork_use(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Private storage bucket for generated assets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('carousel-assets', 'carousel-assets', false)
on conflict (id) do nothing;
