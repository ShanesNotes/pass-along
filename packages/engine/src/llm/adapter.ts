import {
  getPromptRoute,
  type LlmProvider,
  type PromptRoute
} from "./routing.js";

export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type CompletionInput =
  | string
  | {
      system?: string;
      messages: readonly LlmMessage[];
    };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CompletionResult = {
  promptId: string;
  provider: LlmProvider;
  model: string;
  text: string;
  usage: TokenUsage;
};

export type Transport = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;

export type CompleteOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  inference_geo?: string;
  transport?: Transport;
  sleep?: SleepFn;
  env?: NodeJS.ProcessEnv;
};

type NormalizedInput = {
  system?: string;
  messages: readonly LlmMessage[];
};

type ProviderRequest = {
  url: string;
  init: RequestInit;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 250;

export async function complete(
  promptId: string,
  input: CompletionInput,
  opts: CompleteOptions = {}
): Promise<CompletionResult> {
  const route = getPromptRoute(promptId);
  const env = opts.env ?? process.env;
  const apiKey = readApiKey(route.provider, env);
  const normalizedInput = normalizeInput(input);
  const transport = opts.transport ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoffBaseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const providerOptions =
        opts.inference_geo === undefined
          ? { signal: controller.signal }
          : {
              signal: controller.signal,
              inference_geo: opts.inference_geo
            };
      const request = buildProviderRequest(
        route,
        normalizedInput,
        apiKey,
        providerOptions
      );
      const response = await transport(request.url, request.init);

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        await sleep(backoffBaseMs * 2 ** attempt, controller.signal);
        continue;
      }

      if (!response.ok) {
        throw new ProviderHttpError(
          route.provider,
          response.status,
          await safeResponseText(response)
        );
      }

      const payload = (await response.json()) as unknown;
      return normalizeProviderResponse(promptId, route, payload);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LlmTimeoutError(promptId, timeoutMs);
      }

      if (attempt < maxRetries && isRetryableError(error)) {
        await sleep(backoffBaseMs * 2 ** attempt, controller.signal);
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("unreachable retry state");
}

function readApiKey(
  provider: LlmProvider,
  env: NodeJS.ProcessEnv
): string {
  const envVar = apiKeyEnvVar(provider);
  const value = env[envVar];

  if (!value) {
    throw new MissingKeyError(provider, envVar);
  }

  return value;
}

function apiKeyEnvVar(provider: LlmProvider): string {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
  }
}

function normalizeInput(input: CompletionInput): NormalizedInput {
  if (typeof input === "string") {
    return {
      messages: [{ role: "user", content: input }]
    };
  }

  return input;
}

function buildProviderRequest(
  route: PromptRoute,
  input: NormalizedInput,
  apiKey: string,
  opts: {
    signal: AbortSignal;
    inference_geo?: string;
  }
): ProviderRequest {
  switch (route.provider) {
    case "anthropic":
      return buildAnthropicRequest(route, input, apiKey, opts);
    case "openai":
      return buildOpenAiRequest(route, input, apiKey, opts);
    case "google":
      return buildGoogleRequest(route, input, apiKey, opts);
  }
}

function buildOpenAiRequest(
  route: PromptRoute,
  input: NormalizedInput,
  apiKey: string,
  opts: {
    signal: AbortSignal;
    inference_geo?: string;
  }
): ProviderRequest {
  return {
    url: "https://api.openai.com/v1/responses",
    init: {
      method: "POST",
      signal: opts.signal,
      headers: providerHeaders(
        {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        opts.inference_geo
      ),
      body: JSON.stringify({
        model: route.model,
        input: openAiMessages(input),
        temperature: route.params.temperature,
        max_output_tokens: route.params.maxTokens,
        top_p: route.params.topP,
        metadata: metadata(opts.inference_geo)
      })
    }
  };
}

function buildAnthropicRequest(
  route: PromptRoute,
  input: NormalizedInput,
  apiKey: string,
  opts: {
    signal: AbortSignal;
    inference_geo?: string;
  }
): ProviderRequest {
  const system = anthropicSystem(input);

  return {
    url: "https://api.anthropic.com/v1/messages",
    init: {
      method: "POST",
      signal: opts.signal,
      headers: providerHeaders(
        {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": apiKey
        },
        opts.inference_geo
      ),
      body: JSON.stringify({
        model: route.model,
        max_tokens: route.params.maxTokens ?? 1024,
        temperature: route.params.temperature,
        top_p: route.params.topP,
        system,
        messages: input.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role,
            content: message.content
          })),
        metadata: metadata(opts.inference_geo)
      })
    }
  };
}

