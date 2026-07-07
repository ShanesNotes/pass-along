import {
  ConfigError,
  DEFAULT_CONFIG_RERANK_TIMEOUT_MS,
  loadConfig,
  RerankModelOutputSchema,
  type RerankCandidate,
  type RerankModelOutput,
  type RerankSource,
  type UnderstoodQuery
} from "../../../core/src/index.js";
import { RERANK_1_PROMPT } from "../../../prompts/src/rerank1.js";
import {
  MissingKeyError,
  complete,
  type CompleteOptions
} from "../llm/adapter.js";
import type {
  RetrievalCorpus,
  VectorSearchResult
} from "../retrieval/index.js";
import {
  type GroundedRerankItem,
  type RerankWarn,
  validateGroundedRerankResult
} from "./grounding.js";

export const RERANK_PROMPT_ID = "rerank@1";
export const DEFAULT_RERANK_LIMIT = 6;
export const DEFAULT_RERANK_TIMEOUT_MS = DEFAULT_CONFIG_RERANK_TIMEOUT_MS;

export interface RerankOutcome {
  readonly source: RerankSource;
  readonly results: readonly GroundedRerankItem[];
  readonly candidates: readonly RerankCandidate[];
}

export type RerankOptions = Pick<
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

export type RerankEngineWarn = (
  event: "find.rerank_grounding_dropped" | "find.rerank_degraded",
  fields:
    | Parameters<RerankWarn>[1]
    | {
        readonly reason: string;
      }
) => void;

export async function rerankMatches(input: {
  readonly understood: UnderstoodQuery;
  readonly matches: readonly VectorSearchResult[];
  readonly corpus: RetrievalCorpus;
  readonly limit?: number;
  readonly options?: RerankOptions;
  readonly warn?: RerankEngineWarn;
}): Promise<RerankOutcome> {
  return rerankCandidates({
    understood: input.understood,
    candidates: buildRerankCandidates(input.matches, input.corpus),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.options ? { options: input.options } : {}),
    ...(input.warn ? { warn: input.warn } : {})
  });
}

