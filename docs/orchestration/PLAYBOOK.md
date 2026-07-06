# Orchestration Playbook — Pass Along

*Transposed from the Gizmo Hades-clone AFK pipeline (shipped v1 overnight, 6 PRs, 2,296 checks green) onto the Build-Spec §0 orchestrator/worker contract. This doc is the process; the spec is the product.*

## Pipeline (per wave)

1. **Decompose** — orchestrator picks the next wave from `queue/INDEX.yaml`, confirms tickets have disjoint file scopes, and writes each worker a self-contained packet prompt: the spec packet text + §0 conventions + repo-relative context. A worker must be able to ship without asking questions; if it can't, the packet was cut wrong — fix the packet, not the worker.
2. **Dispatch** — parallel workers per routing law (`queue/INDEX.yaml → routing_law`). Workers run unattended on packet branches (`packet/<id>-short-name`) or, pre-CI, directly against the working tree in disjoint scopes.
3. **Verify** — orchestrator runs the packet's DoD gates verbatim (typecheck, tests, privacy:scan, eval suites). Red = send back to the same worker with the failing output; do not fix silently, do not weaken gates.
4. **Adversarial audit** — blind finder pass: Sonnet agent(s) given the diff and the packet's DoD, told to find integration defects, contract drift, and privacy-rule violations — *not* told what the workers claimed. Two finders for large waves, one for small.
5. **Refutation** — orchestrator triages findings: reproduce or refute each one. Confirmed findings become red-first corrections (write the failing test first) routed back to the owning worker.
6. **Merge gate** — full battery green → scoped commit(s) per packet on `build/foundation`. Cross-slice defects that only appear in the merged tree are the orchestrator's to catch here (Gizmo strategic-gate lesson).
7. **Ceremony** — for user-visible waves: actually run the app (`pnpm dev`), click the flows, screenshot. Headless-green ≠ working (Gizmo shipped 2 physics defects invisible to headless tests; the web equivalent is hydration/runtime errors invisible to unit tests).

## Worker invocation (verified mechanics, inherited from Gizmo)

The three ULTRAGOAL prompts are **global**, not project files: `/home/ark/prompts/{feature-ship,decompose,adversarial-audit}.md`, mirrored as skills into `~/.codex/skills/`, `~/.grok/skills/`, `~/.claude/skills/`. Workers can be told "run feature-ship on this ticket" directly; this repo only supplies the queue and packet.

- **Codex** — `codex exec -C /home/ark/pass-along -s workspace-write --color never - < packet.md` (background, 10–40 min). Nontrivial engineering, contracts, test rewrites. Commits coherent partial state if killed; cannot write outside the workspace — the orchestrator owns all vault writes.
- **Grok** — `grok -p "$(cat packet.md)" --cwd /home/ark/pass-along --permission-mode acceptEdits --output-format plain`. Mechanical, judgment-free volume only. **Silent-death lesson:** Grok may finish edits but exit before reporting/flipping status with a near-empty log — treat uncommitted-but-green work as recoverable: audit the diff, and the orchestrator commits on Grok's behalf with attribution. 2/4 silent-death rate on authoring tickets (2026-07-06) → default such tickets to Codex.
- **Sonnet subagents** (Agent tool) — research fan-out, design drafts, blind audit finders. Any factual claim about external material gets orchestrator verification before it enters a spec. Never Fable subagents (model-tiering law).
- **Harness gotchas:** poll worker logs (mtime + content), not process status — nohup-inside-background double-detaches; `pgrep -f` false-positives on the polling shell itself.

Audit stage follows `adversarial-audit.md` in full when waves get large: blind parallel finders by category (correctness, data-loss, concurrency, security, API drift, perf) → 3-refuter panel per finding (survives only with ≥2 votes) → minimal failing reproducer → fixes authorized in severity order (data loss > security > wrong results > crash > leak > perf); stop after 2 dry rounds. Corrections always go back to the **same worker** — the orchestrator never silently patches worker code.

## Verification battery

Single entry point (the `run_all_checks.sh` equivalent): `pnpm verify` = typecheck + lint + test + privacy:scan + db:lint (+ `eval --changed` once suites exist). No queue status flips to `shipped` without exit 0. Red-first: the failing test lands in the same commit as its fix.

## Safety-specific law (this domain, not Gizmo)

- The safety gate packet (PA-008 / L1-S2) ships **alone** — safety code only in its PR, never batched with features.
- Crisis-suite recall 1.0 is a merge-blocking gate everywhere it runs.
- Any finding touching rule 6 (raw query persistence) is auto-confirmed severity-HIGH; refutation burden is on proving it *doesn't* leak.

## Pre-meeting posture

Until L0-S1 (discovery) lands: synthetic fixtures only, no real user text, no external service accounts beyond dev-tier, and everything framed as *direction candidates* for Danielle — reversible, demonstrable, cheap to throw away.
