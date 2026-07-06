import type {
  ProviderKind,
  RetrievalFilters,
  VectorSearchResult,
  VectorStorePort
} from "./types.js";

export const DEFAULT_STRONG_MATCH_THRESHOLD = 3;

export interface FindMatchesInput {
  readonly store: VectorStorePort;
  readonly vector: readonly number[];
  readonly filters: RetrievalFilters;
  readonly topN: number;
  readonly strongMatchThreshold?: number;
}

export interface FindMatchesResult {
  readonly matches: readonly VectorSearchResult[];
  readonly unmet: boolean;
}

/**
 * Spec L1-S5: <3 strong matches should still surface the closest experiences
 * with an honest "closest" framing, not an empty list. The inferred tag
 * filter is the piece most prone to over-narrowing free-text queries (it
 * requires every inferred tag on one document), so when it starves the
 * result set below the strong-match threshold, this re-searches by
 * kind/location alone and flags the response unmet. Results come back empty
 * only when the corpus has no same-kind/location candidates at all.
 */
export async function findMatches(
  input: FindMatchesInput
): Promise<FindMatchesResult> {
  const strongMatchThreshold =
    input.strongMatchThreshold ?? DEFAULT_STRONG_MATCH_THRESHOLD;
  const strongMatches = await input.store.search({
    vector: input.vector,
    topN: input.topN,
    filters: input.filters
  });

  if (countProviders(strongMatches) >= strongMatchThreshold) {
    return { matches: strongMatches, unmet: false };
  }

  const fallbackMatches = await input.store.search({
    vector: input.vector,
    topN: input.topN,
    filters: fallbackFilters(input.filters)
  });

  return { matches: fallbackMatches, unmet: fallbackMatches.length > 0 };
}

function fallbackFilters(filters: RetrievalFilters): RetrievalFilters {
  const result: {
    kind?: ProviderKind | "either";
    location?: string;
  } = {};

  if (filters.kind !== undefined) {
    result.kind = filters.kind;
  }

  if (filters.location !== undefined) {
    result.location = filters.location;
  }

  return result;
}

function countProviders(matches: readonly VectorSearchResult[]): number {
  return new Set(matches.map((match) => match.document.providerId)).size;
}
