# The Gaps — a brutally honest assessment

*Written 2026-07-07 by the orchestrator at Shane's request: "I am not a developer and have never shipped — I need the gaps in the idea." Ordered by what actually kills projects like this, not by what's most fun to fix. The code gaps are at the bottom because they're the least dangerous.*

---

## Tier 1 — Existential (these kill the company, not the app)

### 1. The corpus does not exist, and the demo hides that.
Everything we built runs on 45 synthetic recommendations. The entire strategic frame — "the moat is the corpus, not the AI" — is correct, which means **we have built a beautiful engine with zero fuel and no fuel plan.** StuffThatWorks took years and seeded from existing communities. Nobody has answered:

- Where do the first 300 *real* recommendations come from?
- Why would a recommender — a one-shot, low-frequency contributor with no account and no return visit — come to a website they've never heard of at the exact moment they feel grateful to their therapist?
- Recommendations happen **in conversation** (group texts, Reddit threads, church basements, PTA meetings) — not on websites. Capturing at the moment of recommendation is the actual product problem, and it is unsolved.

The demo is dangerous here: it *looks* alive because we filled it with synthetic data. Demo-completeness is not product-completeness, and both Shane and Danielle need to hold that distinction hard.

**Fix:** a cold-start playbook before any launch: one niche × one metro (Danielle picks, from where her audience/credibility is densest); a personal-ask campaign through her network (therapist-adjacent communities recommend constantly); capture tools that live where conversations live (a share-by-text link, a "pass along by SMS" number, a one-question form that takes 60 seconds on a phone) — not "come to our website." Measure: density in the wedge niche, not national count.

### 2. Anonymity and growth are in direct tension, and we chose anonymity without pricing it.
Anonymous submissions mean: no email capture, no notification channel, no re-engagement, no CRM, no referral loop, no "your recommendation helped 3 people" dopamine (the single strongest retention mechanic this product could have). The freshness loop (L3-S4) quietly assumes an email we mostly won't have. Angi works because both sides return; here, neither side has a reason to come back.

**Fix:** design the *optional* identity gradient — anonymous by default, with a genuinely compelling reason to leave a contact (see the impact notification above; that one mechanic may be worth more than every AI feature we shipped). This is a product-design decision Danielle must own, because it touches her brand promise.

### 3. There is no agreement, no entity, and Shane is personally exposed.
Blunt version: **Shane has built a working product on Danielle's brand and idea without her knowledge.** That is either a generous gift or an overstep depending entirely on how the meeting is framed — and legally it's murky in both directions:

- "Pass Along" / trypassalong.com is her brand. Shipping anything public under it without agreement is trademark/goodwill trouble.
- Conversely, right now the repo is Shane's; if the collaboration goes forward informally and succeeds, IP ownership is a guaranteed future dispute.
- There is no LLC. A mental-health-adjacent consumer product operated by an informal partnership means **personal liability** — and this is a domain with a private right of action (WA MHMDA) and FTC precedent ($7.8M BetterHelp).
- No user-facing Terms of Service or Privacy Policy exists (docs/PRIVACY-LIFECYCLE.md is internal engineering, not a legal document). Nothing here has had a lawyer within a mile of it.

**Fix (before or at the meeting):** frame the build explicitly as *disposable options prepared for her decision* — "this is yours to direct or discard"; leave the meeting with a simple memo of understanding (who owns what, what happens if this goes nowhere); if it proceeds: entity formation, IP assignment into it, lawyer review of ToS/privacy/state health-data laws, and E&O/cyber insurance quotes. None of this is code and all of it outranks code.

### 4. Nobody has watched a real human use it.
Zero seekers, zero recommenders, zero moderator-Danielle sessions. The core UX bet — that people in distress will type an intimate paragraph into an unknown website — is untested and contradicts observed search behavior (people type 3 words, not 3 sentences). "Not reviews, recommendations" is a subtle distinction we assume users grasp. Trust in an unknown brand handling mental-health disclosures is assumed, not earned or measured.

**Fix (cheap, this week, no code):** 5 seeker interviews + 5 recommender interviews from Danielle's orbit; watch 3 of them use the demo cold (say nothing, watch where they hesitate); one moderation session with Danielle on the real bench. This will invalidate assumptions faster and cheaper than anything else we could do, and the findings will re-order the entire backlog.

---

## Tier 2 — Serious (these damage trust or stall growth)

