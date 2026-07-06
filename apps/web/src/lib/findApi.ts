import type { UnderstoodQuery } from "../../../../packages/core/src/index";

export type FindFetch = typeof fetch;
export type UnderstandSource = "model" | "fallback";

export interface FindApiTag {
  readonly value: string;
  readonly freq: number;
}

export interface FindApiCard {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
  readonly passed_count: number;
  readonly tags: readonly FindApiTag[];
  readonly keystone: string;
  readonly verified: boolean;
  readonly why: string | null;
}

export interface CrisisSupport {
  readonly lifeline: string;
  readonly message: string;
}

export type FindApiResponse =
  | {
      readonly crisis: true;
      readonly support: CrisisSupport;
    }
  | {
      readonly understood: UnderstoodQuery | null;
      readonly source: UnderstandSource;
      readonly clarify: {
        readonly question: string;
        readonly chips: readonly string[];
      };
    }
  | {
      readonly understood: UnderstoodQuery | null;
      readonly source: UnderstandSource;
      readonly unmet: boolean;
      readonly results: readonly FindApiCard[];
    };

export async function postFindQuery(
  text: string,
  fetcher: FindFetch = fetch
): Promise<FindApiResponse> {
  const response = await fetcher("/api/find", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Find request failed with status ${response.status}`);
  }

  const body: unknown = await response.json();
  return parseFindApiResponse(body);
}

function parseFindApiResponse(value: unknown): FindApiResponse {
  if (!isRecord(value)) {
    throw new Error("Find response must be an object");
  }

  if (value.crisis === true) {
    const support = value.support;

    if (!isRecord(support)) {
      throw new Error("Find crisis response must include support");
    }

    return {
      crisis: true,
      support: {
        lifeline: stringField(support, "lifeline"),
        message: stringField(support, "message")
      }
    };
  }

  const understood = parseUnderstood(value.understood);
  const source = sourceField(value, "source");

  if (isRecord(value.clarify)) {
    const chips = value.clarify.chips;

    if (!Array.isArray(chips)) {
      throw new Error("Find clarify response chips must be an array");
    }

    return {
      understood,
      source,
      clarify: {
        question: stringField(value.clarify, "question"),
        chips: chips.map((chip) => {
          if (typeof chip !== "string" || chip.length === 0) {
            throw new Error("Find clarify chip must be a string");
          }

          return chip;
        })
      }
    };
  }

  if (!Array.isArray(value.results)) {
    throw new Error("Find response must include results");
  }

  return {
    understood,
    source,
    unmet: booleanField(value, "unmet"),
    results: value.results.map(parseFindCard)
  };
}

function parseFindCard(value: unknown): FindApiCard {
  if (!isRecord(value)) {
    throw new Error("Find result card must be an object");
  }

  const tags = value.tags;

  if (!Array.isArray(tags)) {
    throw new Error("Find result card tags must be an array");
  }

  const why = value.why;

  if (why !== null && typeof why !== "string") {
    throw new Error("Find result card why must be null or a string");
  }

  return {
    id: stringField(value, "id"),
    name: stringField(value, "name"),
    credential: stringField(value, "credential"),
    loc: stringField(value, "loc"),
    passed_count: numberField(value, "passed_count"),
    tags: tags.map(parseFindTag),
    keystone: stringField(value, "keystone"),
    verified: booleanField(value, "verified"),
    why
  };
}

function parseFindTag(value: unknown): FindApiTag {
  if (!isRecord(value)) {
    throw new Error("Find result tag must be an object");
  }

  return {
    value: stringField(value, "value"),
    freq: numberField(value, "freq")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected string field ${field}`);
  }

  return value;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];

  if (typeof value !== "number") {
    throw new Error(`Expected number field ${field}`);
  }

  return value;
}

