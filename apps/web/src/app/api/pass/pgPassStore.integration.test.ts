// PA-028 parity suite: the DB-backed PgPassStore must drive the same
// scrub->extract->score->publish (or ->review_pending) pipeline to the same
// terminal shape as the in-memory demo store, for the same inputs. Gated on
// PASS_ALONG_TEST_DB_URL (see scripts/db-test-container.sh) so `pnpm test`
// stays green without a container.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  JOB_DEFINITIONS,
  createInlineJobRunner
} from "../../../../../../packages/engine/src/jobs/index.js";
import { PgPassStore } from "../../../../../../packages/engine/src/db/adapters/pass-store.js";
import {
  createDbClient,
  type DbClient
} from "../../../../../../packages/engine/src/db/client.js";
import { loadConfig } from "../../../../../../packages/core/src/index.js";
import type { SafetyGateResult } from "../../../../../../packages/engine/src/safety/index.js";
import {
  createPassDemoStore,
  createPassPostHandler,
  type PassApiSuccessResponse
} from "./deps";

const TEST_DB_URL = process.env.PASS_ALONG_TEST_DB_URL;

const CLEAN_STORY =
  "Maria Chen helped my sister Julia in Denver build a CBT plan for panic attacks that worked on the bus after two sessions.";

const REVIEW_STORY =
  "Maria Chen helped my teen daughter with panic and anxiety using CBT bus practice steps in Denver. Afterward, my sister Julia joined us at 123 Pine Street on March 3 after I emailed julia@example.com and called 303-555-1212 about evening routines.";

const NOW = () => new Date("2026-07-06T12:00:00.000Z");

