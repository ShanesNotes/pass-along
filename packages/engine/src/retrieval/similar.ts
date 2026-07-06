import type {
  ProviderKind,
  VectorRecord,
  VectorSearchResult,
  VectorStorePort
} from "./types.js";

export type SimilarTarget =
  | { readonly recId: string; readonly providerId?: never }
  | { readonly providerId: string; readonly recId?: never };

export interface SimilarLookupPort {
  getRecommendationRecord(
    recommendationId: string
  ): Promise<VectorRecord | undefined>;
  getProviderRecords(providerId: string): Promise<readonly VectorRecord[]>;
}

export interface SimilarNeighbor {
  readonly recommendationId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly credential: string;
  readonly loc: string;
  readonly kind: ProviderKind;
  readonly tags: readonly string[];
  readonly keystone: string;
  readonly verified: boolean;
  readonly score: number;
  readonly sameMetro: boolean;
}

export interface SimilarNeighborInput {
  readonly target: SimilarTarget;
  readonly store: VectorStorePort;
  readonly lookup: SimilarLookupPort;
  readonly limit?: number;
  readonly searchDepth?: number;
}

const DEFAULT_LIMIT = 3;
const SEARCH_DEPTH_MULTIPLIER = 8;
const SCORE_TIE_EPSILON = 1e-12;

export async function findSimilarNeighbors(
  input: SimilarNeighborInput
): Promise<readonly SimilarNeighbor[]> {
  const limit = Math.max(0, input.limit ?? DEFAULT_LIMIT);

  if (limit === 0) {
    return [];
  }

  const targetRecords = await targetRecordsFor(input.target, input.lookup);

  if (targetRecords.length === 0) {
    return [];
  }

  const targetKind = targetRecords[0]?.document.kind;

  if (!targetKind) {
    return [];
  }

  const targetProviderIds = new Set(
    targetRecords.map((record) => record.document.providerId)
  );
  const targetMetros = new Set(
    targetRecords.map((record) => record.document.loc).filter(Boolean)
  );
  const searchDepth =
    input.searchDepth ??
    Math.max(limit * SEARCH_DEPTH_MULTIPLIER, limit + targetRecords.length + 8);
  const bestByProvider = new Map<string, SimilarNeighbor>();

  for (const targetRecord of targetRecords) {
    const matches = await input.store.search({
      vector: targetRecord.vector,
      topN: searchDepth,
      filters: {
        kind: targetKind
      }
    });

    for (const match of matches) {
      const neighbor = neighborFromMatch(match, targetProviderIds, targetMetros);

      if (!neighbor || neighbor.kind !== targetKind) {
        continue;
      }

      const current = bestByProvider.get(neighbor.providerId);

      if (!current || compareNeighbors(neighbor, current) < 0) {
        bestByProvider.set(neighbor.providerId, neighbor);
      }
    }
  }

  return [...bestByProvider.values()].sort(compareNeighbors).slice(0, limit);
}

export function createInMemorySimilarLookup(
  records: readonly VectorRecord[]
): SimilarLookupPort {
  const byRecommendation = new Map<string, VectorRecord>();
  const byProvider = new Map<string, VectorRecord[]>();

  for (const record of records) {
    byRecommendation.set(record.document.recommendationId, record);

    const providerRecords = byProvider.get(record.document.providerId) ?? [];
    providerRecords.push(record);
    byProvider.set(record.document.providerId, providerRecords);
  }

  return {
    async getRecommendationRecord(recommendationId) {
      return byRecommendation.get(recommendationId);
    },
    async getProviderRecords(providerId) {
      return byProvider.get(providerId) ?? [];
    }
  };
}

async function targetRecordsFor(
  target: SimilarTarget,
  lookup: SimilarLookupPort
): Promise<readonly VectorRecord[]> {
  if ("recId" in target) {
    const record = await lookup.getRecommendationRecord(target.recId);
    return record ? [record] : [];
  }

  return lookup.getProviderRecords(target.providerId);
}

function neighborFromMatch(
  match: VectorSearchResult,
  targetProviderIds: ReadonlySet<string>,
  targetMetros: ReadonlySet<string>
): SimilarNeighbor | undefined {
  const document = match.document;

  if (targetProviderIds.has(document.providerId)) {
    return undefined;
  }

  return {
    recommendationId: document.recommendationId,
    providerId: document.providerId,
    providerName: document.providerName,
    credential: document.credential,
    loc: document.loc,
    kind: document.kind,
    tags: document.tags,
    keystone: document.keystone,
    verified: document.verified,
    score: match.score,
    sameMetro: targetMetros.has(document.loc)
  };
}

function compareNeighbors(left: SimilarNeighbor, right: SimilarNeighbor): number {
  const scoreDelta = right.score - left.score;

  if (Math.abs(scoreDelta) > SCORE_TIE_EPSILON) {
    return scoreDelta;
  }

  if (left.sameMetro !== right.sameMetro) {
    return left.sameMetro ? -1 : 1;
  }

  const byProvider = left.providerName.localeCompare(right.providerName);

  if (byProvider !== 0) {
    return byProvider;
  }

  return left.recommendationId.localeCompare(right.recommendationId);
}
