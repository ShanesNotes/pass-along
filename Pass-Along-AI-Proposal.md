# Pass Along — AI Build-Out Proposal & Meeting Brief

*Prepared for Shane's meeting with Danielle · July 2026*

---

## 1. What Pass Along is today (site scout)

Pass Along (trypassalong.com) is an **anonymous, community-powered recommendation network for therapists and treatment centers** — word-of-mouth ("you should see mine"), captured and made searchable. Two core flows:

- **Pass Along** (`/pass.html`): submit a free-text recommendation for a provider who helped you. Explicitly "not a review," anonymous, ~1 minute.
- **Find Help** (`/find.html`): "Tell us what's going on in your own words. We'll show you a few trusted recommendations from people who've been there."

The site is a static marketing shell — the pass/find pages render almost no functional content server-side, suggesting the product behind them is early or not yet built. **That's the opportunity: the Find flow as promised ("your own words" → relevant recommendations) is literally an AI semantic-search product. It cannot be built well without it.**

Danielle's positioning is unusually strong: CMO (distribution) + licensed therapist (clinical credibility + moderation authority) + lived experience (authentic founder story).

---

## 2. Why the timing is right (market)

The 2026 landscape validates the wedge:

| Player | Model | Matching | Takeaway for Pass Along |
|---|---|---|---|
| Psychology Today | Pay-to-list directory (~$30/mo, ~80K therapists) | Filters only | Referrals **declining** per therapist forums (late 2025–2026); listings flooded by network profiles. The incumbent is decaying. |
| Zencare / Mental Health Match | Curated directory + quiz | Structured quiz | Match against provider *self-descriptions*, not lived experience |
| Headway / Alma–Spring Health / Grow / Rula / SonderMind | Insurance-billing marketplaces ($1B+ valuations; Spring–Alma merger closed May 2026, 170M covered lives) | In-network filters | All supply-side infrastructure. Nobody owns demand-side trust. |
| Two Chairs | Employed clinicians | Human 45-min matching session, 98% first-match claim | Proof that matching quality is the differentiator people pay for |
| Stellocare (Canada), WithTherapy | Directory + LLM matching | Free-text AI match | Closest UX analogs — proof the free-text pattern works, but they match against directories, not community recommendations |
| StuffThatWorks / PatientsLikeMe | Crowdsourced treatment data (1.3M+ / 400K+ contributors) | ML over structured patient reports | The playbook: lightly structure free text so small corpora aggregate into signal. Neither does *provider* recommendations — that layer is empty. |

Two structural failures Pass Along attacks directly: **ghost networks** (Senate secret-shopper study: only 18% of listed mental-health providers were actually bookable; some analyses put ghost rates >80%) and **directory decay** (paid placement ≠ quality signal). Pass Along's real competitors are Facebook groups and Reddit threads — ephemeral, unsearchable, uncaptured.

**Strategic frame for the meeting:** the moat is not the AI — free-text matching is commoditized. The moat is the **corpus of verified lived-experience recommendations**. AI's job is to (a) make a small corpus feel useful on day one, (b) structure every submission so it compounds, and (c) keep the platform safe and trustworthy.

---

## 3. Proposed AI build-out (prioritized)

### Phase 1 — Make the two core flows real (4–8 weeks of work)

**A. Intake structuring pipeline (the "Pass Along" flow).**
Every free-text recommendation runs through an LLM extraction pass that tags: issue/condition, population (teen, couple, veteran…), modality (EMDR, CBT, IFS…), what changed for the person, provider name/location, insurance/payment notes, and a warmth/specificity quality score. Raw story is preserved; tags make it searchable and aggregatable. This is the StuffThatWorks lesson — structure at write time so 300 recommendations behave like 3,000.

**B. Semantic Find flow (the "Find Help" flow).**
User's "what's going on" text → embedding search over the recommendation corpus (+ tag filters) → LLM re-ranker picks the top few and generates a short "why this matched you" explanation *quoting the recommender's own words*. Output is framed as "recommendations from people who've been there," never advice or assessment.

