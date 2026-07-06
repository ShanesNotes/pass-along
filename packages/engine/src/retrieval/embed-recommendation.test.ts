import { describe, expect, test } from "vitest";
import { embedRecommendation } from "../jobs/embed-recommendation.js";
import type {
  RecommendationEmbeddingStoragePort
} from "../jobs/embed-recommendation.js";
import { embedTextDevOnly } from "../llm/embed.js";
import { loadFixtureCorpus } from "./fixtures.js";
import { toRetrievalDocument } from "./memory.js";
import type { RetrievalDocument, VectorRecord } from "./types.js";

describe("embedRecommendation job handler", () => {
  test("embeds source text and stores vector metadata through the port", async () => {
    const corpus = loadFixtureCorpus();
    const recommendation = corpus.recommendations[0];
    const provider = corpus.providers.find(
      (candidate) => candidate.id === recommendation?.provider_id
    );

    if (!recommendation || !provider) {
      throw new Error("fixture missing first recommendation");
    }

    const source = toRetrievalDocument(provider, recommendation);
    const storage = new FixtureEmbeddingStorage([source]);

    const result = await embedRecommendation({
      recommendationId: source.recommendationId,
      storage,
      embed: async (text) => {
        const embedding = embedTextDevOnly(text);
        return { vector: embedding.vector, metadata: embedding.metadata };
      }
    });

    expect(result).toMatchObject({
      recommendationId: source.recommendationId,
      embedded: true,
      model: "dev-only-hash-embedding",
      modelVersion: "dev-only-v1",
      dimensions: 1536
    });
    expect(storage.recordFor(source.recommendationId)?.embedding).toEqual({
      provider: "dev-only",
      model: "dev-only-hash-embedding",
      modelVersion: "dev-only-v1",
      dimensions: 1536
    });
  });

  test("skips without calling the model when storage has no source seam", async () => {
    await expect(
      embedRecommendation({
        recommendationId: "rec_missing",
        storage: {}
      })
    ).resolves.toEqual({
      recommendationId: "rec_missing",
      embedded: false,
      skippedReason: "storage_unavailable"
    });
  });
});

class FixtureEmbeddingStorage implements RecommendationEmbeddingStoragePort {
  private readonly sources = new Map<string, RetrievalDocument>();
  private readonly records = new Map<string, VectorRecord>();

  constructor(sources: readonly RetrievalDocument[]) {
    for (const source of sources) {
      this.sources.set(source.recommendationId, source);
    }
  }

  async getRecommendationEmbeddingSource(
    recommendationId: string
  ): Promise<RetrievalDocument | undefined> {
    return this.sources.get(recommendationId);
  }

  async upsertRecommendationEmbedding(record: VectorRecord): Promise<void> {
    this.records.set(record.document.recommendationId, record);
  }

  recordFor(recommendationId: string): VectorRecord | undefined {
    return this.records.get(recommendationId);
  }
}
