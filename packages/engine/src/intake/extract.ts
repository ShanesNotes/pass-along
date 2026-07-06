import {
  ISSUE_TERMS,
  MODALITY_TERMS,
  RecEnrichmentSchema,
  type RecEnrichment,
  type RecEnrichmentTag
} from "../../../core/src/index.js";
import { loadPrompt } from "../../../prompts/src/index.js";
import { complete } from "../llm/adapter.js";
import type { PiiFinding } from "./scrub.js";
import {
  googleEnv,
  normalizeText,
  parseJsonObject,
  type IntakeModelOptions,
  type IntakeSource
} from "./shared.js";

export const EXTRACT_PROMPT_ID = "extract@1";

export interface ExtractStoryInput {
  readonly scrubbedStory: string;
  readonly forWhom?: readonly string[];
  readonly piiFindings?: readonly PiiFinding[];
}

export interface ExtractStoryResult {
  readonly enrichment: RecEnrichment;
  readonly source: IntakeSource;
  readonly promptId: typeof EXTRACT_PROMPT_ID;
}

type TagSpec = Omit<RecEnrichmentTag, "confidence"> & {
  readonly confidence?: number;
};

type PatternEntry<T extends string> = {
  readonly value: T;
  readonly patterns: readonly RegExp[];
};

const ISSUE_PATTERNS: readonly PatternEntry<(typeof ISSUE_TERMS)[number]>[] = [
  { value: "anxiety", patterns: [/\banx(?:iety|ious)\b/u, /\bworr(?:y|ied|ies)\b/u] },
  { value: "depression", patterns: [/\bdepress(?:ed|ion)?\b/u] },
  { value: "trauma_ptsd", patterns: [/\btrauma\b/u, /\bptsd\b/u, /\btrauma memories\b/u] },
  { value: "ocd", patterns: [/\bocd\b/u] },
  { value: "grief", patterns: [/\bgrief\b/u, /\bgrieving\b/u] },
  { value: "eating_disorders", patterns: [/\beating disorders?\b/u, /\bbody image\b/u] },
  { value: "substance_use", patterns: [/\bsubstance use\b/u, /\brecovery\b/u, /\bsober\b/u] },
  { value: "adhd", patterns: [/\badhd\b/u] },
  { value: "bipolar", patterns: [/\bbipolar\b/u] },
  { value: "postpartum", patterns: [/\bpostpartum\b/u, /\bnew baby\b/u] },
  { value: "chronic_illness", patterns: [/\bchronic illness\b/u] },
  { value: "relationship_issues", patterns: [/\bcouples?\b/u, /\brelationship\b/u, /\bfight\b/u] },
  { value: "stress_burnout", patterns: [/\bstress\b/u, /\bburnout\b/u] },
  { value: "panic", patterns: [/\bpanic\b/u, /\bpanic attacks?\b/u] },
  { value: "phobias", patterns: [/\bphobias?\b/u] },
  { value: "self_esteem", patterns: [/\bself esteem\b/u, /\bself-esteem\b/u] },
  { value: "anger", patterns: [/\banger\b/u] },
  { value: "sleep", patterns: [/\bsleep\b/u, /\binsomnia\b/u] },
  { value: "autism", patterns: [/\bautis(?:m|tic)\b/u] },
  { value: "personality_disorders", patterns: [/\bpersonality disorders?\b/u] },
  { value: "psychosis", patterns: [/\bpsychosis\b/u] },
  { value: "gender_identity", patterns: [/\bgender identity\b/u, /\btrans\b/u] },
  { value: "sexual_health", patterns: [/\bsexual health\b/u] },
  { value: "infertility", patterns: [/\binfertility\b/u] },
  { value: "parenting", patterns: [/\bparenting\b/u] },
  { value: "family_conflict", patterns: [/\bfamily conflict\b/u, /\bconflict pattern\b/u] },
  { value: "domestic_violence", patterns: [/\bdomestic violence\b/u] },
  { value: "life_transitions", patterns: [/\blife transitions?\b/u] },
  { value: "chronic_pain", patterns: [/\bchronic pain\b/u] },
  { value: "social_anxiety", patterns: [/\bsocial anxiety\b/u] }
];

