# Pass Along — Intelligence Layer Build Spec

*v2 — agent-executable. July 2026.*
*Companion: `Pass-Along-Experience-Proposal.html` (non-technical "what"). This is the "how," structured so each slice can be handed to an autonomous coding agent and merged on green.*

---

## 0. Execution model — how this spec gets built AFK

This spec assumes an **orchestrator/worker** workflow: Shane orchestrates; coding agents execute slices unattended; CI is the arbiter; humans only review PRs and moderation queues.

**The contract:** every slice below is a **work packet** — self-contained context, explicit file scope, typed interfaces, a Definition of Done, and machine-runnable verification. An agent given one packet plus the conventions below should produce a mergeable PR without asking questions.

### Conventions (prepend to every agent session)

```
REPO LAYOUT (pnpm monorepo)
  apps/web/                 Next.js (App Router) — UI + API routes
  packages/core/            zod schemas, shared types, constants (SOURCE OF TRUTH)
  packages/engine/          pipeline steps, model adapter, retrieval
  packages/prompts/         versioned prompt files + per-prompt golden tests
  supabase/migrations/      SQL, additive-only, timestamped
  evals/                    golden datasets + runner
  tools/mcp/                internal MCP server

RULES
  1. Touch only files inside the packet's FILE SCOPE. If a change is needed
     elsewhere, stop and emit a BLOCKED note in the PR description.
  2. Contracts-first: any new interface goes in packages/core as a zod schema;
     API routes and pipeline steps import from core. Never inline-define shapes.
  3. Migrations are additive-only (new tables/columns/indexes). Never rename,
     drop, or change types in place.
  4. All model calls go through packages/engine/src/llm/adapter.ts. Never import
     a provider SDK anywhere else. Every call site passes a named PROMPT_ID.
  5. Prompts live in packages/prompts/<id>/<version>.md with a colocated
     goldens.jsonl. Changing a prompt = new version file + goldens pass.
  6. Raw find-flow query text is NEVER persisted, logged, or sent to analytics.
     Structured `understood` JSON + SHA-256 hash only. CI greps for violations.
  7. No new runtime dependencies without a DEPENDENCY note in the PR
     description (name, license, why, alternatives considered).
  8. Every packet ships its tests in the same PR. Green CI = mergeable;
     red = keep working. Do not weaken tests or skip evals to get green.

CI GATES (all PRs)
  pnpm typecheck && pnpm lint && pnpm test          # unit + contract tests
  pnpm eval --changed                               # goldens for touched prompts
  pnpm db:lint                                      # migration additivity check
  pnpm privacy:scan                                 # forbidden-sink grep (rule 6)

PR TEMPLATE
  Packet ID · What changed · Interfaces added/changed (core diff) ·
  Verification output pasted · BLOCKED/DEPENDENCY notes · Rollback note
```

**Branching:** `packet/<id>-short-name`. One packet = one PR. Packets marked `parallel: yes` may run as concurrent agent sessions; others serialize on their dependencies.

---

## 1. Current state (recon) and what "AI build-out" most plausibly means

The live site's stylesheet reveals a designed-but-unpowered MVP: find flow (free-text + mic, list/map toggle, therapist/facility toggle), result cards with `passed-pill`, `like-you`, `verified-inline`, tag frequencies, keystone quotes, `see similar`; a pass flow with typeahead provider picker, chips, and a guided keystone story field; crisis banner; consent-gated analytics; comments like "MVP 1.1", "spec build", "ROUND 5".

**Reading between the lines, the UI already commits to six intelligent behaviors** — query understanding (`.understood`), similarity matching (`.like-you`), semantic alternatives (`.sim-block`), provider verification (`.verified-inline`), structured story capture (keystone "spec build"), and tag aggregation with frequencies (`.conv .tag .freq`). The build-out = making those six true, plus the pipeline and safety machinery they imply. Everything below is organized around that.

**Discovery unknowns (L0-S1 resolves):** where submissions land today, corpus size, whether typeahead/verified run on real data, hosting access, any existing backend.

---

## 2. The orchestration layer (architecture centerpiece)

The foundation of the build-out is not any single model call — it's a **durable, observable, human-gated event pipeline**. Get this right and every AI feature becomes a small, swappable worker hanging off a rail.

### 2.1 Choice: Inngest over raw queues

