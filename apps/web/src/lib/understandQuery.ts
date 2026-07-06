export interface Facets {
  issues: string[];
  population: string | undefined;
  prefers: string[];
}

export type UnderstoodQuery =
  | { kind: "crisis" }
  | { kind: "low-confidence"; clarifyingQuestion: string }
  | { kind: "understood"; facets: Facets };

// Display-side echo only. The real find flow always posts raw text to /api/find,
// where the server safety gate decides whether search can continue.
const CRISIS_KEYWORDS = [
  "suicide",
  "suicidal",
  "kill myself",
  "want to die",
  "end my life",
  "hurt myself",
  "self harm",
  "self-harm"
];

const ISSUE_KEYWORDS: Record<string, string> = {
  anxious: "anxiety",
  anxiety: "anxiety",
  panic: "panic",
  depress: "depression",
  grief: "grief",
  griev: "grief",
  loss: "grief",
  trauma: "ptsd",
  ptsd: "ptsd",
  adhd: "adhd",
  focus: "adhd",
  relationship: "relationship",
  couple: "relationship",
  marriage: "relationship",
  postpartum: "postpartum",
  "new baby": "postpartum",
  substance: "substance use",
  drinking: "substance use",
  recovery: "substance use"
};

const POPULATION_KEYWORDS: Record<string, string> = {
  teen: "teen",
  teenager: "teen",
  "new parent": "new parent",
  postpartum: "new parent",
  veteran: "veteran",
  military: "veteran",
  lgbtq: "LGBTQ+",
  queer: "LGBTQ+",
  couple: "couple",
  family: "family"
};

const PREFERENCE_KEYWORDS: Record<string, string> = {
  evening: "evenings",
  night: "evenings",
  weekend: "weekends",
  virtual: "telehealth",
  online: "telehealth",
  "sliding scale": "sliding scale",
  affordable: "sliding scale"
};

export type FacetKind = "issue" | "population" | "prefer";

function matchKeywords(text: string, map: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const [needle, label] of Object.entries(map)) {
    if (text.includes(needle)) found.add(label);
  }
  return [...found];
}

export function understandQuery(rawText: string): UnderstoodQuery {
  const text = rawText.trim().toLowerCase();

  if (CRISIS_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return { kind: "crisis" };
  }

  const issues = matchKeywords(text, ISSUE_KEYWORDS);
  const populationMatches = matchKeywords(text, POPULATION_KEYWORDS);
  const prefers = matchKeywords(text, PREFERENCE_KEYWORDS);

  if (text.length < 12 || issues.length === 0) {
    return {
      kind: "low-confidence",
      clarifyingQuestion:
        "Are you looking for support with anxiety, depression, a relationship, or something else?"
    };
  }

  return {
    kind: "understood",
    facets: {
      issues,
      population: populationMatches[0],
      prefers
    }
  };
}

export function removeFacetFromQueryText(
  rawText: string,
  kind: FacetKind,
  value: string
): string {
  const keywordMap =
    kind === "issue"
      ? ISSUE_KEYWORDS
      : kind === "population"
        ? POPULATION_KEYWORDS
        : PREFERENCE_KEYWORDS;
  const variants = [
    value,
    ...Object.entries(keywordMap)
      .filter(([, label]) => label === value)
      .map(([keyword]) => keyword)
  ];

  const uniqueVariants = [...new Set(variants)]
    .filter((variant) => variant.trim().length > 0)
    .sort((left, right) => right.length - left.length);
  let amended = rawText;

  for (const variant of uniqueVariants) {
    const escaped = escapeRegExp(variant);
    amended = amended.replace(
      new RegExp(`(^|[^A-Za-z0-9])${escaped}(?:'s)?(?=$|[^A-Za-z0-9])`, "gi"),
      "$1"
    );
  }

  return amended
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
