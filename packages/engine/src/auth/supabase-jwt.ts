import {
  bearerTokenFrom,
  type AdminAuthenticator,
  type AdminAuthOutcome
} from "./authenticator.js";
import { verifyHs256Jwt } from "./jwt.js";

// Verifies Supabase-issued (or self-signed, for tests) HS256 JWTs against
// the project's JWT secret. Requires an admin claim: Supabase's own `role`
// claim is for RLS (authenticated/anon/service_role), not app-level admin
// status, so this checks app_metadata.role — the one JWT field a client
// can't edit themselves (unlike user_metadata) — falling back to a
// top-level `role` claim for simplicity in hand-signed test/ops tokens.
export class SupabaseJwtAuthenticator implements AdminAuthenticator {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now
  ) {}

  authorize(request: Request): AdminAuthOutcome {
    const token = bearerTokenFrom(request);

    if (!token) {
      return { ok: false, status: 401, error: "ADMIN_UNAUTHORIZED" };
    }

    const result = verifyHs256Jwt(token, this.secret, this.now);

    if (!result.ok || !result.payload) {
      return {
        ok: false,
        status: 401,
        error: "ADMIN_UNAUTHORIZED",
        ...(result.reason ? { reason: result.reason } : {})
      };
    }

    if (!hasAdminClaim(result.payload)) {
      return {
        ok: false,
        status: 401,
        error: "ADMIN_UNAUTHORIZED",
        reason: "missing_admin_claim"
      };
    }

    return { ok: true };
  }
}

function hasAdminClaim(payload: Record<string, unknown>): boolean {
  if (payload.role === "admin") {
    return true;
  }

  const appMetadata = payload.app_metadata;

  return (
    typeof appMetadata === "object" &&
    appMetadata !== null &&
    (appMetadata as { readonly role?: unknown }).role === "admin"
  );
}
