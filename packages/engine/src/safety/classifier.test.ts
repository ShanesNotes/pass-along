import { describe, expect, test, vi } from "vitest";
import {
  CRISIS_GATE_PROMPT_ID,
  safetyClassify
} from "./classifier.js";
import type { Transport } from "../llm/adapter.js";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

describe("safetyClassify", () => {
  test("skips tier 2 when the provider API key is absent", async () => {
    const transport = vi.fn<Transport>();

    await expect(
      safetyClassify("I do not see the point anymore.", {
        env: {},
        transport
      })
    ).resolves.toEqual({
      status: "skipped",
      promptId: CRISIS_GATE_PROMPT_ID,
      crisis: false,
      reason: "missing_api_key",
      missingEnvVar: "ANTHROPIC_API_KEY"
    });
    expect(transport).not.toHaveBeenCalled();
  });

  test("calls the LLM adapter route with injectable transport", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const transport: Transport = async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as unknown
      });

      return jsonResponse({
        content: [
          {
            type: "text",
            text: "{\"crisis\":true,\"reason\":\"active safety concern\"}"
          }
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 8
        }
      });
    };

    await expect(
      safetyClassify("I cannot stay safe tonight.", {
        env: { ANTHROPIC_API_KEY: "test-key" },
        transport
      })
    ).resolves.toMatchObject({
      status: "completed",
      promptId: CRISIS_GATE_PROMPT_ID,
      crisis: true,
      reason: "active safety concern",
      provider: "anthropic"
    });

    expect(requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.stringify(requests[0]?.body)).toContain(
      "classify_find_path_safety"
    );
  });

  test("fails closed on invalid classifier output", async () => {
    const transport: Transport = async () =>
      jsonResponse({
        content: [{ type: "text", text: "not json" }],
        usage: {
          input_tokens: 4,
          output_tokens: 2
        }
      });

    await expect(
      safetyClassify("ordinary search", {
        env: { ANTHROPIC_API_KEY: "test-key" },
        transport
      })
    ).resolves.toMatchObject({
      status: "failed_closed",
      crisis: true,
      reason: "classifier_error"
    });
  });
});