Durable step functions with retries, fan-out, cron, sleep/wait-for-event (needed for human-review gates and follow-up scheduling), local dev server, and Vercel-native deployment — without running infra. Fallback if vendor-averse: pg-boss on Supabase (accepted cost: hand-rolled retries/DLQ/waits). All workers are written against a thin `packages/engine/src/jobs/` interface so the runner is swappable.

### 2.2 Event & job catalog

```
EVENTS (outbox table `events`, append-only, id + type + payload + emitted_at)
  submission.received        pass flow POST accepted (raw stored, status=received)
  submission.published       moderation passed, embeddings written
  submission.flagged         any tier flagged; carries {reasons[], tier}
  provider.created           new provider row from submission or import
  provider.verified          license check completed {status, source, checked_at}
  find.performed             {understood_json, result_count, latency_ms, hash} — NO raw text
  find.unmet                 sparse-corpus fallback triggered {understood_json}
  followup.answered          {rec_id, response}
  moderation.decided         human decision {action, reviewer}

JOBS (Inngest functions; ✋ = human gate, ⏰ = cron)
  onSubmissionReceived   fan-out orchestrator (below)
  scrubPii               redact third-party names/employers/dates → scrubbed_story
  extractTags            structured extraction → rec_tags (schema §3.2)
  scoreQuality           specificity/authenticity/duplicate scores
  resolveProvider        fuzzy-match or create provider; emits provider.created
  verifyLicense          state-board adapter chain; emits provider.verified
  embedRecommendation    embedding → rec_embeddings
  decidePublish          rules: all-green → publish; any flag → ✋ review queue
  ✋ awaitModeration      waitForEvent(moderation.decided) with 14-day timeout
  ⏰ freshnessBatch       quarterly follow-up magic links to recommenders
  ⏰ licenseRecheck       rolling re-verification (oldest checked_at first)
  ⏰ aggregateRebuild     nightly: tag-cluster pages eligible for publish (≥N recs)
  ⏰ weeklyDigest         coverage gaps, demand signals, queue stats → email/MCP
  ⏰ dlqSweep             surface dead-lettered jobs to admin
```

### 2.3 Submission state machine

```
received ──scrub──▶ scrubbing ──extract──▶ enriching ──score──▶ scored
   scored ──all green──────────────────────────────▶ published
   scored ──any flag──▶ review_pending ──approve──▶ published
                              │──reject──▶ rejected
                              │──edit+approve──▶ published (reviewer edits scrub)
   published ──takedown/report──▶ removed
Every transition writes moderation_events; illegal transitions throw (enforced in
packages/core/src/statemachine.ts — single source of truth, unit-tested).
```

### 2.4 Reliability rules

Idempotency: every job keyed on `(job_name, entity_id, attempt_group)`; steps upsert, never insert-blind. Retries: exponential backoff ×4, then DLQ (`jobs_dlq` + admin surface + weekly sweep). Prompt versioning: `PROMPT_ID@version` recorded on every artifact row (`rec_tags.prompt_version` etc.) so backfills are targeted. Model routing: adapter maps `PROMPT_ID → {provider, model, params}` from one config file — model swaps are one-line PRs that must pass goldens.

### 2.5 Find-path (synchronous, target p95 < 2.5s)

```
POST /api/find
  ├─ safetyGate (parallel: regex rules + moderation classifier)  — hard gate
  │     crisis → return {crisis:true} (UI shows 988 support card; nothing stored)
  ├─ understandQuery (small LLM, JSON schema, temp 0)
  ├─ retrieve (pgvector cosine top-40 ∩ tag/geo/kind filters, trigram name match)
  ├─ rerankExplain (Haiku-class: top-6 + grounded "why" quoting rec spans)
  │     grounding check: every why-claim must cite a span id; else drop the line
  └─ respond {understood, results[], unmet?}; emit find.performed (hash only)
```

---

## 3. Contracts (packages/core, authoritative)

### 3.1 Understood-query schema

```ts
UnderstoodQuery = {
  issues: TaxonomyTag[],            // controlled vocab, see 3.2
  population?: "teen"|"adult"|"couple"|"family"|"child"|"veteran"|...,
  kind: "therapist"|"facility"|"either",
  preferences: { style?: string[], modality?: TaxonomyTag[],
                 logistics?: ("telehealth"|"insurance"|"sliding_scale"|"evenings")[] },
  location?: { text: string, geocoded?: LatLng },
  confidence: number                // <0.55 → UI asks one clarifying chip-question
}
```

