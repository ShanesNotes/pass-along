# Cold-Start Playbook — from the published idea to a living corpus

*Written as an outside consultant encountering trypassalong.com for the first time. Grounded only in what the site publishes: "Finding the right mental health care shouldn't depend on who you know" · recommendations rooted in anonymous lived experience · two flows (Pass Along / Find Help) · "Always anonymous — No accounts. No logins." · a founder (Danielle) with a personal story. Everything else below is presented as options with trade-offs, not prescriptions — including options that require little or no engineering.*

---

## 0. The honest read of the published idea

**What's strong:** the thesis is genuinely differentiated (word-of-mouth, captured — not another directory); the founder-clinician voice is a trust asset competitors can't copy; "not reviews" positions away from defamation and toward hope; the anonymity promise removes contribution friction.

**What the published site itself is missing (pre-strategy, just hygiene):**
1. **No crisis resources anywhere.** For a mental-health property this is the first thing any reviewer, partner, or journalist will notice. Fix before anything else — it's an afternoon of copy.
2. **"Always anonymous — No accounts. No logins"** is written as an absolute. It's a great contribution promise and a growth straitjacket (no way to tell a recommender "your words helped someone"). Options preserved below — but know the site has already made a promise you may want to soften to *"anonymous by default."*
3. No launch status or expectation-setting — visitors can't tell if flows work, which spends trust.

**The structural problem this playbook exists for:** this is a two-sided market where the supply side (recommenders) are *one-shot, low-frequency contributors* with no natural return visit, and the demand side (seekers) get value only if supply density exists *in their situation and place*. Nothing about this works "a little bit everywhere." It works "completely, somewhere small" — then expands.

---

## 1. First decision: what shape does v1 deployment take?

Four options, in ascending engineering weight. **Each can honor the published promise.** The right answer depends on Danielle's time, risk appetite, and how fast you want to learn.

### Option A — Concierge (no product at all)
A form (Typeform/Tally) collects recommendations; a form collects seeker requests; **a human (Danielle) matches them by hand** and replies by email/text within 48h. A simple spreadsheet is the corpus.
- **Validates:** will people submit? will seekers trust a reply? what do real submissions look like?
- **Cost:** ~$0 and founder hours. **Time to live: days.**
- **Risks:** doesn't scale (that's the point); founder burnout; still needs the privacy/crisis floor (see §5).
- **Consultant note:** this is the classic do-things-that-don't-scale move, and for a trust product a *human reply from a therapist-founder* may convert better than any algorithm. Strongest option if the priority is learning per dollar.

### Option B — Curated directory-lite
Recommendations are collected (form) and hand-published as **browsable pages** — by city or by concern ("What helped people with postpartum anxiety in Denver") — no search, no matching. Squarespace/Notion/static site.
- **Validates:** does the *content* attract seekers (SEO/social)? which niches draw demand?
- **Cost:** near-$0. **Time to live: 1–2 weeks.**
- **Risks:** no personalization; the "tell us in your own words" find-flow promise stays unshipped; publishing is manual labor.

### Option C — Assisted product (thin software, human in the loop)
Real submission flow with automated intake structuring; simple search/filters for seekers; **every publication human-approved.** This is roughly "the site's promises, minimally true."
- **Validates:** the actual UX bets (will seekers type their situation? do matches feel right?).
- **Cost:** engineering weeks + modest infra. **Time to live: weeks.**
- **Risks:** you're now operating software with real user text — the full privacy/safety floor (§5) is mandatory, not aspirational.

### Option D — Full AI-matching product
Semantic free-text matching, AI-structured intake, explanation of matches, verification badges — the published vision, fully.
- **Validates:** whether the *product* is magic — but only *after* density exists; magic search over 30 recommendations is a party trick.
- **Consultant note:** whatever prototype work may already exist, treat D as something you *graduate into* when Option A/B/C metrics demand it — not the starting point. The corpus makes the product valuable, never the reverse.

**A sane composite:** A immediately (learning) + B's publishing habit (demand capture) → C when volume makes concierge painful → D when density makes matching meaningful. Decision gates in §7.

---

## 2. Second decision: the wedge (where density gets built first)

Pick ONE. Criteria: Danielle's credibility reaches it; recommendations flow person-to-person inside it already; it's under-served by directories; ~50 recommendations would feel like abundance inside it.

| Wedge shape | Example | Pros | Cons |
|---|---|---|---|
| **Geographic metro** | One city she has real network in | Local press/community loops; providers verifiable in one state | Ceiling = metro size; harder if her audience is online-national |
| **Condition/situation, national** | Postpartum; grief; therapist-for-your-teen | Matches how people actually seek ("who helped someone like me"); content compounds via SEO | Provider licensure is state-bound — matching must respect geography anyway |
| **Community-anchored** | A specific parenting network, faith community, veteran org, employer | Warm-intro seeding; built-in trust | Corpus may be invisible/irrelevant outside the community |
| **Provider-type** | "Therapists who actually take insurance in ___" | Attacks the ghost-network pain head-on | Verification-heavy from day one |

**Anti-pattern to name and refuse:** launching "for everyone, everywhere" because the software technically allows it.

---

## 3. Supply: where the first ~150 real recommendations come from

Ranked options; use several. **Rule of thumb: the first 100 are recruited one at a time — plan founder hours accordingly.**

