import {
  ConfigError,
  ISSUE_TERMS,
  MODALITY_TERMS,
  UnderstoodQuerySchema,
  type TaxonomyTag,
  type UnderstoodQuery
} from "../../../core/src/index.js";
import {
  complete,
  type CompleteOptions
} from "../llm/adapter.js";
import { UNDERSTAND_2_PROMPT } from "../../../prompts/src/understand2.js";

export const UNDERSTAND_PROMPT_ID = "understand@2";

export type UnderstandSource = "model" | "fallback";

export interface UnderstandQueryResult {
  readonly understood: UnderstoodQuery;
  readonly source: UnderstandSource;
}

export type UnderstandQueryOptions = Pick<
  CompleteOptions,
  | "env"
  | "config"
  | "transport"
  | "timeoutMs"
  | "maxRetries"
  | "backoffBaseMs"
  | "inference_geo"
  | "sleep"
>;

type PatternDictionary<T extends string> = Record<T, readonly RegExp[]>;

const ISSUE_PATTERNS: PatternDictionary<(typeof ISSUE_TERMS)[number]> = {
  anxiety: [/\banx(?:iety|ious)\b/u, /\bworr(?:y|ied|ies)\b/u],
  depression: [/\bdepress(?:ed|ion)?\b/u, /\bsadness\b/u],
  trauma_ptsd: [/\btrauma\b/u, /\bptsd\b/u, /\bnightmares?\b/u],
  ocd: [/\bocd\b/u, /\bobsessive compulsive\b/u],
  grief: [/\bgrie(?:f|ving)\b/u, /\bloss\b/u, /\bwidow(?:ed|er)?\b/u],
  eating_disorders: [/\beating disorders?\b/u, /\bbody image\b/u],
  substance_use: [
    /\bsubstance use\b/u,
    /\bdrinking\b/u,
    /\brecovery\b/u,
    /\bsober\b/u,
    /\baddiction\b/u
  ],
  adhd: [/\badhd\b/u, /\bfocus\b/u],
  bipolar: [/\bbipolar\b/u],
  postpartum: [/\bpostpartum\b/u, /\bnew baby\b/u],
  chronic_illness: [/\bchronic illness\b/u],
  relationship_issues: [
    /\brelationship issues?\b/u,
    /\bmarriage\b/u,
    /\bcouples?\b/u
  ],
  stress_burnout: [/\bstress\b/u, /\bburnout\b/u],
  panic: [/\bpanic\b/u, /\bpanic attacks?\b/u],
  phobias: [/\bphobias?\b/u],
  self_esteem: [/\bself esteem\b/u, /\bself-esteem\b/u],
  anger: [/\banger\b/u],
  sleep: [/\bsleep\b/u, /\binsomnia\b/u],
  autism: [/\bautis(?:m|tic)\b/u],
  personality_disorders: [/\bpersonality disorders?\b/u],
  psychosis: [/\bpsychosis\b/u, /\bpsychotic\b/u],
  gender_identity: [/\bgender identity\b/u, /\btransgender\b/u],
  sexual_health: [/\bsexual health\b/u],
  infertility: [/\binfertility\b/u],
  parenting: [/\bparenting\b/u],
  family_conflict: [/\bfamily conflict\b/u],
  domestic_violence: [/\bdomestic violence\b/u, /\babusive relationship\b/u],
  life_transitions: [/\blife transitions?\b/u],
  chronic_pain: [/\bchronic pain\b/u],
  social_anxiety: [/\bsocial anxiety\b/u]
};

const MODALITY_PATTERNS: PatternDictionary<(typeof MODALITY_TERMS)[number]> = {
  cbt: [/\bcbt\b/u, /\bcognitive behavioral\b/u],
  dbt: [/\bdbt\b/u, /\bdialectical behavior(?:al)?\b/u],
  emdr: [/\bemdr\b/u],
  ifs: [/\bifs\b/u, /\binternal family systems\b/u],
  act: [/\bact\b/u, /\bacceptance and commitment\b/u],
  psychodynamic: [/\bpsychodynamic\b/u],
  somatic: [/\bsomatic\b/u],
  eft: [/\beft\b/u, /\bemotionally focused\b/u],
  exposure_erp: [/\bexposure erp\b/u, /\berp\b/u, /\bexposure therapy\b/u],
  group: [/\bgroup\b/u],
  art: [/\bart therapy\b/u],
  play: [/\bplay therapy\b/u],
  family_systems: [/\bfamily systems\b/u],
  motivational_interviewing: [/\bmotivational interviewing\b/u],
  mindfulness_based: [/\bmindfulness based\b/u, /\bmindfulness\b/u],
  medication_management: [
    /\bmedication management\b/u,
    /\bmed management\b/u,
    /\bpsychiatr(?:y|ist)\b/u
  ],
  ketamine_assisted: [/\bketamine\b/u],
  neurofeedback: [/\bneurofeedback\b/u]
};

