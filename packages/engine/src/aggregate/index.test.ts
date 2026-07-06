import { describe, expect, test, vi } from "vitest";
import type { Transport } from "../llm/adapter.js";
import {
  AGGREGATE_MIN_STORIES,
  composeAggregatePage,
  fallbackComposeAggregatePage,
  type AggregatePageDraft
} from "./index.js";
import { SCRUBBED_STORIES, storiesForCluster, type ScrubbedStory } from "./fixtures.js";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

function googleCandidate(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] } }]
  };
}

/** GROUNDING LAW test proof: every quote the draft renders must be an exact
 * span of one of the cluster's real scrubbed fixture stories. */
function assertEveryQuoteTracesToAFixtureSpan(
  draft: AggregatePageDraft | undefined,
  cluster: readonly ScrubbedStory[]
): void {
  expect(draft).toBeDefined();

  const storiesById = new Map(cluster.map((story) => [story.id, story]));

  for (const theme of draft?.themes ?? []) {
    for (const quote of theme.quotes) {
      const story = storiesById.get(quote.storyId);
      expect(story).toBeDefined();
      expect(story?.text.includes(quote.text)).toBe(true);
    }
  }
}

describe("composeAggregatePage", () => {
  test("returns undefined below the demo threshold (route should 404)", async () => {
    const draft = await composeAggregatePage("anxiety", "Miami, FL", SCRUBBED_STORIES);

    expect(draft).toBeUndefined();
  });

  test("meets the threshold for both demo clusters", () => {
    expect(storiesForCluster("anxiety", "Denver, CO").length).toBeGreaterThanOrEqual(
      AGGREGATE_MIN_STORIES
    );
    expect(storiesForCluster("grief", "Austin, TX").length).toBeGreaterThanOrEqual(
      AGGREGATE_MIN_STORIES
    );
  });

  test("falls back to a deterministic, grounded draft without an API key", async () => {
    const draft = await composeAggregatePage("anxiety", "Denver, CO", SCRUBBED_STORIES, {
      env: {}
    });

    expect(draft).toBeDefined();
    expect(draft?.source).toBe("fallback");
    expect(draft?.headline).toContain("anxiety");
    expect(draft?.themes.length).toBeGreaterThan(0);
    expect(draft?.providers.length).toBeGreaterThan(0);

    assertEveryQuoteTracesToAFixtureSpan(draft, storiesForCluster("anxiety", "Denver, CO"));
  });

  test.each([
    ["anxiety", "Denver, CO"],
    ["grief", "Austin, TX"]
  ] as const)(
    "test proof: every quote on the %s/%s demo page traces to a real fixture span",
    async (issue, metro) => {
      const draft = await composeAggregatePage(issue, metro, SCRUBBED_STORIES, { env: {} });

      expect(draft).toBeDefined();
      assertEveryQuoteTracesToAFixtureSpan(draft, storiesForCluster(issue, metro));
    }
  );

  test("copy never claims advice or an outcome guarantee", () => {
    const draft = fallbackComposeAggregatePage(
      "anxiety",
      "Denver, CO",
      storiesForCluster("anxiety", "Denver, CO")
    );

    expect(draft.headline.toLowerCase()).not.toMatch(/\bcures?\b|\bguarantee/u);
  });

  test("a model response with a hallucinated quote has that quote dropped, keeping only grounded ones", async () => {
    const cluster = storiesForCluster("grief", "Austin, TX");
    const realStory = cluster[0];

    if (!realStory) {
      throw new Error("Expected a grief/Austin fixture story");
    }
    const transport: Transport = async () =>
      jsonResponse(
        googleCandidate(
          JSON.stringify({
            headline: "What helped people with grief in Austin, TX",
            themes: [
              {
                title: "Real theme",
                quotes: [{ story_id: realStory.id, text: realStory.keystone }]
              },
              {
                title: "Hallucinated theme",
                quotes: [
                  {
                    story_id: realStory.id,
                    text: "Grace personally guaranteed my grief would resolve in six weeks."
                  }
                ]
              }
            ]
          })
        )
      );

    const draft = await composeAggregatePage("grief", "Austin, TX", SCRUBBED_STORIES, {
      env: { GOOGLE_API_KEY: "test-key" },
      transport
    });

    expect(draft).toBeDefined();
    expect(draft?.source).toBe("model");
    expect(draft?.themes).toHaveLength(1);
    expect(draft?.themes[0]?.title).toBe("What people said about group support");
    expect(draft?.themes[0]?.quotes[0]?.text).toBe(realStory.keystone);
  });

  test("a model response with fabricated headline and title is replaced by grounded templates", async () => {
    const cluster = storiesForCluster("grief", "Austin, TX");
    const realStory = cluster[0];

    if (!realStory) {
      throw new Error("Expected a grief/Austin fixture story");
    }

    const warn = vi.fn();
    const transport: Transport = async () =>
      jsonResponse(
        googleCandidate(
          JSON.stringify({
            headline: "Guaranteed grief recovery in 30 days",
            themes: [
              {
                title: "Guaranteed outcomes and instant relief",
                quotes: [{ story_id: realStory.id, text: realStory.keystone }]
              }
            ]
          })
        )
      );

    const draft = await composeAggregatePage("grief", "Austin, TX", SCRUBBED_STORIES, {
      env: { GOOGLE_API_KEY: "test-key" },
      transport,
      warn
    });

    expect(draft?.headline).toBe("What helped people with grief in Austin, TX");
    expect(draft?.themes[0]?.title).toBe("What people said about group support");
    expect(warn).toHaveBeenCalledWith("aggregate.title_grounding_replaced", {
      replaced_headline_count: 1,
      replaced_theme_title_count: 1
    });
  });

  test("a model response with only hallucinated quotes falls back to the deterministic draft", async () => {
    const transport: Transport = async () =>
      jsonResponse(
        googleCandidate(
          JSON.stringify({
            headline: "What helped people with grief in Austin, TX",
            themes: [
              {
                title: "Entirely hallucinated theme",
                quotes: [
                  { story_id: "story_grief_austin_1", text: "A quote that does not exist anywhere." }
                ]
              }
            ]
          })
        )
      );

    const draft = await composeAggregatePage("grief", "Austin, TX", SCRUBBED_STORIES, {
      env: { GOOGLE_API_KEY: "test-key" },
      transport
    });

    expect(draft?.source).toBe("fallback");
  });
});
