import { describe, expect, test } from "vitest";
import { postTypeaheadQuery, type TypeaheadFetch } from "./typeaheadApi";

describe("postTypeaheadQuery", () => {
  test("sends the provider-name query only in the POST body, never the URL", async () => {
    const query = "North Star Teen Therapy";
    const { fetcher, calls } = mockTypeaheadFetch({ results: [] });

    await postTypeaheadQuery(query, fetcher);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/typeahead");
    expect(String(calls[0]?.input)).not.toContain(query);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ q: query }));
  });

  test("parses fixture-shaped provider matches", async () => {
    const { fetcher } = mockTypeaheadFetch({
      results: [
        {
          id: "provider_postpartum_austin",
          name: "Juniper Perinatal Counseling",
          credential: "LCSW",
          loc: "Austin, TX"
        }
      ]
    });

    const matches = await postTypeaheadQuery("juniper", fetcher);

    expect(matches).toEqual([
      {
        id: "provider_postpartum_austin",
        name: "Juniper Perinatal Counseling",
        credential: "LCSW",
        loc: "Austin, TX"
      }
    ]);
  });

  test("returns an empty list when the request fails", async () => {
    const fetcher: TypeaheadFetch = async () =>
      new Response(JSON.stringify({ results: [] }), { status: 500 });

    const matches = await postTypeaheadQuery("anything", fetcher);

    expect(matches).toEqual([]);
  });
});

function mockTypeaheadFetch(response: unknown): {
  readonly fetcher: TypeaheadFetch;
  readonly calls: Array<{
    readonly input: Parameters<TypeaheadFetch>[0];
    readonly init: Parameters<TypeaheadFetch>[1];
  }>;
} {
  const calls: Array<{
    input: Parameters<TypeaheadFetch>[0];
    init: Parameters<TypeaheadFetch>[1];
  }> = [];
  const fetcher: TypeaheadFetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  return { fetcher, calls };
}
