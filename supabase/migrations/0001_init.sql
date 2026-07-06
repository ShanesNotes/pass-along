create extension if not exists vector;
create extension if not exists pg_trgm;

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_kind text not null default 'therapist'
    check (provider_kind in ('therapist', 'facility', 'other')),
  website_url text,
  phone text,
  address_text text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  license_status text,
  license_source text,
  license_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists providers_name_trgm_idx
  on public.providers using gin (name gin_trgm_ops);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.providers (id),
  provider_name_snapshot text not null,
  kind text not null default 'therapist'
    check (kind in ('therapist', 'facility', 'either')),
  status text not null default 'received'
    check (
      status in (
        'received',
        'scrubbing',
        'enriching',
        'scored',
        'published',
        'review_pending',
        'rejected',
        'removed'
      )
    ),
  original_story text not null,
  scrubbed_story text,
  recommender_contact_hash text,
  submitted_at timestamptz not null default now(),
  published_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recommendations_provider_id_idx
  on public.recommendations (provider_id);

create index if not exists recommendations_status_idx
  on public.recommendations (status);

create table if not exists public.rec_tags (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations (id),
  type text not null
    check (type in ('issue', 'population', 'modality', 'style', 'logistics', 'outcome')),
  value text not null,
  vocab boolean not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists rec_tags_recommendation_id_idx
  on public.rec_tags (recommendation_id);

create index if not exists rec_tags_lookup_idx
  on public.rec_tags (type, value);

create table if not exists public.rec_embeddings (
  recommendation_id uuid primary key references public.recommendations (id),
  embedding vector(1536) not null,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations (id),
  from_state text,
  action text not null,
  to_state text,
  actor text not null default 'system',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists moderation_events_recommendation_id_idx
  on public.moderation_events (recommendation_id);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations (id),
  token_hash text not null unique,
  due_at timestamptz not null,
  answered_at timestamptz,
  response text,
  created_at timestamptz not null default now()
);

create index if not exists follow_ups_due_at_idx
  on public.follow_ups (due_at);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null,
  emitted_at timestamptz not null default now(),
  idempotency_key text unique
);

create index if not exists events_type_emitted_at_idx
  on public.events (type, emitted_at);

create table if not exists public.jobs_dlq (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  entity_id text not null,
  event_id uuid references public.events (id),
  attempt_group text not null,
  error jsonb not null,
  failed_at timestamptz not null default now(),
  replayed_at timestamptz
);

create index if not exists jobs_dlq_job_name_failed_at_idx
  on public.jobs_dlq (job_name, failed_at);

create table if not exists public.aggregate_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  tag_type text not null,
  tag_value text not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'removed')),
  recommendation_count integer not null default 0 check (recommendation_count >= 0),
  summary text,
  rebuilt_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists aggregate_pages_tag_idx
  on public.aggregate_pages (tag_type, tag_value);

create table if not exists public.demand_signals (
  id uuid primary key default gen_random_uuid(),
  query_hash text not null unique,
  understood jsonb not null,
  count integer not null default 1 check (count >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.queries (
  query_hash text primary key,
  understood jsonb not null
);

alter table public.providers enable row level security;
alter table public.recommendations enable row level security;
alter table public.rec_tags enable row level security;
alter table public.rec_embeddings enable row level security;
alter table public.moderation_events enable row level security;
alter table public.follow_ups enable row level security;
alter table public.events enable row level security;
alter table public.jobs_dlq enable row level security;
alter table public.aggregate_pages enable row level security;
alter table public.demand_signals enable row level security;
alter table public.queries enable row level security;

create policy "anon can read providers"
  on public.providers for select
  to anon
  using (true);

create policy "anon can read published recommendations"
  on public.recommendations for select
  to anon
  using (status = 'published');

create policy "anon can read tags on published recommendations"
  on public.rec_tags for select
  to anon
  using (
    exists (
      select 1
      from public.recommendations
      where recommendations.id = rec_tags.recommendation_id
        and recommendations.status = 'published'
    )
  );

create policy "anon can read embeddings on published recommendations"
  on public.rec_embeddings for select
  to anon
  using (
    exists (
      select 1
      from public.recommendations
      where recommendations.id = rec_embeddings.recommendation_id
        and recommendations.status = 'published'
    )
  );

create policy "anon cannot read moderation events"
  on public.moderation_events for select
  to anon
  using (false);

create policy "anon cannot read follow ups"
  on public.follow_ups for select
  to anon
  using (false);

create policy "anon cannot read outbox events"
  on public.events for select
  to anon
  using (false);

create policy "anon cannot read dead letter jobs"
  on public.jobs_dlq for select
  to anon
  using (false);

create policy "anon can read published aggregate pages"
  on public.aggregate_pages for select
  to anon
  using (status = 'published');

create policy "anon cannot read demand signals"
  on public.demand_signals for select
  to anon
  using (false);

create policy "anon cannot read stored queries"
  on public.queries for select
  to anon
  using (false);