function booleanField(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean field ${field}`);
  }

  return value;
}

function sourceField(
  record: Record<string, unknown>,
  field: string
): UnderstandSource {
  const value = record[field];

  if (value !== "model" && value !== "fallback") {
    throw new Error(`Expected understand source field ${field}`);
  }

  return value;
}

function parseUnderstood(value: unknown): UnderstoodQuery | null {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("Find understood response must be an object");
  }

  const issues = value.issues;
  const preferences = value.preferences;
  const confidence = value.confidence;

  if (!Array.isArray(issues)) {
    throw new Error("Find understood issues must be an array");
  }

  if (!isRecord(preferences)) {
    throw new Error("Find understood preferences must be an object");
  }

  if (!isConfidence(confidence)) {
    throw new Error("Find understood confidence must be between 0 and 1");
  }

  const understood: UnderstoodQuery = {
    issues: issues.map(parseTaxonomyTag),
    kind: parseKind(value.kind),
    preferences: parsePreferences(preferences),
    confidence
  };

  if (value.population !== undefined) {
    understood.population = parsePopulation(value.population);
  }

  if (value.location !== undefined) {
    understood.location = parseLocation(value.location);
  }

  return understood;
}

function parseTaxonomyTag(value: unknown): UnderstoodQuery["issues"][number] {
  if (!isRecord(value)) {
    throw new Error("Find understood tag must be an object");
  }

  const tagValue = value.value;
  const vocab = value.vocab;
  const confidence = value.confidence;

  if (typeof tagValue !== "string" || tagValue.length === 0) {
    throw new Error("Find understood tag value must be a string");
  }

  if (typeof vocab !== "boolean") {
    throw new Error("Find understood tag vocab must be a boolean");
  }

  if (!isConfidence(confidence)) {
    throw new Error("Find understood tag confidence must be between 0 and 1");
  }

  return {
    value: tagValue,
    vocab,
    confidence
  };
}

function parseKind(value: unknown): UnderstoodQuery["kind"] {
  if (value === "therapist" || value === "facility" || value === "either") {
    return value;
  }

  throw new Error("Find understood kind is invalid");
}

function parsePopulation(value: unknown): NonNullable<UnderstoodQuery["population"]> {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Find understood population must be a string");
  }

  return value as NonNullable<UnderstoodQuery["population"]>;
}

function parsePreferences(
  value: Record<string, unknown>
): UnderstoodQuery["preferences"] {
  const preferences: UnderstoodQuery["preferences"] = {};

  if (value.style !== undefined) {
    preferences.style = stringArray(value.style, "style");
  }

  if (value.modality !== undefined) {
    if (!Array.isArray(value.modality)) {
      throw new Error("Find understood modality must be an array");
    }

    preferences.modality = value.modality.map(parseTaxonomyTag);
  }

  if (value.logistics !== undefined) {
    preferences.logistics = parseLogistics(value.logistics);
  }

  return preferences;
}

function parseLogistics(
  value: unknown
): NonNullable<UnderstoodQuery["preferences"]["logistics"]> {
  if (!Array.isArray(value)) {
    throw new Error("Find understood logistics must be an array");
  }

  return value.map((entry) => {
    if (
      entry === "telehealth" ||
      entry === "insurance" ||
      entry === "sliding_scale" ||
      entry === "evenings"
    ) {
      return entry;
    }

    throw new Error("Find understood logistics value is invalid");
  });
}

function parseLocation(value: unknown): NonNullable<UnderstoodQuery["location"]> {
  if (!isRecord(value)) {
    throw new Error("Find understood location must be an object");
  }

  const text = value.text;

  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Find understood location text must be a string");
  }

  const location: NonNullable<UnderstoodQuery["location"]> = { text };

  if (value.geocoded !== undefined) {
    if (!isRecord(value.geocoded)) {
      throw new Error("Find understood geocoded location must be an object");
    }

    const lat = value.geocoded.lat;
    const lng = value.geocoded.lng;

    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new Error("Find understood geocoded location must be numeric");
    }

    location.geocoded = { lat, lng };
  }

  return location;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Find understood ${field} must be an array`);
  }

  return value.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`Find understood ${field} entry must be a string`);
    }

    return entry;
  });
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}
