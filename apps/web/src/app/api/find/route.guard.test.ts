import { describe, expect, test } from "vitest";
import { REQUEST_ID_HEADER } from "../../../../../../packages/engine/src/http/index";
import { POST } from "./route";

function findRequest(ip: string): Request {
  return new Request("http://localhost/api/find", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip
    },
    body: JSON.stringify({ text: "anxiety support in Denver" })
  });
}

describe("POST /api/find rate limiting", () => {
  test("echoes a request id and eventually 429s with Retry-After for a hammering client", async () => {
    const ip = "203.0.113.99";
    const responses: Response[] = [];

    for (let i = 0; i < 25; i += 1) {
      responses.push(await POST(findRequest(ip)));
    }

    for (const response of responses) {
      expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    }

    const limited = responses.find((response) => response.status === 429);
    expect(limited).toBeDefined();
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    await expect(limited?.json()).resolves.toEqual({ error: "RATE_LIMITED" });

    // A different client IP is on its own bucket and is unaffected.
    const otherClient = await POST(findRequest("198.51.100.1"));
    expect(otherClient.status).not.toBe(429);
  });
});