**C. Safety layer (non-negotiable, and Danielle's clinical credential makes it credible).**
Three-tier crisis detection on every free-text input: deterministic keyword rules (always surface 988) → free classifier (OpenAI omni-moderation has purpose-built self-harm categories) → small-LLM review of flags. Plus moderation of submissions: PII scrubbing (protect anonymity — people leak identifying details), fake/astroturf detection, and provider license verification against state boards ("every recommendation is from a real person and the provider actually picks up" — a direct attack on ghost networks).

### Phase 2 — Compounding value

- **Guided conversational search:** short chat that helps someone articulate what they need before matching (many seekers don't have the vocabulary — "modality," "psychodynamic"). Strictly navigation, not counseling.
- **Aggregation pages:** auto-generated "what helped people with X" summaries once tag clusters hit critical mass — SEO surface area that directories can't replicate (Danielle's CMO instincts will see this immediately).
- **Recommender follow-up loop:** lightweight prompts to recommenders ("still seeing them? still taking new clients?") to keep freshness — the anti-ghost-network signal.
- **Provider-side (later, carefully):** verified provider profiles, B2B licensing to employers/payers. **Never paid placement** — it recreates the Psychology Today conflict the whole brand critiques.

### Phase 3 — MCP / API layer

You asked about MCP specifically. Two genuinely useful applications:

1. **Internal ops MCP server** — expose the recommendation DB, moderation queue, and license-verification tools to Claude/other agents so Danielle's (tiny) team can run ops conversationally: "show me this week's flagged submissions," "which cities have >10 recs but no EMDR coverage," "draft the follow-up batch." This is cheap to build once the API exists and is a huge force multiplier for a 1–2 person team.
2. **Public MCP endpoint (later)** — as AI assistants become a search channel, a `find_recommendations` MCP tool makes Pass Along's corpus reachable from ChatGPT/Claude/etc. Early, but it's a low-cost distribution bet no competitor is making.

The MCP layer is a thin wrapper over a clean internal REST API — design the API first, MCP falls out nearly free.

---

## 4. Backend architecture (proposed)

Keep it boring and cheap:

```
Next.js (Vercel)  ──►  Postgres + pgvector (Supabase or Neon)
      │                     ▲
      ▼                     │
 API routes ──► Async pipeline (queue): moderation → extraction
      │              → embedding → license check → publish
      ▼
 LLM providers (Anthropic / OpenAI) via thin abstraction layer
      │
 MCP server (wraps the same internal API)
```

- **Postgres + pgvector** as the single store (rows + vectors + tags). At this scale, 10K recommendations ≈ 60 MB of vectors — a dedicated vector DB (Pinecone, etc.) is unjustified. Supabase also gives auth + row-level security out of the box.
- **Async submission pipeline:** submissions land raw, process through moderation/extraction/embedding in a queue, publish on pass. Human (Danielle) reviews only flags — clinical judgment where it matters, automation everywhere else.
- **Thin model-abstraction layer** (or LiteLLM/OpenRouter) so models are swappable — pricing moves quarterly.
- **Batch APIs** (−50%) for all backfills/re-tagging; prompt caching (−90% on cached input) on system prompts.
- **No ad pixels or third-party trackers on intake/find pages, ever** (see §6).

---

## 5. Model selection & inference economics

Direct answer to "cheapest SOTA? GLM 5.2?": **GLM-5.2 is impressive but wrong for this.** It benchmarks near frontier on *coding* at ~$1.40/$4.40 per M tokens — but these workloads (short extraction, moderation, retrieval, brief chat) don't need frontier coding ability, and cheaper models undercut it 5–10×. Zhipu has also raised prices twice in 2026, and it's a US Entity List company with no BAA and Singapore/China hosting — a nonstarter for US consumer mental-health-adjacent data. Same verdict on DeepSeek's official API (mainland-China data processing) despite spectacular pricing. If GLM ever matters, run the open weights on a US host (Fireworks/Together). At your volumes, serverless open-weights hosting saves pennies and costs you first-party safety tuning — not worth it.

**Recommended stack (verified pricing, July 2026):**

| Workload | Model | Price ($/M in / out) | Why |
|---|---|---|---|
| Embeddings/search | OpenAI text-embedding-3-small — or Voyage voyage-4-lite | $0.02 / — (Voyage: first 200M tokens **free**) | Effectively $0 at this scale |
| Intake extraction | GPT-5-nano or Gemini 2.5 Flash-Lite; Haiku 4.5 if quality demands | $0.05–1.00 / $0.40–5.00 | Pennies; batch for backfills |
| Moderation/crisis first pass | omni-moderation-latest | **Free** | Purpose-built self-harm categories; layer with rules + Haiku review of flags |
| Re-rank + "why this match" + guided chat | **Claude Haiku 4.5** | $1.00 / $5.00 | Strongest small-model safety behavior for distress-adjacent conversation — the workload where model choice actually matters |
| Premium tier / hard cases | Claude Sonnet 5 | $2 / $10 intro (→ $3/$15 after Aug 31) | Optional upgrade path |

**Cost model:** ~$100/mo at 10K user queries/month, ~$1,000/mo at 100K (Haiku chat); a budget stack (Flash-Lite chat) runs ~$12/~$120. **Inference cost is a rounding error — don't let model pricing drive any architecture decision. Optimize for safety behavior and trust instead.** This is a strong talking point: the AI build-out is not expensive; the scarce resources are corpus and trust.

---

## 6. Regulatory guardrails (build as if regulated)

Pass Along is likely not a HIPAA covered entity — but that's a trap, not a pass:

- **FTC precedent is the real exposure:** BetterHelp ($7.8M — shared intake data with Facebook/Snapchat), GoodRx, Cerebral. Free-text "tell us what's going on" is exactly the data class at issue. No ad-tech on those flows, ever.
- **Washington My Health My Data Act** (+ NV/CT analogs) applies to *any* entity, includes a private right of action: opt-in consent for mental-health data, separate health-data privacy policy, deletion rights.
- **State AI-in-mental-health laws (IL WOPR Act, NV AB 406, UT HB 452):** AI must not deliver therapy or therapeutic recommendations. Navigation/matching is fine — but output must always read as *"search results from community recommendations,"* never assessment or advice, with crisis routing built in. This constraint should shape prompt design and UX copy from day one.
- **Section 230 + recommendations-only design:** positive-only content largely sidesteps defamation and the therapist-confidentiality-response problem; anonymity raises astroturfing risk → license verification + authenticity checks.

Danielle's licensed-therapist status is a genuine trust asset here — clinical review of moderation policy is a marketing claim competitors can't make.

---

## 7. What you bring to the table

Frame yourself as the **technical co-builder who de-risks the whole build**:

1. **Architecture & build:** you can ship Phase 1 (pipeline + semantic find + safety layer) on a lean stack for near-zero infra cost — and you've already scoped it (this doc).
2. **AI economics fluency:** verified model pricing, the GLM/DeepSeek analysis, and the "$100/mo, not $10K/mo" cost model — you save her from both overspending and from a naive vendor pitch.
3. **Safety-first engineering:** the three-tier crisis/moderation design and regulatory mapping show you understand this domain isn't a generic CRUD app — the thing a therapist-founder will care most about.
4. **MCP/agent-native thinking:** internal ops automation for a tiny team now; AI-assistant distribution channel later. Nobody in this market is building for that yet.
5. **A concrete 90-day plan** (below) instead of vague enthusiasm.

**90-day sketch:** Weeks 1–2 discovery (her data, volume, current form backend, org/roles) → Weeks 3–6 submission pipeline + corpus schema + safety layer → Weeks 7–10 semantic Find flow live → Weeks 11–13 instrument, license-verification MVP, internal ops MCP.

**Questions to ask Danielle in the meeting:**

- How many recommendations exist today, and where do submissions currently land (form tool? spreadsheet?)
- What's the cold-start plan — which community/city/niche first? (Corpus density in one niche beats thin national coverage.)
- Who else is involved — any technical help, budget, or funding conversations?
- What does she mean by "AI build-out" — the Find flow, ops automation, or something else she's imagined?
- Risk appetite: how does she want clinical review vs. automation balanced in moderation?
- Business model intentions — because "no paid placement" is an architectural decision, not just a values statement.

---

## Appendix: key sources

Market: ClearHealthCosts on Psychology Today referral decline (Dec 2025–Mar 2026); Spring Health–Alma merger (springhealth.com, May 2026); Grow Therapy $150M Series D at ~$1B revenue (BHB, Mar 2026); Senate Finance ghost-network secret-shopper study; stellocare.com/find-a-therapist/ai-matching; stuffthatworks.health.
Pricing (all fetched from official pages July 4, 2026): platform.claude.com/docs/en/about-claude/pricing · developers.openai.com/api/docs/pricing · ai.google.dev/gemini-api/docs/pricing · docs.z.ai/guides/overview/pricing · api-docs.deepseek.com/quick_start/pricing · docs.voyageai.com/docs/pricing.
Regulatory: FTC v. BetterHelp/GoodRx/Cerebral (ftc.gov); WA MHMDA (RCW 19.373); IL WOPR Act (idfpr.illinois.gov); NV AB 406, UT HB 452 (wsgr.com).
