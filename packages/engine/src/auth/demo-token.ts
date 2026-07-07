import { timingSafeEqual } from "node:crypto";
import {
  bearerTokenFrom,
  type AdminAuthenticator,
  type AdminAuthOutcome
} from "./authenticator.js";

// Current behavior, unchanged: a single shared bearer token from
// ADMIN_DEMO_TOKEN. Used when no SUPABASE_JWT_SECRET is configured.
export class DemoTokenAuthenticator implements AdminAuthenticator {
  constructor(private readonly expectedToken: string) {}

  authorize(request: Request): AdminAuthOutcome {
    const suppliedToken = bearerTokenFrom(request);

    if (!suppliedToken || !safeEqual(suppliedToken, this.expectedToken)) {
      return { ok: false, status: 401, error: "ADMIN_UNAUTHORIZED" };
    }

    return { ok: true };
  }
}

// Constant-time comparison for the demo token: no algorithmic reason two
// tokens of different lengths ever match, so short-circuiting there leaks
// nothing timing-wise (timingSafeEqual would throw on length mismatch).
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");

  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
