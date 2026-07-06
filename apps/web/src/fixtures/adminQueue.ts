export interface FlaggedSubmission {
  id: string;
  providerName: string;
  flagReasons: string[];
  raw: string;
  scrubbed: string;
  piiSpans: { start: number; end: number; label: string }[];
  submittedAt: string;
}

export interface TaxonomyCandidate {
  id: string;
  term: string;
  occurrences: number;
  suggestedParent: string;
}

export interface DlqEntry {
  id: string;
  jobName: string;
  entityId: string;
  attempts: number;
  lastError: string;
  failedAt: string;
}

export const flaggedSubmissions: FlaggedSubmission[] = [
  {
    id: "s1",
    providerName: "Maria Chen",
    flagReasons: ["possible third-party name", "employer mention"],
    raw: "My coworker Danielle recommended Maria after I mentioned my anxiety at Ferris Consulting.",
    scrubbed: "A coworker recommended Maria after I mentioned my anxiety at [EMPLOYER].",
    piiSpans: [
      { start: 3, end: 12, label: "third-party name" },
      { start: 62, end: 79, label: "employer" }
    ],
    submittedAt: "2026-06-28"
  },
  {
    id: "s2",
    providerName: "Bluebonnet Behavioral Health",
    flagReasons: ["low specificity score"],
    raw: "It was fine I guess, helped some.",
    scrubbed: "It was fine I guess, helped some.",
    piiSpans: [],
    submittedAt: "2026-06-29"
  },
  {
    id: "s3",
    providerName: "Grace Whitfield",
    flagReasons: ["possible duplicate submission"],
    raw: "Finally a couples therapist who didn't take sides, ever, not even once.",
    scrubbed: "Finally a couples therapist who didn't take sides, ever, not even once.",
    piiSpans: [],
    submittedAt: "2026-06-30"
  },
  {
    id: "s4",
    providerName: "Dana Kim",
    flagReasons: ["possible date/location identifier"],
    raw: "Saw her on March 3rd at the clinic near 4th and Lamar right after my son was born.",
    scrubbed: "Saw her [DATE] at the clinic near [LOCATION] right after my son was born.",
    piiSpans: [
      { start: 11, end: 20, label: "specific date" },
      { start: 34, end: 49, label: "specific location" }
    ],
    submittedAt: "2026-07-01"
  }
];

export const taxonomyCandidates: TaxonomyCandidate[] = [
  { id: "t1", term: "postpartum rage", occurrences: 6, suggestedParent: "postpartum" },
  { id: "t2", term: "religious trauma", occurrences: 4, suggestedParent: "trauma" },
  { id: "t3", term: "sandwich generation stress", occurrences: 3, suggestedParent: "caregiver stress" }
];

export const dlqEntries: DlqEntry[] = [
  {
    id: "d1",
    jobName: "verifyLicense",
    entityId: "p9",
    attempts: 4,
    lastError: "state board endpoint timeout",
    failedAt: "2026-07-02"
  },
  {
    id: "d2",
    jobName: "embedRecommendation",
    entityId: "r19",
    attempts: 4,
    lastError: "embedding provider rate limited",
    failedAt: "2026-07-03"
  }
];
