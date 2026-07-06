import { describe, expect, test, vi } from "vitest";
import type { Transport } from "../llm/adapter.js";
import {
  UNDERSTAND_PROMPT_ID,
  fallbackUnderstandQuery,
  understandQuery
} from "./index.js";

const validUnderstood = {
  issues: [{ value: "anxiety", vocab: true, confidence: 0.91 }],
  population: "teen",
  kind: "therapist",
  preferences: {
    modality: [{ value: "cbt", vocab: true, confidence: 0.88 }],
    logistics: ["evenings"]
  },
  location: { text: "Denver" },
  confidence: 0.87
};

describe("understandQuery", () => {
  test("does not read prompt files on the model runtime path", async () => {
    vi.resetModules();
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() => {
        throw new Error("runtime fs read forbidden");
      })
    }));

    try {
      const { understandQuery: fsFreeUnderstandQuery } = await import(
        "./index.js"
      );
      const transport = vi.fn<Transport>(async () =>
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(validUnderstood) }]
              }
            }
          ]
        })
      );

      const result = await fsFreeUnderstandQuery("teen anxiety CBT in Denver", {
        env: { GEMINI_API_KEY: "test-gemini-key" },
        transport
      });

      expect(result.source).toBe("model");
      expect(result.understood).toEqual(validUnderstood);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });

  test("uses the model route and validates strict UnderstoodQuery JSON", async () => {
    const transport = vi.fn<Transport>(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(validUnderstood) }]
            }
          }
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 8,
          totalTokenCount: 20
        }
      })
    );

    const result = await understandQuery("teen anxiety CBT in Denver", {
      env: { GEMINI_API_KEY: "test-gemini-key" },
      transport
    });

    expect(result).toEqual({
      understood: validUnderstood,
      source: "model"
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]?.[0])).toContain(
      "/models/gemini-3.1-flash-lite:generateContent"
    );
    expect(String(transport.mock.calls[0]?.[0])).toContain(
      "key=test-gemini-key"
    );
    const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body)) as {
      generationConfig: { temperature: number };
      systemInstruction: { parts: Array<{ text: string }> };
    };
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.systemInstruction.parts[0]?.text).toContain(
      UNDERSTAND_PROMPT_ID
    );
  });

  test("retries once when the model response is not schema-valid JSON", async () => {
    const transport = vi
      .fn<Transport>()
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: "issues: anxiety" }]
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(validUnderstood) }]
              }
            }
          ]
        })
      );

    const result = await understandQuery("teen anxiety CBT in Denver", {
      env: { GOOGLE_API_KEY: "test-google-key" },
      transport
    });

    expect(result.source).toBe("model");
    expect(result.understood.issues[0]?.value).toBe("anxiety");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test("falls back deterministically when the key is missing", async () => {
    const transport = vi.fn<Transport>();

    const result = await understandQuery(
      "Sliding scale telehealth therapist for my husband, an adult, near Austin",
      {
        env: {},
        transport
      }
    );

    expect(result.source).toBe("fallback");
    expect(result.understood).toMatchObject({
      population: "adult",
      kind: "therapist",
      preferences: {
        logistics: ["telehealth", "sliding_scale"]
      },
      location: {
        text: "Austin"
      }
    });
    expect(transport).not.toHaveBeenCalled();
  });

  test("falls back after two parse failures", async () => {
    const transport = vi.fn<Transport>(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: "{\"issues\":[\"anxiety\"]}" }]
            }
          }
        ]
      })
    );

    const result = await understandQuery("anxiety in Chicago", {
      env: { GEMINI_API_KEY: "test-gemini-key" },
      transport
    });

    expect(result.source).toBe("fallback");
    expect(result.understood.issues.map((issue) => issue.value)).toContain(
      "anxiety"
    );
    expect(result.understood.location?.text).toBe("Chicago");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("fallbackUnderstandQuery", () => {
  test("ports the display heuristic to the server-side schema shape", () => {
    const understood = fallbackUnderstandQuery(
      "Looking for someone for my teenager's anxiety, ideally evening appointments"
    );

    expect(understood).toMatchObject({
      population: "teen",
      kind: "therapist",
      preferences: {
        logistics: ["evenings"]
      }
    });
    expect(understood.issues.map((issue) => issue.value)).toContain("anxiety");
    expect(understood.confidence).toBeGreaterThanOrEqual(0.55);
  });

  test("keeps vague inputs below the clarify threshold", () => {
    expect(fallbackUnderstandQuery("help").confidence).toBeLessThan(0.55);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
