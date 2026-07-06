import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CorpusProvider,
  CorpusRecommendation,
  ProviderKind,
  RetrievalCorpus
} from "./types.js";

const DEFAULT_CORPUS_PATH = "evals/fixtures/corpus/recommendations.json";

export function loadFixtureCorpus(
  filePath = resolve(process.cwd(), DEFAULT_CORPUS_PATH)
): RetrievalCorpus {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;

  return assertCorpus(parsed);
}

export function corpusTags(corpus: RetrievalCorpus): readonly string[] {
  return [
    ...new Set(corpus.recommendations.flatMap((recommendation) => recommendation.tags))
  ].sort();
}

function assertCorpus(value: unknown): RetrievalCorpus {
  if (!isRecord(value)) {
    throw new Error("Fixture corpus must be an object");
  }

  const providers = value.providers;
  const recommendations = value.recommendations;

  if (!Array.isArray(providers) || !Array.isArray(recommendations)) {
    throw new Error("Fixture corpus must include providers and recommendations");
  }

  return {
    providers: providers.map(assertProvider),
    recommendations: recommendations.map(assertRecommendation)
  };
}

function assertProvider(value: unknown): CorpusProvider {
  if (!isRecord(value)) {
    throw new Error("Fixture provider must be an object");
  }

  const provider = {
    id: stringField(value, "id"),
    name: stringField(value, "name"),
    credential: stringField(value, "credential"),
    kind: kindField(value, "kind"),
    loc: stringField(value, "loc"),
    verified: booleanField(value, "verified")
  };

  return provider;
}

function assertRecommendation(value: unknown): CorpusRecommendation {
  if (!isRecord(value)) {
    throw new Error("Fixture recommendation must be an object");
  }

  const tags = value.tags;

  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
    throw new Error("Fixture recommendation tags must be strings");
  }

  return {
    id: stringField(value, "id"),
    provider_id: stringField(value, "provider_id"),
    kind: kindField(value, "kind"),
    tags: [...tags],
    keystone: stringField(value, "keystone"),
    story: stringField(value, "story")
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

function booleanField(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean field ${field}`);
  }

  return value;
}

function kindField(
  record: Record<string, unknown>,
  field: string
): ProviderKind {
  const value = stringField(record, field);

  if (value !== "therapist" && value !== "facility") {
    throw new Error(`Expected provider kind field ${field}`);
  }

  return value;
}
