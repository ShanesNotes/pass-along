import { describe, expect, test, vi } from "vitest";
import { POST } from "./route";

interface TypeaheadApiResult {
  readonly id: string;
  readonly name: string;
}

function postRequest(q: string): Request {
  return new Request("http://localhost/api/typeahead", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q })
  });
}

describe("POST /api/typeahead", () => {
  test("returns fixture-backed provider name matches", async () => {
    const response = await POST(postRequest("juniper"));
    const body = (await response.json()) as {
      readonly results: readonly TypeaheadApiResult[];
    };

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      id: "provider_postpartum_austin",
      name: "Juniper Perinatal Counseling"
    });
  });

  test("returns an empty result set for blank q", async () => {
    const response = await POST(postRequest(" "));

    await expect(response.json()).resolves.toEqual({ results: [] });
  });

  test("does not accept the query via the URL", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/typeahead?q=North+Star+Teen+Therapy",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: "" })
        }
      )
    );

    await expect(response.json()).resolves.toEqual({ results: [] });
  });

  test("does not log or persist the provider-name query", async () => {
    // The route guard's access log (http.request: request_id/route/status/
    // latency_ms only, allowlist-enforced) is expected here. The invariant
    // under test is that the query text itself never rides along on any log
    // line, not that logging never happens.
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const providerName = "North Star Teen Therapy";

    try {
      const response = await POST(postRequest(providerName));

      expect(response.status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain(providerName);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(providerName);
      expect(JSON.stringify(error.mock.calls)).not.toContain(providerName);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
