import { describe, expect, test } from "vitest";
import { embedTextDevOnly } from "../llm/embed.js";
import { findMatches } from "./find.js";
import { corpusTags, loadFixtureCorpus } from "./fixtures.js";
import { inferTagFiltersFromText } from "./filters.js";
import { createInMemoryVectorStoreFromCorpus } from "./memory.js";

describe("findMatches", () => {
  test("returns the strong filtered matches unchanged when there are enough", async () => {
    const corpus = loadFixtureCorpus();
    const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });
    const text = "anxiety support";
    const tags = inferTagFiltersFromText(text, corpusTags(corpus));
    const vector = embedTextDevOnly(text).vector;

    const result = await findMatches({
      store,
      vector,
      filters: { tags },
      topN: 40
    });

    expect(result.unmet).toBe(false);
    expect(
      new Set(result.matches.map((match) => match.document.providerId)).size
    ).toBeGreaterThanOrEqual(3);
  });

  test("falls back to closest matches across the corpus when the tag filter is too strict", async () => {
    const corpus = loadFixtureCorpus();
    const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });
    const text =
      "Looking for someone to help with my teenage daughter's anxiety, evenings, we have insurance";
    const tags = inferTagFiltersFromText(text, corpusTags(corpus));
    const vector = embedTextDevOnly(text).vector;

    // Sanity check the defect precondition: the naive AND-of-inferred-tags
    // filter has no single provider carrying all three tags together.
    const strongOnly = await store.search({ vector, topN: 40, filters: { tags } });
    expect(strongOnly).toHaveLength(0);

    const result = await findMatches({
      store,
      vector,
      filters: { tags },
      topN: 40
    });

    expect(result.unmet).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(3);
    expect(result.matches.map((match) => match.document.providerId)).toContain(
      "provider_teen_denver"
    );
  });

  test("reports no results only when even the kind/location fallback is empty", async () => {
    const corpus = loadFixtureCorpus();
    const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });
    const vector = embedTextDevOnly("anything at all").vector;

    const result = await findMatches({
      store,
      vector,
      filters: { location: "Nowhere, ZZ" },
      topN: 40
    });

    expect(result.unmet).toBe(false);
    expect(result.matches).toEqual([]);
  });
});