### 3.2 Extraction schema (per recommendation)

```ts
RecEnrichment = {
  tags: { type:"issue"|"population"|"modality"|"style"|"logistics"|"outcome",
          value: string, vocab: boolean, confidence: number }[],
  keystone_quote: { text: string, start: number, end: number },  // span into scrubbed_story
  duration_hint?: string,
  pii_findings: { span:[number,number], kind:"person"|"org"|"date"|"place", replacement:string }[],
  quality: { specificity:0-1, lived_experience:0-1, ad_smell:0-1, dup_similarity:0-1 }
}
```

Taxonomy: seed vocabulary ~60 terms (issues/populations/modalities) in `packages/core/src/taxonomy.ts`; model maps free text → vocab with confidence; sub-threshold descriptors kept as `vocab:false` and surfaced in admin for promotion.

### 3.3 Golden-eval file format (evals/)

```jsonl
{"suite":"crisis","input":"...","expect":{"crisis":true}}
{"suite":"understand","input":"my 15yo daughter ...","expect_subset":{"issues":["anxiety"],"population":"teen"}}
{"suite":"extract","input":"<story>","expect_tags_f1_min":0.85}
{"suite":"match","query_id":"q17","expect_top3_contains":["rec_042"]}
```

Runner: `pnpm eval --suite crisis` → JSON report; CI thresholds: crisis recall = 1.0 (hard fail), understand field-accuracy ≥ .9, extract F1 ≥ .85, match precision@3 ≥ baseline.

---

## 4. Work packets

Legend: `effort` S≈½day M≈1-2d L≈3-5d of agent time · `parallel` = safe to run concurrently with siblings once deps merge.

### L0 — Foundations

---

**L0-S1 · Discovery & corpus liberation** — `effort:S · parallel:no · HUMAN (not agent)`
The only human-required packet. Obtain: current submission storage + export, provider dataset behind typeahead (if any), hosting/repo access, corpus counts, launch-geo intent, moderation appetite, business-model intent.
**DoD:** `docs/discovery.md` answers §1 unknowns; corpus export lands in `evals/fixtures/corpus_raw/` (gitignored).

---

**L0-S2 · Monorepo scaffold + CI gates** — `effort:M · parallel:no · depends:—`
**Scope:** repo root, `.github/workflows/`, `packages/core` skeleton, `apps/web` bootstrap.
**Deliverables:** pnpm workspace per §0 layout; CI running all five gates (privacy:scan = grep-based forbidden-sink check: `console.log(.*query`, analytics calls in find path, raw-text inserts to `queries`); `db:lint` additivity checker; PR template.
**DoD:** fresh clone → `pnpm i && pnpm typecheck && pnpm test` green; CI blocks a seeded rule-6 violation (include the failing fixture test).
**Verify:** run gates locally; intentionally add `console.log(rawQuery)` in a test file → privacy:scan fails.

---

**L0-S3 · Schema v1 + state machine + seed import** — `effort:M · parallel:no · depends:L0-S2`
**Scope:** `supabase/migrations/0001_*.sql`, `packages/core/src/{schema,statemachine,taxonomy}.ts`, `scripts/import.ts`.
**Deliverables:** tables `providers, recommendations, rec_tags, rec_embeddings, moderation_events, follow_ups, events, jobs_dlq, aggregate_pages, demand_signals` (+ `queries` table storing hash/understood ONLY — column named `raw_text` must not exist, asserted by test); RLS anon = published-only reads; pgvector + trigram extensions; state machine per §2.3 with exhaustive transition tests; idempotent corpus importer.
**DoD:** `pnpm db:reset && pnpm db:migrate && pnpm import --dry-run` clean; re-running import creates zero dupes; RLS verified by anon-key integration test.

---

**L0-S4 · LLM adapter + prompt registry + eval runner** — `effort:M · parallel:yes · depends:L0-S2`
**Scope:** `packages/engine/src/llm/`, `packages/prompts/`, `evals/`.
**Deliverables:** adapter (Anthropic/OpenAI/Google behind one interface; retry, timeout, token accounting, `inference_geo` passthrough); `PROMPT_ID@version` registry; eval runner per §3.3 with the four suites stubbed + ≥25 seed goldens each for `crisis` and `understand` (author synthetic goldens — no real user text).
**DoD:** `pnpm eval --suite crisis` produces report; adapter unit-tested with mocked providers; swapping model for a PROMPT_ID is a one-line config diff (test asserts).

