-- PA-026: MHMDA (+ NV/CT analogs) deletion-rights intake. A human (Danielle)
-- reviews and actions each row; this table is the durable queue, not an
-- automated deletion trigger. Identity verification stays manual for now.

create table if not exists public.data_rights_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('deletion_request')),
  recommendation_id uuid references public.recommendations (id),
  contact text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'denied')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by text
);

create index if not exists data_rights_requests_status_idx
  on public.data_rights_requests (status);

alter table public.data_rights_requests enable row level security;

create policy "anon cannot read data rights requests"
  on public.data_rights_requests for select
  to anon
  using (false);
