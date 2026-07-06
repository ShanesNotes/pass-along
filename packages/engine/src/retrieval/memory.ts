import { cosineSimilarity } from "./cosine.js";
import { matchesFilters } from "./filters.js";
import type {
  CorpusProvider,
  CorpusRecommendation,
  EmbeddingMetadata,
  RetrievalCorpus,
  RetrievalDocument,
  VectorRecord,
  VectorSearchInput,
  VectorSearchResult,
  VectorStorePort,
  VectorWritePort
} from "./types.js";

export class InMemoryVectorStore implements VectorStorePort, VectorWritePort {
  private readonly records = new Map<string, VectorRecord>();

  constructor(records: readonly VectorRecord[] = []) {
    for (const record of records) {
      this.records.set(record.document.recommendationId, record);
    }
  }

  async upsert(record: VectorRecord): Promise<void> {
    this.records.set(record.document.recommendationId, record);
  }

  async search(input: VectorSearchInput): Promise<readonly VectorSearchResult[]> {
    const topN = Math.max(0, input.topN);

    return [...this.records.values()]
      .filter((record) => matchesFilters(record.document, input.filters))
      .map((record) => ({
        document: record.document,
        score: cosineSimilarity(input.vector, record.vector)
      }))
      .sort((left, right) => {
        const byScore = right.score - left.score;
        return byScore === 0
          ? left.document.recommendationId.localeCompare(
              right.document.recommendationId
            )
          : byScore;
      })
      .slice(0, topN);
  }

  allRecords(): readonly VectorRecord[] {
    return [...this.records.values()];
  }
}

export async function createInMemoryVectorStoreFromCorpus(
  corpus: RetrievalCorpus,
  embed: (text: string) => Promise<{
    readonly vector: readonly number[];
    readonly metadata: EmbeddingMetadata;
  }>
): Promise<InMemoryVectorStore> {
  const records: VectorRecord[] = [];

  for (const recommendation of corpus.recommendations) {
    const provider = providerFor(corpus.providers, recommendation.provider_id);
    const document = toRetrievalDocument(provider, recommendation);
    const embedding = await embed(document.text);

    records.push({
      document,
      vector: embedding.vector,
      embedding: embedding.metadata
    });
  }

  return new InMemoryVectorStore(records);
}

export function toRetrievalDocument(
  provider: CorpusProvider,
  recommendation: CorpusRecommendation
): RetrievalDocument {
  return {
    recommendationId: recommendation.id,
    providerId: provider.id,
    providerName: provider.name,
    credential: provider.credential,
    loc: provider.loc,
    kind: recommendation.kind,
    tags: [...recommendation.tags],
    keystone: recommendation.keystone,
    text: [
      provider.name,
      provider.credential,
      provider.kind,
      provider.loc,
      recommendation.tags.join(" "),
      recommendation.keystone,
      recommendation.story
    ].join("\n"),
    verified: provider.verified
  };
}

function providerFor(
  providers: readonly CorpusProvider[],
  providerId: string
): CorpusProvider {
  const provider = providers.find((candidate) => candidate.id === providerId);

  if (!provider) {
    throw new Error(`Missing provider ${providerId}`);
  }

  return provider;
}
