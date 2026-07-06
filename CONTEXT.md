# Pass Along — Orientation Keystone

*This file wins on conflict. Read it first, every session.*

## What this repo is

Pre-meeting build workspace for **Pass Along** (trypassalong.com) — an anonymous, community-powered recommendation network for therapists and treatment centers. Shane has **not yet met the product owner (Danielle)**; everything here is speculative pre-build to demonstrate directions, not committed product. Nothing here touches the live site.

Three root documents are the source of truth for *what* to build:

1. `Pass-Along-AI-Proposal.md` — market frame, model economics, regulatory guardrails.
2. `Pass-Along-Build-Spec.md` — **the authoritative build spec**: conventions (§0), architecture (§2), contracts (§3), work packets (§4), wave map (§5). Work packets are quoted by ID (`L0-S2` etc.).
3. `Pass-Along-Experience-Proposal.html` — the non-technical experience narrative.

## Product frame (one paragraph)

The Angi playbook transposed to mental-health providers: demand-side trust marketplace where the trust signals are **lived-experience recommendations** (not reviews), **license verification** (anti-ghost-network), and **freshness confirmation** — never paid placement. The moat is the corpus, not the AI. AI structures every submission at write time (scrub → extract → score → embed) and makes a small corpus feel useful at read time (understand → retrieve → grounded re-rank).

## Hard invariants (from spec §0, non-negotiable)

- Raw find-flow query text is **never** persisted, logged, or analytics'd. `understood` JSON + SHA-256 hash only. CI `privacy:scan` greps for violations.
- Crisis safety gate blocks any public find path (`L1-S2` is a ship-blocker; crisis recall 1.0 is a hard CI gate).
- Output always reads as *search results from community recommendations*, never assessment, advice, or therapy (IL WOPR / NV AB 406 / UT HB 452).
- Migrations additive-only. Contracts live in `packages/core` as zod schemas. All model calls via `packages/engine/src/llm/adapter.ts` with a named `PROMPT_ID@version`.
- No paid placement, ever — it's an architectural decision, not a values poster.

## How work happens here

Orchestrator/worker AFK loop, transposed from the Gizmo pipeline. See `docs/orchestration/PLAYBOOK.md` for the full pipeline and `queue/INDEX.yaml` for the live ticket queue. Short form:

decompose → dispatch disjoint packets to workers (codex/grok CLIs, Sonnet agents) → verify DoD gates → blind adversarial audit → orchestrator refutation → red-first corrections → scoped commit/PR on green.

Branch: work happens on `build/foundation` (and packet branches off it), never directly on `main`.
