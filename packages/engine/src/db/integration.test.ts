// Integration suite for PA-023's Postgres adapters. Gated on
// PASS_ALONG_TEST_DB_URL so `pnpm test` stays green (skipped, visible in the
// vitest summary) without a container; run
// `scripts/db-test-container.sh start` first to populate it and get the
// real assertions.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  EventCatalogSchema,
  transition
} from "../../../core/src/index.js";
import { PgIntakeArtifactStorage } from "./adapters/intake-storage.js";
import { PgJobStorage } from "./adapters/job-storage.js";
import { PgVectorAdapter } from "./adapters/vector-store.js";
import { loadFixtureCorpus } from "../retrieval/fixtures.js";
import { createInMemoryVectorStoreFromCorpus } from "../retrieval/memory.js";
import { toRetrievalDocument } from "../retrieval/memory.js";
import { embedTextDevOnly } from "../llm/embed.js";
import type { SqlExecutor, SqlQueryResult } from "../retrieval/pgvector.js";

const TEST_DB_URL = process.env.PASS_ALONG_TEST_DB_URL;

describe.skipIf(!TEST_DB_URL)("Postgres adapters (integration)", () => {
  let pool: Pool;
  let sql: SqlExecutor;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    sql = executorFor(pool);
    await pool.query("select 1");
  });

  afterAll(async () => {
    await pool.end();
  });

  test("migrations already applied leave the expected tables in place", async () => {
    const result = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name in
         ('recommendations', 'rec_embeddings', 'rec_intake_artifacts', 'job_steps')`
    );
    const names = result.rows.map((row) => row.table_name).sort();

    expect(names).toEqual(
      ["job_steps", "rec_embeddings", "rec_intake_artifacts", "recommendations"].sort()
    );
  });

  describe("row level security", () => {
    test("anon can read published recommendations but not originals or unpublished rows", async () => {
      const providerId = await insertProvider(pool, "RLS Test Provider");
      const published = await insertRecommendation(pool, {
        providerId,
        providerName: "RLS Test Provider",
        status: "published",
        story: "a published story"
      });
      const unpublished = await insertRecommendation(pool, {
        providerId,
        providerName: "RLS Test Provider",
        status: "received",
        story: "an unpublished story"
      });
      await insertOriginal(pool, published, "original text for published");
      await insertOriginal(pool, unpublished, "original text for unpublished");

      await withAnonRole(pool, async (client) => {
        const visible = await client.query<{ id: string }>(
          "select id from public.recommendations where id = any($1::uuid[])",
          [[published, unpublished]]
        );
        expect(visible.rows.map((row) => row.id).sort()).toEqual([published].sort());

        const originals = await client.query(
          "select recommendation_id from public.recommendation_originals where recommendation_id = any($1::uuid[])",
          [[published, unpublished]]
        );
        expect(originals.rows).toEqual([]);
      });
    });

    test("anon cannot read moderation_events, events, jobs_dlq, or job_steps", async () => {
      await withAnonRole(pool, async (client) => {
        for (const table of [
          "moderation_events",
          "events",
          "jobs_dlq",
          "job_steps",
          "rec_intake_artifacts"
        ]) {
          const result = await client.query(`select * from public.${table}`, []);
          expect(result.rows, `anon should see zero rows in ${table}`).toEqual([]);
        }
      });
    });
  });

  test("vector round-trip matches the in-memory store's neighbor order on the fixture corpus", async () => {
    const corpus = loadFixtureCorpus();
    const providerIdByFixtureId = new Map<string, string>();

    for (const provider of corpus.providers) {
      const id = await insertProvider(pool, provider.name, {
        kind: provider.kind,
        loc: provider.loc,
        verified: provider.verified
      });
      providerIdByFixtureId.set(provider.id, id);
    }

    const recIdByFixtureId = new Map<string, string>();
    for (const recommendation of corpus.recommendations) {
      const providerId = providerIdByFixtureId.get(recommendation.provider_id);
      if (!providerId) {
        throw new Error(`missing provider for ${recommendation.provider_id}`);
      }
      const provider = corpus.providers.find(
        (candidate) => candidate.id === recommendation.provider_id
      );
      const id = await insertRecommendation(pool, {
        providerId,
        providerName: provider?.name ?? "unknown",
        status: "published",
        story: recommendation.keystone
      });
      recIdByFixtureId.set(recommendation.id, id);
      for (const tag of recommendation.tags) {
        await insertTag(pool, id, tag);
      }
    }

    const adapter = new PgVectorAdapter(sql);
    const inMemory = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
      const embedding = embedTextDevOnly(text);
      return { vector: embedding.vector, metadata: embedding.metadata };
    });

    for (const recommendation of corpus.recommendations) {
      const provider = corpus.providers.find(
        (candidate) => candidate.id === recommendation.provider_id
      );
      if (!provider) continue;
      const document = toRetrievalDocument(provider, recommendation);
      const embedding = embedTextDevOnly(document.text);
      const dbId = recIdByFixtureId.get(recommendation.id);
      if (!dbId) continue;

      await adapter.upsert({
        document: { ...document, recommendationId: dbId },
        vector: embedding.vector,
        embedding: embedding.metadata
      });
    }

    const queryVector = embedTextDevOnly(
      corpus.recommendations[0]?.keystone ?? "anxiety support"
    ).vector;

    const dbResults = await adapter.search({ vector: queryVector, topN: 3 });
    const memoryResults = await inMemory.search({ vector: queryVector, topN: 3 });

    expect(dbResults.length).toBe(memoryResults.length);
    expect(dbResults.map((r) => r.document.providerName)).toEqual(
      memoryResults.map((r) => r.document.providerName)
    );
  });

  test("events insert validates against the core EventCatalogSchema and round-trips", async () => {
    const storage = new PgJobStorage(sql);
    const idempotencyKey = `test:${randomUUID()}`;
    const recommendationId = await insertProvider(pool, "Events Test Provider").then(
      (providerId) =>
        insertRecommendation(pool, {
          providerId,
          providerName: "Events Test Provider",
          status: "received",
          story: "events test story"
        })
    );

    const row = await storage.appendEvent(
      {
        type: "submission.received",
        payload: { recommendation_id: recommendationId }
      },
      { idempotencyKey, emittedAt: new Date() }
    );

    expect(() => EventCatalogSchema.parse({ type: row.type, payload: row.payload })).not.toThrow();

    const again = await storage.appendEvent(
      {
        type: "submission.received",
        payload: { recommendation_id: recommendationId }
      },
      { idempotencyKey, emittedAt: new Date() }
    );
    expect(again.id).toBe(row.id);

    await expect(() =>
      storage.appendEvent(
        // @ts-expect-error deliberately invalid payload for the red-first check
        { type: "submission.received", payload: { recommendation_id: 123 } },
        { idempotencyKey: `bad:${randomUUID()}`, emittedAt: new Date() }
      )
    ).rejects.toThrow();
  });

  test("DLQ write/list/replay-mark round-trips", async () => {
    const storage = new PgJobStorage(sql);

    const written = await storage.writeDlq({
      jobName: "test_job",
      entityId: "pass_rec_dlq_test",
      eventId: null,
      attemptGroup: "attempt-1",
      error: { message: "boom" },
      failedAt: new Date()
    });

    const listed = await storage.listDlq();
    expect(listed.some((row) => row.id === written.id)).toBe(true);

    const replayed = await storage.markDlqReplayed(written.id, new Date());
    expect(replayed.replayedAt).not.toBeNull();

    const fetched = await storage.getDlqRow(written.id);
    expect(fetched?.replayedAt).not.toBeNull();
  });

  test("full pipeline parity: DB-backed store reaches the same terminal state as in-memory for a clean story", async () => {
    const jobStorage = new PgJobStorage(sql);
    const intakeStorage = new PgIntakeArtifactStorage(sql);

    const providerId = await insertProvider(pool, "Parity Test Provider");
    const recommendationId = await insertRecommendation(pool, {
      providerId,
      providerName: "Parity Test Provider",
      status: "received",
      story: "parity test story"
    });
    await insertOriginal(pool, recommendationId, "Maria Chen helped me with anxiety.", [
      "myself"
    ]);

    const now = new Date("2026-07-07T00:00:00.000Z");

    await jobStorage.transitionRecommendation({
      recommendationId,
      action: "scrub",
      actor: "system",
      metadata: {},
      idempotencyKey: `scrub:${recommendationId}`,
      now
    });
    await intakeStorage.saveScrubResult(recommendationId, {
      scrubbedStory: "Maria Chen helped me with anxiety.",
      piiFindings: [],
      flags: [],
      confidence: 1,
      source: "fallback",
      promptId: "scrub@1"
    });

    await jobStorage.transitionRecommendation({
      recommendationId,
      action: "extract",
      actor: "system",
      metadata: {},
      idempotencyKey: `extract:${recommendationId}`,
      now
    });
    await intakeStorage.saveExtractResult(recommendationId, {
      enrichment: {
        tags: [],
        keystone_quote: { text: "helped me with anxiety", start: 0, end: 20 },
        pii_findings: [],
        quality: {
          specificity: 0.8,
          lived_experience: 0.8,
          ad_smell: 0,
          dup_similarity: 0
        }
      },
      source: "fallback",
      promptId: "extract@1"
    });

    await jobStorage.transitionRecommendation({
      recommendationId,
      action: "score",
      actor: "system",
      metadata: {},
      idempotencyKey: `score:${recommendationId}`,
      now
    });
    await intakeStorage.saveQualityResult(recommendationId, {
      quality: {
        specificity: 0.8,
        lived_experience: 0.8,
        ad_smell: 0,
        dup_similarity: 0
      },
      flags: [],
      source: "fallback"
    });

    const decision = await jobStorage.getPublishDecision(recommendationId);
    expect(decision.outcome).toBe("publish");

    await jobStorage.transitionRecommendation({
      recommendationId,
      action: "all_green",
      actor: "system",
      metadata: {},
      idempotencyKey: `all_green:${recommendationId}`,
      now
    });

    const state = await jobStorage.getRecommendationState(recommendationId);
    expect(state).toBe("published");

    const inMemoryState = transition(
      transition(transition(transition("received", "scrub"), "extract"), "score"),
      "all_green"
    );
    expect(state).toBe(inMemoryState);
  });
});

function executorFor(pool: Pool): SqlExecutor {
  return {
    async query<TRow>(
      sqlText: string,
      params: readonly unknown[]
    ): Promise<SqlQueryResult<TRow>> {
      const result = await pool.query(sqlText, params as unknown[]);
      return { rows: result.rows as TRow[] };
    }
  };
}

async function insertProvider(
  pool: Pool,
  name: string,
  options: {
    readonly kind?: "therapist" | "facility";
    readonly loc?: string;
    readonly verified?: boolean;
  } = {}
): Promise<string> {
  const [city, state] = (options.loc ?? "Denver, CO").split(", ");
  const result = await pool.query<{ id: string }>(
    `insert into public.providers (name, provider_kind, city, state, license_status)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      name,
      options.kind ?? "therapist",
      city ?? "Denver",
      state ?? "CO",
      options.verified ? "verified" : null
    ]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("provider insert returned no id");
  return id;
}