describe.skipIf(!TEST_DB_URL)("PgPassStore parity with the in-memory demo store", () => {
  let client: DbClient;
  let dbProviderId: string;

  beforeAll(async () => {
    client = createDbClient(loadConfig({ ...process.env, DATABASE_URL: TEST_DB_URL }));
    const result = await client.query<{ id: string }>(
      `insert into public.providers (name, provider_kind, city, state, license_status)
       values ('Maria Chen', 'therapist', 'Denver', 'CO', 'LPC')
       returning id`,
      []
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("provider insert returned no id");
    dbProviderId = id;
  });

  afterAll(async () => {
    await client.end();
  });

  test("clean story reaches the same terminal state and content shape as in-memory", async () => {
    const memory = memoryHarness();
    const db = dbHarness(client);

    const memoryResponse = await memory.post({
      providerId: "p1",
      story: CLEAN_STORY,
      forWhom: ["a family member"]
    });
    const dbResponse = await db.post({
      providerId: dbProviderId,
      story: CLEAN_STORY,
      forWhom: ["a family member"]
    });

    const memoryBody = (await memoryResponse.json()) as PassApiSuccessResponse;
    const dbBody = (await dbResponse.json()) as PassApiSuccessResponse;

    expect(dbResponse.status).toBe(200);
    expect(dbBody.status).toBe(memoryBody.status);
    expect(dbBody.status).toBe("published");
    expect(dbBody.scrubbed_story).toBe(memoryBody.scrubbed_story);
    expect(dbBody.pii_findings_count).toBe(memoryBody.pii_findings_count);
    expect(dbBody.tags).toEqual(memoryBody.tags);
    expect(dbBody.keystone_quote.text).toBe(memoryBody.keystone_quote.text);
    expect(dbBody.quality).toEqual(memoryBody.quality);
    expect(dbBody.transitions.map((t) => t.action)).toEqual(
      memoryBody.transitions.map((t) => t.action)
    );
    expect(JSON.stringify(dbBody)).not.toContain("Julia");
  }, 20_000);

  test("flagged story reaches review_pending, queues, and decides the same as in-memory", async () => {
    const memory = memoryHarness();
    const db = dbHarness(client);

    const memoryResponse = await memory.post({
      providerId: "p1",
      story: REVIEW_STORY,
      forWhom: ["my child"]
    });
    const dbResponse = await db.post({
      providerId: dbProviderId,
      story: REVIEW_STORY,
      forWhom: ["my child"]
    });
    const memoryBody = (await memoryResponse.json()) as PassApiSuccessResponse;
    const dbBody = (await dbResponse.json()) as PassApiSuccessResponse;

    expect(dbBody.status).toBe(memoryBody.status);
    expect(dbBody.status).toBe("review_pending");

    const memoryQueue = await memory.store.listAdminReviewQueue();
    const dbQueue = await db.store.listAdminReviewQueue();
    const memoryItem = memoryQueue.find(
      (item) => item.id === memoryBody.recommendation_id
    );
    const dbItem = dbQueue.find((item) => item.id === dbBody.recommendation_id);

    expect(dbItem).toBeDefined();
    expect(memoryItem).toBeDefined();
    expect(dbItem?.flag_reasons.slice().sort()).toEqual(
      memoryItem?.flag_reasons.slice().sort()
    );
    expect(dbItem?.pii_findings.length).toBe(memoryItem?.pii_findings.length);
    expect(dbItem?.tags).toEqual(memoryItem?.tags);
    expect(dbItem?.raw_story).toBe(REVIEW_STORY);

    const memoryDecision = await memory.store.decideAdminReview({
      recommendationId: memoryBody.recommendation_id,
      action: "approve",
      reviewer: "test-reviewer",
      now: NOW()
    });
    const dbDecision = await db.store.decideAdminReview({
      recommendationId: dbBody.recommendation_id,
      action: "approve",
      reviewer: "test-reviewer",
      now: NOW()
    });

    expect(dbDecision.status).toBe(memoryDecision.status);
    expect(dbDecision.status).toBe("published");
    expect(dbDecision.transition.action).toBe(memoryDecision.transition.action);

    const dbResult = await db.store.resultFor(dbBody.recommendation_id);
    expect(dbResult.status).toBe("published");
  }, 20_000);

  test("debugCounts reflects real inserted rows", async () => {
    const db = dbHarness(client);
    const response = await db.post({
      providerId: dbProviderId,
      story: CLEAN_STORY,
      forWhom: ["myself"]
    });
    expect(response.status).toBe(200);

    const counts = await db.store.debugCounts();
    expect(counts.originals).toBeGreaterThan(0);
    expect(counts.recommendations).toBeGreaterThan(0);
    expect(counts.events).toBeGreaterThan(0);
  });
});

function memoryHarness() {
  const store = createPassDemoStore();
  const runner = createInlineJobRunner({ storage: store, jobs: JOB_DEFINITIONS, now: NOW });
  const handler = createPassPostHandler({
    store,
    runner,
    safetyGate: nonCrisisSafetyGate,
    now: NOW
  });

  return {
    store,
    post: (body: unknown) =>
      handler(
        new Request("http://localhost/api/pass", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
      )
  };
}

// PgPassStore mirrors PassDemoStore structurally (proven at the real
// wire-up call site in pass/deps.ts's defaultPassRouteDeps), so it's passed
// here exactly as-is — no cast needed.
function dbHarness(client: DbClient) {
  const store = new PgPassStore(client);
  const runner = createInlineJobRunner({ storage: store, jobs: JOB_DEFINITIONS, now: NOW });
  const handler = createPassPostHandler({
    store,
    runner,
    safetyGate: nonCrisisSafetyGate,
    now: NOW
  });

  return {
    store,
    post: (body: unknown) =>
      handler(
        new Request("http://localhost/api/pass", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
      )
  };
}

async function nonCrisisSafetyGate(): Promise<SafetyGateResult> {
  return {
    crisis: false,
    degraded: false,
    tier1: { triggered: false, matches: [] },
    tier2: {
      status: "skipped",
      promptId: "crisis_gate@1",
      crisis: false,
      reason: "missing_api_key",
      missingEnvVar: "ANTHROPIC_API_KEY"
    }
  };
}
