import { describe, expect, test } from "vitest";
import { REQUEST_ID_HEADER } from "../../../../../../packages/engine/src/http/index";
import {
  createDataRightsPostHandler,
  createInMemoryDataRightsStore
} from "./deps";
import { POST } from "./route";

function request(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://localhost/api/data-rights", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body)
  });
}

describe("POST /api/data-rights", () => {
  test("stores a pending deletion request by recommendation id", async () => {
    const store = createInMemoryDataRightsStore();
    const handler = createDataRightsPostHandler({
      store,
      now: () => new Date("2026-07-07T00:00:00.000Z")
    });

    const response = await handler(
      request({ kind: "deletion_request", recommendation_id: "rec_1" })
    );
    const body = (await response.json()) as {
      readonly request_id: string;
      readonly status: string;
    };

    expect(response.status).toBe(201);
    expect(body.status).toBe("pending");
    expect(typeof body.request_id).toBe("string");
  });

  test("stores a pending deletion request by contact alone", async () => {
    const store = createInMemoryDataRightsStore();
    const handler = createDataRightsPostHandler({ store });

    const response = await handler(
      request({ kind: "deletion_request", contact: "someone@example.com" })
    );

    expect(response.status).toBe(201);
  });

  test("rejects a request with no recommendation id and no contact", async () => {
    const store = createInMemoryDataRightsStore();
    const handler = createDataRightsPostHandler({ store });

    const response = await handler(request({ kind: "deletion_request" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_DATA_RIGHTS_REQUEST"
    });
  });

  test("rejects an unsupported kind", async () => {
    const store = createInMemoryDataRightsStore();
    const handler = createDataRightsPostHandler({ store });

    const response = await handler(
      request({ kind: "access_request", contact: "a@b.com" })
    );

    expect(response.status).toBe(400);
  });

  test("stores nothing beyond what the requester explicitly submitted", async () => {
    const calls: unknown[] = [];
    const spyStore = {
      async insertRequest(input: Parameters<
        ReturnType<typeof createInMemoryDataRightsStore>["insertRequest"]
      >[0]) {
        calls.push(input);
        return createInMemoryDataRightsStore().insertRequest(input);
      }
    };
    const handler = createDataRightsPostHandler({
      store: spyStore,
      now: () => new Date("2026-07-07T00:00:00.000Z")
    });

    await handler(
      request({
        kind: "deletion_request",
        recommendation_id: "rec_1",
        contact: "a@b.com",
        extraField: "should never reach storage"
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: "deletion_request",
      recommendationId: "rec_1",
      contact: "a@b.com",
      now: new Date("2026-07-07T00:00:00.000Z")
    });
  });
});

describe("POST /api/data-rights rate limiting", () => {
  test("echoes a request id and 429s a hammering client past the 5/min default", async () => {
    const ip = "203.0.113.99";
    const responses: Response[] = [];

    for (let i = 0; i < 8; i += 1) {
      responses.push(
        await POST(request({ kind: "deletion_request", contact: "a@b.com" }, ip))
      );
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