const MODALITY_PATTERNS: readonly PatternEntry<(typeof MODALITY_TERMS)[number]>[] = [
  { value: "cbt", patterns: [/\bcbt\b/u, /\bcognitive behavioral\b/u] },
  { value: "dbt", patterns: [/\bdbt\b/u] },
  { value: "emdr", patterns: [/\bemdr\b/u] },
  { value: "ifs", patterns: [/\bifs\b/u, /\binternal family systems\b/u] },
  { value: "act", patterns: [/\bact\b/u, /\bacceptance and commitment\b/u] },
  { value: "psychodynamic", patterns: [/\bpsychodynamic\b/u] },
  { value: "somatic", patterns: [/\bsomatic\b/u] },
  { value: "eft", patterns: [/\beft\b/u, /\bemotionally focused\b/u] },
  { value: "exposure_erp", patterns: [/\bexposure erp\b/u, /\berp\b/u, /\bexposure practice\b/u] },
  { value: "group", patterns: [/\bgroup\b/u] },
  { value: "art", patterns: [/\bart therapy\b/u] },
  { value: "play", patterns: [/\bplay therapy\b/u] },
  { value: "family_systems", patterns: [/\bfamily systems\b/u] },
  { value: "motivational_interviewing", patterns: [/\bmotivational interviewing\b/u] },
  { value: "mindfulness_based", patterns: [/\bmindfulness based\b/u, /\bmindfulness\b/u] },
  { value: "medication_management", patterns: [/\bmedication management\b/u, /\bmed management\b/u] },
  { value: "ketamine_assisted", patterns: [/\bketamine\b/u] },
  { value: "neurofeedback", patterns: [/\bneurofeedback\b/u] }
];

const POPULATION_PATTERNS: readonly TagSpec[] = [
  tag("population", "teen", true, [/\bteen\b/u, /\bteenager\b/u, /\badolescent\b/u]),
  tag("population", "child", true, [/\bchild\b/u, /\bkid\b/u, /\bautistic child\b/u]),
  tag("population", "couple", true, [/\bcouples?\b/u]),
  tag("population", "family", true, [/\bfamily\b/u, /\bus\b/u]),
  tag("population", "lgbtq_plus", true, [/\blgbtq\+?\b/u, /\bgender identity\b/u, /\baffirming\b/u]),
  tag("population", "new_parent", true, [/\bnew baby\b/u, /\bnew parent\b/u, /\bpostpartum\b/u]),
  tag("population", "older_adult", true, [/\bolder adult\b/u, /\bfather\b/u]),
  tag("population", "college_student", true, [/\bcollege student\b/u])
];

const LOGISTICS_PATTERNS: readonly TagSpec[] = [
  tag("logistics", "telehealth", true, [/\btelehealth\b/u, /\bvirtual\b/u]),
  tag("logistics", "evenings", true, [/\bevenings?\b/u, /\bafter work\b/u]),
  tag("logistics", "insurance", true, [/\binsurance\b/u]),
  tag("logistics", "sliding_scale", true, [/\bsliding scale\b/u, /\baffordable\b/u])
];

const STYLE_PATTERNS: readonly TagSpec[] = [
  tag("style", "affirming", false, [/\baffirming\b/u]),
  tag("style", "structured", false, [/\bstructured\b/u, /\btiny steps\b/u, /\btracked wins\b/u]),
  tag("style", "patient", false, [/\bwithout rushing\b/u, /\bpatient\b/u]),
  tag("style", "practical", false, [/\bpractical\b/u])
];

const OUTCOME_PATTERNS: readonly TagSpec[] = [
  tag("outcome", "aftercare plan", false, [/\bafter discharge\b/u, /\baftercare\b/u]),
  tag("outcome", "study routine", false, [/\bstudy routine\b/u]),
  tag("outcome", "flare-up plan", false, [/\bflare-ups?\b/u]),
  tag("outcome", "daily action", false, [/\bsmall action\b/u]),
  tag("outcome", "sleep routine", false, [/\bsleep routine\b/u]),
  tag("outcome", "written plan", false, [/\bwritten plan\b/u])
];