1. **Founder's direct ask** — personal messages, not broadcasts, to people Danielle knows have "a therapist who changed my life" stories. Conversion on warm asks is 10–50×.
2. **Community partnerships** — support-group facilitators, NAMI-style chapters, moderators of condition-specific forums/Facebook groups (ask permission; offer the community a curated page of *their* recommendations as the payoff). Recommendations already happen there weekly — this is capture, not creation.
3. **Content-led capture** — Danielle publishes in founder voice ("the recommendation that saved me") wherever her audience is; every piece ends with the pass-along ask.
4. **Therapist-adjacent networks** — clinicians know *other* clinicians' reputations; a "who do you send clients to when you're full?" channel is a legitimate, distinct supply stream (label its provenance differently from lived-experience stories — don't blend them silently).
5. **Physical capture at moments of gratitude** — QR cards that partnered therapists may offer *ethically* ("if your care here helped, consider passing it along — never required, never seen by me"). Requires a clinician-written ethics note; done wrong it's coercive, done right it's capture at the exact moment of feeling helped.
6. **Event/workshop harvesting** — any talk Danielle gives ends with 5 minutes of "pass one along right now, phones out."

**Capture-channel options (the form is not the only door):** the 60-second phone-first web form; an SMS number ("text PASSALONG…") for zero-web-friction capture; a voice-note option (people speak stories they'd never type — transcription is cheap); a share-link that a recommender sends *to the person asking them for a therapist* (this one meets the recommendation at its actual moment of occurrence, inside an existing conversation — arguably the most native mechanic available and worth prototyping in any deployment option).

---

## 4. Demand: making a tiny corpus feel like abundance

- **Sequencing:** do NOT drive seekers before the wedge has density (a seeker who gets nothing never returns; worse, they conclude the concept is empty). Supply-first for the first 60–90 days.
- **The sparse-corpus honesty pattern:** when a seeker's need isn't covered, say so warmly and *convert the miss into supply*: "we don't have this yet — know someone who does? / want us to ask the network?" Every unmet search is a demand signal to aim recruitment at.
- **"Ask the network"** (concierge-compatible!): a seeker's anonymized need is relayed to recommenders/communities who might know someone. Human-brokered at first. This mechanic alone can carry the early product.
- **Aggregation/SEO pages** (Option B habit): "what helped people with X in Y" pages built from real quotes become the durable demand channel directories can't copy — but only publish clusters with enough stories to be genuinely useful.
- **Founder distribution:** her audience is the launch channel; the wedge should be chosen partly because that's true.

---

## 5. The floor: what must exist before ANY deployment option collects a real story

Non-negotiable regardless of Option A/B/C/D — most of these are copy, policy, and process, not engineering:

1. **Crisis routing** — 988 and crisis resources visibly present on every intake/search surface; a written protocol for what happens if a submission or request suggests active crisis (who sees it, within what time, what they do). *(Currently absent from the live site.)*
2. **A real privacy policy + terms** — lawyer-reviewed, covering the mental-health-data statutes of target states; no ad-tech on intake/search surfaces, ever.
3. **Anonymity, decided precisely** — options: (a) absolute (as published — accept the growth cost); (b) anonymous-by-default with *optional* contact for "your words helped someone" notifications (the strongest retention mechanic available — requires softening the published absolute); (c) pseudonymous handles. Pick one deliberately; it shapes everything downstream.
4. **Moderation from submission #1** — a named human approves every story pre-publication at this scale; written rules for what's rejected (identifying third parties, active-crisis content, ad-smell, provider self-promotion); a takedown/dispute path for named providers *before* the first dispute, not after.
5. **PII hygiene** — scrubbing third-party names/details from published stories (human pass at concierge scale; automated later), plus a small-community identifiability check ("would this story's details identify the recommender in this niche?").
6. **Provider reality-check** — at minimum: named provider exists and license is current (manual state-board lookup at concierge scale). Never render a "verified" signal that isn't backed by a dated check.
7. **Deletion on request** — a working email/process for "remove my story," honored fast and completely, with the response-deadline requirements of applicable state law tracked.
8. **An entity + insurance** before public launch (see MOU checklist §7).

---

## 6. Measurement (works even for the concierge option)

- **North star: wedge density** — recommendations covering the wedge such that ≥80% of wedge-typical requests get ≥3 relevant results (or a useful human reply within 48h).
- Supply health: recommendations/week; % from each channel (tells you where to spend founder hours); acceptance rate through moderation; % of recommenders opting into contact (validates the §5.3 decision).
- Demand health: requests/week; **matched vs unmet rate** (the honest number); reply/click-through; return rate of unmet seekers after "ask the network."
- Trust health: time-to-moderation; disputes; % of published stories with verified providers.
- Learning cadence: weekly 30-minute review of every raw submission and every unmet request — at this scale, reading everything IS the analytics.

## 7. A 90-day sequence with decision gates

- **Weeks 1–2 — Floor + frame.** Crisis copy on the live site (day 1); privacy/anonymity decision; moderation rules v1; wedge chosen; MOU conversation happens. *Gate: floor items 1–4 exist in writing.*
- **Weeks 3–6 — Concierge supply push.** Option A live; founder-ask campaign (target: 50 real stories); one community partnership; every story moderated + provider-checked by hand. *Gate: 50 stories and the ask-conversion rate known. If warm asks convert <10%, the contribution promise itself needs rework — stop and diagnose before building anything.*
- **Weeks 7–10 — Demand trickle.** Open Find (concierge replies or curated pages) to the wedge only; run "ask the network" manually on misses. *Gate: matched-rate ≥ 50% and at least a handful of "this actually helped me find someone" replies.*
- **Weeks 11–13 — Graduate or iterate.** If concierge volume hurts: move to Option C for the painful part only. If density is thin: another supply cycle instead of more software. Publish the first 2–3 aggregation pages from real clusters. *Gate for any Option D investment: seekers are returning and citing match quality — i.e., the corpus, not the software, is now the constraint.*

---

*The one-sentence version: make the promise safe (floor), make it true somewhere small (wedge + concierge), let humans do the magic until the corpus — not the ambition — demands software.*
