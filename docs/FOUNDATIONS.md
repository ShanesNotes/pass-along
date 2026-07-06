# Foundations Map — the Angi clone, transposed

*Highest-level pillars for Pass Along as a demand-side trust marketplace. Each pillar names its Angi analog, the spec packets that implement it, and status. The Angi mechanic we permanently reject: paid placement / lead-gen ranking — ranking integrity is architectural.*

| # | Pillar | Angi analog | Packets | Status |
|---|--------|-------------|---------|--------|
| 1 | **Contracts & data spine** — zod contracts, state machine, taxonomy, schema | listings DB + category taxonomy | L0-S2, L0-S3 | ✅ shipped (PA-002/003) |
| 2 | **Model access layer** — one adapter, versioned prompts, golden evals | (none — our edge) | L0-S4 | 🔨 PA-004 |
| 3 | **Durable event rail** — submission pipeline as jobs/events, human gates, DLQ | lead-routing backend | L0-S5 | 🔨 PA-005 |
| 4 | **Matching engine** — embeddings, vector find, understood-query, re-rank; crisis safety gate in front | search & pro-matching | L1-S1…S6 | wave 3 (PA-007/008 first) |
| 5 | **Intake enrichment** — PII scrub, extraction/tagging, quality + astroturf scoring | review ingestion + fraud detection | L2-S1…S4 | queued |
| 6 | **Trust & verification** — provider resolution, state-board license checks, freshness loop | background checks, "Verified Pro" badges | L2-S5, L3-S3, L3-S4 | queued |
| 7 | **Moderation & admin bench** — review queue, span-highlighted scrub review, taxonomy promotion | content moderation ops | L3-S1, L3-S2, L3-S5 | queued (wireframed) |
| 8 | **Growth surfaces** — aggregation pages, demand signals, share cards | city/cost-guide SEO pages | L1-S5, L4-S1…S4 | queued |
| 9 | **Ops copilot** — internal MCP over admin API; later public find endpoint | (none — our edge) | L5-S1…S3 | queued |

## Build order rationale

Pillars 2–3 are pure infrastructure with zero discovery dependency — they unblock everything and are safe to build pre-meeting. Pillar 4 builds next against the synthetic fixture corpus (models mocked in tests; live keys are a config flip), with the safety gate (L1-S2) shipping alone before any public find. Pillars 5–7 are where discovery answers (corpus reality, moderation appetite, launch geo) start changing decisions — build the frameworks, defer the tuning. Pillars 8–9 compound only once 4–6 exist.

The two-sided-marketplace shape, in Angi terms: **supply** = providers (created from recommendations, not self-listing — pillar 6 makes them trustworthy), **demand** = seekers (pillar 4 matches them), **trust** = the corpus + verification (pillars 5–6), **liquidity flywheel** = Ask-the-Network demand signals + aggregation pages recruiting new recommenders (pillar 8).
