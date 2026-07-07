import {
  PgVectorStore,
  type SqlExecutor
} from "../../retrieval/pgvector.js";
import type {
  VectorRecord,
  VectorStorePort,
  VectorWritePort
} from "../../retrieval/index.js";

// Read side reuses the existing pgvector SQL builder/query verbatim (it
// already joins recommendations/providers/rec_tags and orders by the HNSW
// cosine operator) — nothing to finish there, just wire in a real executor.
export class PgVectorAdapter implements VectorStorePort, VectorWritePort {
  private readonly reader: PgVectorStore;

  constructor(private readonly executor: SqlExecutor) {
    this.reader = new PgVectorStore(executor);
  }

  search: PgVectorStore["search"] = (input) => this.reader.search(input);

  async upsert(record: VectorRecord): Promise<void> {
    await this.executor.query(
      `
insert into public.rec_embeddings
  (recommendation_id, embedding, model, prompt_version, model_version, dimensions)
values ($1::uuid, $2::vector, $3, $4, $5, $6)
on conflict (recommendation_id) do update set
  embedding = excluded.embedding,
  model = excluded.model,
  prompt_version = excluded.prompt_version,
  model_version = excluded.model_version,
  dimensions = excluded.dimensions
`.trim(),
      [
        record.document.recommendationId,
        vectorLiteral(record.vector),
        record.embedding.provider,
        embeddingPromptVersion(record.embedding),
        record.embedding.modelVersion,
        record.embedding.dimensions
      ]
    );
  }
}

// rec_embeddings.model is a free-text label (provider name in our fixtures);
// prompt_version isn't tracked on EmbeddingMetadata, so we record the model
// id itself as the closest available provenance string.
function embeddingPromptVersion(embedding: VectorRecord["embedding"]): string {
  return embedding.model;
}

function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => finiteNumber(value).toString()).join(",")}]`;
}

function finiteNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Vector values must be finite numbers");
  }

  return value;
}
