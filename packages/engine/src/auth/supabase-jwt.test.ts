import { describe, expect, test } from "vitest";
import { signHs256Jwt } from "./jwt.js";
import { SupabaseJwtAuthenticator } from "./supabase-jwt.js";

const SECRET = "test-jwt-secret";

function requestWithBearer(token: string | undefined): Request {
  return new Request("http://localhost/api/admin/queue", {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

describe("SupabaseJwtAuthenticator", () => {
  test("authorizes a token with app_metadata.role admin", () => {
    const token = signHs256Jwt(
      { sub: "user-1", app_metadata: { role: "admin" }, exp: 9_999_999_999 },
      SECRET
    );
    const authenticator = new SupabaseJwtAuthenticator(SECRET);

    expect(authenticator.authorize(requestWithBearer(token))).toEqual({
      ok: true
    });
  });

  test("authorizes a token with a top-level role admin claim", () => {
    const token = signHs256Jwt(
      { sub: "user-1", role: "admin", exp: 9_999_999_999 },
      SECRET
    );
    const authenticator = new SupabaseJwtAuthenticator(SECRET);

    expect(authenticator.authorize(requestWithBearer(token)).ok).toBe(true);
  });

  test("rejects a token missing the admin claim", () => {
    const token = signHs256Jwt(
      { sub: "user-1", role: "authenticated", exp: 9_999_999_999 },
      SECRET
    );
    const authenticator = new SupabaseJwtAuthenticator(SECRET);

    expect(authenticator.authorize(requestWithBearer(token))).toEqual({
      ok: false,
      status: 401,
      error: "ADMIN_UNAUTHORIZED",
      reason: "missing_admin_claim"
    });
  });

  test("rejects a forged token", () => {
    const token = signHs256Jwt(
      { sub: "user-1", role: "admin" },
      "wrong-secret"
    );
    const authenticator = new SupabaseJwtAuthenticator(SECRET);
    const result = authenticator.authorize(requestWithBearer(token));

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 401, error: "ADMIN_UNAUTHORIZED" });
  });

  test("rejects an expired token", () => {
    const token = signHs256Jwt(
      { sub: "user-1", role: "admin", exp: 1_000 },
      SECRET
    );
    const authenticator = new SupabaseJwtAuthenticator(SECRET, () => 2_000_000);

    expect(authenticator.authorize(requestWithBearer(token))).toMatchObject({
      ok: false,
      status: 401,
      error: "ADMIN_UNAUTHORIZED",
      reason: "expired"
    });
  });

  test("rejects a missing bearer token", () => {
    const authenticator = new SupabaseJwtAuthenticator(SECRET);

    expect(authenticator.authorize(requestWithBearer(undefined))).toEqual({
      ok: false,
      status: 401,
      error: "ADMIN_UNAUTHORIZED"
    });
  });
});