export async function rerankCandidates(input: {
  readonly understood: UnderstoodQuery;
  readonly candidates: readonly RerankCandidate[];
  readonly limit?: number;
  readonly options?: RerankOptions;
  readonly warn?: RerankEngineWarn;
}): Promise<RerankOutcome> {
  const limit = input.limit ?? DEFAULT_RERANK_LIMIT;
  const fallback = fallbackRerank(input.candidates, limit);

  if (input.candidates.length === 0) {
    return {
      source: "fallback",
      results: [],
      candidates: input.candidates
    };
  }

  try {
    const output = await modelRerank({
      understood: input.understood,
      candidates: input.candidates,
      ...(input.options ? { options: input.options } : {})
    });

    if (!output) {
      warnRerankDegraded(input.warn, "invalid_model_response");

      return {
        source: "fallback",
        results: fallback,
        candidates: input.candidates
      };
    }

    const grounded = validateGroundedRerankResult({
      candidates: input.candidates,
      output,
      ...(input.warn
        ? { warn: (event, fields) => input.warn?.(event, fields) }
        : {})
    });

    return {
      source: "model",
      results: fillMissingResults(grounded.results, fallback, limit),
      candidates: input.candidates
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    warnRerankDegraded(input.warn, degradedReason(error));

    return {
      source: "fallback",
      results: fallback,
      candidates: input.candidates
    };
  }
}

export function buildRerankCandidates(
  matches: readonly VectorSearchResult[],
  corpus: RetrievalCorpus,
  maxCandidates = 40
): readonly RerankCandidate[] {
  const providerOrder = unique(matches.map((match) => match.document.providerId));
  const candidates: RerankCandidate[] = [];

  for (const providerId of providerOrder) {
    const matchedRecommendationIds = matches
      .filter((match) => match.document.providerId === providerId)
      .map((match) => match.document.recommendationId);
    const providerRecommendations = corpus.recommendations.filter(
      (recommendation) => recommendation.provider_id === providerId
    );
    const orderedRecommendations = orderRecommendations(
      providerRecommendations,
      matchedRecommendationIds
    );
    const snippets = orderedRecommendations
      .flatMap((recommendation) => [
        {
          span_id: `${providerId}:${recommendation.id}:keystone`,
          text: normalizeSnippet(recommendation.keystone)
        },
        {
          span_id: `${providerId}:${recommendation.id}:story`,
          text: normalizeSnippet(recommendation.story)
        }
      ])
      .filter((snippet) => snippet.text.length > 0)
      .slice(0, 6);

    if (snippets.length > 0) {
      candidates.push({
        id: providerId,
        snippets
      });
    }

    if (candidates.length >= maxCandidates) {
      break;
    }
  }

  return candidates;
}

export function fallbackRerank(
  candidates: readonly RerankCandidate[],
  limit = DEFAULT_RERANK_LIMIT
): readonly GroundedRerankItem[] {
  return candidates.slice(0, limit).map((candidate, index) => {
    const firstSnippet = candidate.snippets[0];

    return {
      id: candidate.id,
      score: Number(Math.max(0, 1 - index * 0.01).toFixed(2)),
      why: firstSnippet?.text ?? null,
      cited_span_ids: firstSnippet ? [firstSnippet.span_id] : []
    };
  });
}

async function modelRerank(input: {
  readonly understood: UnderstoodQuery;
  readonly candidates: readonly RerankCandidate[];
  readonly options?: RerankOptions;
}): Promise<RerankModelOutput | undefined> {
  const config = input.options?.config ?? loadConfig(input.options?.env);
  const timeoutMs =
    input.options?.timeoutMs ?? config.rerank.timeoutMs;

  for (const repair of [false, true]) {
    const completion = await complete(
      RERANK_PROMPT_ID,
      {
        system: RERANK_1_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              understood: input.understood,
              candidates: input.candidates
            })
          },
          ...(repair
            ? [
                {
                  role: "user" as const,
                  content:
                    "The previous response was invalid. Return only strict JSON matching RerankModelOutputSchema with span ids copied from the input."
                }
              ]
            : [])
        ]
      },
      {
        ...input.options,
        config,
        timeoutMs,
        maxRetries: input.options?.maxRetries ?? 0
      }
    );
    const parsed = parseRerankJson(completion.text);

    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

function parseRerankJson(text: string): RerankModelOutput | undefined {
  const parsed = parseJsonObject(text);

  if (!parsed) {
    return undefined;
  }

  const result = RerankModelOutputSchema.safeParse(parsed);
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

function fillMissingResults(
  modelResults: readonly GroundedRerankItem[],
  fallbackResults: readonly GroundedRerankItem[],
  limit: number
): readonly GroundedRerankItem[] {
  const seen = new Set(modelResults.map((result) => result.id));
  const filled = [
    ...modelResults,
    ...fallbackResults.filter((result) => !seen.has(result.id))
  ];

  return filled.slice(0, limit);
}

function orderRecommendations(
  recommendations: RetrievalCorpus["recommendations"],
  preferredIds: readonly string[]
): RetrievalCorpus["recommendations"] {
  const preferred = new Map(preferredIds.map((id, index) => [id, index]));

  return [...recommendations].sort((left, right) => {
    const leftRank = preferred.get(left.id) ?? Number.POSITIVE_INFINITY;
    const rightRank = preferred.get(right.id) ?? Number.POSITIVE_INFINITY;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });
}

function normalizeSnippet(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();

  return normalized.length <= 320
    ? normalized
    : `${normalized.slice(0, 317).trimEnd()}...`;
}

function warnRerankDegraded(
  warn: RerankEngineWarn | undefined,
  reason: string
): void {
  if (!warn || reason === "MissingKeyError") {
    return;
  }

  warn("find.rerank_degraded", { reason });
}

function degradedReason(error: unknown): string {
  if (error instanceof MissingKeyError) {
    return "MissingKeyError";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return "unknown";
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
