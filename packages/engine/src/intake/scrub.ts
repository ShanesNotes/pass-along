import type { RecEnrichment } from "../../../core/src/index.js";
import { loadPrompt } from "../../../prompts/src/index.js";
import { complete } from "../llm/adapter.js";
import {
  asRecord,
  asStringArray,
  getString,
  googleEnv,
  normalizeText,
  parseJsonObject,
  type IntakeModelOptions,
  type IntakeSource
} from "./shared.js";

export const SCRUB_PROMPT_ID = "scrub@1";

export type PiiFinding = RecEnrichment["pii_findings"][number];
export type PiiKind = PiiFinding["kind"];

export interface ScrubStoryInput {
  readonly story: string;
  readonly providerName: string;
}

export interface ScrubStoryResult {
  readonly scrubbedStory: string;
  readonly piiFindings: readonly PiiFinding[];
  readonly flags: readonly string[];
  readonly confidence: number;
  readonly source: IntakeSource;
  readonly promptId: typeof SCRUB_PROMPT_ID;
}

interface MutableFinding {
  readonly span: [number, number];
  readonly kind: PiiKind;
  readonly replacement: string;
}

const MONTH_PATTERN =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const WEEKDAY_PATTERN =
  "Mondays?|Tuesdays?|Wednesdays?|Thursdays?|Fridays?|Saturdays?|Sundays?";

export async function scrubStory(
  input: ScrubStoryInput,
  options: IntakeModelOptions = {}
): Promise<ScrubStoryResult> {
  try {
    const modeled = await modelScrubStory(input, options);

    if (modeled) {
      return modeled;
    }
  } catch {
    // The intake route is allowed to run without model credentials in dev/tests.
  }

  return fallbackScrubStory(input);
}

export function fallbackScrubStory(input: ScrubStoryInput): ScrubStoryResult {
  const findings = collectFindings(input.story, input.providerName);
  const scrubbedStory = applyFindings(input.story, findings);
  const flags = findings.length >= 4 ? ["pii_heavy"] : [];

  return {
    scrubbedStory,
    piiFindings: findings,
    flags,
    confidence: findings.length >= 4 ? 0.86 : 0.93,
    source: "fallback",
    promptId: SCRUB_PROMPT_ID
  };
}

async function modelScrubStory(
  input: ScrubStoryInput,
  options: IntakeModelOptions
): Promise<ScrubStoryResult | undefined> {
  const completion = await complete(
    SCRUB_PROMPT_ID,
    {
      system: loadPrompt(SCRUB_PROMPT_ID).content,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: "scrub_recommendation_story",
            story: input.story,
            provider_name: input.providerName
          })
        }
      ]
    },
    {
      ...options,
      env: googleEnv(options.env ?? process.env)
    }
  );
  const parsed = parseScrubJson(completion.text);

  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    source: "model",
    promptId: SCRUB_PROMPT_ID
  };
}

function collectFindings(
  story: string,
  providerName: string
): readonly PiiFinding[] {
  const findings: MutableFinding[] = [];

  addRegexFindings(
    story,
    providerName,
    findings,
    /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu,
    "person",
    "a contact detail"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gu,
    "person",
    "a contact detail"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    new RegExp(`\\b(?:${MONTH_PATTERN})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b`, "gu"),
    "date",
    "that month"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    new RegExp(`\\b(?:${MONTH_PATTERN})\\s+\\d{4}\\b`, "gu"),
    "date",
    "that month"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gu,
    "date",
    "that month"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    new RegExp(`\\b(?:${WEEKDAY_PATTERN})\\b`, "gu"),
    "date",
    "that day"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/gu,
    "place",
    "a local address"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    /\b[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3}\s+(?:High School|Middle School|Elementary School|University|College|Preschool)\b/gu,
    "org",
    "a school"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    /\b[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3}\s+(?:Robotics|Labs|Bank|Systems Inc|Inc|LLC|Company|Hospital|Agency|Factory)\b/gu,
    "org",
    "her workplace"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    /\b[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,2}\s+Church\b/gu,
    "org",
    "an organization"
  );
  addRegexFindings(
    story,
    providerName,
    findings,
    /\b[A-Z][A-Za-z]+\s+(?:House|Apartments|Tower)\b/gu,
    "place",
    "a local place"
  );
  addRelationshipFindings(story, providerName, findings);

  return dedupeFindings(findings);
}

