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
  test("crisis path returns support response and stores nothing", async () => {
    const harness = await createHarness({
      ANTHROPIC_API_KEY: undefined
    });
    const response = await harness.post({
      text: "I do not see the point anymore.",
      location: "Denver"
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      crisis: true,
      support: {
        lifeline: "988",
        message: "Nothing was stored."
      }
    });
    expect(harness.events).toEqual([]);
    expect(harness.queryRows).toEqual([]);
    expect(harness.embedInputs).toEqual([]);
  });

  test("happy path emits hash-only find event and cards", async () => {
    const harness = await createHarness({
      ANTHROPIC_API_KEY: undefined
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
    expect(harness.embedInputs).toEqual([text]);
    expect(JSON.stringify(harness.events)).not.toContain(text);
    expect(JSON.stringify(harness.queryRows)).not.toContain(text);
  });

  test("logs nothing on the dev happy path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const harness = await createHarness({
        ANTHROPIC_API_KEY: undefined
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
  const embedInputs: string[] = [];
  const embed = async (text: string) => {
    embedInputs.push(text);
    const embedding = embedTextDevOnly(text);
    return { vector: embedding.vector, metadata: embedding.metadata };
  };
  const store = await createInMemoryVectorStoreFromCorpus(corpus, embed);
  embedInputs.length = 0;
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
    env: { ...process.env, ANTHROPIC_API_KEY: undefined, ...env },
    corpus,
    store,
    embed,
    events: eventPort,
    queries: queryPort,
    now: clock([100, 115])
  });

  return {
    events,
    embedInputs,
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
