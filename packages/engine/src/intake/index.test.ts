import { describe, expect, test } from "vitest";
import {
  extractStory,
  fallbackScrubStory,
  scoreQuality,
  scrubStory
} from "./index.js";

describe("intake pipeline fallbacks", () => {
  test("scrubs third-party names while keeping provider names and cities", () => {
    const result = fallbackScrubStory({
      providerName: "Maria Chen",
      story:
        "Maria Chen helped my sister Julia in Denver build a CBT plan for panic attacks."
    });

    expect(result.scrubbedStory).toContain("Maria Chen");
    expect(result.scrubbedStory).toContain("Denver");
    expect(result.scrubbedStory).toContain("a family member");
    expect(result.scrubbedStory).not.toContain("Julia");
    expect(result.piiFindings).toEqual([
      {
        span: [18, 33],
        kind: "person",
        replacement: "a family member"
      }
    ]);
  });

  test("falls back deterministically when scrub model credentials are absent", async () => {
    const result = await scrubStory(
      {
        providerName: "James Okafor",
        story:
          "James Okafor helped my friend Lena in Austin practice exposure steps."
      },
      { env: {} }
    );

    expect(result.source).toBe("fallback");
    expect(result.scrubbedStory).toContain("a friend");
    expect(result.scrubbedStory).not.toContain("Lena");
  });

  test("extracts taxonomy tags, a keystone quote, and quality flags", async () => {
    const scrubbedStory =
      "The therapist helped my teen build a CBT ladder for panic attacks and practice it on the bus.";
    const result = await extractStory({ scrubbedStory }, { env: {} });
    const quality = scoreQuality({
      scrubbedStory,
      enrichment: result.enrichment
    });

    expect(result.source).toBe("fallback");
    expect(result.enrichment.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "issue", value: "panic" }),
        expect.objectContaining({ type: "population", value: "teen" }),
        expect.objectContaining({ type: "modality", value: "cbt" })
      ])
    );
    expect(result.enrichment.keystone_quote.text).toContain("CBT ladder");
    expect(quality.flags).toEqual([]);
  });

  test("flags heavy PII for review", () => {
    const scrub = fallbackScrubStory({
      providerName: "Maria Chen",
      story:
        "Maria Chen helped my sister Julia at Acme Robotics on March 12 near 214 Oak Street."
    });

    expect(scrub.flags).toContain("pii_heavy");
    expect(scrub.piiFindings).toHaveLength(4);
  });
});
