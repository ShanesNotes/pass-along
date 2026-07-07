import { afterEach, describe, expect, test, vi } from "vitest";
import { RERANK_PROMPT_ID, buildRerankCandidates, rerankCandidates } from "./index.js";
import type { Transport } from "../llm/adapter.js";
import type { RerankCandidate, UnderstoodQuery } from "../../../core/src/index.js";

const jsonResponse = (text: string) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }]
          }
        }
      ],
      usageMetadata: {
        promptTokenCount: 9,
        candidatesTokenCount: 7,
        totalTokenCount: 16
      }
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );

describe("rerankCandidates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("falls back to cosine order with keystone-span why when no model key is configured", async () => {
    const warn = vi.fn();
    const outcome = await rerankCandidates({
      understood: understoodFixture(),
      candidates: [
        candidate("provider_a", "provider_a:rec_1:keystone", "Keystone A"),
        candidate("provider_b", "provider_b:rec_2:keystone", "Keystone B")
      ],
      options: {
        env: {}
      },
      warn
    });

    expect(outcome.source).toBe("fallback");
    expect(outcome.results).toEqual([
      {
        id: "provider_a",
        score: 1,
        why: "Keystone A",
        cited_span_ids: ["provider_a:rec_1:keystone"]
      },
      {
        id: "provider_b",
        score: 0.99,
        why: "Keystone B",
        cited_span_ids: ["provider_b:rec_2:keystone"]
      }
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("retries once when the model response is not valid rerank JSON", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const transport = vi.fn<Transport>(async (url, init) => {
      requests.push({
        url: String(url),
        body: String(init?.body)
      });

      if (requests.length === 1) {
        return jsonResponse("not json");
      }

      return jsonResponse(
        JSON.stringify({
          results: [
            {
              id: "provider_b",
              score: 0.94,
              why: [
                {
                  text: "The snippet mentions evening CBT support.",
                  cited_span_ids: ["provider_b:rec_2:keystone"]
                }
              ]
            }
          ]
        })
      );
    });

    const outcome = await rerankCandidates({
      understood: understoodFixture(),
      candidates: [
        candidate("provider_a", "provider_a:rec_1:keystone", "Keystone A"),
        candidate(
          "provider_b",
          "provider_b:rec_2:keystone",
          "The recommender described evening CBT support."
        )
      ],
      options: {
        env: { GOOGLE_API_KEY: "test-google-key" },
        transport
      }
    });

    expect(outcome.source).toBe("model");
    expect(outcome.results[0]).toEqual({
      id: "provider_b",
      score: 0.94,
      why: "The snippet mentions evening CBT support.",
      cited_span_ids: ["provider_b:rec_2:keystone"]
    });
    expect(outcome.results[1]?.id).toBe("provider_a");
    expect(transport).toHaveBeenCalledTimes(2);
    expect(requests[0]?.url).toContain(":generateContent");
    expect(requests[1]?.body).toContain("previous response was invalid");
    expect(requests[0]?.body).toContain(RERANK_PROMPT_ID);
    expect(requests[0]?.body).not.toContain("raw query");
  });

  test("falls back without waiting past the rerank timeout", async () => {
    const transport: Transport = async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      });

    const outcome = await rerankCandidates({
      understood: understoodFixture(),
      candidates: [
        candidate("provider_a", "provider_a:rec_1:keystone", "Keystone A")
      ],
      options: {
        env: { GOOGLE_API_KEY: "test-google-key" },
        transport,
        timeoutMs: 5
      }
    });

    expect(outcome.source).toBe("fallback");
    expect(outcome.results[0]?.why).toBe("Keystone A");
  });

  test("uses a realistic default rerank timeout before falling back", async () => {
    const outcome = await runHangingRerankUntilTimeout({
      env: { GOOGLE_API_KEY: "test-google-key" },
      expectedTimeoutMs: 8_000
    });

    expect(outcome.source).toBe("fallback");
    expect(outcome.results[0]?.why).toBe("Keystone A");
  });

  test("respects RERANK_TIMEOUT_MS when it is configured", async () => {
    const outcome = await runHangingRerankUntilTimeout({
      env: {
        GOOGLE_API_KEY: "test-google-key",
        RERANK_TIMEOUT_MS: "1234"
      },
      expectedTimeoutMs: 1_234
    });

    expect(outcome.source).toBe("fallback");
    expect(outcome.results[0]?.why).toBe("Keystone A");
  });

  test("throws on malformed RERANK_TIMEOUT_MS values", async () => {
    await expect(
      rerankCandidates({
        understood: understoodFixture(),
        candidates: [
          candidate("provider_a", "provider_a:rec_1:keystone", "Keystone A")
        ],
        options: {
          env: {
            GOOGLE_API_KEY: "test-google-key",
            RERANK_TIMEOUT_MS: "1100ms"
          }
        }
      })
    ).rejects.toThrow(/RERANK_TIMEOUT_MS.*positive integer/u);
  });
});

describe("buildRerankCandidates", () => {
  test("creates provider candidates with real keystone and story span ids", () => {
    const candidates = buildRerankCandidates(
      [
        {
          score: 0.8,
          document: {
            recommendationId: "rec_1",
            providerId: "provider_a",
            providerName: "Provider A",
            credential: "LPC",
            loc: "Denver, CO",
            kind: "therapist",
            tags: ["anxiety"],
            keystone: "Keystone A",
            text: "Story A",
            verified: true
          }
        }
      ],
      {
        providers: [
          {
            id: "provider_a",
            name: "Provider A",
            credential: "LPC",
            kind: "therapist",
            loc: "Denver, CO",
            verified: true
          }
        ],
        recommendations: [
          {
            id: "rec_1",
            provider_id: "provider_a",
            kind: "therapist",
            tags: ["anxiety"],
            keystone: "Keystone A",
            story: "Story A"
          }
        ]
      }
    );

    expect(candidates).toEqual([
      {
        id: "provider_a",
        snippets: [
          {
            span_id: "provider_a:rec_1:keystone",
            text: "Keystone A"
          },
          {
            span_id: "provider_a:rec_1:story",
            text: "Story A"
          }
        ]
      }
    ]);
  });
});

function candidate(id: string, spanId: string, text: string): RerankCandidate {
  return {
    id,
    snippets: [
      {
        span_id: spanId,
        text
      }
    ]
  };
}

function understoodFixture(): UnderstoodQuery {
  return {
    issues: [{ value: "anxiety", vocab: true, confidence: 0.9 }],
    population: "teen",
    kind: "therapist",
    preferences: {
      modality: [{ value: "cbt", vocab: true, confidence: 0.8 }],
      logistics: ["evenings"]
    },
    location: { text: "Denver" },
    confidence: 0.85
  };
}

async function runHangingRerankUntilTimeout(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly expectedTimeoutMs: number;
}) {
  vi.useFakeTimers();

  const transport: Transport = async (_url, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true }
      );
    });
  const outcomePromise = rerankCandidates({
    understood: understoodFixture(),
    candidates: [
      candidate("provider_a", "provider_a:rec_1:keystone", "Keystone A")
    ],
    options: {
      env: input.env,
      transport
    }
  });
  let settled = false;
  void outcomePromise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );

  await vi.advanceTimersByTimeAsync(input.expectedTimeoutMs - 1);
  await Promise.resolve();
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);

  return await outcomePromise;
}
