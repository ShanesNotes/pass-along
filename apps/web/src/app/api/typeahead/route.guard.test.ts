import { describe, expect, test } from "vitest";
import { REQUEST_ID_HEADER } from "../../../../../../packages/engine/src/http/index";
import { POST } from "./route";

function typeaheadRequest(ip: string): Request {
  return new Request("http://localhost/api/typeahead", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip
    },
    body: JSON.stringify({ q: "juniper" })
  });
}

describe("POST /api/typeahead rate limiting", () => {
  test("echoes a request id and 429s a hammering client past the 60/min default", async () => {
    const ip = "203.0.113.7";
    const responses: Response[] = [];

    for (let i = 0; i < 61; i += 1) {
      responses.push(await POST(typeaheadRequest(ip)));
    }

    for (const response of responses) {
      expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    }

    const limited = responses.find((response) => response.status === 429);
    expect(limited).toBeDefined();
    expect(limited?.headers.get("retry-after")).toBeTruthy();
  });
});
