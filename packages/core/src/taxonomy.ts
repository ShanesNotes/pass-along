// Seed vocabulary pending clinical review.
export const ISSUE_TERMS = [
  "anxiety",
  "depression",
  "trauma_ptsd",
  "ocd",
  "grief",
  "eating_disorders",
  "substance_use",
  "adhd",
  "bipolar",
  "postpartum",
  "chronic_illness",
  "relationship_issues",
  "stress_burnout",
  "panic",
  "phobias",
  "self_esteem",
  "anger",
  "sleep",
  "autism",
  "personality_disorders",
  "psychosis",
  "gender_identity",
  "sexual_health",
  "infertility",
  "parenting",
  "family_conflict",
  "domestic_violence",
  "life_transitions",
  "chronic_pain",
  "social_anxiety"
] as const;

// Seed vocabulary pending clinical review.
export const POPULATION_TERMS = [
  "teen",
  "adult",
  "child",
  "couple",
  "family",
  "veteran",
  "lgbtq_plus",
  "new_parent",
  "older_adult",
  "college_student",
  "first_responder",
  "caregiver"
] as const;

// Seed vocabulary pending clinical review.
export const MODALITY_TERMS = [
  "cbt",
  "dbt",
  "emdr",
  "ifs",
  "act",
  "psychodynamic",
  "somatic",
  "eft",
  "exposure_erp",
  "group",
  "art",
  "play",
  "family_systems",
  "motivational_interviewing",
  "mindfulness_based",
  "medication_management",
  "ketamine_assisted",
  "neurofeedback"
] as const;

export const TAXONOMY_TERMS = {
  issue: ISSUE_TERMS,
  population: POPULATION_TERMS,
  modality: MODALITY_TERMS
} as const;

export type IssueTerm = (typeof ISSUE_TERMS)[number];
export type PopulationTerm = (typeof POPULATION_TERMS)[number];
export type ModalityTerm = (typeof MODALITY_TERMS)[number];
export type TaxonomyType = keyof typeof TAXONOMY_TERMS;
export type TaxonomyTerm =
  | IssueTerm
  | PopulationTerm
  | ModalityTerm;

export type TaxonomyLookup = {
  type: TaxonomyType;
  value: TaxonomyTerm;
};

export function lookupTaxonomyTerm(
  type: TaxonomyType,
  value: string
): TaxonomyLookup | undefined {
  const terms = TAXONOMY_TERMS[type] as readonly string[];

  if (!terms.includes(value)) {
    return undefined;
  }

  return { type, value: value as TaxonomyTerm };
}
