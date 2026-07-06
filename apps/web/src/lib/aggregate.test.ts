import { describe, expect, it } from "vitest";
import { providers } from "../fixtures/providers";
import { recommendations } from "../fixtures/recommendations";
import { providerStats, similarProviders } from "./aggregate";

describe("providerStats", () => {
  it("counts recommendations and aggregates tag frequencies for a provider", () => {
    const stats = providerStats("p1", recommendations);
    expect(stats.passedCount).toBe(3);
    expect(stats.quotes).toHaveLength(3);
    const anxietyTag = stats.tagFrequencies.find((entry) => entry.tag === "anxiety");
    expect(anxietyTag?.count).toBeGreaterThan(0);
  });

  it("returns zero stats for a provider with no recommendations", () => {
    const stats = providerStats("does-not-exist", recommendations);
    expect(stats.passedCount).toBe(0);
    expect(stats.tagFrequencies).toEqual([]);
  });
});

describe("similarProviders", () => {
  it("ranks providers with overlapping tags or metro above unrelated ones", () => {
    const similar = similarProviders("p1", providers, recommendations, 3);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar.some((provider) => provider.id === "p1")).toBe(false);
  });

  it("returns an empty list for an unknown provider", () => {
    expect(similarProviders("nope", providers, recommendations)).toEqual([]);
  });
});
