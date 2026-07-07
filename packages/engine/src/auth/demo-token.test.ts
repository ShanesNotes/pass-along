import { describe, expect, test } from "vitest";
import { DemoTokenAuthenticator } from "./demo-token.js";

function requestWithBearer(token: string | undefined): Request {
  return new Request("http://localhost/api/admin/queue", {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

describe("DemoTokenAuthenticator", () => {
  test("authorizes the matching bearer token", () => {
    const authenticator = new DemoTokenAuthenticator("expected-token");

    expect(authenticator.authorize(requestWithBearer("expected-token"))).toEqual({
      ok: true
    });
  });

  test("rejects a mismatched token", () => {
    const authenticator = new DemoTokenAuthenticator("expected-token");

    expect(authenticator.authorize(requestWithBearer("wrong-token"))).toEqual({
      ok: false,
      status: 401,
      error: "ADMIN_UNAUTHORIZED"
    });
  });

  test("rejects a missing bearer token", () => {
    const authenticator = new DemoTokenAuthenticator("expected-token");

    expect(authenticator.authorize(requestWithBearer(undefined))).toEqual({
      ok: false,
      status: 401,
      error: "ADMIN_UNAUTHORIZED"
    });
  });

  test("rejects tokens of a different length without throwing", () => {
    const authenticator = new DemoTokenAuthenticator("a-much-longer-expected-token");

    expect(authenticator.authorize(requestWithBearer("short")).ok).toBe(false);
  });
});