export async function extractStory(
  input: ExtractStoryInput,
  options: IntakeModelOptions = {}
): Promise<ExtractStoryResult> {
  try {
    const modeled = await modelExtractStory(input, options);

    if (modeled) {
      return modeled;
    }
  } catch {
    // Dev/test fallback is deterministic and avoids retaining raw model errors.
  }

  return fallbackExtractStory(input);
}

export function fallbackExtractStory(input: ExtractStoryInput): ExtractStoryResult {
  const normalized = normalizeText(input.scrubbedStory);
  const tags = dedupeTags([
    ...matchesForPatternEntries(normalized, "issue", ISSUE_PATTERNS),
    ...matchesForPatternEntries(normalized, "modality", MODALITY_PATTERNS),
    ...matchesForTagSpecs(normalized, POPULATION_PATTERNS),
    ...matchesForTagSpecs(normalized, LOGISTICS_PATTERNS),
    ...matchesForTagSpecs(normalized, STYLE_PATTERNS),
    ...matchesForTagSpecs(normalized, OUTCOME_PATTERNS)
  ]);
  const enrichment: RecEnrichment = {
    tags: [...tags],
    keystone_quote: keystoneQuote(input.scrubbedStory, tags),
    pii_findings: [...(input.piiFindings ?? [])],
    quality: qualityFor(input.scrubbedStory, tags)
  };
  const durationHint = durationHintFor(normalized);

  if (durationHint) {
    enrichment.duration_hint = durationHint;
  }

  return {
    enrichment: RecEnrichmentSchema.parse(enrichment),
    source: "fallback",
    promptId: EXTRACT_PROMPT_ID
  };
}

async function modelExtractStory(
  input: ExtractStoryInput,
  options: IntakeModelOptions
): Promise<ExtractStoryResult | undefined> {
  const completion = await complete(
    EXTRACT_PROMPT_ID,
    {
      system: loadPrompt(EXTRACT_PROMPT_ID).content,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: "extract_recommendation_enrichment",
            scrubbed_story: input.scrubbedStory,
            for_whom: input.forWhom ?? []
          })
        }
      ]
    },
    {
      ...options,
      env: googleEnv(options.env ?? process.env)
    }
  );
  const parsed = parseJsonObject(completion.text);
  const result = RecEnrichmentSchema.safeParse(parsed);

  if (!result.success || !quoteMatchesStory(result.data, input.scrubbedStory)) {
    return undefined;
  }

  return {
    enrichment: {
      ...result.data,
      pii_findings: [...(input.piiFindings ?? result.data.pii_findings)]
    },
    source: "model",
    promptId: EXTRACT_PROMPT_ID
  };
}

function matchesForPatternEntries<T extends string>(
  text: string,
  type: RecEnrichmentTag["type"],
  entries: readonly PatternEntry<T>[]
): readonly RecEnrichmentTag[] {
  return entries
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(text)))
    .map((entry) => ({
      type,
      value: entry.value,
      vocab: true,
      confidence: 0.82
    }));
}

function matchesForTagSpecs(
  text: string,
  specs: readonly TagSpec[]
): readonly RecEnrichmentTag[] {
  return specs
    .filter((spec) => specMatches(text, spec))
    .map((spec) => ({
      type: spec.type,
      value: spec.value,
      vocab: spec.vocab,
      confidence: spec.confidence ?? 0.78
    }));
}

function tag(
  type: RecEnrichmentTag["type"],
  value: string,
  vocab: boolean,
  patterns: readonly RegExp[]
): TagSpec & { readonly patterns: readonly RegExp[] } {
  return { type, value, vocab, patterns };
}

function specMatches(text: string, spec: TagSpec): boolean {
  const withPatterns = spec as TagSpec & { readonly patterns?: readonly RegExp[] };

  return withPatterns.patterns?.some((pattern) => pattern.test(text)) ?? false;
}

