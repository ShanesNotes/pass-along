import { describe, expect, it } from "vitest";
import {
  facetsFromUnderstood,
  removeFacetFromQueryText
} from "./understandQuery";

describe("understood display helpers", () => {
  it("maps server understood JSON into display facets", () => {
    const facets = facetsFromUnderstood({
      issues: [{ value: "anxiety", vocab: true, confidence: 0.9 }],
      population: "teen",
      kind: "therapist",
      preferences: {
        modality: [{ value: "cbt", vocab: true, confidence: 0.8 }],
        logistics: ["evenings"],
        style: ["warm"]
      },
      confidence: 0.85
    });

    expect(facets).toEqual({
      issues: ["anxiety"],
      population: "teen",
      prefers: ["cbt", "evenings", "warm"]
    });
  });

  it("removes a selected server facet before re-querying", () => {
    expect(
      removeFacetFromQueryText(
        "Looking for trauma PTSD support for a teenager with telehealth",
        "issue",
        "trauma_ptsd"
      )
    ).toBe("Looking for support for a teenager with telehealth");
    expect(
      removeFacetFromQueryText(
        "Looking for anxiety support for a teenager with telehealth",
        "population",
        "teen"
      )
    ).toBe("Looking for anxiety support for a with telehealth");
    expect(
      removeFacetFromQueryText(
        "Looking for anxiety support for a teenager with telehealth",
        "prefer",
        "telehealth"
      )
    ).toBe("Looking for anxiety support for a teenager with");
  });
});
