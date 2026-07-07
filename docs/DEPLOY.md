# Deploy runbook (Vercel)

This is the "how do we actually ship this" doc. It doesn't restate environment variables — `docs/OPERATIONS.md` is the source of truth for every variable, when it's required, and what happens when it's missing. This doc covers the deployment target, the build/CI story, the deliberate fail-closed behavior operators need to expect, the job-runner wiring gap, and the Supabase go-live checklist.

## Environments

Three tiers, same Next.js app, different env var sets (see `docs/OPERATIONS.md` for the full table):

- **Local dev** — no env vars required. Fixture-backed find/pass/typeahead all work keyless; model calls fall back deterministically; crisis tier-2 needs `ANTHROPIC_API_KEY` or `CRISIS_TIER2_OPTIONAL=1` (see below).
- **Preview (Vercel PR previews)** — same as local dev by default. Add model keys as Vercel Preview-scoped env vars only if you want previews to exercise live model calls instead of fallbacks.
- **Production (Vercel, `main`)** — every secret in `docs/OPERATIONS.md`'s table set for real: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY` (or `GEMINI_API_KEY`), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ADMIN_DEMO_TOKEN` (until real auth lands — PA-025). Set them as Vercel **Production**-scoped env vars, never committed, never in `NEXT_PUBLIC_*`.

## CI: the `deploy-build` job

`.github/workflows/ci.yml` has two jobs:

- `gates` — the existing typecheck/lint/test/eval/db-lint/privacy-scan gate, unchanged, runs on every push and PR.
- `deploy-build` (new) — runs only on pushes to `main` or `build/foundation`. It runs `pnpm --filter web build` with **no secrets configured at all** (the job doesn't reference the `secrets` context anywhere), then uploads `apps/web/.next` as a build artifact.

The point of `deploy-build` is to prove, on every push, that the production build itself never requires a secret to succeed — model calls fall back deterministically, and the crisis-path fail-closed behavior (below) is a *runtime* 503, not a build-time failure. If `deploy-build` ever starts failing without a code change, that's a real signal something now requires a key at build time, which would be a regression worth catching before it reaches Vercel.

This job does not deploy anywhere — it validates the artifact. Vercel's own git integration handles the actual deploy (see below); the artifact upload here is for local inspection / debugging a CI-only build failure without needing Vercel's build logs.

## Vercel project setup

1. Import the repo into a new Vercel project, framework preset **Next.js**, root directory `apps/web`.
2. Set the Production env vars listed above (Project Settings → Environment Variables → Production). Leave Preview/Development empty unless you deliberately want previews to hit live models.
3. Set `NEXT_PUBLIC_SITE_URL` to the production domain once known; until then Vercel's `VERCEL_URL` fallback covers provider metadata (see `docs/OPERATIONS.md`).
4. `VERCEL_GIT_COMMIT_SHA` is populated automatically by Vercel — `GET /api/health`'s `version` field reads it directly and falls back to the literal string `"dev"` when it's absent (e.g. local dev, or any host that doesn't set it).
5. Build command / output directory: Vercel's Next.js preset defaults are correct as-is; nothing custom needed.

## The strict safety-gate 503 (deliberate, not a bug)

`/api/find` and `/api/pass` run every submission through `packages/engine/src/safety/gate.ts`'s two-tier safety gate before anything is written or returned. Tier-2 (the model classifier) needs `ANTHROPIC_API_KEY`. If that key is missing **and** `CRISIS_TIER2_OPTIONAL` is not explicitly set to `1`/`true`, both routes return `503` before doing anything else — no story is scrubbed, no query is embedded, nothing is persisted. This is intentional fail-closed behavior: a crisis-safety gate that silently degrades to tier-1-only (regex rules) without an explicit operator decision is a worse failure mode than a visible outage.

**Do not set `CRISIS_TIER2_OPTIONAL=1` in production** without an explicit, documented risk decision — it exists for local demos that intentionally run without a real Anthropic key. `GET /api/health`'s `checks.safety_gate` field reports `"strict"` (tier2 required) or `"tier1_only"` (opted out) so this is visible from the outside without reading logs.

## `GET /api/health`

`apps/web/src/app/api/health/route.ts` (+ `deps.ts` for the testable logic, same route/deps split as `/api/find` and `/api/pass`). Returns:

```json
{
  "status": "ok" | "degraded",
  "checks": {
    "db": "configured" | "unreachable" | "ok",
    "model_keys": { "google": "present" | "absent", "anthropic": "present" | "absent", "openai": "present" | "absent" },
    "safety_gate": "strict" | "tier1_only",
    "admin": "enabled" | "disabled"
  },
  "version": "<VERCEL_GIT_COMMIT_SHA or \"dev\">",
  "uptime_s": 123
}
```

Notes on the shape (also commented at the call sites in `deps.ts`):

- **`db`**: `"configured"` means no `DATABASE_URL` is set for this deployment tier — the fixture/in-memory demo path is in effect, which is a normal, healthy state, not an error. When a `DATABASE_URL` *is* set, the check runs a real `select 1` (1.5s timeout) against the existing engine DB client (`packages/engine/src/db/client.ts`, imported read-only — this endpoint never modifies it) and reports `"ok"` or `"unreachable"`.
- **`model_keys`**: presence booleans only, never the key values — `"present"` or `"absent"` per provider. This endpoint never leaks a secret, a URL, or any raw config value; there's a test (`route.test.ts`) that builds a config with fake secret strings and asserts none of them appear anywhere in the serialized response.
- **`safety_gate`**: reflects the `CRISIS_TIER2_OPTIONAL` *configuration*, not whether `ANTHROPIC_API_KEY` happens to be set. Combined with `model_keys.anthropic`, an external monitor can tell the difference between "strict mode, key present, all good" and "strict mode, key missing, every find/pass request is about to 503."
- **`admin`**: `"enabled"`/`"disabled"` reflects whether `ADMIN_DEMO_TOKEN` is set — mirrors the `503 ADMIN_DISABLED` behavior on `/api/admin/*`.
- **`status`**: `"degraded"` when the DB is configured but unreachable, or when the safety gate is strict with no Anthropic key (i.e., find/pass are currently 503ing). Everything else is `"ok"`, including the demo-mode "no DB configured" and "tier1_only" states — those are intentional operating modes, not failures.
- No rate limiter on this route — health checks get polled constantly by uptime monitors, and there's no user input to abuse (`GET`, no body, no query params).

## Inngest wiring (currently demo-inline)

`apps/web/src/inngest/route.ts` creates its job runner like this today:

```ts
const storage = createInMemoryJobStorage();
const runner = createInngestRunner({ id: "pass-along-web", storage, jobs: JOB_DEFINITIONS });
```

That `createInMemoryJobStorage()` means **job state does not persist across invocations** in a real deployment — on Vercel, each serverless invocation is a fresh process, so idempotency keys, DLQ rows, and the events outbox all reset per-invocation instead of accumulating in Postgres. The submission pipeline still runs correctly within a single invocation (that's what `apps/web/src/app/api/pass/route.test.ts` exercises), but retries, replays, and DLQ inspection across invocations won't work until this is swapped for a DB-backed `JobStoragePort` (the `PgJobStorage` adapter already exists — `packages/engine/src/db/adapters/job-storage.ts` — it just isn't wired into `apps/web/src/inngest/route.ts` yet).

Production also needs the actual Inngest platform connected (not just the local dev server): set `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` per Inngest's Vercel integration docs and point it at `/api/inngest`. Neither of those env vars exists in `packages/core/src/config.ts` yet — wiring them through typed config, plus swapping the storage above for `PgJobStorage`, is the concrete follow-up this doc is flagging, not something this packet builds.

## Supabase go-live checklist

1. **Create the Supabase project** (or a plain Postgres instance with the `vector` and `pg_trgm` extensions available — the migrations `create extension if not exists` them).
2. **Run migrations in order**: `supabase/migrations/0001_init.sql` → `0002_embeddings_index.sql` → `0003_intake_artifacts_and_job_steps.sql` → `0004_data_rights_requests.sql`. They're additive-only and idempotent (`create table if not exists` / `add column if not exists`), so re-running is safe. `supabase/migrations/README.md` has the additivity rule; `pnpm db:lint` enforces it in CI.
3. **Set `DATABASE_URL`** to the Supabase Postgres connection string (direct connection, not the pooler, unless you've confirmed the pooler works with this app's connection pattern in `packages/engine/src/db/client.ts`). Also set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from the project's API settings.
4. **`createStores(config)` lights up automatically** once `DATABASE_URL` is set (`packages/engine/src/db/stores.ts` gates on `config.db.url` — no code change needed to switch from fixtures to Postgres for the vector store / job storage / intake artifact storage paths that are already wired). `GET /api/health`'s `checks.db` will report `"ok"` once this is live and reachable.
5. **Run the gated integration suite against it**: `PASS_ALONG_TEST_DB_URL=<connection string> pnpm test` picks up `packages/engine/src/db/integration.test.ts` (currently `describe.skipIf(!TEST_DB_URL)`), which checks the expected tables exist and exercises the RLS policies (anon can read published recommendations but not originals/unpublished rows, cannot read moderation events/outbox/DLQ/demand signals/queries/data rights requests, etc.). This is the step that actually proves RLS is doing its job against a real Postgres, not just against the in-memory fixtures `pnpm test` runs by default.
6. **Wire `apps/web/src/app/api/pass/deps.ts`** to the Postgres-backed store once its async-interface gap is resolved (see that file's own comments and `packages/engine/src/db/stores.ts` — in progress on a concurrent lane as of this doc).