function dedupeTags(tags: readonly RecEnrichmentTag[]): readonly RecEnrichmentTag[] {
  const seen = new Set<string>();
  const deduped: RecEnrichmentTag[] = [];

  for (const tagEntry of tags) {
    const key = `${tagEntry.type}:${tagEntry.value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(tagEntry);
  }

  return deduped;
}

function keystoneQuote(
  scrubbedStory: string,
  tags: readonly RecEnrichmentTag[]
): RecEnrichment["keystone_quote"] {
  const sentences = sentenceSpans(scrubbedStory);
  const scored = sentences
    .map((sentence) => ({
      ...sentence,
      score: quoteScore(sentence.text, tags)
    }))
    .sort((left, right) => {
      const byScore = right.score - left.score;
      return byScore === 0 ? left.start - right.start : byScore;
    });
  const best = scored[0] ?? {
    text: scrubbedStory.trim(),
    start: 0,
    end: scrubbedStory.trim().length
  };

  return {
    text: best.text,
    start: best.start,
    end: best.end
  };
}

function sentenceSpans(
  story: string
): Array<{ readonly text: string; readonly start: number; readonly end: number }> {
  const spans: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /[^.!?]+[.!?]?/gu;

  for (const match of story.matchAll(pattern)) {
    const raw = match[0] ?? "";
    const leadingWhitespace = raw.match(/^\s*/u)?.[0].length ?? 0;
    const text = raw.trim();

    if (text.length === 0) {
      continue;
    }

    const start = (match.index ?? 0) + leadingWhitespace;
    spans.push({ text, start, end: start + text.length });
  }

  return spans;
}

function quoteScore(
  sentence: string,
  tags: readonly RecEnrichmentTag[]
): number {
  const normalized = normalizeText(sentence);
  const tagScore = tags.filter((tagEntry) =>
    normalized.includes(tagEntry.value.replaceAll("_", " "))
  ).length;
  const concreteScore = [
    /\bplan\b/u,
    /\bpractice\b/u,
    /\broutine\b/u,
    /\bsteps?\b/u,
    /\bmap\b/u,
    /\bcards?\b/u,
    /\bwithout\b/u
  ].filter((pattern) => pattern.test(normalized)).length;

  return tagScore * 2 + concreteScore;
}

function qualityFor(
  scrubbedStory: string,
  tags: readonly RecEnrichmentTag[]
): RecEnrichment["quality"] {
  const normalized = normalizeText(scrubbedStory);
  const wordCount = normalized.split(/\s+/u).filter(Boolean).length;
  const concreteSignals = [
    /\bplan\b/u,
    /\bpractice\b/u,
    /\broutine\b/u,
    /\bsteps?\b/u,
    /\bweekly\b/u,
    /\bbus\b/u,
    /\bwritten\b/u,
    /\bcards?\b/u,
    /\bafter discharge\b/u
  ].filter((pattern) => pattern.test(normalized)).length;
  const livedSignals = [/\bI\b/u, /\bme\b/u, /\bmy\b/u, /\bour\b/u, /\bus\b/u]
    .filter((pattern) => pattern.test(scrubbedStory)).length;
  const adSignals = [
    /\bbest\b/u,
    /\bamazing\b/u,
    /\bguaranteed\b/u,
    /\bbook now\b/u,
    /\bcall today\b/u
  ].filter((pattern) => pattern.test(normalized)).length;
  const hasIssue = tags.some((tagEntry) => tagEntry.type === "issue");

  return {
    specificity: clamp01(0.25 + Math.min(wordCount, 80) / 160 + concreteSignals * 0.08),
    lived_experience: clamp01(0.35 + livedSignals * 0.12 + (hasIssue ? 0.1 : 0)),
    ad_smell: clamp01(adSignals * 0.28),
    dup_similarity: 0
  };
}

function durationHintFor(normalized: string): string | undefined {
  const match = normalized.match(
    /\b(?:for|within|after)\s+((?:\d+\s+)?(?:weeks?|months?|sessions?))\b/u
  );

  return match?.[1];
}

function quoteMatchesStory(enrichment: RecEnrichment, story: string): boolean {
  return story.slice(
    enrichment.keystone_quote.start,
    enrichment.keystone_quote.end
  ) === enrichment.keystone_quote.text;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
