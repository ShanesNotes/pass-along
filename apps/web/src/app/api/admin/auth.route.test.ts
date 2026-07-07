// PA-025: proves /api/admin/queue really uses the AdminAuthenticator port
// end-to-end when SUPABASE_JWT_SECRET is configured — the unit-level
// coverage lives in packages/engine/src/auth/*.test.ts; this is the
// route-level wiring check plus the red-first forged/expired/wrong-claim
// cases the packet calls out explicitly.
import { describe, expect, test } from "vitest";
import { loadConfig } from "../../../../../../packages/core/src/index.js";
import { signHs256Jwt } from "../../../../../../packages/engine/src/auth/index.js";
import { createPassDemoStore } from "../pass/deps";
import { createAdminQueueGetHandler } from "./deps";

const JWT_SECRET = "test-supabase-jwt-secret";

function queueRequest(token?: string): Request {
  return new Request("http://localhost/api/admin/queue", {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

function handlerWithJwtSecret() {
  const config = loadConfig({ ...process.env, SUPABASE_JWT_SECRET: JWT_SECRET });
  return createAdminQueueGetHandler({
    store: createPassDemoStore(),
    config
  });
}

describe("GET /api/admin/queue with SUPABASE_JWT_SECRET configured", () => {
  test("authorizes a validly signed admin JWT", async () => {
    const handler = handlerWithJwtSecret();
    const token = signHs256Jwt({ app_metadata: { role: "admin" } }, JWT_SECRET);

    const response = await handler(queueRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ queue: [] });
  });

  test("rejects a forged JWT", async () => {
    const handler = handlerWithJwtSecret();
    const token = signHs256Jwt(
      { app_metadata: { role: "admin" } },
      "wrong-secret"
    );

    const response = await handler(queueRequest(token));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "ADMIN_UNAUTHORIZED"
    });
  });

  test("rejects an expired JWT", async () => {
    const handler = handlerWithJwtSecret();
    const token = signHs256Jwt(
      { app_metadata: { role: "admin" }, exp: 1_000 },
      JWT_SECRET
    );

    const response = await handler(queueRequest(token));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "ADMIN_UNAUTHORIZED"
    });
  });

  test("rejects a validly signed JWT missing the admin claim", async () => {
    const handler = handlerWithJwtSecret();
    const token = signHs256Jwt({ role: "authenticated" }, JWT_SECRET);

    const response = await handler(queueRequest(token));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "ADMIN_UNAUTHORIZED"
    });
  });

  test("rejects a demo token when a JWT secret is configured", async () => {
    // Demo-token bearer values are not valid JWTs, so they fail JWT parsing
    // the same way any other malformed bearer value would once a JWT
    // secret takes priority over the demo token.
    const handler = handlerWithJwtSecret();

    const response = await handler(queueRequest("some-demo-token"));

    expect(response.status).toBe(401);
  });

  test("rejects a missing bearer token", async () => {
    const handler = handlerWithJwtSecret();

    const response = await handler(queueRequest());

    expect(response.status).toBe(401);
  });
});
