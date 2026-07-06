alter table public.rec_embeddings
  add column if not exists model_version text not null default 'unknown';

alter table public.rec_embeddings
  add column if not exists dimensions integer not null default 1536
    check (dimensions > 0);

create index if not exists rec_embeddings_embedding_hnsw_idx
  on public.rec_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists rec_embeddings_model_version_idx
  on public.rec_embeddings (model, model_version);