async function insertRecommendation(
  pool: Pool,
  input: {
    readonly providerId: string;
    readonly providerName: string;
    readonly status: string;
    readonly story: string;
  }
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.recommendations
       (provider_id, provider_name_snapshot, status, scrubbed_story, published_at)
     values ($1::uuid, $2, $3, $4, case when $3 = 'published' then now() else null end)
     returning id`,
    [input.providerId, input.providerName, input.status, input.story]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("recommendation insert returned no id");
  return id;
}

async function insertOriginal(
  pool: Pool,
  recommendationId: string,
  story: string,
  forWhom: readonly string[] = ["myself"]
): Promise<void> {
  await pool.query(
    `insert into public.recommendation_originals (recommendation_id, original_story, for_whom)
     values ($1::uuid, $2, $3::text[])`,
    [recommendationId, story, forWhom]
  );
}

async function insertTag(
  pool: Pool,
  recommendationId: string,
  value: string
): Promise<void> {
  await pool.query(
    `insert into public.rec_tags (recommendation_id, type, value, vocab, confidence, prompt_version)
     values ($1::uuid, 'issue', $2, true, 0.9, 'test@1')`,
    [recommendationId, value]
  );
}

async function withAnonRole(
  pool: Pool,
  fn: (client: SqlExecutor) => Promise<void>
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("set local role anon");
    await fn({
      async query(sqlText, params) {
        const result = await client.query(sqlText, params as unknown[]);
        return { rows: result.rows };
      }
    });
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
