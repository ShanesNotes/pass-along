import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import { loadFixtureCorpus } from "./fixtures.js";
import {
  InMemoryProviderNameSearch,
  scoreProviderNameMatches
} from "./typeahead.js";

describe("provider typeahead", () => {
  test("ranks provider-name prefix matches first", () => {
    const corpus = loadFixtureCorpus();
    const matches = scoreProviderNameMatches(corpus.providers, "north", 3);

    expect(matches[0]).toMatchObject({
      id: "provider_teen_denver",
      name: "North Star Teen Therapy"
    });
  });

  test("finds fuzzy trigram-style provider-name matches", () => {
    const corpus = loadFixtureCorpus();
    const matches = scoreProviderNameMatches(corpus.providers, "Juniper Perinatal", 3);

    expect(matches[0]).toMatchObject({
      id: "provider_postpartum_austin",
      name: "Juniper Perinatal Counseling"
    });
    expect(matches[0]?.score).toBeGreaterThan(0.7);
  });

  test("keeps the provider search behind a drop-in port", async () => {
    const corpus = loadFixtureCorpus();
    const port = new InMemoryProviderNameSearch(corpus.providers);

    await expect(
      port.searchProvidersByName({
        query: "trauma center",
        limit: 2
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "provider_emdr_austin",
          name: "Hill Country Trauma Center"
        })
      ])
    );
  });

  test("p95 latency over fixture providers stays under 150ms", () => {
    const corpus = loadFixtureCorpus();
    const durations: number[] = [];

    for (let index = 0; index < 300; index += 1) {
      const start = performance.now();
      scoreProviderNameMatches(corpus.providers, "austin counseling", 5);
      durations.push(performance.now() - start);
    }

    durations.sort((left, right) => left - right);
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Infinity;

    expect(p95).toBeLessThan(150);
  });
});
