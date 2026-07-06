import { createHash } from "node:crypto";
import { MissingKeyError, ProviderHttpError, type Transport } from "./adapter.js";
import { normalizeVector } from "../retrieval/cosine.js";
import type { EmbeddingMetadata } from "../retrieval/types.js";

export const EMBEDDING_ROUTE_ID = "recommendation_embedding@1";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENAI_EMBEDDING_MODEL_VERSION =
  "text-embedding-3-small@2026-07-06";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const DEV_ONLY_HASH_EMBEDDING_MODEL = "dev-only-hash-embedding";
export const DEV_ONLY_HASH_EMBEDDING_MODEL_VERSION = "dev-only-v1";

export interface EmbedTextOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: Transport;
  readonly timeoutMs?: number;
  readonly inference_geo?: string;
}

export interface EmbeddingResult {
  readonly routeId: typeof EMBEDDING_ROUTE_ID;
  readonly vector: readonly number[];
  readonly metadata: EmbeddingMetadata;
}

interface OpenAiEmbeddingPayload {
  readonly data?: readonly {
    readonly embedding?: readonly number[];
  }[];
  readonly model?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function embedText(
  text: string,
  opts: EmbedTextOptions = {}
): Promise<EmbeddingResult> {
  const env = opts.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new MissingKeyError("openai", "OPENAI_API_KEY");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const transport = opts.transport ?? fetch;
    const response = await transport("https://api.openai.com/v1/embeddings", {
      method: "POST",
      signal: controller.signal,
      headers: providerHeaders(
        {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        opts.inference_geo
      ),
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: text,
        encoding_format: "float"
      })
    });

    if (!response.ok) {
      throw new ProviderHttpError(
        "openai",
        response.status,
        await safeResponseText(response)
      );
    }

    const payload = (await response.json()) as OpenAiEmbeddingPayload;
    const vector = payload.data?.[0]?.embedding;

    if (!vector || !vector.every((value) => typeof value === "number")) {
      throw new Error("OpenAI embedding response did not include a vector");
    }

    return {
      routeId: EMBEDDING_ROUTE_ID,
      vector,
      metadata: {
        provider: "openai",
        model: payload.model ?? OPENAI_EMBEDDING_MODEL,
        modelVersion: OPENAI_EMBEDDING_MODEL_VERSION,
        dimensions: vector.length
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function embedTextDevOnly(
  text: string,
  dimensions = DEFAULT_EMBEDDING_DIMENSIONS
): EmbeddingResult {
  if (dimensions <= 0) {
    throw new Error("Embedding dimensions must be positive");
  }

  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  const features = [
    ...tokens.map((token) => ({ token, weight: 1 })),
    ...ngrams(tokens, 2).map((token) => ({ token, weight: 1.4 })),
    ...ngrams(tokens, 3).map((token) => ({ token, weight: 1.8 }))
  ];

  for (const feature of features) {
    const digest = createHash("sha256").update(feature.token).digest();
    const bucket = digest.readUInt32BE(0) % dimensions;
    const sign = digest[4] === undefined || digest[4] % 2 === 0 ? 1 : -1;
    vector[bucket] = (vector[bucket] ?? 0) + sign * feature.weight;
  }

  return {
    routeId: EMBEDDING_ROUTE_ID,
    vector: normalizeVector(vector),
    metadata: {
      provider: "dev-only",
      model: DEV_ONLY_HASH_EMBEDDING_MODEL,
      modelVersion: DEV_ONLY_HASH_EMBEDDING_MODEL_VERSION,
      dimensions
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

// DEV-ONLY: hash embedder is a token-overlap stand-in for a real model, so it
// needs light normalization (possessives, stopwords) or natural sentences
// dilute below any useful cosine signal. Never used for the real embedding path.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "with", "in", "on", "at",
  "my", "our", "your", "we", "i", "you", "he", "she", "they", "it",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "someone", "something", "anyone", "help", "looking", "look", "need", "want"
]);

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/lgbtq\+/gu, "lgbtq")
    .replace(/['’]s\b/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function ngrams(tokens: readonly string[], size: number): readonly string[] {
  const grams: string[] = [];

  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.push(tokens.slice(index, index + size).join(" "));
  }

  return grams;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
