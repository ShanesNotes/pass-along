import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import LandingPage from "../app/page";
import { FindBox, type FindView } from "../app/find/FindBox";
import { postFindQuery, type FindApiCard, type FindApiResponse, type FindFetch } from "./findApi";

describe("product landing page", () => {
  test("embeds the live find box front and center, with trust props, a pass CTA, and an honest footer", () => {
    const html = renderToStaticMarkup(createElement(LandingPage));

    expect(html).toContain("passed along by someone");
    expect(html).toContain("Looking for someone for my teenager&#x27;s anxiety");
    expect(html).toContain("Find help");
    expect(html).toContain("Lived-experience stories");
    expect(html).toContain("Licenses actually verified");
    expect(html).toContain("pay-to-rank");
    expect(html).toContain("Pass one along");
    expect(html).toContain("href=\"/pass\"");
    expect(html).toContain("Concept preview");
    expect(html).toContain("nothing stored");
  });

  test("the embedded find box renders results from the same live route the /find page uses", async () => {
    const query = "Looking for teen anxiety CBT in Denver, ideally evenings";
    const card: FindApiCard = {
      id: "provider_teen_denver",
      name: "North Star Teen Therapy",
      credential: "LPC",
      loc: "Denver, CO",
      passed_count: 3,
      tags: [{ value: "anxiety", freq: 2 }],
      keystone: "A synthetic recommendation keystone for the demo.",
      license_check: {
        status: "verified",
        source: "Colorado DORA cassette",
        checked_at: "2026-06-18T10:00:00.000Z"
      },
      why: null
    };
    const { fetcher, calls } = mockFindFetch({
      understood: null,
      source: "fallback",
      unmet: false,
      results: [card]
    });

    const response = await postFindQuery(query, fetcher);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input: "/api/find",
      init: { method: "POST", body: JSON.stringify({ text: query }) }
    });

    const view = resultsView(query, response);
    const html = renderToStaticMarkup(
      createElement(FindBox, {
        text: query,
        view,
        onTextChange() {
          return undefined;
        },
        onSubmit() {
          return undefined;
        },
        onCrisisExample() {
          return undefined;
        },
        onBack() {
          return undefined;
        },
        onRemoveChip() {
          return undefined;
        },
        onClarifyChip() {
          return undefined;
        }
      })
    );

    expect(html).toContain("North Star Teen Therapy");
    expect(html).toContain("Passed along 3 times");
  });
});

function mockFindFetch(response: FindApiResponse): {
  readonly fetcher: FindFetch;
  readonly calls: Array<{
    readonly input: Parameters<FindFetch>[0];
    readonly init: Parameters<FindFetch>[1];
  }>;
} {
  const calls: Array<{
    input: Parameters<FindFetch>[0];
    init: Parameters<FindFetch>[1];
  }> = [];
  const fetcher: FindFetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  return { fetcher, calls };
}

function resultsView(queryText: string, response: FindApiResponse): FindView {
  if ("crisis" in response || "clarify" in response) {
    throw new Error("Expected a results response");
  }

  return {
    kind: "results",
    queryText,
    facets: { issues: [], population: undefined, prefers: [] },
    cards: response.results
  };
}