const POPULATION_PATTERNS = {
  older_adult: [/\bolder adult\b/u, /\bsenior\b/u],
  college_student: [/\bcollege student\b/u, /\bcollege\b/u],
  first_responder: [/\bfirst responder\b/u],
  teen: [
    /\bteen(?:s|ager|age)?\b/u,
    /\badolescent\b/u,
    /\b1[3-9]\s*(?:yo|y\/o|year old|year-old)\b/u
  ],
  child: [/\bchild\b/u, /\bkid\b/u, /\bplay therapy\b/u],
  couple: [/\bcouples?\b/u, /\bmarriage\b/u],
  family: [/\bfamily\b/u, /\bparenting\b/u],
  veteran: [/\bveteran\b/u, /\bmilitary\b/u],
  lgbtq_plus: [/\blgbtq\+?\b/u, /\bqueer\b/u],
  new_parent: [/\bnew parent\b/u, /\bpostpartum\b/u, /\bnew baby\b/u],
  caregiver: [/\bcaregiver\b/u],
  adult: [
    /\badult\b/u,
    /\bhusband\b/u,
    /\bwife\b/u,
    /\bspouse\b/u,
    /\bpartner\b/u
  ]
} as const;

const LOGISTICS_PATTERNS = {
  telehealth: [/\btelehealth\b/u, /\bvirtual\b/u, /\bonline\b/u],
  insurance: [/\binsurance\b/u, /\btakes insurance\b/u],
  sliding_scale: [
    /\bsliding scale\b/u,
    /\bsliding-scale\b/u,
    /\baffordable\b/u,
    /\blow cost\b/u
  ],
  evenings: [/\bevenings?\b/u, /\bafter work\b/u, /\bnight appointments?\b/u]
} as const;

const STYLE_PATTERNS = {
  warm: [/\bwarm\b/u],
  structured: [/\bstructured\b/u],
  affirming: [/\baffirming\b/u],
  "faith sensitive": [/\bfaith sensitive\b/u, /\bfaith-sensitive\b/u],
  "spanish speaking": [/\bspanish speaking\b/u]
} as const;

const KNOWN_LOCATIONS = [
  "Atlanta",
  "Austin",
  "Boston",
  "Chicago",
  "Dallas",
  "Denver",
  "Detroit",
  "Houston",
  "Los Angeles",
  "Miami",
  "Minneapolis",
  "New York",
  "Oakland",
  "Philadelphia",
  "Phoenix",
  "Pittsburgh",
  "Portland",
  "San Francisco",
  "Seattle"
] as const;

export async function understandQuery(
  input: string,
  options: UnderstandQueryOptions = {}
): Promise<UnderstandQueryResult> {
  try {
    const modeled = await modelUnderstand(input, options);

    if (modeled) {
      return { understood: modeled, source: "model" };
    }

    warnUnderstandDegraded("invalid_model_response");
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    warnUnderstandDegraded(error);
  }

  return { understood: fallbackUnderstandQuery(input), source: "fallback" };
}

export function fallbackUnderstandQuery(input: string): UnderstoodQuery {
  const normalized = normalizeText(input);
  const issues = matchesFromDictionary(normalized, ISSUE_PATTERNS).map((value) =>
    taxonomyTag(value, 0.78)
  );
  const modality = matchesFromDictionary(
    normalized,
    MODALITY_PATTERNS
  ).map((value) => taxonomyTag(value, 0.78));
  const population = firstMatchFromDictionary(normalized, POPULATION_PATTERNS);
  const logistics = matchesFromDictionary(normalized, LOGISTICS_PATTERNS);
  const style = matchesFromDictionary(normalized, STYLE_PATTERNS);
  const location = detectLocation(input, normalized);
  const kind = detectKind(normalized);
  const confidence = confidenceFor({
    input: normalized,
    issues,
    population,
    modality,
    logistics,
    style,
    location,
    kind
  });
  const preferences: UnderstoodQuery["preferences"] = {};

  if (style.length > 0) {
    preferences.style = style;
  }

  if (modality.length > 0) {
    preferences.modality = modality;
  }

  if (logistics.length > 0) {
    preferences.logistics = logistics;
  }

  const understood: UnderstoodQuery = {
    issues,
    kind,
    preferences,
    confidence
  };

  if (population) {
    understood.population = population;
  }

  if (location) {
    understood.location = { text: location };
  }

  return UnderstoodQuerySchema.parse(understood);
}

