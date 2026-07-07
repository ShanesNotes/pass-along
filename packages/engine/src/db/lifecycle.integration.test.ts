// Audit finding F1: PgLifecycleStorage (packages/engine/src/lifecycle/
// pg-adapter.ts) was implemented but never composed into any store
// createStores() hands out, so hasLifecycleStorage() was false against the
// real DB-backed store and the deleteSubmission job always reported
// storage_unavailable — the MHMDA deletion cascade was unreachable in
// production shape. This drives a real moderation.decided(remove) event
// through the actual job runner against PgPassStore and asserts the full
// cascade happened for real. Gated on PASS_ALONG_TEST_DB_URL.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  JOB_DEFINITIONS,
  createInlineJobRunner
} from "../jobs/index.js";
import { PgPassStore } from "./adapters/pass-store.js";
import { PgVectorAdapter } from "./adapters/vector-store.js";
import { embedTextDevOnly } from "../llm/embed.js";
import type { SqlExecutor, SqlQueryResult } from "../retrieval/pgvector.js";

const TEST_DB_URL = process.env.PASS_ALONG_TEST_DB_URL;
const NOW = () => new Date("2026-07-07T00:00:00.000Z");

describe.skipIf(!TEST_DB_URL)("deleteSubmission cascade against PgPassStore", () => {
  let pool: Pool;
  let sql: SqlExecutor;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    sql = {
      async query<TRow>(sqlText: string, params: readonly unknown[]) {
        const result = await pool.query(sqlText, params as unknown[]);
        return { rows: result.rows as TRow[] } satisfies SqlQueryResult<TRow>;
      }
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  test("moderation.decided(remove) deletes every artifact, redacts the row, and writes a tombstone", async () => {
    const providerId = await insertProvider(pool);
    const recommendationId = await insertRecommendation(pool, providerId);
    await insertOriginal(pool, recommendationId);
    await insertTag(pool, recommendationId);

    const store = new PgPassStore(sql);
    await store.saveScrubResult(recommendationId, {
      scrubbedStory: "A story about finding a good therapist.",
      piiFindings: [],
      flags: [],
      confidence: 1,
      source: "fallback",
      promptId: "scrub@1"
    });
    await store.saveExtractResult(recommendationId, {
      enrichment: {
        tags: [],
        keystone_quote: { text: "found a good therapist", start: 0, end: 20 },
        pii_findings: [],
        quality: { specificity: 0.8, lived_experience: 0.8, ad_smell: 0, dup_similarity: 0 }
      },
      source: "fallback",
      promptId: "extract@1"
    });
    await store.saveQualityResult(recommendationId, {
      quality: { specificity: 0.8, lived_experience: 0.8, ad_smell: 0, dup_similarity: 0 },
      flags: [],
      source: "fallback"
    });

    const vectorAdapter = new PgVectorAdapter(sql);
    const embedding = embedTextDevOnly("test embedding text");
    await vectorAdapter.upsert({
      document: {
        recommendationId,
        providerId,
        providerName: "Lifecycle Test Provider",
        credential: "LPC",
        loc: "Denver, CO",
        kind: "therapist",
        tags: [],
        keystone: "found a good therapist",
        text: "test embedding text",
        verified: false
      },
      vector: embedding.vector,
      embedding: embedding.metadata
    });

    // Sanity: everything is actually there before we delete it.
    expect(await countRows(pool, "recommendation_originals", recommendationId)).toBe(1);
    expect(await countRows(pool, "rec_tags", recommendationId)).toBe(1);
    expect(await countRows(pool, "rec_embeddings", recommendationId)).toBe(1);
    expect(await countRows(pool, "rec_intake_artifacts", recommendationId)).toBe(1);

    const runner = createInlineJobRunner({ storage: store, jobs: JOB_DEFINITIONS, now: NOW });
    await runner.dispatch(
      {
        type: "moderation.decided",
        payload: {
          recommendation_id: recommendationId,
          action: "remove",
          reviewer: "test-admin"
        }
      },
      { eventId: `lifecycle-test:${recommendationId}:remove` }
    );

    expect(await countRows(pool, "recommendation_originals", recommendationId)).toBe(0);
    expect(await countRows(pool, "rec_tags", recommendationId)).toBe(0);
    expect(await countRows(pool, "rec_embeddings", recommendationId)).toBe(0);
    expect(await countRows(pool, "rec_intake_artifacts", recommendationId)).toBe(0);

    const recRow = await pool.query<{
      status: string;
      removed_at: Date | null;
      scrubbed_story: string | null;
    }>(
      "select status, removed_at, scrubbed_story from public.recommendations where id = $1::uuid",
      [recommendationId]
    );
    expect(recRow.rows[0]).toMatchObject({
      status: "removed",
      scrubbed_story: null
    });
    expect(recRow.rows[0]?.removed_at).not.toBeNull();

    const tombstone = await pool.query<{ action: string }>(
      "select action from public.moderation_events where recommendation_id = $1::uuid and action = 'deleted'",
      [recommendationId]
    );
    expect(tombstone.rows).toHaveLength(1);
  });
});

async function insertProvider(pool: Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.providers (name, provider_kind, city, state, license_status)
     values ('Lifecycle Test Provider', 'therapist', 'Denver', 'CO', 'LPC')
     returning id`
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("provider insert returned no id");
  return id;
}

async function insertRecommendation(pool: Pool, providerId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.recommendations
       (provider_id, provider_name_snapshot, status, scrubbed_story, published_at)
     values ($1::uuid, 'Lifecycle Test Provider', 'published', 'A story about finding a good therapist.', now())
     returning id`,
    [providerId]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("recommendation insert returned no id");
  return id;
}

async function insertOriginal(pool: Pool, recommendationId: string): Promise<void> {
  await pool.query(
    `insert into public.recommendation_originals (recommendation_id, original_story, for_whom)
     values ($1::uuid, 'My name is Jane and I saw Dr. Smith for anxiety.', '{myself}')`,
    [recommendationId]
  );
}

async function insertTag(pool: Pool, recommendationId: string): Promise<void> {
  await pool.query(
    `insert into public.rec_tags (recommendation_id, type, value, vocab, confidence, prompt_version)
     values ($1::uuid, 'issue', 'anxiety', true, 0.9, 'test@1')`,
    [recommendationId]
  );
}

async function countRows(
  pool: Pool,
  table: string,
  recommendationId: string
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from public.${table} where recommendation_id = $1::uuid`,
    [recommendationId]
  );
  return Number(result.rows[0]?.count ?? 0);
}
