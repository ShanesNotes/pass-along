import { describe, expect, test } from "vitest";
import { signHs256Jwt, verifyHs256Jwt } from "./jwt.js";

const SECRET = "test-jwt-secret";

describe("verifyHs256Jwt", () => {
  test("accepts a validly signed, unexpired token", () => {
    const token = signHs256Jwt({ sub: "user-1", role: "admin" }, SECRET);
    const result = verifyHs256Jwt(token, SECRET);

    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({ sub: "user-1", role: "admin" });
  });

  test("rejects a forged signature", () => {
    const token = signHs256Jwt({ sub: "user-1", role: "admin" }, SECRET);
    const [header, payload] = token.split(".");
    const forged = `${header}.${payload}.forged-signature`;

    expect(verifyHs256Jwt(forged, SECRET).ok).toBe(false);
  });

  test("rejects a token signed with a different secret", () => {
    const token = signHs256Jwt({ sub: "user-1", role: "admin" }, "wrong-secret");

    const result = verifyHs256Jwt(token, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  test("rejects an expired token", () => {
    const token = signHs256Jwt(
      { sub: "user-1", role: "admin", exp: 1_000 },
      SECRET
    );

    const result = verifyHs256Jwt(token, SECRET, () => 2_000_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  test("accepts a token whose exp is still in the future", () => {
    const token = signHs256Jwt(
      { sub: "user-1", role: "admin", exp: 9_999_999_999 },
      SECRET
    );

    expect(verifyHs256Jwt(token, SECRET, () => 1_000).ok).toBe(true);
  });

  test("rejects malformed tokens", () => {
    expect(verifyHs256Jwt("not-a-jwt", SECRET).ok).toBe(false);
    expect(verifyHs256Jwt("a.b", SECRET).ok).toBe(false);
    expect(verifyHs256Jwt("", SECRET).ok).toBe(false);
  });

  test("rejects tokens using an algorithm other than HS256", () => {
    const headerB64 = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
      .toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify({ role: "admin" })).toString(
      "base64url"
    );
    const forged = `${headerB64}.${payloadB64}.`;

    const result = verifyHs256Jwt(forged, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_alg");
  });

  test("rejects a payload that isn't a JSON object", () => {
    const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
      .toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(["not", "an", "object"]))
      .toString("base64url");
    const forged = `${headerB64}.${payloadB64}.sig`;

    expect(verifyHs256Jwt(forged, SECRET).ok).toBe(false);
  });
});