---

**L0-S5 · Orchestration rail** — `effort:M · parallel:yes · depends:L0-S3`
**Scope:** `packages/engine/src/jobs/`, `apps/web/src/inngest/`.
**Deliverables:** Inngest client + local dev config; job/event catalog per §2.2 as typed definitions (handlers stubbed, wired to events outbox); idempotency helper; DLQ writer; `onSubmissionReceived` orchestrator calling stub steps in §2.3 order with state transitions.
**DoD:** integration test drives a fake submission `received → published` through stubs; forced step-failure lands in `jobs_dlq` with replay helper; every transition row present in `moderation_events`.

---

### L1 — Understanding & Matching (the Find engine)

---

**L1-S1 · Embeddings + raw vector find** — `effort:M · parallel:no · depends:L0-S3,L0-S4`
**Scope:** `packages/engine/src/retrieval/`, `apps/web/src/app/api/find/route.ts`, `embedRecommendation` job.
**Deliverables:** embed worker (text-embedding-3-small; store model version); HNSW index migration; `/api/find` v0 = embed query → cosine top-N ∩ kind/geo filter → cards payload matching existing UI fields (name, loc, passed_count, tags w/ freq, keystone, verified). Corpus backfill script (Batch where supported).
**DoD:** golden `match` suite baseline recorded in `evals/baselines.json`; p95 < 800ms on 1k-rec fixture corpus; zero raw-query persistence (privacy:scan + integration assert on `queries` rows).

---

**L1-S2 · Safety gate on the find path** — `effort:M · parallel:no · depends:L1-S1 · SHIP-BLOCKER for any public find`
**Scope:** `packages/engine/src/safety/`, find route.
**Deliverables:** tier-1 regex rule families (self-harm, harm-to-others, medical-emergency) with rule-file format + tests; tier-2 moderation-classifier call; either-triggers → `{crisis:true}` response contract; crisis suite expanded to ≥60 goldens covering indirect phrasing ("I don't see the point anymore"), negations ("I'm not suicidal, but…" → still supportive path), and false-positive controls ("killing it at work").
**DoD:** crisis recall 1.0 on suite (CI hard gate); FP rate < 15% on control set; crisis path stores nothing, asserted.
**Guardrail:** this packet may not be batched with feature work; its PR contains safety code only (review isolation).

---

**L1-S3 · Query understanding + `understood` echo** — `effort:M · parallel:yes · depends:L1-S1`
**Scope:** `packages/prompts/understand/`, find route, `apps/web` find page component.
**Deliverables:** `understand@1` prompt → `UnderstoodQuery` (schema-validated, temp 0, reject-and-retry-once on parse fail); UI renders existing `.understood` line from structured fields with correction chips (tap = remove/adjust facet → client-side re-query); `confidence <0.55` → one clarifying chip-question instead of results.
**DoD:** understand suite ≥ .9 field accuracy; correction round-trips without page reload; `find.performed` event carries understood JSON + hash only.

---

**L1-S4 · Re-rank + grounded "why this matched"** — `effort:M · parallel:yes · depends:L1-S3`
**Scope:** `packages/prompts/rerank/`, find route.
**Deliverables:** `rerank@1`: top-40 → top-6 with per-result `{score, why, cited_span_ids[]}`; grounding validator drops any `why` whose claims lack cited spans (log counter); sun-box "Why this might fit you" wired into cards; latency budget enforced (understanding + rerank ≤ 1.6s p95 via parallel retrieval).
**DoD:** match precision@3 ≥ baseline+30%; 100% of rendered `why` lines pass grounding validator; latency budget met on fixture corpus.

---

**L1-S5 · Sparse-corpus fallback + demand signals** — `effort:S · parallel:yes · depends:L1-S3`
**Deliverables:** <3 strong matches → honest "closest experiences" framing + ask-the-network card; `find.unmet` event → `demand_signals` aggregation (understood JSON, count, first/last seen — no raw text).
**DoD:** fallback renders on fixture sparse query; demand rows aggregate correctly across repeat queries (hash-grouped).

---

**L1-S6 · "See similar" + typeahead on real data** — `effort:S · parallel:yes · depends:L1-S1`
**Deliverables:** `.sim-block` populated via vector neighbors (same-kind, geo-weighted); provider typeahead served from `providers` table (trigram) replacing any client stub.
**DoD:** similar-neighbor unit tests; typeahead p95 < 150ms.

