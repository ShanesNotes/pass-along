import { describe, expect, test } from "vitest";
import { buildPgVectorSearchQuery, PgVectorStore } from "./pgvector.js";
import type { PgVectorRow, SqlExecutor } from "./pgvector.js";

describe("pgvector retrieval", () => {
  test("builds cosine SQL with published, kind, geo, and tag filters", () => {
    const query = buildPgVectorSearchQuery({
      vector: [0.1, 0.2, 0.3],
      topN: 40,
      filters: {
        kind: "facility",
        location: "Austin",
        tags: ["ptsd", "emdr"]
      }
    });

    expect(query.params).toEqual([
      "[0.1,0.2,0.3]",
      "facility",
      "Austin",
      ["ptsd", "emdr"],
      40
    ]);
    expect(query.sql).toContain("e.embedding <=> $1::vector");
    expect(query.sql).toContain("r.status = 'published'");
    expect(query.sql).toContain("r.kind = $2::text");
    expect(query.sql).toContain("lower(concat_ws");
    expect(query.sql).toContain("unnest($4::text[])");
    expect(query.sql).toContain("TODO(L1-S6)");
    expect(query.sql).toContain("limit $5::integer");
  });

  test("maps SQL rows into retrieval results", async () => {
    const executor: SqlExecutor = {
      async query<TRow>(
        sql: string,
        params: readonly unknown[]
      ) {
        expect(sql).toContain("from public.rec_embeddings");
        expect(params[4]).toBe(1);
        const row = {
          recommendation_id: "rec_sql",
          provider_id: "provider_sql",
          provider_name: "SQL Provider",
          credential: "LPC",
          loc: "Denver, CO",
          kind: "therapist",
          tags: ["anxiety"],
          keystone: "Pinned quote",
          story: "Story text",
          verified: true,
          score: 0.91
        } satisfies PgVectorRow;

        return {
          rows: [row as TRow]
        };
      }
    };
    const store = new PgVectorStore(executor);

    await expect(
      store.search({
        vector: [1, 0, 0],
        topN: 1
      })
    ).resolves.toEqual([
      {
        document: {
          recommendationId: "rec_sql",
          providerId: "provider_sql",
          providerName: "SQL Provider",
          credential: "LPC",
          loc: "Denver, CO",
          kind: "therapist",
          tags: ["anxiety"],
          keystone: "Pinned quote",
          text: "Story text",
          verified: true
        },
        score: 0.91
      }
    ]);
  });
});
