// Audit finding F2 (TOCTOU): decideAdminReview reads the current state,
// then later writes a transition, with no lock in between — two concurrent
// decides for the same review_pending recommendation both pass the initial
// check and both execute the transition. This drives two real concurrent
// decideAdminReview calls against a live Postgres connection and asserts
// exactly one wins. Gated on PASS_ALONG_TEST_DB_URL.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PgPassStore, AlreadyDecidedError } from "./adapters/pass-store.js";
import { createDbClient, type DbClient } from "./client.js";
import { loadConfig } from "../../../core/src/index.js";

const TEST_DB_URL = process.env.PASS_ALONG_TEST_DB_URL;

describe.skipIf(!TEST_DB_URL)("decideAdminReview concurrency (TOCTOU)", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDbClient(loadConfig({ ...process.env, DATABASE_URL: TEST_DB_URL }));
  });

  afterAll(async () => {
    await client.end();
  });

  test("two concurrent decides on the same review_pending recommendation: exactly one wins", async () => {
    const store = new PgPassStore(client);
    const provider = await client.query<{ id: string }>(
      `insert into public.providers (name, provider_kind, city, state, license_status)
       values ('Concurrency Test Provider', 'therapist', 'Denver', 'CO', 'LPC')
       returning id`,
      []
    );
    const providerId = provider.rows[0]?.id;
    if (!providerId) throw new Error("provider insert returned no id");

    const rec = await client.query<{ id: string }>(
      `insert into public.recommendations (provider_id, provider_name_snapshot, status)
       values ($1::uuid, 'Concurrency Test Provider', 'review_pending')
       returning id`,
      [providerId]
    );
    const recommendationId = rec.rows[0]?.id;
    if (!recommendationId) throw new Error("recommendation insert returned no id");

    const now = new Date("2026-07-07T00:00:00.000Z");
    const results = await Promise.allSettled([
      store.decideAdminReview({
        recommendationId,
        action: "approve",
        reviewer: "reviewer-a",
        now
      }),
      store.decideAdminReview({
        recommendationId,
        action: "reject",
        reviewer: "reviewer-b",
        now
      })
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof store.decideAdminReview>>> =>
        r.status === "fulfilled"
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );

    // Exactly one decide actually transitioned the row; the other gets a
    // clean AlreadyDecidedError rather than also transitioning it (today,
    // without the fix, both fulfill and both transition).
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(AlreadyDecidedError);

    const finalState = await client.query<{ status: string }>(
      "select status from public.recommendations where id = $1::uuid",
      [recommendationId]
    );
    // Whichever action won, the row reflects exactly that one transition —
    // not a second one layered on top.
    expect(["published", "rejected"]).toContain(finalState.rows[0]?.status);

    const moderationEvents = await client.query<{ action: string }>(
      "select action from public.moderation_events where recommendation_id = $1::uuid and actor in ('reviewer-a', 'reviewer-b')",
      [recommendationId]
    );
    expect(moderationEvents.rows).toHaveLength(1);
  });
});
