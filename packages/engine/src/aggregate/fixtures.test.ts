import { describe, expect, test } from "vitest";
import { SCRUBBED_STORIES, storiesForCluster } from "./fixtures.js";

describe("aggregate demo fixtures", () => {
  test("every keystone is an exact substring of its own scrubbed story text", () => {
    for (const story of SCRUBBED_STORIES) {
      expect(story.text.includes(story.keystone)).toBe(true);
    }
  });

  test("both demo clusters meet the aggregation threshold", () => {
    expect(storiesForCluster("anxiety", "Denver, CO").length).toBeGreaterThanOrEqual(3);
    expect(storiesForCluster("grief", "Austin, TX").length).toBeGreaterThanOrEqual(3);
  });
});
