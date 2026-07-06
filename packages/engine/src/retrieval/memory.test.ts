import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import { embedText, embedTextDevOnly } from "../llm/embed.js";
import type { Transport } from "../llm/adapter.js";
import { cardsFromMatches } from "./cards.js";
import { corpusTags, loadFixtureCorpus } from "./fixtures.js";
import { inferTagFiltersFromText } from "./filters.js";
import { createInMemoryVectorStoreFromCorpus } from "./memory.js";

describe("in-memory retrieval", () => {
  test("returns cosine top-N with kind, geo, and tag filter intersection", async () => {
    const corpus = loadFixtureCorpus();
    const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });
    const query = embedTextDevOnly("Denver teen anxiety after school CBT");

    const results = await store.search({
      vector: query.vector,
      topN: 5,
      filters: {
        kind: "therapist",
        location: "Denver",
        tags: ["teen", "anxiety"]
      }
    });

    expect(results.map((result) => result.document.recommendationId)).toEqual(
      expect.arrayContaining(["rec_001", "rec_002"])
    );
    expect(
      results.every(
        (result) =>
          result.document.kind === "therapist" &&
          result.document.loc === "Denver, CO" &&
          result.document.tags.includes("teen") &&
          result.document.tags.includes("anxiety")
      )
    ).toBe(true);
  });

  test("builds route card fields from matched recommendations", async () => {
    const corpus = loadFixtureCorpus();
    const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });
    const query = embedTextDevOnly("Austin postpartum anxiety new parent");
    const matches = await store.search({
      vector: query.vector,
      topN: 10,
      filters: {
        location: "Austin",
        tags: ["postpartum"]
      }
    });
    const cards = cardsFromMatches(matches, corpus, 3);

    expect(cards[0]).toMatchObject({
      id: "provider_postpartum_austin",
      name: "Juniper Perinatal Counseling",
      credential: "LCSW",
      loc: "Austin, TX",
      passed_count: 3,
      verified: true,
      why: null,
      cited_span_ids: []
    });
    expect(cards[0]?.tags).toEqual(
      expect.arrayContaining([
        { value: "new parent", freq: 3 },
        { value: "postpartum", freq: 2 }
      ])
    );
  });

  test("infers controlled tag filters from query text", () => {
    const tags = corpusTags(loadFixtureCorpus());

    expect(
      inferTagFiltersFromText(
        "Looking for Spanish speaking family support in Austin",
        tags
      )
    ).toEqual(["spanish speaking", "family"]);
  });

  test("p95 latency over fixture corpus stays under 800ms", async () => {
    const corpus = loadFixtureCorpus();
    const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });
    const query = embedTextDevOnly("structured care for first responder burnout");
    const durations: number[] = [];

    for (let index = 0; index < 120; index += 1) {
      const start = performance.now();
      await store.search({
        vector: query.vector,
        topN: 10,
        filters: { tags: ["burnout"] }
      });
      durations.push(performance.now() - start);
    }

    durations.sort((left, right) => left - right);
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Infinity;

    expect(p95).toBeLessThan(800);
  });
});

describe("embedding seam", () => {
  test("calls OpenAI embeddings through injectable transport and records metadata", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport: Transport = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          model: "text-embedding-3-small",
          data: [{ embedding: [0.1, 0.2, 0.3] }]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    };

    const result = await embedText("teen anxiety", {
      env: { OPENAI_API_KEY: "test-openai-key" },
      transport,
      inference_geo: "us"
    });

    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.metadata).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
      modelVersion: "text-embedding-3-small@2026-07-06",
      dimensions: 3
    });
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/embeddings");

    const body = JSON.parse(String(requests[0]?.init.body)) as {
      model: string;
      input: string;
    };
    const headers = requests[0]?.init.headers as Record<string, string>;

    expect(body).toMatchObject({
      model: "text-embedding-3-small",
      input: "teen anxiety"
    });
    expect(headers["x-pass-along-inference-geo"]).toBe("us");
  });

  test("dev-only hash embedding is deterministic and clearly marked", () => {
    const first = embedTextDevOnly("postpartum anxiety Austin");
    const second = embedTextDevOnly("postpartum anxiety Austin");

    expect(first.vector).toEqual(second.vector);
    expect(first.metadata).toEqual({
      provider: "dev-only",
      model: "dev-only-hash-embedding",
      modelVersion: "dev-only-v1",
      dimensions: 1536
    });
  });
});
