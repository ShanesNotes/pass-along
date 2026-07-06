import { describe, expect, it } from "vitest";
import { providers } from "../fixtures/providers";
import { recommendations } from "../fixtures/recommendations";
import { findMatches } from "./search";

describe("findMatches", () => {
  it("returns non-sparse results for a well-represented issue", () => {
    const result = findMatches({ issues: ["anxiety"], population: undefined, prefers: [] }, providers, recommendations);
    expect(result.sparse).toBe(false);
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards[0]?.keystoneQuote).toBeTruthy();
  });

  it("falls back to a sparse, closest-experiences state for a rare facet", () => {
    const result = findMatches(
      { issues: ["substance use"], population: "veteran", prefers: [] },
      providers,
      recommendations
    );
    expect(result.sparse).toBe(true);
    expect(result.cards.length).toBeGreaterThan(0);
  });
});
