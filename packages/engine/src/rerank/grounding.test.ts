import { describe, expect, test, vi } from "vitest";
import { validateGroundedRerankResult } from "./grounding.js";
import type {
  RerankCandidate,
  RerankModelOutput
} from "../../../core/src/index.js";

describe("validateGroundedRerankResult", () => {
  test("drops why sentences that cite fabricated spans", () => {
    const warn = vi.fn();
    const result = validateGroundedRerankResult({
      candidates: [candidate("provider_1", ["provider_1:rec_1:keystone"])],
      output: {
        results: [
          {
            id: "provider_1",
            score: 0.91,
            why: [
              {
                text: "This sentence points at a span the candidate never supplied.",
                cited_span_ids: ["provider_1:rec_fake:keystone"]
              },
              {
                text: "This sentence cites a real candidate span.",
                cited_span_ids: ["provider_1:rec_1:keystone"]
              }
            ]
          }
        ]
      },
      warn
    });

    expect(result.dropped_why_count).toBe(1);
    expect(result.results).toEqual([
      {
        id: "provider_1",
        score: 0.91,
        why: "This sentence cites a real candidate span.",
        cited_span_ids: ["provider_1:rec_1:keystone"]
      }
    ]);
    expect(warn).toHaveBeenCalledWith("find.rerank_grounding_dropped", {
      dropped_why_count: 1,
      dropped_result_count: 0,
      unknown_candidate_count: 0
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("rec_fake");
  });

  test("drops fabricated why claims even when they cite a real span id", () => {
    const warn = vi.fn();
    const result = validateGroundedRerankResult({
      candidates: [
        {
          id: "provider_1",
          snippets: [
            {
              span_id: "provider_1:rec_1:keystone",
              text:
                "CBT practice on the bus helped panic spikes after school."
            }
          ]
        }
      ],
      output: {
        results: [
          {
            id: "provider_1",
            score: 0.91,
            why: [
              {
                text: "They offer a 30-day money-back guarantee.",
                cited_span_ids: ["provider_1:rec_1:keystone"]
              }
            ]
          }
        ]
      },
      warn
    });

    expect(result.dropped_why_count).toBe(1);
    expect(result.results).toEqual([
      {
        id: "provider_1",
        score: 0.91,
        why: null,
        cited_span_ids: []
      }
    ]);
    expect(warn).toHaveBeenCalledWith("find.rerank_grounding_dropped", {
      dropped_why_count: 1,
      dropped_result_count: 0,
      unknown_candidate_count: 0
    });
  });

  test("never lets randomly fabricated cited span ids through", () => {
    const realSpanId = "provider_1:rec_1:keystone";
    const candidates = [candidate("provider_1", [realSpanId])];

    for (let index = 0; index < 100; index += 1) {
      const fabricatedSpanId = `provider_1:rec_fake_${index}:story`;
      const result = validateGroundedRerankResult({
        candidates,
        output: {
          results: [
            {
              id: "provider_1",
              score: 0.8,
              why: [
                {
                  text: `Fabricated claim ${index}`,
                  cited_span_ids: [fabricatedSpanId]
                }
              ]
            }
          ]
        }
      });

      expect(result.results[0]?.why).toBeNull();
      expect(result.results[0]?.cited_span_ids).toEqual([]);
    }
  });

  test("drops whole rerank entries whose candidate id was not in the input", () => {
    const result = validateGroundedRerankResult({
      candidates: [candidate("provider_1", ["provider_1:rec_1:keystone"])],
      output: {
        results: [
          {
            id: "provider_fake",
            score: 0.99,
            why: [
              {
                text: "A fabricated candidate should not survive.",
                cited_span_ids: ["provider_fake:rec_1:keystone"]
              }
            ]
          }
        ]
      }
    });

    expect(result.results).toEqual([]);
    expect(result.unknown_candidate_count).toBe(1);
  });
});

function candidate(id: string, spanIds: readonly string[]): RerankCandidate {
  return {
    id,
    snippets: spanIds.map((spanId) => ({
      span_id: spanId,
      text: `This real candidate span has grounded text for ${spanId}`
    }))
  };
}

const _schemaShape: RerankModelOutput = {
  results: []
};

void _schemaShape;
