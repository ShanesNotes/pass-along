import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal HS256 JWT sign/verify. No new dependency: HS256 is just
// HMAC-SHA256 over `${header}.${payload}` (both base64url JSON), which
// node:crypto already does. Deliberately does not support other algorithms
// (in particular "none" and RS256/JWKS) — Supabase's JWT secret is HS256 by
// default, and this port only ever needs to verify tokens signed with that
// same shared secret.
export interface JwtVerifyResult {
  readonly ok: boolean;
  readonly payload?: Record<string, unknown>;
  readonly reason?: string;
}

export function verifyHs256Jwt(
  token: string,
  secret: string,
  now: () => number = Date.now
): JwtVerifyResult {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return { ok: false, reason: "malformed" };
  }

  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string
  ];

  const header = parseBase64UrlJson(headerB64);
  const payload = parseBase64UrlJson(payloadB64);

  if (!header || !isPlainObject(header) || header.alg !== "HS256") {
    return { ok: false, reason: "unsupported_alg" };
  }

  if (!payload || !isPlainObject(payload)) {
    return { ok: false, reason: "invalid_payload" };
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const suppliedSignature = base64UrlToBuffer(signatureB64);

  if (
    !suppliedSignature ||
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const exp = payload.exp;

  if (typeof exp === "number" && exp * 1000 <= now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}

// Test/fixture helper: signs a token with the same algorithm this module
// verifies. Real Supabase JWTs are also HS256-signed with the project's JWT
// secret, so this doubles as a way to hand-construct fixtures without a
// live Supabase project.
export function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string
): string {
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();

  return `${headerB64}.${payloadB64}.${bufferToBase64Url(signature)}`;
}

function parseBase64UrlJson(value: string): unknown | undefined {
  try {
    const decoded = base64UrlToBuffer(value);
    return decoded ? (JSON.parse(decoded.toString("utf8")) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlToBuffer(value: string): Buffer | undefined {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const padLength = (4 - (padded.length % 4)) % 4;
    return Buffer.from(padded + "=".repeat(padLength), "base64");
  } catch {
    return undefined;
  }
}

function base64UrlEncode(value: string): string {
  return bufferToBase64Url(Buffer.from(value, "utf8"));
}

function bufferToBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
