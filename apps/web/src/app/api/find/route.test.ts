import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
  createInMemoryVectorStoreFromCorpus,
  loadFixtureCorpus
} from "../../../../../../packages/engine/src/retrieval/index.js";
import { embedTextDevOnly } from "../../../../../../packages/engine/src/llm/embed.js";
import type { SafetyGateResult } from "../../../../../../packages/engine/src/safety/index.js";
import { EventCatalogSchema } from "../../../../../../packages/core/src/index.js";
import {
  createFindPostHandler,
  defaultFindRouteDeps,
  sha256,
  type FindEventsPort,
  type FindPerformedEvent,
  type QueryAuditPort,
  type QueryAuditRow
} from "./deps";

describe("POST /api/find", () => {
  test("default deps initialize from the web app cwd", async () => {
    const originalCwd = process.cwd();
    const webAppDir = fileURLToPath(new URL("../../../../", import.meta.url));

    try {
      process.chdir(webAppDir);
      const deps = await defaultFindRouteDeps();

      expect(deps.corpus.recommendations.length).toBeGreaterThan(0);
      await expect(
        deps.store.search({
          vector: (await deps.embed("teen anxiety CBT in Denver")).vector,
          topN: 1
        })
      ).resolves.toHaveLength(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

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
    const harness = await createHarness(
      {
        ANTHROPIC_API_KEY: undefined
      },
      {
        safetyGate: nonDegradedSafetyGate
      }
    );
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

    expect(harness.events).toHaveLength(1);
    const parsedEvent = EventCatalogSchema.parse(harness.events[0]);
    expect(parsedEvent).toMatchObject({
      type: "find.performed",
      payload: {
        query_hash_sha256: sha256(text),
        result_count: body.results.length,
        latency_ms: 15,
        understood_json: {
          kind: "therapist",
          location: {
            text: "Denver"
          }
        }
      }
    });
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
      const harness = await createHarness(
        {
          ANTHROPIC_API_KEY: undefined
        },
        {
          safetyGate: nonDegradedSafetyGate
        }
      );
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

  test("warns and annotates the find event when the safety gate is degraded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const text = "Looking for teen anxiety CBT in Denver";

    try {
      const harness = await createHarness(
        {
          ANTHROPIC_API_KEY: undefined
        },
        {
          safetyGate: async () => ({
            crisis: false,
            degraded: true,
            tier1: {
              triggered: false,
              matches: []
            },
            tier2: {
              status: "skipped",
              promptId: "crisis_gate@1",
              crisis: false,
              reason: "missing_api_key",
              missingEnvVar: "ANTHROPIC_API_KEY"
            }
          })
        }
      );
      await harness.post({
        text,
        kind: "therapist",
        location: "Denver"
      });

      expect(warn).toHaveBeenCalledWith("find.safety_gate_degraded", {
        reason: "missing_api_key"
      });
      const parsedEvent = EventCatalogSchema.parse(harness.events[0]);
      expect(parsedEvent).toMatchObject({
        type: "find.performed",
        payload: {
          degraded: true
        }
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(text);
    } finally {
      warn.mockRestore();
    }
  });
});

async function createHarness(
  env: Record<string, string | undefined>,
  options: {
    readonly safetyGate?: (
      text: string
    ) => Promise<SafetyGateResult>;
  } = {}
) {
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
    ...(options.safetyGate ? { safetyGate: options.safetyGate } : {}),
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

async function nonDegradedSafetyGate(): Promise<SafetyGateResult> {
  return {
    crisis: false,
    degraded: false,
    tier1: {
      triggered: false,
      matches: []
    },
    tier2: {
      status: "completed",
      promptId: "crisis_gate@1",
      crisis: false,
      reason: "no safety signal",
      provider: "anthropic",
      model: "test-model"
    }
  };
}
