# Privacy & data lifecycle

Why this exists: Washington's My Health My Data Act (+ NV/CT analogs) applies to Pass Along even though it likely isn't a HIPAA covered entity, includes a private right of action, and grants deletion rights over "consumer health data" — a bar free-text mental-health recommendation stories clear easily (Pass-Along-AI-Proposal.md §6). The machinery has to exist from day one, not bolted on after a complaint. This doc covers what we store, where, how long, how a deletion request flows end to end, and the one documented exception to the events-outbox append-only rule.

## What we store, and where

| Table | Content | Sensitivity |
| --- | --- | --- |
| `recommendation_originals` | Raw submitted story text + `for_whom`, restricted (no anon SELECT policy at all) | Highest — this is the pre-scrub raw text |
| `recommendations.scrubbed_story` | PII-scrubbed story text, denormalized for the published card | High — still first-person health narrative, just with names/dates/places replaced |
| `rec_intake_artifacts.scrub/extract/quality` | JSON blobs from the scrub/extract/score pipeline steps, including PII findings spans and the scrubbed/extracted text again | High — duplicates raw-adjacent content in a different shape |
| `rec_tags` | Structured issue/population/modality/style/logistics/outcome tags derived from the story | Medium — inferred health-adjacent categories, no free text |
| `rec_embeddings` | The embedding vector for the recommendation's combined text | Medium — a vector encoding of the same content; not human-readable but not nothing |
| `moderation_events` | Workflow audit trail: state transitions, actor, optional free-text `reason`, `metadata` jsonb | Medium — `reason`/`metadata` can occasionally reference story content (e.g. an admin's note) |
| `events` (outbox) | Append-only event log: `type`, `payload`, `emitted_at`. Every payload in `packages/core/src/schema.ts`'s `EventCatalog` today carries only ids/counts/hashes, never raw text | Low today, by design — kept redactable anyway as defense in depth |
| `queries` / `demand_signals` | Hash + `understood` JSON for find-flow queries. Raw find query text is never persisted anywhere (see CONTEXT.md's hard invariants; CI's `privacy:scan` enforces it) | N/A — this doc is about *recommendation* data, not find-flow queries, which have their own zero-raw-text guarantee |

Retention default: indefinite while a recommendation is active (`received` through `published`), because the corpus itself is the product. There is no independent time-based purge job yet — deletion is request-driven (below) until a retention-schedule ticket exists.

## The 988 / crisis-path zero-storage guarantee (restated)

Both `/api/find` and `/api/pass` run every submission through the safety gate before anything is written. When the gate reports `crisis: true`, the route returns the 988 interstitial immediately and nothing about that request — not the story, not a hash, not an event — is ever persisted. This is unconditional and predates this packet; it is restated here because it's the strongest possible answer to "what do you do with someone's crisis disclosure" and belongs next to the rest of the data-lifecycle story.

## Deletion cascade (`deleteRecommendation`, `packages/engine/src/lifecycle/delete-recommendation.ts`)

Given a `recommendationId`, in order:

1. **Delete outright** (100% raw or raw-derived content, no reason to keep a trace):
   - `recommendation_originals` row
   - `rec_tags` rows
   - `rec_embeddings` row
   - `rec_intake_artifacts` row
2. **Redact in place, don't delete**: the `recommendations` row itself. It survives as a stub — `status = 'removed'`, `removed_at = now()`, `scrubbed_story = null`, `recommender_contact_hash = null` — because it's the foreign-key anchor for `moderation_events` (including the tombstone written in step 4) and for provider/aggregate stats elsewhere in the system. Hard-deleting it would either orphan the audit trail or force cascading deletes into tables this cascade deliberately doesn't touch (e.g. `providers`).
3. **Redact existing `moderation_events` rows** tied to this recommendation: `reason` → `null`, `metadata` → `{}`. The transitions themselves (`action`, `from_state`, `to_state`, `actor`, `created_at`) stay — they're workflow metadata, not personal content — but any free-text `reason` an admin wrote (which could reference story content) is cleared.
4. **Append one tombstone `moderation_events` row**: `action = 'deleted'`, `reason = null`, `metadata = {}`, keyed by an idempotency key (`deletion:<recommendationId>`) so a retried deletion never writes a second tombstone.

Each step is idempotent (deleting an already-deleted row / redacting an already-redacted row is a no-op; the tombstone insert is `on conflict ... do nothing` on Postgres), so `deleteRecommendation` is safe to retry or re-run.

`LifecycleStoragePort` (`packages/engine/src/lifecycle/ports.ts`) is the seam: an in-memory implementation (`memory.ts`) backs the unit tests, and `PgLifecycleStorage` (`pg-adapter.ts`) implements the same port against the tables above with plain SQL — no schema changes were needed beyond `0004_data_rights_requests.sql`. Nothing calls the Postgres path automatically yet; wiring it into a real store (the way `apps/web/src/app/api/pass/deps.ts` composes `PassDemoStore`) is follow-up work once the auth seam (PA-025) lands, since only an authenticated admin action should be able to trigger a deletion in production.

### The events-outbox append-only exception

`packages/engine/src/jobs/ports.ts`'s `events` table is designed to be append-only — it's the system's event log, and nothing in the pipeline ever updates a row after writing it. `deleteRecommendation` is a deliberate, narrow exception: `redactOutboxEventsForRecommendation` finds every `events` row whose payload carries this recommendation's id (`payload.recommendation_id` or `payload.rec_id`) and overwrites `payload` in place with `{ recommendation_id, redacted: true }`, leaving `id`, `type`, and `emitted_at` untouched. Every event payload in today's `EventCatalog` already carries no raw text (ids, counts, hashes, enum-valued actions only), so in practice this redaction has nothing sensitive to remove yet — it exists as defense in depth so a future event type that *does* carry more context doesn't quietly become an un-redactable trace of a deleted recommendation.

## `deleteSubmission` job

`packages/engine/src/jobs/catalog.ts` wires a `deleteSubmission` job into the same catalog/runner pattern as every other pipeline step (`JOB_NAMES`, `JOB_DEFINITIONS`). It triggers on the existing `moderation.decided` event and only acts when `payload.action === "remove"` — that action value was already defined in `ModerationDecidedEventSchema` (`packages/core/src/schema.ts`) but nothing emitted it before this change, so reusing it avoids widening `EventCatalog` for a schema change outside this packet's scope. When it fires, it runs `deleteRecommendation` over the job's `storage` the same way `embedRecommendation` duck-types its own storage extension: if the storage in use doesn't implement `LifecycleStoragePort` (true of today's `InMemoryJobStorage`/`PassDemoStore`), the job reports `skippedReason: "storage_unavailable"` instead of throwing.

