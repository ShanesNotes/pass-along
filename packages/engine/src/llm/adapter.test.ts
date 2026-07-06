import { describe, expect, test, vi } from "vitest";
import {
  complete,
  LlmTimeoutError,
  MissingKeyError,
  type Transport
} from "./adapter.js";
import { PROMPT_ROUTING } from "./routing.js";

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });

describe("complete", () => {
  test("looks up provider, model, and params from routing.ts", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport: Transport = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        output_text: "{\"ok\":true}",
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          total_tokens: 18
        }
      });
    };

    const result = await complete("understand@1", "map this request", {
      env: { OPENAI_API_KEY: "test-openai-key" },
      transport,
      inference_geo: "us"
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe(PROMPT_ROUTING["understand@1"].model);
    expect(result.text).toBe("{\"ok\":true}");
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18
    });

    const body = JSON.parse(String(requests[0]?.init.body)) as {
      model: string;
      temperature: number;
      max_output_tokens: number;
      metadata: { inference_geo: string };
    };
    const headers = requests[0]?.init.headers as Record<string, string>;

    expect(requests[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(body.model).toBe(PROMPT_ROUTING["understand@1"].model);
    expect(body.temperature).toBe(0);
    expect(body.max_output_tokens).toBe(900);
    expect(body.metadata.inference_geo).toBe("us");
    expect(headers["x-pass-along-inference-geo"]).toBe("us");
  });

  test("throws a typed MissingKeyError before transport when env key is absent", async () => {
    const transport = vi.fn<Transport>();

    await expect(
      complete("crisis_gate@1", "classify", {
        env: {},
        transport
      })
    ).rejects.toMatchObject({
      name: "MissingKeyError",
      provider: "anthropic",
      envVar: "ANTHROPIC_API_KEY"
    } satisfies Partial<MissingKeyError>);

    expect(transport).not.toHaveBeenCalled();
  });

  test("retries 429 and 5xx responses with exponential backoff", async () => {
    const sleepCalls: number[] = [];
    const transport = vi
      .fn<Transport>()
      .mockResolvedValueOnce(new Response("rate limit", { status: 429 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({
          output_text: "done",
          usage: {
            input_tokens: 3,
            output_tokens: 2
          }
        })
      );

    const result = await complete("understand@1", "retry", {
      env: { OPENAI_API_KEY: "test-openai-key" },
      transport,
      backoffBaseMs: 10,
      maxRetries: 3,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    });

    expect(result.text).toBe("done");
    expect(transport).toHaveBeenCalledTimes(3);
    expect(sleepCalls).toEqual([10, 20]);
  });

  test("aborts the transport and throws a timeout error", async () => {
    let observedSignal: AbortSignal | undefined;
    const transport: Transport = async (_url, init) => {
      observedSignal = init?.signal ?? undefined;

      return await new Promise<Response>((resolve, reject) => {
        observedSignal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true }
        );
      });
    };

    await expect(
      complete("understand@1", "slow", {
        env: { OPENAI_API_KEY: "test-openai-key" },
        transport,
        timeoutMs: 5,
        maxRetries: 0
      })
    ).rejects.toBeInstanceOf(LlmTimeoutError);

    expect(observedSignal?.aborted).toBe(true);
  });

  test("normalizes anthropic token accounting", async () => {
    const result = await complete("crisis_gate@1", "classify", {
      env: { ANTHROPIC_API_KEY: "test-anthropic-key" },
      transport: async () =>
        jsonResponse({
          content: [{ type: "text", text: "{\"crisis\":false}" }],
          usage: {
            input_tokens: 19,
            output_tokens: 5
          }
        })
    });

    expect(result.provider).toBe("anthropic");
    expect(result.usage).toEqual({
      inputTokens: 19,
      outputTokens: 5,
      totalTokens: 24
    });
  });

  test("model swaps are isolated to one routing table entry", () => {
    expect(PROMPT_ROUTING["understand@1"]).toMatchObject({
      provider: "openai",
      model: expect.any(String),
      params: expect.any(Object)
    });
    expect(Object.keys(PROMPT_ROUTING["understand@1"]).sort()).toEqual([
      "model",
      "params",
      "provider"
    ]);
  });
});
