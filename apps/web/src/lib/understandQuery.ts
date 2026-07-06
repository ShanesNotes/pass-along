import type { UnderstoodQuery } from "../../../../packages/core/src/index";

export interface Facets {
  issues: string[];
  population: string | undefined;
  prefers: string[];
}

const ISSUE_KEYWORDS: Record<string, string> = {
  anxiety: "anxiety",
  panic: "panic",
  depress: "depression",
  grief: "grief",
  griev: "grief",
  loss: "grief",
  trauma: "trauma_ptsd",
  ptsd: "trauma_ptsd",
  adhd: "adhd",
  focus: "adhd",
  relationship: "relationship_issues",
  couple: "relationship_issues",
  marriage: "relationship_issues",
  postpartum: "postpartum",
  "new baby": "postpartum",
  substance: "substance_use",
  drinking: "substance_use",
  recovery: "substance_use",
  "chronic pain": "chronic_pain",
  burnout: "stress_burnout",
  "social anxiety": "social_anxiety"
};

const POPULATION_KEYWORDS: Record<string, string> = {
  teen: "teen",
  teenager: "teen",
  teenage: "teen",
  "new parent": "new_parent",
  postpartum: "new_parent",
  veteran: "veteran",
  military: "veteran",
  lgbtq: "lgbtq_plus",
  queer: "lgbtq_plus",
  couple: "couple",
  family: "family",
  husband: "adult",
  wife: "adult",
  spouse: "adult",
  adult: "adult"
};

const PREFERENCE_KEYWORDS: Record<string, string> = {
  evening: "evenings",
  night: "evenings",
  virtual: "telehealth",
  online: "telehealth",
  telehealth: "telehealth",
  insurance: "insurance",
  "sliding scale": "sliding_scale",
  affordable: "sliding_scale",
  cbt: "cbt",
  dbt: "dbt",
  emdr: "emdr",
  erp: "exposure_erp",
  "family systems": "family_systems",
  somatic: "somatic",
  group: "group"
};

export type FacetKind = "issue" | "population" | "prefer";

export function facetsFromUnderstood(
  understood: UnderstoodQuery | null
): Facets {
  if (!understood) {
    return emptyFacets();
  }

  return {
    issues: understood.issues.map((issue) => issue.value),
    population: understood.population,
    prefers: [
      ...(understood.preferences.modality ?? []).map(
        (modality) => modality.value
      ),
      ...(understood.preferences.logistics ?? []),
      ...(understood.preferences.style ?? [])
    ]
  };
}

export function emptyFacets(): Facets {
  return { issues: [], population: undefined, prefers: [] };
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
    value.replaceAll("_", " "),
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