## `POST /api/data-rights` — the human-processing queue

`apps/web/src/app/api/data-rights/route.ts` accepts `{ kind: "deletion_request", recommendation_id?, contact? }`, rate-limited (5/min/IP, reusing the same `RateLimiter`/`withRouteGuard` seam as `/api/find`, `/api/pass`, `/api/typeahead`), and requires at least one of `recommendation_id` or `contact` so there's something for a human to act on. It stores a `pending` row in the new `data_rights_requests` table (`supabase/migrations/0004_data_rights_requests.sql`, RLS anon-deny like every other non-public table in this schema) and returns `{ request_id, status }`.

This endpoint **files a request**; it does not call `deleteRecommendation` itself. Identity verification — confirming the requester is who they say they are before anything gets deleted — is manual and explicitly out of scope for this packet (automating it is future work once the auth seam exists). The intended flow today:

1. Requester submits via `/api/data-rights` (or, later, a form backed by it).
2. Danielle (or another admin, once PA-025's auth lands) reviews the `data_rights_requests` row, verifies identity out of band, and if it's a deletion, triggers the cascade — today that means driving `deleteRecommendation` directly against a Postgres-backed `LifecycleStoragePort`; later it likely becomes an admin action that also emits `moderation.decided` with `action: "remove"` so the `deleteSubmission` job runs it through the same pipeline everything else uses.
3. The row's `status` moves from `pending` → `processing` → `completed` (or `denied`), and `processed_at`/`processed_by` get set. That state-machine wiring is not built yet — the table has the columns, but no route or job updates them yet.

**Statutory clock note:** MHMDA-style deletion rights typically carry a response-time requirement (commonly framed as a matter of weeks, not months). Nothing in this repo currently enforces or alerts on that clock — the `requested_at` timestamp on each row is the input a future reminder/digest job would need, but building that job is not part of this packet.
