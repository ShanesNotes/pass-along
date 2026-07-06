export type ProviderKind = "therapist" | "facility";

export interface CorpusProvider {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly kind: ProviderKind;
  readonly loc: string;
  readonly verified: boolean;
}

export interface CorpusRecommendation {
  readonly id: string;
  readonly provider_id: string;
  readonly kind: ProviderKind;
  readonly tags: readonly string[];
  readonly keystone: string;
  readonly story: string;
}

export interface RetrievalCorpus {
  readonly providers: readonly CorpusProvider[];
  readonly recommendations: readonly CorpusRecommendation[];
}

export interface EmbeddingMetadata {
  readonly provider: "openai" | "dev-only";
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: number;
}

export interface RetrievalDocument {
  readonly recommendationId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly credential: string;
  readonly loc: string;
  readonly kind: ProviderKind;
  readonly tags: readonly string[];
  readonly keystone: string;
  readonly text: string;
  readonly verified: boolean;
}

export interface VectorRecord {
  readonly document: RetrievalDocument;
  readonly vector: readonly number[];
  readonly embedding: EmbeddingMetadata;
}

export interface RetrievalFilters {
  readonly kind?: ProviderKind | "either";
  readonly location?: string;
  readonly tags?: readonly string[];
}

export interface VectorSearchInput {
  readonly vector: readonly number[];
  readonly topN: number;
  readonly filters?: RetrievalFilters;
}

export interface VectorSearchResult {
  readonly document: RetrievalDocument;
  readonly score: number;
}

export interface VectorStorePort {
  search(input: VectorSearchInput): Promise<readonly VectorSearchResult[]>;
}

export interface VectorWritePort {
  upsert(record: VectorRecord): Promise<void>;
}

export interface FindResultTag {
  readonly value: string;
  readonly freq: number;
}

export interface FindResultCard {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
  readonly passed_count: number;
  readonly tags: readonly FindResultTag[];
  readonly keystone: string;
  readonly verified: boolean;
  readonly why: string | null;
  readonly cited_span_ids: readonly string[];
}
