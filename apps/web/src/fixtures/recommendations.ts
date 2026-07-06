import type { Recommendation } from "./types";

export const recommendations: Recommendation[] = [
  {
    id: "r1",
    providerId: "p1",
    issues: ["anxiety"],
    population: "new parent",
    modality: ["CBT"],
    quote:
      "She helped me name what was anxiety versus what was just new-baby exhaustion. That distinction alone changed how I showed up for myself.",
    recommenderContext: "recommended by a new parent navigating anxiety",
    freshnessConfirmedAt: "2026-06-15"
  },
  {
    id: "r2",
    providerId: "p1",
    issues: ["anxiety", "panic"],
    population: "adult",
    modality: ["CBT"],
    quote: "Gave me a plan for panic attacks that actually works on the bus, not just in her office.",
    recommenderContext: "recommended by an adult managing panic",
    freshnessConfirmedAt: "2026-05-20"
  },
  {
    id: "r3",
    providerId: "p1",
    issues: ["postpartum"],
    population: "new parent",
    modality: ["CBT"],
    quote: "Never once made me feel like a bad mom for struggling. That was the whole thing I needed.",
    recommenderContext: "recommended by a new parent",
    freshnessConfirmedAt: "2026-04-01"
  },
  {
    id: "r4",
    providerId: "p2",
    issues: ["relationship"],
    population: "couple",
    modality: ["family systems"],
    quote: "The practice paired us with someone who actually watched how we argued instead of just asking us to describe it.",
    recommenderContext: "recommended by a couple",
    freshnessConfirmedAt: "2026-05-01"
  },
  {
    id: "r5",
    providerId: "p2",
    issues: ["grief"],
    population: "adult",
    modality: ["talk therapy"],
    quote: "They let me talk about my dad in the present tense for as long as I needed to.",
    recommenderContext: "recommended by an adult processing loss",
    freshnessConfirmedAt: "2026-03-10"
  },
  {
    id: "r6",
    providerId: "p3",
    issues: ["teen anxiety"],
    population: "teen",
    modality: ["CBT"],
    quote: "My teenager actually looks forward to sessions, which is not a sentence I expected to say.",
    recommenderContext: "recommended by a parent of a teen",
    freshnessConfirmedAt: "2026-06-05"
  },
  {
    id: "r7",
    providerId: "p3",
    issues: ["adhd"],
    population: "teen",
    modality: ["CBT", "skills coaching"],
    quote: "Built real routines with my son instead of just labeling the behavior.",
    recommenderContext: "recommended by a parent navigating ADHD",
    freshnessConfirmedAt: "2026-02-18"
  },
  {
    id: "r8",
    providerId: "p4",
    issues: ["depression"],
    population: "adult",
    modality: ["talk therapy"],
    quote: "Slow and steady. She never rushed me toward feeling better before I was ready.",
    recommenderContext: "recommended by an adult managing depression",
    freshnessConfirmedAt: "2026-01-20"
  },
  {
    id: "r9",
    providerId: "p4",
    issues: ["anxiety", "depression"],
    population: "adult",
    modality: ["talk therapy"],
    quote: "Good at holding both things at once when I couldn't tell which one was driving the week.",
    recommenderContext: "recommended by an adult",
    freshnessConfirmedAt: "2026-03-05"
  },
  {
    id: "r10",
    providerId: "p5",
    issues: ["relationship"],
    population: "family",
    modality: ["family systems"],
    quote: "First family therapist who got my parents to actually listen instead of just wait their turn.",
    recommenderContext: "recommended by a family navigating conflict",
    freshnessConfirmedAt: "2026-06-01"
  },
  {
    id: "r11",
    providerId: "p5",
    issues: ["grief"],
    population: "teen",
    modality: ["family systems"],
    quote: "Helped our whole household grieve at different speeds without anyone feeling behind.",
    recommenderContext: "recommended by a parent",
    freshnessConfirmedAt: "2026-04-22"
  },
  {
    id: "r12",
    providerId: "p5",
    issues: ["teen anxiety"],
    population: "teen",
    modality: ["family systems", "CBT"],
    quote: "Includes the whole family in the plan, not just the kid who got labeled as the problem.",
    recommenderContext: "recommended by a parent of a teen",
    freshnessConfirmedAt: "2026-05-30"
  },
  {
    id: "r13",
    providerId: "p6",
    issues: ["relationship"],
    population: "couple",
    modality: ["EFT"],
    quote: "Finally a couples therapist who didn't take sides, ever, not even once.",
    recommenderContext: "recommended by a couple",
    freshnessConfirmedAt: "2026-06-10"
  },
  {
    id: "r14",
    providerId: "p6",
    issues: ["anxiety"],
    population: "LGBTQ+",
    modality: ["CBT"],
    quote: "Didn't need me to explain the basics of being queer before we could get to the actual work.",
    recommenderContext: "recommended by an LGBTQ+ adult",
    freshnessConfirmedAt: "2026-05-12"
  },
  {
    id: "r15",
    providerId: "p7",
    issues: ["substance use"],
    population: "adult",
    modality: ["DBT"],
    quote: "The structure at this center is what kept me showing up on the weeks I didn't want to.",
    recommenderContext: "recommended by an adult in recovery",
    freshnessConfirmedAt: "2026-02-01"
  },
  {
    id: "r16",
    providerId: "p7",
    issues: ["ptsd"],
    population: "veteran",
    modality: ["EMDR"],
    quote: "First place that treated my nightmares as a symptom to work on, not a personality trait.",
    recommenderContext: "recommended by a veteran",
    freshnessConfirmedAt: "2026-01-28"
  },
  {
    id: "r17",
    providerId: "p7",
    issues: ["substance use", "anxiety"],
    population: "adult",
    modality: ["DBT"],
    quote: "The group sessions here made the individual sessions land differently.",
    recommenderContext: "recommended by an adult in recovery",
    freshnessConfirmedAt: "2026-03-15"
  },
  {
    id: "r18",
    providerId: "p8",
    issues: ["anxiety", "depression"],
    population: "adult",
    modality: ["medication management"],
    quote: "Explains every med change in plain language and actually asks how the side effects feel.",
    recommenderContext: "recommended by an adult on medication",
    freshnessConfirmedAt: "2026-05-25"
  },
  {
    id: "r19",
    providerId: "p8",
    issues: ["adhd"],
    population: "adult",
    modality: ["medication management"],
    quote: "Took my scattered description of a normal day seriously instead of rushing to a diagnosis.",
    recommenderContext: "recommended by an adult navigating ADHD",
    freshnessConfirmedAt: "2026-04-10"
  },
  {
    id: "r20",
    providerId: "p9",
    issues: ["postpartum"],
    population: "new parent",
    modality: ["talk therapy"],
    quote: "Saw me within a week postpartum when everyone else had a two-month waitlist.",
    recommenderContext: "recommended by a new parent",
    freshnessConfirmedAt: "2026-01-05"
  },
  {
    id: "r21",
    providerId: "p9",
    issues: ["anxiety"],
    population: "new parent",
    modality: ["talk therapy"],
    quote: "Normalized the intrusive thoughts without ever making me feel like I needed to be hospitalized for having them.",
    recommenderContext: "recommended by a new parent navigating anxiety",
    freshnessConfirmedAt: "2026-02-20"
  },
  {
    id: "r22",
    providerId: "p10",
    issues: ["ptsd"],
    population: "adult",
    modality: ["EMDR"],
    quote: "Paced the EMDR work to what I could actually handle each week, never pushed past it.",
    recommenderContext: "recommended by an adult processing trauma",
    freshnessConfirmedAt: "2026-06-18"
  },
  {
    id: "r23",
    providerId: "p10",
    issues: ["grief", "depression"],
    population: "adult",
    modality: ["talk therapy"],
    quote: "The intake coordinator matched me with someone who'd actually worked with widowers before.",
    recommenderContext: "recommended by an adult processing loss",
    freshnessConfirmedAt: "2026-05-08"
  },
  {
    id: "r24",
    providerId: "p10",
    issues: ["relationship"],
    population: "couple",
    modality: ["EFT", "family systems"],
    quote: "This collective has three couples therapists and somehow all three run the same steady intake process.",
    recommenderContext: "recommended by a couple",
    freshnessConfirmedAt: "2026-06-22"
  },
  {
    id: "r25",
    providerId: "p2",
    issues: ["teen anxiety"],
    population: "teen",
    modality: ["CBT"],
    quote: "The practice's teen-specific intake meant my kid didn't have to sit in a waiting room full of adults.",
    recommenderContext: "recommended by a parent of a teen",
    freshnessConfirmedAt: "2026-06-08"
  }
];
