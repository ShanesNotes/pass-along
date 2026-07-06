import { describe, expect, test, vi } from "vitest";
import { GET } from "./route";

interface SimilarApiResult {
  readonly providerId: string;
  readonly recommendationId: string;
  readonly name: string;
  readonly kind: "therapist" | "facility";
  readonly license_check?: {
    readonly status: string;
    readonly source: string;
    readonly checked_at: string;
  };
  readonly verified?: boolean;
}

describe("GET /api/similar", () => {
  test("returns fixture-backed same-kind neighbors for a provider", async () => {
    const response = await GET(
      new Request("http://localhost/api/similar?providerId=provider_teen_denver")
    );
    const body = (await response.json()) as {
      readonly results: readonly SimilarApiResult[];
    };

    expect(response.status).toBe(200);
    expect(body.results.length).toBeGreaterThan(0);
    expect(
      body.results.every((result) => result.kind === "therapist")
    ).toBe(true);
    expect(
      body.results.some((result) => result.providerId === "provider_teen_denver")
    ).toBe(false);
    expect(body.results.some((result) => "verified" in result)).toBe(false);
  });

  test("returns dated successful license checks instead of static verified booleans", async () => {
    const response = await GET(
      new Request("http://localhost/api/similar?providerId=provider_family_denver")
    );
    const body = (await response.json()) as {
      readonly results: readonly SimilarApiResult[];
    };

    expect(response.status).toBe(200);
    expect(body.results.some((result) => "verified" in result)).toBe(false);
    expect(
      body.results
        .filter((result) => result.license_check)
        .every((result) => result.license_check?.status === "verified")
    ).toBe(true);
  });

  test("returns fixture-backed neighbors for a recommendation", async () => {
    const response = await GET(
      new Request("http://localhost/api/similar?recId=rec_001")
    );
    const body = (await response.json()) as {
      readonly results: readonly SimilarApiResult[];
    };

    expect(response.status).toBe(200);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        providerId: expect.any(String),
        recommendationId: expect.any(String),
        name: expect.any(String)
      })
    );
  });

  test("rejects missing or ambiguous target params", async () => {
    await expect(
      GET(new Request("http://localhost/api/similar"))
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      GET(
        new Request(
          "http://localhost/api/similar?recId=rec_001&providerId=provider_teen_denver"
        )
      )
    ).resolves.toMatchObject({ status: 400 });
  });

  test("is read-only and logs nothing on the fixture route", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await GET(
        new Request("http://localhost/api/similar?providerId=provider_ocd_denver")
      );

      expect(response.status).toBe(200);
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
