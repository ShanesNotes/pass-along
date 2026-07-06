import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  FindScreen,
  type FindScreenProps,
  type FindView
} from "../app/find/FindScreen";
import {
  postFindQuery,
  type FindApiCard,
  type FindApiResponse,
  type FindFetch
} from "./findApi";
import type { Facets } from "./understandQuery";

describe("find page", () => {
  test("posts to the real find route and renders the crisis card from the route response", async () => {
    const query = "I do not see the point anymore.";
    const { fetcher, calls } = mockFindFetch({
      crisis: true,
      support: {
        lifeline: "988",
        message: "Nothing was stored."
      }
    });

    const response = await postFindQuery(query, fetcher);
    const html = renderFindScreen({
      text: query,
      view: crisisView(query, response)
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input: "/api/find",
      init: {
        method: "POST",
        body: JSON.stringify({ text: query })
      }
    });
    expect(html).toContain("not alone right now");
    expect(html).toContain("Call or text 988");
    expect(html).toContain("Nothing was stored.");
  });

  test("renders result cards from the route payload", async () => {
    const query = "Looking for teen anxiety CBT in Denver, ideally evenings";
    const cards = [
      findCard({
        id: "provider_teen_denver",
        name: "North Star Teen Therapy",
        passed_count: 3
      }),
      findCard({
        id: "provider_family_denver",
        name: "Cedar Table Family Therapy",
        passed_count: 2
      }),
      findCard({
        id: "provider_med_mgmt_denver",
        name: "Front Range Medication Clinic",
        passed_count: 1
      })
    ];
    const { fetcher } = mockFindFetch({
      understood: null,
      results: cards
    });

    const response = await postFindQuery(query, fetcher);
    const html = renderFindScreen({
      text: query,
      view: resultsView(query, response, {
        issues: ["anxiety"],
        population: "teen",
        prefers: ["evenings"]
      })
    });

    expect(html).toContain("real route · safety gate active · dev embeddings · nothing stored");
    expect(html).toContain("issues: anxiety");
    expect(html).toContain("population: teen");
    expect(html).toContain("prefers: evenings");
    expect(html).toContain("North Star Teen Therapy");
    expect(html).toContain("Cedar Table Family Therapy");
    expect(html).toContain("Front Range Medication Clinic");
    expect(html).not.toContain("We don&rsquo;t have many recommendations");
  });

  test("renders the sparse-corpus fallback when the route returns fewer than three cards", async () => {
    const query = "Looking for chronic pain support near Detroit";
    const { fetcher } = mockFindFetch({
      understood: null,
      results: [
        findCard({
          id: "provider_pain_detroit",
          name: "Lakeside Chronic Pain Counseling",
          passed_count: 1
        })
      ]
    });

    const response = await postFindQuery(query, fetcher);
    const html = renderFindScreen({
      text: query,
      view: resultsView(query, response, {
        issues: [],
        population: undefined,
        prefers: []
      })
    });

    expect(html).toContain("We don’t have many recommendations");
    expect(html).toContain("Ask the network instead");
    expect(html).toContain("Lakeside Chronic Pain Counseling");
  });

  test("sends query text only in the POST /api/find body", async () => {
    const query = "raw query text should have exactly one sink";
    const { fetcher, calls } = mockFindFetch({
      understood: null,
      results: []
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await postFindQuery(query, fetcher);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.input).toBe("/api/find");
      expect(String(calls[0]?.input)).not.toContain(query);
      expect(calls[0]?.init?.method).toBe("POST");
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ text: query }));
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

function renderFindScreen(
  overrides: Pick<FindScreenProps, "text" | "view">
): string {
  const props: FindScreenProps = {
    text: overrides.text,
    view: overrides.view,
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
    }
  };

  return renderToStaticMarkup(createElement(FindScreen, props));
}

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
      headers: {
        "content-type": "application/json"
      }
    });
  };

  return { fetcher, calls };
}

function crisisView(queryText: string, response: FindApiResponse): FindView {
  if (!("crisis" in response)) {
    throw new Error("Expected crisis response");
  }

  return {
    kind: "crisis",
    queryText,
    support: response.support
  };
}

function resultsView(
  queryText: string,
  response: FindApiResponse,
  facets: Facets
): FindView {
  if ("crisis" in response) {
    throw new Error("Expected results response");
  }

  return {
    kind: "results",
    queryText,
    facets,
    cards: response.results
  };
}

function findCard(overrides: {
  readonly id: string;
  readonly name: string;
  readonly passed_count: number;
}): FindApiCard {
  return {
    id: overrides.id,
    name: overrides.name,
    credential: "LPC",
    loc: "Denver, CO",
    passed_count: overrides.passed_count,
    tags: [
      {
        value: "anxiety",
        freq: 2
      },
      {
        value: "teen",
        freq: 1
      }
    ],
    keystone: "A synthetic recommendation keystone for the demo.",
    verified: true,
    why: null
  };
}