function buildGoogleRequest(
  route: PromptRoute,
  input: NormalizedInput,
  apiKey: string,
  opts: {
    signal: AbortSignal;
    inference_geo?: string;
  }
): ProviderRequest {
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${route.model}:generateContent`
  );
  url.searchParams.set("key", apiKey);

  return {
    url: url.toString(),
    init: {
      method: "POST",
      signal: opts.signal,
      headers: providerHeaders(
        {
          "content-type": "application/json"
        },
        opts.inference_geo
      ),
      body: JSON.stringify({
        systemInstruction: input.system
          ? { parts: [{ text: input.system }] }
          : undefined,
        contents: input.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }]
          })),
        generationConfig: {
          temperature: route.params.temperature,
          maxOutputTokens: route.params.maxTokens,
          topP: route.params.topP
        }
      })
    }
  };
}

function providerHeaders(
  headers: Record<string, string>,
  inferenceGeo: string | undefined
): Record<string, string> {
  if (!inferenceGeo) {
    return headers;
  }

  return {
    ...headers,
    "x-pass-along-inference-geo": inferenceGeo
  };
}

function metadata(
  inferenceGeo: string | undefined
): Record<string, string> | undefined {
  if (!inferenceGeo) {
    return undefined;
  }

  return { inference_geo: inferenceGeo };
}

function openAiMessages(input: NormalizedInput): Array<{
  role: LlmRole;
  content: string;
}> {
  const systemMessages = input.system
    ? [{ role: "system" as const, content: input.system }]
    : [];

  return [...systemMessages, ...input.messages].map((message) => ({
    role: message.role,
    content: message.content
  }));
}

function anthropicSystem(input: NormalizedInput): string | undefined {
  const parts = [
    input.system,
    ...input.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function normalizeProviderResponse(
  promptId: string,
  route: PromptRoute,
  payload: unknown
): CompletionResult {
  return {
    promptId,
    provider: route.provider,
    model: route.model,
    text: extractText(route.provider, payload),
    usage: extractUsage(route.provider, payload)
  };
}

function extractText(provider: LlmProvider, payload: unknown): string {
  const record = asRecord(payload);

  if (!record) {
    return "";
  }

  switch (provider) {
    case "openai":
      return (
        getString(record, "output_text") ??
        extractOpenAiChoiceText(record) ??
        ""
      );
    case "anthropic":
      return extractAnthropicText(record);
    case "google":
      return extractGoogleText(record);
  }
}

function extractOpenAiChoiceText(record: Record<string, unknown>): string | undefined {
  const choices = asArray(record.choices);
  const firstChoice = asRecord(choices?.[0]);
  const message = asRecord(firstChoice?.message);

  return getString(message, "content");
}

function extractAnthropicText(record: Record<string, unknown>): string {
  const content = asArray(record.content) ?? [];

  return content
    .map((item) => getString(asRecord(item), "text"))
    .filter((text): text is string => Boolean(text))
    .join("");
}

function extractGoogleText(record: Record<string, unknown>): string {
  const candidates = asArray(record.candidates) ?? [];
  const firstCandidate = asRecord(candidates[0]);
  const content = asRecord(firstCandidate?.content);
  const parts = asArray(content?.parts) ?? [];

  return parts
    .map((part) => getString(asRecord(part), "text"))
    .filter((text): text is string => Boolean(text))
    .join("");
}

function extractUsage(
  provider: LlmProvider,
  payload: unknown
): TokenUsage {
  const record = asRecord(payload);

  if (!record) {
    return zeroUsage();
  }

  switch (provider) {
    case "openai": {
      const usage = asRecord(record.usage);
      const inputTokens =
        getNumber(usage, "input_tokens") ?? getNumber(usage, "prompt_tokens");
      const outputTokens =
        getNumber(usage, "output_tokens") ??
        getNumber(usage, "completion_tokens");

      return usageFromParts(
        inputTokens,
        outputTokens,
        getNumber(usage, "total_tokens")
      );
    }
    case "anthropic": {
      const usage = asRecord(record.usage);

      return usageFromParts(
        getNumber(usage, "input_tokens"),
        getNumber(usage, "output_tokens"),
        undefined
      );
    }
    case "google": {
      const usage = asRecord(record.usageMetadata);

      return usageFromParts(
        getNumber(usage, "promptTokenCount"),
        getNumber(usage, "candidatesTokenCount"),
        getNumber(usage, "totalTokenCount")
      );
    }
  }
}

function usageFromParts(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  totalTokens: number | undefined
): TokenUsage {
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;

  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: totalTokens ?? input + output
  };
}

function zeroUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    error instanceof ProviderHttpError && isRetryableStatus(error.status)
  );
}

async function defaultSleep(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      },
      { once: true }
    );
  });
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function getString(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}

function getNumber(
  record: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = record?.[key];

  return typeof value === "number" ? value : undefined;
}

export class MissingKeyError extends Error {
  readonly provider: LlmProvider;
  readonly envVar: string;

  constructor(provider: LlmProvider, envVar: string) {
    super(`Missing API key for ${provider}; set ${envVar}`);
    this.name = "MissingKeyError";
    this.provider = provider;
    this.envVar = envVar;
  }
}

export class ProviderHttpError extends Error {
  readonly provider: LlmProvider;
  readonly status: number;
  readonly responseText: string;

  constructor(provider: LlmProvider, status: number, responseText: string) {
    super(`${provider} completion failed with HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = status;
    this.responseText = responseText;
  }
}

export class LlmTimeoutError extends Error {
  readonly promptId: string;
  readonly timeoutMs: number;

  constructor(promptId: string, timeoutMs: number) {
    super(`LLM completion for ${promptId} timed out after ${timeoutMs}ms`);
    this.name = "LlmTimeoutError";
    this.promptId = promptId;
    this.timeoutMs = timeoutMs;
  }
}
