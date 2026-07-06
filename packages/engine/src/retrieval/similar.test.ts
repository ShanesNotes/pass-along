import { describe, expect, test } from "vitest";
import { embedTextDevOnly } from "../llm/embed.js";
import { loadFixtureCorpus } from "./fixtures.js";
import {
  createInMemoryVectorStoreFromCorpus,
  InMemoryVectorStore,
  toRetrievalDocument
} from "./memory.js";
import {
  createInMemorySimilarLookup,
  findSimilarNeighbors
} from "./similar.js";
import type { VectorRecord } from "./types.js";

describe("similar vector neighbors", () => {
  test("returns same-kind provider neighbors from the fixture vector corpus", async () => {
    const corpus = loadFixtureCorpus();
    const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });
    const lookup = createInMemorySimilarLookup(store.allRecords());

    const neighbors = await findSimilarNeighbors({
      target: { providerId: "provider_teen_denver" },
      store,
      lookup,
      limit: 5
    });

    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors.every((neighbor) => neighbor.kind === "therapist")).toBe(
      true
    );
    expect(neighbors.some((neighbor) => neighbor.providerId === "provider_teen_denver")).toBe(
      false
    );
    expect(new Set(neighbors.map((neighbor) => neighbor.providerId)).size).toBe(
      neighbors.length
    );
  });

  test("same-metro neighbors rank above cross-metro neighbors at equal cosine", async () => {
    const corpus = loadFixtureCorpus();
    const records = [
      fixtureRecord(corpus, "rec_001", [1, 0]),
      fixtureRecord(corpus, "rec_010", [1, 0]),
      fixtureRecord(corpus, "rec_004", [1, 0])
    ];
    const store = new InMemoryVectorStore(records);
    const lookup = createInMemorySimilarLookup(records);

    const neighbors = await findSimilarNeighbors({
      target: { recId: "rec_001" },
      store,
      lookup,
      limit: 2
    });

    expect(neighbors.map((neighbor) => neighbor.recommendationId)).toEqual([
      "rec_010",
      "rec_004"
    ]);
    expect(neighbors.map((neighbor) => neighbor.sameMetro)).toEqual([
      true,
      false
    ]);
    expect(neighbors[0]?.score).toBe(neighbors[1]?.score);
  });

  test("returns an empty list for an unknown recommendation or provider", async () => {
    const store = new InMemoryVectorStore([]);
    const lookup = createInMemorySimilarLookup([]);

    await expect(
      findSimilarNeighbors({
        target: { recId: "missing" },
        store,
        lookup
      })
    ).resolves.toEqual([]);
    await expect(
      findSimilarNeighbors({
        target: { providerId: "missing" },
        store,
        lookup
      })
    ).resolves.toEqual([]);
  });
});

function fixtureRecord(
  corpus: ReturnType<typeof loadFixtureCorpus>,
  recommendationId: string,
  vector: readonly number[]
): VectorRecord {
  const recommendation = corpus.recommendations.find(
    (candidate) => candidate.id === recommendationId
  );

  if (!recommendation) {
    throw new Error(`Missing fixture recommendation ${recommendationId}`);
  }

  const provider = corpus.providers.find(
    (candidate) => candidate.id === recommendation.provider_id
  );

  if (!provider) {
    throw new Error(`Missing fixture provider ${recommendation.provider_id}`);
  }

  return {
    document: toRetrievalDocument(provider, recommendation),
    vector,
    embedding: {
      provider: "dev-only",
      model: "test",
      modelVersion: "test",
      dimensions: vector.length
    }
  };
}
