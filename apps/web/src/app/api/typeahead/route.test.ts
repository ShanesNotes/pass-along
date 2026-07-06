import { describe, expect, test, vi } from "vitest";
import { GET } from "./route";

interface TypeaheadApiResult {
  readonly id: string;
  readonly name: string;
}

describe("GET /api/typeahead", () => {
  test("returns fixture-backed provider name matches", async () => {
    const response = await GET(
      new Request("http://localhost/api/typeahead?q=juniper")
    );
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
    const response = await GET(
      new Request("http://localhost/api/typeahead?q=%20")
    );

    await expect(response.json()).resolves.toEqual({ results: [] });
  });

  test("does not log or persist the provider-name query", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const providerName = "North Star Teen Therapy";

    try {
      const response = await GET(
        new Request(
          `http://localhost/api/typeahead?q=${encodeURIComponent(providerName)}`
        )
      );

      expect(response.status).toBe(200);
      expect(log).not.toHaveBeenCalled();
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
