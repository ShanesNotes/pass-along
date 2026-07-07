import { describe, expect, test } from "vitest";
import {
  InMemoryTokenBucketRateLimiter,
  clientIpFrom,
  ratePerMinute
} from "./rate-limiter.js";

describe("InMemoryTokenBucketRateLimiter", () => {
  test("allows a burst up to capacity then blocks", () => {
    const nowMs = 0;
    const limiter = new InMemoryTokenBucketRateLimiter(
      ratePerMinute(3),
      () => nowMs
    );

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);

    const blocked = limiter.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  test("refills over time", () => {
    let nowMs = 0;
    const limiter = new InMemoryTokenBucketRateLimiter(
      ratePerMinute(60),
      () => nowMs
    );

    for (let i = 0; i < 60; i += 1) {
      expect(limiter.check("k").allowed).toBe(true);
    }
    expect(limiter.check("k").allowed).toBe(false);

    nowMs += 1_000;
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
  });

  test("tracks buckets independently per key", () => {
    const limiter = new InMemoryTokenBucketRateLimiter(ratePerMinute(1));

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  test("route buckets stay independent when using separate limiter instances", () => {
    const findLimiter = new InMemoryTokenBucketRateLimiter(ratePerMinute(20));
    const passLimiter = new InMemoryTokenBucketRateLimiter(ratePerMinute(5));

    for (let i = 0; i < 5; i += 1) {
      expect(passLimiter.check("1.2.3.4").allowed).toBe(true);
    }
    expect(passLimiter.check("1.2.3.4").allowed).toBe(false);

    // Same key, different route's limiter: unaffected by the pass bucket.
    expect(findLimiter.check("1.2.3.4").allowed).toBe(true);
  });
});

describe("clientIpFrom", () => {
  test("uses the first hop of x-forwarded-for", () => {
    const request = new Request("http://localhost/api/find", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" }
    });

    expect(clientIpFrom(request)).toBe("203.0.113.5");
  });

  test("falls back to x-real-ip then unknown", () => {
    const withRealIp = new Request("http://localhost/api/find", {
      headers: { "x-real-ip": "198.51.100.9" }
    });
    const withNeither = new Request("http://localhost/api/find");

    expect(clientIpFrom(withRealIp)).toBe("198.51.100.9");
    expect(clientIpFrom(withNeither)).toBe("unknown");
  });
});
