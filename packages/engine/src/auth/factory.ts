import type { AppConfig } from "../../../core/src/index.js";
import type { AdminAuthenticator, AdminAuthOutcome } from "./authenticator.js";
import { DemoTokenAuthenticator } from "./demo-token.js";
import { SupabaseJwtAuthenticator } from "./supabase-jwt.js";

// Selection law, unchanged from before this packet: Supabase JWT verification
// when a secret is configured, else the demo token, else fail-closed 503 —
// the existing "no auth path configured" default.
export function createAdminAuthenticator(config: AppConfig): AdminAuthenticator {
  if (config.supabase.jwtSecret) {
    return new SupabaseJwtAuthenticator(config.supabase.jwtSecret);
  }

  if (config.admin.demoToken) {
    return new DemoTokenAuthenticator(config.admin.demoToken);
  }

  return new DisabledAuthenticator();
}

class DisabledAuthenticator implements AdminAuthenticator {
  authorize(): AdminAuthOutcome {
    return { ok: false, status: 503, error: "ADMIN_DISABLED" };
  }
}
