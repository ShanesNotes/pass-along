import { createHash } from "node:crypto";

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSec?: number;
}

// Port for per-key rate limiting. Production drop-in: an Upstash/Redis-backed
// limiter (e.g. @upstash/ratelimit) implementing this same interface so the
// in-memory bucket below can be swapped without touching call sites.
export interface RateLimiter {
  check(key: string): RateLimitResult;
}

export interface TokenBucketConfig {
  readonly capacity: number;
  readonly refillPerSec: number;
}

export function ratePerMinute(capacity: number): TokenBucketConfig {
  return { capacity, refillPerSec: capacity / 60 };
}

interface BucketState {
  readonly tokens: number;
  readonly updatedAtMs: number;
}

export class InMemoryTokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, BucketState>();

  constructor(
    private readonly config: TokenBucketConfig,
    private readonly now: () => number = () => Date.now()
  ) {}

  check(key: string): RateLimitResult {
    const nowMs = this.now();
    const previous = this.buckets.get(key);
    const elapsedSec = previous
      ? Math.max(0, (nowMs - previous.updatedAtMs) / 1000)
      : 0;
    const available = Math.min(
      this.config.capacity,
      (previous?.tokens ?? this.config.capacity) + elapsedSec * this.config.refillPerSec
    );

    if (available < 1) {
      this.buckets.set(key, { tokens: available, updatedAtMs: nowMs });
      const deficit = 1 - available;
      const retryAfterSec = Math.max(
        1,
        Math.ceil(deficit / this.config.refillPerSec)
      );

      return { allowed: false, retryAfterSec };
    }

    this.buckets.set(key, { tokens: available - 1, updatedAtMs: nowMs });
    return { allowed: true };
  }
}

// Bucket key: first hop of x-forwarded-for, falling back to x-real-ip, then
// "unknown". Never the user's story or query text.
export function clientIpFrom(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim();

    if (firstHop) {
      return firstHop;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp && realIp.length > 0 ? realIp : "unknown";
}

// Short, non-reversible-in-practice prefix for logging IPs without exposing
// the raw address.
export function ipHashPrefix(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

export function tooManyRequestsResponse(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(Math.max(1, Math.ceil(retryAfterSec)))
    }
  });
}
