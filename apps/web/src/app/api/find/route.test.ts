import { describe, expect, test, vi } from "vitest";
import {
  createInMemoryVectorStoreFromCorpus,
  loadFixtureCorpus
} from "../../../../../../packages/engine/src/retrieval/index.js";
import { embedTextDevOnly } from "../../../../../../packages/engine/src/llm/embed.js";
import {
  createFindPostHandler,
  sha256,
  type FindEventsPort,
  type FindPerformedEvent,
  type QueryAuditPort,
  type QueryAuditRow
} from "./route.js";

describe("POST /api/find", () => {
  test("returns 503 by default until PA-008 installs the safety gate", async () => {
    const harness = await createHarness({});
    const response = await harness.post({
      text: "teen anxiety in Denver",
      location: "Denver"
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "UNAVAILABLE_PENDING_SAFETY_GATE"
    });
    expect(harness.events).toEqual([]);
    expect(harness.queryRows).toEqual([]);
  });

  test("happy path emits hash-only find event and cards under dev escape hatch", async () => {
    const harness = await createHarness({
      FIND_SAFETY_GATE_DISABLED_I_UNDERSTAND: "1"
    });
    const text = "Looking for teen anxiety CBT in Denver";
    const response = await harness.post({
      text,
      kind: "therapist",
      location: "Denver"
    });
    const body = (await response.json()) as {
      understood: null;
      results: Array<{ name: string; why: null }>;
    };

    expect(response.status).toBe(200);
    expect(body.understood).toBeNull();
    expect(body.results[0]).toMatchObject({
      name: "North Star Teen Therapy",
      why: null
    });

    expect(harness.events).toEqual([
      {
        type: "find.performed",
        payload: {
          understood: null,
          query_hash: sha256(text),
          result_count: body.results.length,
          latency_ms: 15
        }
      }
    ]);
    expect(harness.queryRows).toEqual([
      {
        query_hash: sha256(text),
        understood: null
      }
    ]);
    expect(JSON.stringify(harness.events)).not.toContain(text);
    expect(JSON.stringify(harness.queryRows)).not.toContain(text);
  });

  test("logs nothing on the dev happy path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const harness = await createHarness({
        FIND_SAFETY_GATE_DISABLED_I_UNDERSTAND: "1"
      });
      await harness.post({
        text: "adult ADHD medication management in Denver",
        kind: "therapist",
        location: "Denver"
      });

      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

async function createHarness(env: Record<string, string | undefined>) {
  const corpus = loadFixtureCorpus();
  const embed = async (text: string) => {
    const embedding = embedTextDevOnly(text);
    return { vector: embedding.vector, metadata: embedding.metadata };
  };
  const store = await createInMemoryVectorStoreFromCorpus(corpus, embed);
  const events: FindPerformedEvent[] = [];
  const queryRows: QueryAuditRow[] = [];
  const eventPort: FindEventsPort = {
    async emit(event) {
      events.push(event);
    }
  };
  const queryPort: QueryAuditPort = {
    async upsert(row) {
      queryRows.push(row);
    }
  };
  const handler = createFindPostHandler({
    env: { ...process.env, ...env },
    corpus,
    store,
    embed,
    events: eventPort,
    queries: queryPort,
    now: clock([100, 115])
  });

  return {
    events,
    queryRows,
    async post(body: unknown) {
      return handler(
        new Request("http://localhost/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
      );
    }
  };
}

function clock(values: readonly number[]) {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
}
