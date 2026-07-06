import { describe, expect, test } from "vitest";
import { storiesForCluster } from "./fixtures.js";
import { validateGrounding, type ThemeDraft } from "./grounding.js";

function requireStory<T>(list: readonly T[], index: number): T {
  const story = list[index];

  if (!story) {
    throw new Error(`Expected a fixture story at index ${index}`);
  }

  return story;
}

describe("validateGrounding", () => {
  const cluster = storiesForCluster("anxiety", "Denver, CO");
  const realStory = requireStory(cluster, 0);

  test("red: a fabricated quote that is not a verbatim span gets dropped", () => {
    const themes: readonly ThemeDraft[] = [
      {
        title: "Fabricated theme",
        quotes: [
          {
            storyId: realStory.id,
            providerId: realStory.providerId,
            text: "She guaranteed my anxiety would be cured within two weeks."
          }
        ]
      }
    ];

    const result = validateGrounding(themes, cluster);

    expect(result.themes).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain("not a verbatim span");
  });

  test("green: a quote that is an exact substring of its story is kept", () => {
    const themes: readonly ThemeDraft[] = [
      {
        title: "Real theme",
        quotes: [
          {
            storyId: realStory.id,
            providerId: realStory.providerId,
            text: realStory.keystone
          }
        ]
      }
    ];

    const result = validateGrounding(themes, cluster);

    expect(result.dropped).toHaveLength(0);
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0]?.quotes[0]?.text).toBe(realStory.keystone);
  });

  test("a quote referencing a story id outside the cluster is dropped", () => {
    const themes: readonly ThemeDraft[] = [
      {
        title: "Out of cluster",
        quotes: [
          {
            storyId: "story_not_in_cluster",
            providerId: "p_ghost",
            text: "anything"
          }
        ]
      }
    ];

    const result = validateGrounding(themes, cluster);

    expect(result.themes).toHaveLength(0);
    expect(result.dropped[0]?.reason).toContain("outside this cluster");
  });

  test("a theme with a mix of grounded and fabricated quotes keeps only the grounded one", () => {
    const otherStory = requireStory(cluster, 1);
    const themes: readonly ThemeDraft[] = [
      {
        title: "Mixed theme",
        quotes: [
          { storyId: realStory.id, providerId: realStory.providerId, text: realStory.keystone },
          {
            storyId: otherStory.id,
            providerId: otherStory.providerId,
            text: "This never appeared anywhere in the actual story."
          }
        ]
      }
    ];

    const result = validateGrounding(themes, cluster);

    expect(result.themes).toHaveLength(1);
    expect(result.themes[0]?.quotes).toHaveLength(1);
    expect(result.themes[0]?.quotes[0]?.storyId).toBe(realStory.id);
    expect(result.dropped).toHaveLength(1);
  });
});