function addRelationshipFindings(
  story: string,
  providerName: string,
  findings: MutableFinding[]
): void {
  const relationshipPattern =
    /\b(?:(?:my|our|his|her|their)\s+(?:sister|brother|mother|mom|father|dad|daughter|son|wife|husband|partner|friend|coworker|co-worker|boss|manager|roommate|neighbor|classmate|client|patient|child)|a\s+friend\s+named)\s+[A-Z][A-Za-z']+\b/gu;

  for (const match of story.matchAll(relationshipPattern)) {
    const text = match[0] ?? "";
    const start = match.index ?? -1;

    if (start < 0 || shouldPreserve(text, providerName)) {
      continue;
    }

    findings.push({
      span: [start, start + text.length],
      kind: "person",
      replacement: relationshipReplacement(text)
    });
  }
}

function relationshipReplacement(text: string): string {
  const normalized = normalizeText(text);

  if (/\bfriend\b/u.test(normalized)) return "a friend";
  if (/\b(?:coworker|co-worker|boss|manager|classmate)\b/u.test(normalized)) {
    return "a coworker";
  }
  if (/\broommate\b/u.test(normalized)) return "someone close to me";
  if (/\bneighbor\b/u.test(normalized)) return "someone nearby";
  if (/\b(?:client|patient)\b/u.test(normalized)) return "someone I referred";

  return "a family member";
}

function addRegexFindings(
  story: string,
  providerName: string,
  findings: MutableFinding[],
  pattern: RegExp,
  kind: PiiKind,
  replacement: string
): void {
  for (const match of story.matchAll(pattern)) {
    const text = match[0] ?? "";
    const start = match.index ?? -1;

    if (start < 0 || shouldPreserve(text, providerName)) {
      continue;
    }

    findings.push({
      span: [start, start + text.length],
      kind,
      replacement
    });
  }
}

function shouldPreserve(text: string, providerName: string): boolean {
  const normalizedText = normalizeComparable(text);
  const normalizedProvider = normalizeComparable(providerName);

  return (
    normalizedText.length > 0 &&
    normalizedProvider.length > 0 &&
    (normalizedText === normalizedProvider ||
      normalizedProvider.includes(normalizedText) ||
      normalizedText.includes(normalizedProvider))
  );
}

function normalizeComparable(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/gu, " ").trim();
}

function dedupeFindings(findings: readonly MutableFinding[]): readonly PiiFinding[] {
  const sorted = [...findings].sort((left, right) => {
    const byStart = left.span[0] - right.span[0];

    if (byStart !== 0) {
      return byStart;
    }

    return right.span[1] - left.span[1];
  });
  const accepted: MutableFinding[] = [];

  for (const finding of sorted) {
    if (accepted.some((existing) => spansOverlap(existing.span, finding.span))) {
      continue;
    }

    accepted.push(finding);
  }

  return accepted.map((finding) => ({
    span: finding.span,
    kind: finding.kind,
    replacement: finding.replacement
  }));
}

function spansOverlap(
  left: readonly [number, number],
  right: readonly [number, number]
): boolean {
  return left[0] < right[1] && right[0] < left[1];
}

function applyFindings(
  story: string,
  findings: readonly PiiFinding[]
): string {
  return [...findings]
    .sort((left, right) => right.span[0] - left.span[0])
    .reduce(
      (current, finding) =>
        `${current.slice(0, finding.span[0])}${finding.replacement}${current.slice(finding.span[1])}`,
      story
    );
}

function parseScrubJson(
  text: string
): Omit<ScrubStoryResult, "source" | "promptId"> | undefined {
  const parsed = parseJsonObject(text);
  const scrubbedStory = getString(parsed, "scrubbed_story");
  const confidence = numericField(parsed, "confidence") ?? 0.7;
  const piiFindings = parsePiiFindings(parsed?.pii_findings);

  if (scrubbedStory === undefined || piiFindings === undefined) {
    return undefined;
  }

  return {
    scrubbedStory,
    piiFindings,
    flags: asStringArray(parsed?.flags),
    confidence
  };
}

function parsePiiFindings(value: unknown): readonly PiiFinding[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const findings: PiiFinding[] = [];

  for (const item of value) {
    const record = asRecord(item);
    const span = Array.isArray(record?.span) ? record.span : undefined;
    const kind = record?.kind;
    const replacement = getString(record, "replacement");

    if (
      span?.length !== 2 ||
      typeof span[0] !== "number" ||
      typeof span[1] !== "number" ||
      !isPiiKind(kind) ||
      replacement === undefined
    ) {
      return undefined;
    }

    findings.push({
      span: [span[0], span[1]],
      kind,
      replacement
    });
  }

  return findings;
}

function isPiiKind(value: unknown): value is PiiKind {
  return (
    value === "person" ||
    value === "org" ||
    value === "date" ||
    value === "place"
  );
}

function numericField(
  record: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = record?.[key];

  return typeof value === "number" ? value : undefined;
}