---

### L2 — Intake & Enrichment pipeline

---

**L2-S1 · PII scrub worker** — `effort:M · parallel:yes · depends:L0-S5,L0-S4`
**Scope:** `packages/prompts/scrub/`, `scrubPii` job.
**Deliverables:** `scrub@1` emits `pii_findings` spans (§3.2); deterministic replacements ("a friend", "her workplace"); provider's own name is NOT scrubbed; heavy-PII (≥4 findings or low confidence) → flag `pii_heavy` for review; original stored in restricted-RLS column, scrubbed version is the only publicly readable text.
**DoD:** scrub suite (≥30 goldens incl. tricky cases: provider name kept, city kept, sister's name removed) ≥ .9 span F1; RLS test proves anon cannot read raw column.

---

**L2-S2 · Extraction + tagging worker** — `effort:M · parallel:yes · depends:L2-S1`
**Deliverables:** `extract@1` → `RecEnrichment`; taxonomy mapping w/ confidence; keystone-quote span selection (feeds existing `.keystone` UI); tags written with `prompt_version`; card tag frequencies computed from DB aggregate, not hardcoded.
**DoD:** extract F1 ≥ .85; every published rec has ≥1 issue tag + keystone span; frequency aggregates match fixture counts.

---

**L2-S3 · Quality, authenticity & duplicate scoring** — `effort:M · parallel:yes · depends:L2-S2`
**Deliverables:** heuristics + small-LLM blend → `quality` block; near-dup detection vs same-provider recs (embedding cosine > .93 → flag); ad-smell + template-similarity checks (astroturf); scores route `decidePublish` per §2.3 (all-green auto-publish threshold configurable, default conservative: everything human-reviewed until corpus > 200).
**DoD:** seeded dup pair flagged; seeded ad-copy fixture flagged; routing matrix unit-tested.

---

**L2-S4 · Corpus backfill** — `effort:S · parallel:no · depends:L2-S2,L2-S3`
**Deliverables:** batch backfill of existing corpus through scrub→extract→score→embed (Batch API, −50%); progress + resume; report of flags for human sweep.
**DoD:** 100% of imported corpus enriched or flagged; spot-check sample report generated.

---

**L2-S5 · Provider resolution** — `effort:M · parallel:yes · depends:L0-S5`
**Deliverables:** fuzzy matcher (name + geo + credential) with confidence bands: ≥.9 auto-link, .6–.9 review flag, <.6 create-pending; merge tool data model (`provider_merges` audit table).
**DoD:** matcher test set (30 fixture pairs incl. "Dr. Maya Reyes" vs "Maya Reyes LPC") ≥ .95 correct routing; no silent auto-merges below band.

---

### L3 — Trust & Safety machinery

---

**L3-S1 · Pass-flow safety + moderation queue** — `effort:M · parallel:yes · depends:L0-S5`
**Deliverables:** same tiered gate on submissions (crisis-in-story → supportive interstitial, story still savable — the storyteller may be fine, the story may reference past crisis; classify `historical` vs `active` with `crisis_context@1` prompt); `review_pending` queue tables + `awaitModeration` wait-for-event wiring; decision writes `moderation.decided`.
**DoD:** active-crisis fixture shows interstitial; historical-reference fixture publishes normally after review; queue round-trip integration test.

---

**L3-S2 · Admin review UI** — `effort:M · parallel:yes · depends:L3-S1`
**Scope:** `apps/web/src/app/admin/` (Supabase auth, admin role).
**Deliverables:** queue list w/ flag reasons; side-by-side raw vs scrubbed with span highlights; approve / edit-scrub / reject (+reason); taxonomy-promotion panel (`vocab:false` descriptors → vocabulary); DLQ view + replay button.
**DoD:** every state-machine action reachable in UI; audit row per action; keyboard-only review flow (reviewer efficiency).

---

**L3-S3 · License verification framework + top-3 states** — `effort:L · parallel:yes · depends:L2-S5`
**Deliverables:** adapter interface `verifyLicense(provider) → {status, source, evidence_url, checked_at}`; implementations for top-3 corpus states (API where exists, else structured scrape w/ polite rate limits + caching; manual-queue fallback adapter); `verified-inline` badge rendered ONLY from a dated successful check; "checked <month year>" copy.
**DoD:** fixture providers verify against recorded HTTP cassettes; badge integration test (no check row → no badge); recheck cron targets oldest first.

---

**L3-S4 · Freshness loop (magic links)** — `effort:M · parallel:yes · depends:L0-S5`
**Deliverables:** quarterly `freshnessBatch`: signed single-use token per rec (no account, no email stored if none given — skip silently), one-tap responses (`still seeing · stopped · not accepting`); responses update `accepting_status` + card copy ("a recommender confirmed they're still practicing — <quarter>").
**DoD:** token single-use + 30-day expiry tested; response updates provider + emits `followup.answered`; zero-PII assertion on token payload.

---

**L3-S5 · Report/takedown + provider claims** — `effort:S · parallel:yes · depends:L3-S2`
**Deliverables:** public report endpoint (rate-limited) → `removed` path; provider claim/dispute intake (manual review; recommendations-only policy means disputes are narrow); policy pages copy stubs.
**DoD:** report → auto-unpublish-at-threshold config + admin notify; audit trail complete.

---

### L4 — Growth engine (post-core; packets lighter, same format on request)

- **L4-S1 · Weekly digest** (`S`, depends L1-S5): `weeklyDigest` cron → coverage gaps, demand top-10, queue stats; email + MCP resource. DoD: digest renders from fixtures.
- **L4-S2 · Aggregation pages** (`M`, depends L2-S2): nightly `aggregateRebuild` marks tag×geo clusters ≥N recs; `aggregate@1` prompt drafts page strictly from quote spans (grounding validator reused); admin approve → publish + sitemap. DoD: no page publishes without approval; every sentence cites spans.
- **L4-S3 · Share cards** (`S`): OG-image generation per published rec (anonymous, on-brand); share URLs w/ UTM-free clean paths. DoD: image snapshot tests.
- **L4-S4 · Adaptive keystone follow-up** (`S`, depends L2-S3): one gentle clarifying question when quality.specificity < threshold, asked inline pre-submit; never more than one. DoD: A/B flag; question grounded in what's missing.

### L5 — Ops copilot (MCP)

- **L5-S1 · Internal MCP server** (`M`, depends L3-S2): `tools/mcp/` exposing `review_queue, decide, corpus_stats, coverage_gaps, license_status, run_followup_batch, dlq_list, dlq_replay` over the admin API with admin auth. DoD: every routine op executable from Claude without SQL.
- **L5-S2 · Digest-as-resource + scheduled summaries** (`S`, depends L4-S1).
- **L5-S3 · Public read-only MCP** (`S`, later): `find_recommendations` over published data only; rate-limited. DoD: anon-scope test proves published-only.

---

## 5. Sequencing & agent-parallelism map

```
Wave 0 (human):    L0-S1
Wave 1 (serial):   L0-S2 → L0-S3
Wave 2 (3 agents): L0-S4 ∥ L0-S5 ∥ (web glue)
Wave 3 (serial):   L1-S1 → L1-S2        ← safety gate blocks public find
Wave 4 (4 agents): L1-S3 ∥ L2-S1 ∥ L2-S5 ∥ L3-S1
Wave 5 (4 agents): L1-S4 ∥ L1-S5 ∥ L1-S6 ∥ L2-S2
Wave 6 (4 agents): L2-S3 ∥ L3-S2 ∥ L3-S4 ∥ L3-S3(start, longest)
Wave 7:            L2-S4 backfill → launch checklist → L3-S5 ∥ L4-S1 ∥ L5-S1
```

Milestones: **M1** end Wave 3 — real semantic find behind a safety gate, zero visible redesign. **M2** end Wave 6 — full pipeline, true verified badges, human-gated moderation. **M3** Wave 7 — compounding loops + ops copilot. Roughly 90 days with one orchestrator + 2–4 concurrent agent sessions; inference+infra ≈ $125/mo at current scale.

Launch checklist (M2→public): crisis suite recall 1.0 in last 5 CI runs · privacy:scan clean · RLS pen-test pass · all published recs enriched+scrubbed · badges backed by dated checks · consent banner verified GA-gating · takedown path tested.

---

## 6. Discovery questions (unchanged, feed L0-S1)

Data location & corpus size · typeahead/verified data reality · hosting/repo access · launch niche/geo · moderation appetite · business-model intent (ranking-integrity guarantees; no paid placement).
