import { describe, expect, test } from "vitest";
import { loadConfig } from "../../../core/src/index.js";
import { createAdminAuthenticator } from "./factory.js";
import { DemoTokenAuthenticator } from "./demo-token.js";
import { SupabaseJwtAuthenticator } from "./supabase-jwt.js";

function requestWithBearer(token: string): Request {
  return new Request("http://localhost/api/admin/queue", {
    headers: { authorization: `Bearer ${token}` }
  });
}

describe("createAdminAuthenticator", () => {
  test("picks SupabaseJwtAuthenticator when a JWT secret is configured", () => {
    const config = loadConfig({ SUPABASE_JWT_SECRET: "jwt-secret" });

    expect(createAdminAuthenticator(config)).toBeInstanceOf(
      SupabaseJwtAuthenticator
    );
  });

  test("picks DemoTokenAuthenticator when only the demo token is configured", () => {
    const config = loadConfig({ ADMIN_DEMO_TOKEN: "demo-token" });

    expect(createAdminAuthenticator(config)).toBeInstanceOf(
      DemoTokenAuthenticator
    );
  });

  test("prefers the Supabase JWT secret when both are configured", () => {
    const config = loadConfig({
      SUPABASE_JWT_SECRET: "jwt-secret",
      ADMIN_DEMO_TOKEN: "demo-token"
    });

    expect(createAdminAuthenticator(config)).toBeInstanceOf(
      SupabaseJwtAuthenticator
    );
  });

  test("fails closed with 503 when neither is configured", () => {
    const config = loadConfig({});
    const authenticator = createAdminAuthenticator(config);

    expect(authenticator.authorize(requestWithBearer("anything"))).toEqual({
      ok: false,
      status: 503,
      error: "ADMIN_DISABLED"
    });
  });
});
