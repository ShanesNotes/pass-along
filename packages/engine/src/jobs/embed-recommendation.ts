import { embedText } from "../llm/embed.js";
import type {
  EmbeddingMetadata,
  RetrievalDocument,
  VectorRecord
} from "../retrieval/types.js";

export interface RecommendationEmbeddingStoragePort {
  getRecommendationEmbeddingSource(
    recommendationId: string
  ): Promise<RetrievalDocument | undefined>;
  upsertRecommendationEmbedding(record: VectorRecord): Promise<void>;
}

export interface EmbedRecommendationInput {
  readonly recommendationId: string;
  readonly storage: unknown;
  readonly embed?: (text: string) => Promise<{
    readonly vector: readonly number[];
    readonly metadata: EmbeddingMetadata;
  }>;
}

export interface EmbedRecommendationResult {
  readonly recommendationId: string;
  readonly embedded: boolean;
  readonly model?: string;
  readonly modelVersion?: string;
  readonly dimensions?: number;
  readonly skippedReason?: "storage_unavailable" | "source_missing";
}

export async function embedRecommendation(
  input: EmbedRecommendationInput
): Promise<EmbedRecommendationResult> {
  if (!hasRecommendationEmbeddingStorage(input.storage)) {
    return {
      recommendationId: input.recommendationId,
      embedded: false,
      skippedReason: "storage_unavailable"
    };
  }

  const source = await input.storage.getRecommendationEmbeddingSource(
    input.recommendationId
  );

  if (!source) {
    return {
      recommendationId: input.recommendationId,
      embedded: false,
      skippedReason: "source_missing"
    };
  }

  const embed = input.embed ?? defaultEmbed;
  const embedding = await embed(source.text);

  await input.storage.upsertRecommendationEmbedding({
    document: source,
    vector: embedding.vector,
    embedding: embedding.metadata
  });

  return {
    recommendationId: input.recommendationId,
    embedded: true,
    model: embedding.metadata.model,
    modelVersion: embedding.metadata.modelVersion,
    dimensions: embedding.metadata.dimensions
  };
}

function hasRecommendationEmbeddingStorage(
  value: unknown
): value is RecommendationEmbeddingStoragePort {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    readonly getRecommendationEmbeddingSource?: unknown;
    readonly upsertRecommendationEmbedding?: unknown;
  };

  return (
    typeof candidate.getRecommendationEmbeddingSource === "function" &&
    typeof candidate.upsertRecommendationEmbedding === "function"
  );
}

async function defaultEmbed(text: string) {
  const result = await embedText(text);

  return {
    vector: result.vector,
    metadata: result.metadata
  };
}