### 5. Clinical governance is one engineer's guess wearing a stethoscope.
The crisis gate is solid *engineering* — but the rule families, the 74 goldens, the historical-vs-active distinction, and the 60-term taxonomy were all authored by AI/engineers and are marked "pending clinical review" that has never happened. A real product needs: a clinician-owned crisis protocol (what we show, when, and who decided), a moderation policy covering disputes (a therapist claims a recommendation about them is false — §230 helps but a *process* must exist), and a review cadence. Danielle's license is the asset here; right now it's decorative.

### 6. Recommendation quality has an unexamined dark side.
- **Fit is personal.** Therapeutic-alliance research says the "best" therapist is the best *match*, not the most-recommended. "Passed along 7×" subtly implies clinical validation. Copy and ranking must resist that implication (some of our copy already does; the number badges fight it).
- **Availability inversion.** We verify licenses but not capacity. Concentrating demand on well-recommended providers who are *full* recreates the ghost-network frustration with extra steps. The freshness loop half-answers this; a provider-side "accepting clients" signal (careful — it's the top of the slippery slope toward provider-pays) is the real answer.
- **Small-N identifiability.** In a small metro, story details + provider name can identify the *recommender* despite PII scrubbing (the scrubber removes names, not "the only EMDR therapist near the lake"). Needs a k-anonymity-style publish threshold per provider/metro and a scrub pass for contextual identifiers.

### 7. No measurement, so no learning.
We built a founder dashboard on synthetic events — but there is **no consented product analytics** at all (correctly none, per rule 6 — but the spec's consent-gated design was never built). Without funnel measurement (arrivals → searches → matched → clicked → passed along), every product decision post-launch is vibes. Privacy-safe analytics is a solved design (we already emit hash-only events); it needs consent UX + a real sink.

### 8. Operational bus factor = 1, and it's the person who won't be operating it.
Only Shane can run any of this. Danielle cannot deploy, moderate without hand-holding, read the dashboard, or respond to a data-rights request. If the partnership forms, the product's actual operator needs: a non-engineer runbook, alerting that reaches a phone, and the L5 ops-MCP (queued) so routine ops are conversational.

---

## Tier 3 — Technical debt on the path to production (real, bounded, all fixable)

| Gap | State | Fix trigger |
|---|---|---|
| Inngest rail is demo-inline; job state won't survive serverless | Documented in DEPLOY.md, unwired | First deploy |
| No staging environment, no error tracking, no backups/DR, no incident plan | Absent | Before first real user |
| Real embeddings never exercised (dev-hash only); evals judged by heuristics | Honest but weak | The day real corpus + OpenAI/Voyage key exist — re-baseline everything |
| Admin token in sessionStorage; no dependency scanning; no secrets rotation; no pen test | Demo-grade | Before real raw stories exist |
| Accessibility beyond color contrast (screen readers, keyboard, WCAG audit) | Untested | Before launch — this audience disproportionately needs it |
| Mobile: renders at 390px but never *used* on a phone | Untested | User-research week |
| Infra cost modeled for inference only; Supabase/Vercel tiers unmodeled | Minor | Post-meeting |
| Statutory-clock tracking for data-rights deadlines | Flagged in PRIVACY-LIFECYCLE.md, unbuilt | When first real request arrives (build before) |

---

## The meta-gap: the pre-build itself

Walking into the meeting with a finished-looking product is a power move that can backfire two ways: it can anchor Danielle to *our* choices (flattening the vision only she has — she knows things about therapists, seekers, and her audience that no amount of our research replaces), or it can read as "I built your company without you." The mitigation is entirely in the framing: **the demo's job is to answer "can it be built" so the meeting can be about "should it, and what do you know that changes it."** The three-directions page was built for exactly this; lead with questions (the six in the proposal doc), not the demo.

And the Garry-office-hours truth: a beautiful demo with zero users is *negative* signal if presented as more than a prototype. The only thing that makes this fundable is the corpus + retention curves in one niche. Everything we shipped is in service of getting there faster — it is not the thing itself.

---

## Priority order for fixes

1. **Meeting frame + partnership/legal basics** (tier 1.3) — protects Shane personally; nothing else matters if this goes wrong.
2. **Cold-start playbook + capture-at-conversation design** (1.1) — the actual product problem.
3. **User research week** (1.4) — cheapest possible invalidation of the riskiest assumptions.
4. **Anonymity/identity-gradient decision** (1.2) — Danielle's call, needed early because it shapes schema + growth.
5. **Clinical governance** (2.5) — turns Danielle's license from marketing into infrastructure.
6. **k-anonymity + availability signals** (2.6), **consented analytics** (2.7), **operator runbook** (2.8).
7. **Tier-3 debt** — sequenced against real usage, per the table.

Items 1–5 are conversations, documents, and interviews — not code. That is the honest headline: **the project's biggest missing pieces cannot be built by coding agents.**