export function clarifyQuestionFor(
  input: string,
  understood: UnderstoodQuery
): { readonly question: string; readonly chips: readonly string[] } {
  if (understood.issues.length === 0) {
    return {
      question: "What kind of support should we look for?",
      chips: nearestIssueCandidates(input)
    };
  }

  if (!understood.population) {
    return {
      question: "Who is this for?",
      chips: ["adult", "teen", "child", "couple"]
    };
  }

  return {
    question: "Which detail should we prioritize?",
    chips: [
      ...understood.issues.map((issue) => issue.value),
      understood.population
    ].slice(0, 4)
  };
}

async function modelUnderstand(
  input: string,
  options: UnderstandQueryOptions
): Promise<UnderstoodQuery | undefined> {
  for (const repair of [false, true]) {
    const completion = await complete(
      UNDERSTAND_PROMPT_ID,
      {
        system: understandPrompt(),
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              task: "understand_find_query",
              input
            })
          },
          ...(repair
            ? [
                {
                  role: "user" as const,
                  content:
                    "The previous response was invalid. Return only strict JSON matching UnderstoodQuerySchema."
                }
              ]
            : [])
        ]
      },
      options
    );
    const parsed = parseUnderstoodJson(completion.text);

    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

function understandPrompt(): string {
  return UNDERSTAND_2_PROMPT;
}

function parseUnderstoodJson(text: string): UnderstoodQuery | undefined {
  const parsed = parseJsonObject(text);

  if (!parsed) {
    return undefined;
  }

  const result = UnderstoodQuerySchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

function parseJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function warnUnderstandDegraded(error: unknown): void {
  console.warn("find.understand_degraded", {
    reason: degradedReason(error)
  });
}

function degradedReason(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    const code = (error as { readonly code?: unknown }).code;

    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }

  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return "unknown";
}

function taxonomyTag(value: string, confidence: number): TaxonomyTag {
  return {
    value,
    vocab: true,
    confidence
  };
}

function matchesFromDictionary<T extends string>(
  text: string,
  dictionary: PatternDictionary<T>
): T[] {
  return Object.entries(dictionary)
    .filter(([, patterns]) =>
      (patterns as readonly RegExp[]).some((pattern) => pattern.test(text))
    )
    .map(([value]) => value as T);
}

function firstMatchFromDictionary<T extends string>(
  text: string,
  dictionary: PatternDictionary<T>
): T | undefined {
  return matchesFromDictionary(text, dictionary)[0];
}

function detectLocation(rawInput: string, normalized: string): string | undefined {
  for (const location of KNOWN_LOCATIONS) {
    if (normalized.includes(normalizeText(location))) {
      return location;
    }
  }

  const match = rawInput.match(
    /\b(?:in|near|around|outside)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/u
  );

  return match?.[1];
}

function detectKind(
  text: string
): UnderstoodQuery["kind"] {
  if (
    /\b(facility|center|clinic|program|residential|treatment center|intensive outpatient|iop|php)\b/u.test(
      text
    )
  ) {
    return "facility";
  }

  if (
    /\b(therapist|therapy|counselor|counseling|psychiatrist|someone|specialist|clinician|group)\b/u.test(
      text
    )
  ) {
    return "therapist";
  }

  return "therapist";
}

function confidenceFor(input: {
  readonly input: string;
  readonly issues: readonly TaxonomyTag[];
  readonly population: string | undefined;
  readonly modality: readonly TaxonomyTag[];
  readonly logistics: readonly string[];
  readonly style: readonly string[];
  readonly location: string | undefined;
  readonly kind: UnderstoodQuery["kind"];
}): number {
  if (input.input.trim().length < 12) {
    return 0.35;
  }

  let confidence = 0.35;

  if (input.issues.length > 0) confidence += 0.28;
  if (input.population) confidence += 0.08;
  if (input.modality.length > 0) confidence += 0.08;
  if (input.logistics.length > 0) confidence += 0.06;
  if (input.style.length > 0) confidence += 0.04;
  if (input.location) confidence += 0.06;
  if (input.kind !== "either") confidence += 0.03;

  return Math.min(0.92, Number(confidence.toFixed(2)));
}

function nearestIssueCandidates(input: string): readonly string[] {
  const normalized = normalizeText(input);
  const scored = ISSUE_TERMS.map((term) => {
    const words = term.split("_");
    const score = words.filter((word) => normalized.includes(word)).length;
    return { term, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      const byScore = right.score - left.score;
      return byScore === 0 ? left.term.localeCompare(right.term) : byScore;
    })
    .map((entry) => entry.term);

  return scored.length > 0
    ? scored.slice(0, 4)
    : ["anxiety", "depression", "trauma_ptsd", "relationship_issues"];
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll(/[’‘]/gu, "'")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}
