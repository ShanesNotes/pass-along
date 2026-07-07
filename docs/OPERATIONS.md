# Operations

Environment is loaded through `packages/core/src/config.ts`. Secrets are optional at boot so local demos can run keyless, but production paths can call `loadConfig(env, { require: [...] })` when a secret must exist. Malformed values fail fast with the env var named.

## Environment Variables

| Variable | Required when | Effect when missing | Secure handling notes |
| --- | --- | --- | --- |
| `NODE_ENV` | Runtime selection. | Defaults to `development`; `test` and `production` must be set explicitly by the runtime. | Not secret. Only `development`, `test`, and `production` are valid. |
| `DATABASE_URL` | Supabase/Postgres-backed persistence or migrations need a database connection. | Current fixture-backed demo still boots; DB-backed paths cannot connect. | Treat as secret because URLs commonly include credentials. |
| `SUPABASE_URL` | Supabase-backed app/API paths. | Supabase-backed features remain unavailable; fixture demo paths continue. | Not secret by itself, but keep paired config in the same secret store. |
| `SUPABASE_ANON_KEY` | Client/anon Supabase access. | Client Supabase access is unavailable. | Public-ish key, but do not paste into logs. Rotate if exposed outside intended clients. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service-role writes, migrations, or admin jobs. | Service-role paths cannot run. | Secret. Server only. Never expose to browser bundles or client env. |
| `GOOGLE_API_KEY` | Live Google Gemini understand/rerank/scrub/extract routes. | If `GEMINI_API_KEY` is also missing, model paths fall back deterministically and sources are labeled `fallback`. | Secret. Preferred Google key name. If both Google vars are set, this one wins. |
| `GEMINI_API_KEY` | Compatibility alias for Google Gemini routes. | If `GOOGLE_API_KEY` is missing, this value is used as the Google key. If both are missing, deterministic fallbacks run. | Secret. Prefer migrating operators to `GOOGLE_API_KEY`. |
| `ANTHROPIC_API_KEY` | Crisis tier-2 classifier. | With `CRISIS_TIER2_OPTIONAL` blank/false, public find/pass return `503` by design. With optional mode on, tier-1-only safety runs degraded. | Secret. Production should set this rather than enabling optional mode. |
| `OPENAI_API_KEY` | Real OpenAI embeddings/backfill paths. | Default fixture find uses dev hash embeddings; real embedding jobs cannot call OpenAI. | Secret. Server only. |
| `CRISIS_TIER2_OPTIONAL` | Local demos that intentionally run without Anthropic tier-2. | Defaults false. No tier-2 key + false means find/pass `503` fail-closed. | Not secret. Do not enable in production without an explicit risk decision. Valid values: `1`, `0`, `true`, `false`. |
| `ADMIN_DEMO_TOKEN` | Accessing `/api/admin/queue` and `/api/admin/decide`. | Admin APIs return `503 ADMIN_DISABLED`; raw stories stay unavailable. | Secret demo bearer token. Rotate after demos; replace with real auth before production. |
| `RERANK_TIMEOUT_MS` | Tuning live rerank latency. | Defaults to `8000`. If set too low, rerank degrades to deterministic fallback and logs `find.rerank_degraded`. | Not secret. Must be a positive integer. |
| `RATE_LIMIT_FIND_PER_MIN` | Tuning `/api/find` abuse guard. | Defaults to `20` requests/minute/IP bucket. | Not secret. Must be a positive integer. |
| `RATE_LIMIT_PASS_PER_MIN` | Tuning `/api/pass` abuse guard. | Defaults to `5` requests/minute/IP bucket. | Not secret. Must be a positive integer. |
| `RATE_LIMIT_TYPEAHEAD_PER_MIN` | Tuning `/api/typeahead` abuse guard. | Defaults to `60` requests/minute/IP bucket. | Not secret. Must be a positive integer. |
| `NEXT_PUBLIC_SITE_URL` | Canonical public site URL for provider metadata. | Provider metadata falls back to `VERCEL_URL`, then `http://localhost:3000`. | Public value. Must not contain secrets because `NEXT_PUBLIC_*` can reach browser code. |
| `VERCEL_URL` | Vercel-hosted preview/production URL fallback. | Provider metadata falls back to `http://localhost:3000`. | Platform-provided, not secret. Do not set to a URL with credentials. |

## Secret Handling

- Store real secrets in the deployment secret manager or local untracked env files only.
- Do not log `loadConfig()` directly expecting raw values: JSON and Node inspection redact key material, but callers should still avoid printing config in normal request logs.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, and `ADMIN_DEMO_TOKEN` server-side only.
- Missing model keys are safe for demos because deterministic fallbacks run, except the crisis tier-2 path, which fail-closes unless `CRISIS_TIER2_OPTIONAL` is explicitly enabled.
