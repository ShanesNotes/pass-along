import { describe, expect, test } from "vitest";
import { withRouteGuard } from "./guard.js";
import { REQUEST_ID_HEADER } from "./request-id.js";
import { createLogger } from "./logger.js";
import { InMemoryTokenBucketRateLimiter, ratePerMinute } from "./rate-limiter.js";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/find", {
    method: "POST",
    headers
  });
}

describe("withRouteGuard", () => {
  test("passes requests through under the limit and echoes a request id", async () => {
    const limiter = new InMemoryTokenBucketRateLimiter(ratePerMinute(2));
    const response = await withRouteGuard(
      request(),
      { route: "find", limiter },
      async () => new Response("ok", { status: 200 })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  test("returns 429 with Retry-After once the bucket is empty", async () => {
    const limiter = new InMemoryTokenBucketRateLimiter(ratePerMinute(1));
    const handle = async () => new Response("ok", { status: 200 });

    await withRouteGuard(request(), { route: "find", limiter }, handle);
    const blocked = await withRouteGuard(
      request(),
      { route: "find", limiter },
      handle
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    await expect(blocked.json()).resolves.toEqual({ error: "RATE_LIMITED" });
  });

  test("emits a rate-limited log line without a raw IP", async () => {
    const limiter = new InMemoryTokenBucketRateLimiter(ratePerMinute(1));
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    const handle = async () => new Response("ok", { status: 200 });

    await withRouteGuard(
      request({ "x-forwarded-for": "203.0.113.7" }),
      { route: "find", limiter, logger },
      handle
    );
    await withRouteGuard(
      request({ "x-forwarded-for": "203.0.113.7" }),
      { route: "find", limiter, logger },
      handle
    );

    const rateLimitedLine = lines.find((line) =>
      line.includes("http.rate_limited")
    );
    expect(rateLimitedLine).toBeDefined();
    expect(rateLimitedLine).not.toContain("203.0.113.7");
  });
});
