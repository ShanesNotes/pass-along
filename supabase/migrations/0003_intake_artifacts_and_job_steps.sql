-- Additive gaps found wiring PA-023 (Postgres adapters) against the existing
-- schema: recommendation_originals had no forWhom/submitted_at, moderation_
-- events had no idempotency key (JobStoragePort.transitionRecommendation
-- requires one), there was no durable home for scrub/extract/quality intake
-- artifacts, and job_steps (idempotency bookkeeping for the job runner) had
-- no table at all.

alter table public.recommendation_originals
  add column if not exists for_whom text[] not null default '{}';

alter table public.recommendation_originals
  add column if not exists submitted_at timestamptz not null default now();

alter table public.moderation_events
  add column if not exists idempotency_key text unique;

create table if not exists public.rec_intake_artifacts (
  recommendation_id uuid primary key references public.recommendations (id),
  scrub jsonb,
  extract jsonb,
  quality jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.job_steps (
  idempotency_key text primary key,
  job_name text not null,
  entity_id text not null,
  attempt_group text not null,
  step_name text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  result jsonb,
  error jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists job_steps_entity_id_idx
  on public.job_steps (entity_id);

alter table public.rec_intake_artifacts enable row level security;
alter table public.job_steps enable row level security;

create policy "anon cannot read intake artifacts"
  on public.rec_intake_artifacts for select
  to anon
  using (false);

create policy "anon cannot read job steps"
  on public.job_steps for select
  to anon
  using (false);
