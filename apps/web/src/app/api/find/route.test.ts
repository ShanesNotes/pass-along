import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
  createInMemoryVectorStoreFromCorpus,
  loadFixtureCorpus
} from "../../../../../../packages/engine/src/retrieval/index.js";
import { embedTextDevOnly } from "../../../../../../packages/engine/src/llm/embed.js";
import type { Transport } from "../../../../../../packages/engine/src/llm/adapter.js";
import type { SafetyGateResult } from "../../../../../../packages/engine/src/safety/index.js";
import {
  EventCatalogSchema,
  type UnderstoodQuery
} from "../../../../../../packages/core/src/index.js";
import {
  understandQuery,
  type UnderstandQueryResult
} from "../../../../../../packages/engine/src/understand/index.js";
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
    expect(harness.understandInputs).toEqual([]);
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
      understood: UnderstoodQuery;
      source: string;
      rerank_source: string;
      results: Array<{
        name: string;
        why: string | null;
        cited_span_ids: readonly string[];
        license_check?: {
          status: string;
          source: string;
          checked_at: string;
        };
        verified?: boolean;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe("fallback");
    expect(body.rerank_source).toBe("fallback");
    expect(body.understood).toMatchObject({
      kind: "therapist",
      location: {
        text: "Denver"
      }
    });
    expect(body.results[0]).toMatchObject({
      name: "North Star Teen Therapy",
      why: "The first plan for teen anxiety that worked after school instead of only in the office.",
      cited_span_ids: ["provider_teen_denver:rec_001:keystone"],
      license_check: {
        status: "verified",
        source: "Colorado DORA cassette",
        checked_at: "2026-06-18T10:00:00.000Z"
      }
    });
    expect(body.results.some((result) => "verified" in result)).toBe(false);

    expect(harness.events).toHaveLength(1);
    const parsedEvent = EventCatalogSchema.parse(harness.events[0]);
    if (parsedEvent.type !== "find.performed") {
      throw new Error("Expected find.performed event");
    }
    expect(parsedEvent).toMatchObject({
      type: "find.performed",
      payload: {
        query_hash_sha256: sha256(text),
        result_count: body.results.length,
        latency_ms: 15,
        rerank_source: "fallback",
        understood_json: {
          kind: "therapist",
          location: {
            text: "Denver"
          },
          issues: [{ value: "anxiety" }]
        }
      }
    });
    expect(harness.queryRows).toEqual([
      {
        query_hash: sha256(text),
        understood: parsedEvent.payload.understood_json
      }
    ]);
    expect(harness.embedInputs).toEqual([text]);
    expect(harness.understandInputs).toEqual([text]);
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

  test("returns closest matches with unmet:true for a realistic sentence the tag filter would otherwise zero out", async () => {
    const harness = await createHarness(
      {
        ANTHROPIC_API_KEY: undefined
      },
      {
        safetyGate: nonDegradedSafetyGate
      }
    );
    const text =
      "Looking for someone to help with my teenage daughter's anxiety, evenings, we have insurance";
    const response = await harness.post({ text });
    const body = (await response.json()) as {
      understood: UnderstoodQuery;
      unmet: boolean;
      results: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.understood.issues.map((issue) => issue.value)).toContain(
      "anxiety"
    );
    expect(body.results.length).toBeGreaterThanOrEqual(3);
    expect(body.results.map((result) => result.id)).toContain(
      "provider_teen_denver"
    );
  });

  test("marks the response unmet:true only when it is carrying nonempty closest-match results", async () => {
    const harness = await createHarness(
      {
        ANTHROPIC_API_KEY: undefined
      },
      {
        safetyGate: nonDegradedSafetyGate
      }
    );
    const text = "chronic pain support near Detroit, we have insurance";
    const response = await harness.post({ text });
    const body = (await response.json()) as {
      understood: UnderstoodQuery;
      unmet: boolean;
      results: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.unmet).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
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

  test("warns and annotates the find event when understand falls back after a model error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const text = "Looking for teen anxiety CBT in Denver";
    const transport = vi.fn<Transport>(async () => {
      const error = new TypeError(`transport failed for ${text}`);
      throw error;
    });

    try {
      const harness = await createHarness(
        {
          ANTHROPIC_API_KEY: undefined,
          GEMINI_API_KEY: "test-gemini-key"
        },
        {
          safetyGate: nonDegradedSafetyGate,
          understand: (input) =>
            understandQuery(input, {
              env: { ...process.env, GEMINI_API_KEY: "test-gemini-key" },
              transport,
              maxRetries: 0
            })
        }
      );
      await harness.post({
        text,
        kind: "therapist",
        location: "Denver"
      });

      expect(warn).toHaveBeenCalledWith("find.understand_degraded", {
        reason: "TypeError"
      });
      const parsedEvent = EventCatalogSchema.parse(harness.events[0]);
      expect(parsedEvent).toMatchObject({
        type: "find.performed",
        payload: {
          understood_source: "fallback"
        }
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(text);
      expect(JSON.stringify(harness.events)).not.toContain(text);
    } finally {
      warn.mockRestore();
    }
  });

  test("starts understanding and embedding in parallel after the safety gate clears", async () => {
    const starts: string[] = [];
    let resolveUnderstanding:
      | ((result: UnderstandQueryResult) => void)
      | undefined;
    let resolveEmbedding:
      | ((result: Awaited<ReturnType<typeof embedForText>>) => void)
      | undefined;
    const understandingPromise = new Promise<UnderstandQueryResult>((resolve) => {
      resolveUnderstanding = resolve;
    });
    const embeddingPromise = new Promise<Awaited<ReturnType<typeof embedForText>>>(
      (resolve) => {
        resolveEmbedding = resolve;
      }
    );
    const harness = await createHarness(
      {
        ANTHROPIC_API_KEY: undefined
      },
      {
        safetyGate: nonDegradedSafetyGate,
        understand: async () => {
          starts.push("understand");
          return understandingPromise;
        },
        embed: async (text) => {
          starts.push("embed");
          return embeddingPromise.then(() => embedForText(text));
        }
      }
    );
    const responsePromise = harness.post({
      text: "Looking for teen anxiety CBT in Denver"
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts.sort()).toEqual(["embed", "understand"]);

    resolveUnderstanding?.({
      understood: understoodFixture({
        issues: [{ value: "anxiety", vocab: true, confidence: 0.9 }],
        population: "teen",
        confidence: 0.8
      }),
      source: "model"
    });
    resolveEmbedding?.(embedForText("Looking for teen anxiety CBT in Denver"));

    const response = await responsePromise;
    expect(response.status).toBe(200);
  });

  test("returns clarify chips instead of results when understanding is low-confidence", async () => {
    const text = "help";
    const lowConfidence = understoodFixture({
      issues: [],
      kind: "either",
      confidence: 0.35
    });
    const harness = await createHarness(
      {
        ANTHROPIC_API_KEY: undefined
      },
      {
        safetyGate: nonDegradedSafetyGate,
        understand: async () => ({
          understood: lowConfidence,
          source: "fallback"
        })
      }
    );

    const response = await harness.post({ text });
    const body = (await response.json()) as {
      understood: UnderstoodQuery;
      source: string;
      clarify: { question: string; chips: string[] };
      results?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.results).toBeUndefined();
    expect(body.understood.confidence).toBeLessThan(0.55);
    expect(body.source).toBe("fallback");
    expect(body.clarify.question).toContain("What kind of support");
    expect(body.clarify.chips).toEqual([
      "anxiety",
      "depression",
      "trauma_ptsd",
      "relationship_issues"
    ]);
    expect(harness.events[0]?.payload).toMatchObject({
      query_hash_sha256: sha256(text),
      result_count: 0,
      understood_json: lowConfidence
    });
    expect(JSON.stringify(harness.events)).not.toContain(text);
    expect(JSON.stringify(harness.queryRows)).not.toContain(text);
  });

  test("omits the license badge check for providers without a check row", async () => {
    const harness = await createHarness(
      {
        ANTHROPIC_API_KEY: undefined
      },
      {
        safetyGate: nonDegradedSafetyGate
      }
    );
    const text = "chronic pain support near Detroit, we have insurance";
    const response = await harness.post({ text });
    const body = (await response.json()) as {
      results: Array<{
        id: string;
        license_check?: unknown;
        verified?: boolean;
      }>;
    };
    const result = body.results.find(
      (entry) => entry.id === "provider_pain_detroit"
    );

    expect(response.status).toBe(200);
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("license_check");
    expect(body.results.some((entry) => "verified" in entry)).toBe(false);
  });
});

async function createHarness(
  env: Record<string, string | undefined>,
  options: {
    readonly safetyGate?: (
      text: string
    ) => Promise<SafetyGateResult>;
    readonly understand?: (text: string) => Promise<UnderstandQueryResult>;
    readonly embed?: (text: string) => Promise<{
      readonly vector: readonly number[];
      readonly metadata: ReturnType<typeof embedTextDevOnly>["metadata"];
    }>;
  } = {}
) {
  const corpus = loadFixtureCorpus();
  const embedInputs: string[] = [];
  const embedForHarness = async (text: string) => {
    embedInputs.push(text);
    return options.embed?.(text) ?? embedForText(text);
  };
  const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) =>
    embedForText(text)
  );
  embedInputs.length = 0;
  const understandInputs: string[] = [];
  const understand = async (text: string) => {
    understandInputs.push(text);

    if (options.understand) {
      return options.understand(text);
    }

    return {
      understood: understoodFixture({
        issues: [
          ...(text.toLowerCase().includes("anxiety")
            ? [{ value: "anxiety", vocab: true, confidence: 0.8 }]
            : []),
          ...(text.toLowerCase().includes("chronic pain")
            ? [{ value: "chronic_pain", vocab: true, confidence: 0.8 }]
            : [])
        ],
        population: text.toLowerCase().includes("teen") ? "teen" : undefined,
        location: text.toLowerCase().includes("denver")
          ? { text: "Denver" }
          : undefined,
        preferences: text.toLowerCase().includes("cbt")
          ? {
              modality: [{ value: "cbt", vocab: true, confidence: 0.8 }]
            }
          : {}
      }),
      source: "fallback" as const
    };
  };
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
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      ...env
    },
    corpus,
    store,
    embed: embedForHarness,
    understand,
    events: eventPort,
    queries: queryPort,
    ...(options.safetyGate ? { safetyGate: options.safetyGate } : {}),
    now: clock([100, 115])
  });

  return {
    events,
    embedInputs,
    understandInputs,
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

function embedForText(text: string) {
  const embedding = embedTextDevOnly(text);
  return { vector: embedding.vector, metadata: embedding.metadata };
}

function understoodFixture(
  overrides: Partial<UnderstoodQuery> = {}
): UnderstoodQuery {
  return {
    issues: [],
    kind: "therapist",
    preferences: {},
    confidence: 0.8,
    ...overrides
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
