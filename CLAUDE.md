# Pass Along — Worker Conventions

Read `CONTEXT.md` first (it wins on conflict). This file is what every coding agent gets prepended to its session, per Build-Spec §0.

## Repo layout (pnpm monorepo)

```
apps/web/                 Next.js (App Router) — UI + API routes
packages/core/            zod schemas, shared types, constants (SOURCE OF TRUTH)
packages/engine/          pipeline steps, model adapter, retrieval
packages/prompts/         versioned prompt files + per-prompt golden tests
supabase/migrations/      SQL, additive-only, timestamped
evals/                    golden datasets + runner
tools/mcp/                internal MCP server
queue/                    orchestration ticket queue (INDEX.yaml)
docs/orchestration/       playbook + wave reports
```

## Rules (verbatim from spec §0 — violations fail review)

1. Touch only files inside your packet's FILE SCOPE. Change needed elsewhere → stop, emit a BLOCKED note.
2. Contracts-first: new interfaces are zod schemas in `packages/core`; everything imports from core. Never inline-define shapes.
3. Migrations additive-only. Never rename, drop, or change types in place.
4. All model calls via `packages/engine/src/llm/adapter.ts` with a named `PROMPT_ID`. No provider SDK imports anywhere else.
5. Prompts: `packages/prompts/<id>/<version>.md` + colocated `goldens.jsonl`. Prompt change = new version file + goldens pass.
6. Raw find-flow query text is NEVER persisted, logged, or sent to analytics. Structured `understood` JSON + SHA-256 hash only.
7. No new runtime dependencies without a DEPENDENCY note (name, license, why, alternatives).
8. Ship tests in the same change. Green gates = done; red = keep working. Never weaken tests or skip evals to get green.

## Gates

```
pnpm typecheck && pnpm lint && pnpm test
pnpm eval --changed        # goldens for touched prompts (once evals exist)
pnpm db:lint               # migration additivity
pnpm privacy:scan          # forbidden-sink grep (rule 6)
```

## Style

- TypeScript strict; no `any` without a comment stating why.
- Wireframe UI (`apps/web`) is deliberately greybox: system fonts, neutral palette, no design-system dependency — the point is flows and information architecture, not polish.
- Fixture data lives in `evals/fixtures/` and is synthetic. Never author fixtures that read as real people in crisis; keep crisis-suite goldens clinical and brief.
