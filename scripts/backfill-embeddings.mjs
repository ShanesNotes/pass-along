import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CORPUS_PATH = resolve("evals/fixtures/corpus/recommendations.json");
const DIMENSIONS = 1536;
const MODEL = "dev-only-hash-embedding";
const MODEL_VERSION = "dev-only-v1";

async function main() {
  const corpus = JSON.parse(await readFile(CORPUS_PATH, "utf8"));
  const storage = new FixtureEmbeddingStorage(corpus);

  let embedded = 0;
  for (const recommendation of corpus.recommendations) {
    const result = await runEmbedRecommendation({
      recommendationId: recommendation.id,
      storage
    });

    if (result.embedded) {
      embedded += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        corpus: "evals/fixtures/corpus/recommendations.json",
        processed: corpus.recommendations.length,
        embedded,
        model: MODEL,
        model_version: MODEL_VERSION,
        dimensions: DIMENSIONS
      },
      null,
      2
    )
  );
}

async function runEmbedRecommendation(input) {
  const source = await input.storage.getRecommendationEmbeddingSource(
    input.recommendationId
  );

  if (!source) {
    return { recommendationId: input.recommendationId, embedded: false };
  }

  const vector = devHashEmbedding(source.text);
  await input.storage.upsertRecommendationEmbedding({
    document: source,
    vector,
    embedding: {
      provider: "dev-only",
      model: MODEL,
      modelVersion: MODEL_VERSION,
      dimensions: DIMENSIONS
    }
  });

  return {
    recommendationId: input.recommendationId,
    embedded: true,
    model: MODEL,
    modelVersion: MODEL_VERSION,
    dimensions: DIMENSIONS
  };
}

class FixtureEmbeddingStorage {
  #sources = new Map();
  #records = new Map();

  constructor(fixtureCorpus) {
    for (const recommendation of fixtureCorpus.recommendations) {
      const provider = fixtureCorpus.providers.find(
        (candidate) => candidate.id === recommendation.provider_id
      );

      if (!provider) {
        throw new Error(`Missing provider ${recommendation.provider_id}`);
      }

      const source = toRetrievalDocument(provider, recommendation);
      this.#sources.set(source.recommendationId, source);
    }
  }

  async getRecommendationEmbeddingSource(recommendationId) {
    return this.#sources.get(recommendationId);
  }

  async upsertRecommendationEmbedding(record) {
    this.#records.set(record.document.recommendationId, record);
  }
}

function toRetrievalDocument(provider, recommendation) {
  return {
    recommendationId: recommendation.id,
    providerId: provider.id,
    providerName: provider.name,
    credential: provider.credential,
    loc: provider.loc,
    kind: recommendation.kind,
    tags: [...recommendation.tags],
    keystone: recommendation.keystone,
    text: [
      provider.name,
      provider.credential,
      provider.kind,
      provider.loc,
      recommendation.tags.join(" "),
      recommendation.keystone,
      recommendation.story
    ].join("\n"),
    verified: provider.verified
  };
}

function devHashEmbedding(input) {
  const vector = new Array(DIMENSIONS).fill(0);
  const tokens = tokenizeForEmbedding(input);
  const features = [
    ...tokens.map((token) => ({ token, weight: 1 })),
    ...tokenNgrams(tokens, 2).map((token) => ({ token, weight: 1.4 })),
    ...tokenNgrams(tokens, 3).map((token) => ({ token, weight: 1.8 }))
  ];

  for (const feature of features) {
    const digest = createHash("sha256").update(feature.token).digest();
    const bucket = digest.readUInt32BE(0) % DIMENSIONS;
    const sign = digest[4] === undefined || digest[4] % 2 === 0 ? 1 : -1;
    vector[bucket] += sign * feature.weight;
  }

  return normalizeVector(vector);
}

function tokenizeForEmbedding(input) {
  return input
    .toLowerCase()
    .replace(/lgbtq\+/gu, "lgbtq")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 1);
}

function tokenNgrams(tokens, size) {
  const grams = [];

  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.push(tokens.slice(index, index + size).join(" "));
  }

  return grams;
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return [...vector];
  }

  return vector.map((value) => value / magnitude);
}

await main();
