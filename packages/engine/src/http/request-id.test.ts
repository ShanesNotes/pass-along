import { describe, expect, test } from "vitest";
import { REQUEST_ID_HEADER, createRequestId, withRequestId } from "./request-id.js";

describe("request id", () => {
  test("creates distinct uuids", () => {
    expect(createRequestId()).not.toBe(createRequestId());
  });

  test("echoes the request id as a response header without altering the body", async () => {
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });

    const tagged = withRequestId(original, "req-123");

    expect(tagged.status).toBe(201);
    expect(tagged.headers.get(REQUEST_ID_HEADER)).toBe("req-123");
    expect(tagged.headers.get("content-type")).toBe("application/json");
    await expect(tagged.json()).resolves.toEqual({ ok: true });
  });
});
