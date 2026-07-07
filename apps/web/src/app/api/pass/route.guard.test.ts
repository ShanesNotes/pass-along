import { describe, expect, test } from "vitest";
import { REQUEST_ID_HEADER } from "../../../../../../packages/engine/src/http/index";
import { POST } from "./route";

function passRequest(ip: string): Request {
  return new Request("http://localhost/api/pass", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip
    },
    body: JSON.stringify({
      providerId: "p1",
      story: "Someone helped me a lot with anxiety.",
      forWhom: ["myself"]
    })
  });
}

describe("POST /api/pass rate limiting", () => {
  test("echoes a request id and 429s a hammering client past the 5/min default", async () => {
    const ip = "203.0.113.42";
    const responses: Response[] = [];

    for (let i = 0; i < 8; i += 1) {
      responses.push(await POST(passRequest(ip)));
    }

    for (const response of responses) {
      expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    }

    const limited = responses.find((response) => response.status === 429);
    expect(limited).toBeDefined();
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    await expect(limited?.json()).resolves.toEqual({ error: "RATE_LIMITED" });
  });
});
