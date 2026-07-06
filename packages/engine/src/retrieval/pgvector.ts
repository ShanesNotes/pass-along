import type {
  RetrievalDocument,
  VectorSearchInput,
  VectorSearchResult,
  VectorStorePort
} from "./types.js";

export interface SqlQueryResult<TRow> {
  readonly rows: readonly TRow[];
}

export interface SqlExecutor {
  query<TRow>(
    sql: string,
    params: readonly unknown[]
  ): Promise<SqlQueryResult<TRow>>;
}

export interface PgVectorRow {
  readonly recommendation_id: string;
  readonly provider_id: string;
  readonly provider_name: string;
  readonly credential: string | null;
  readonly loc: string | null;
  readonly kind: "therapist" | "facility";
  readonly tags: readonly string[] | null;
  readonly keystone: string | null;
  readonly story: string | null;
  readonly verified: boolean | null;
  readonly score: number;
}

export class PgVectorStore implements VectorStorePort {
  constructor(private readonly executor: SqlExecutor) {}

  async search(input: VectorSearchInput): Promise<readonly VectorSearchResult[]> {
    const query = buildPgVectorSearchQuery(input);
    const result = await this.executor.query<PgVectorRow>(
      query.sql,
      query.params
    );

    return result.rows.map((row) => ({
      document: documentFromRow(row),
      score: row.score
    }));
  }
}

export function buildPgVectorSearchQuery(input: VectorSearchInput): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  const filters = input.filters ?? {};
  const params = [
    vectorLiteral(input.vector),
    filters.kind ?? null,
    filters.location ?? null,
    filters.tags === undefined ? [] : [...filters.tags],
    input.topN
  ] as const;

  return {
    params,
    sql: `
select
  r.id::text as recommendation_id,
  p.id::text as provider_id,
  p.name as provider_name,
  coalesce(nullif(p.license_status, ''), p.provider_kind) as credential,
  concat_ws(', ', p.city, p.state) as loc,
  case when r.kind = 'facility' then 'facility' else 'therapist' end as kind,
  coalesce(array_agg(distinct t.value) filter (where t.value is not null), '{}') as tags,
  r.scrubbed_story as story,
  substring(coalesce(r.scrubbed_story, '') from 1 for 220) as keystone,
  p.license_status = 'verified' as verified,
  1 - (e.embedding <=> $1::vector) as score
from public.rec_embeddings e
join public.recommendations r on r.id = e.recommendation_id
left join public.providers p on p.id = r.provider_id
left join public.rec_tags t on t.recommendation_id = r.id
where r.status = 'published'
  and ($2::text is null or $2::text = 'either' or r.kind = $2::text)
  and (
    $3::text is null
    or lower(concat_ws(' ', p.city, p.state, p.postal_code, p.country)) like '%' || lower($3::text) || '%'
  )
  and not exists (
    select 1
    from unnest($4::text[]) required_tag(value)
    where not exists (
      select 1
      from public.rec_tags required_rec_tag
      where required_rec_tag.recommendation_id = r.id
        and lower(required_rec_tag.value) = lower(required_tag.value)
    )
  )
group by r.id, p.id, e.embedding
-- TODO(L1-S6): union trigram provider-name matches before final rerank.
order by e.embedding <=> $1::vector
limit $5::integer
`.trim()
  };
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

function documentFromRow(row: PgVectorRow): RetrievalDocument {
  return {
    recommendationId: row.recommendation_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    credential: row.credential ?? "",
    loc: row.loc ?? "",
    kind: row.kind,
    tags: row.tags ?? [],
    keystone: row.keystone ?? "",
    text: row.story ?? "",
    verified: row.verified ?? false
  };
}
