// Audit finding F4: runIdempotentStep was read-then-write (getJobStep, then
// upsertJobStep with status "running"), so two concurrent deliveries of the
// same idempotency key could both pass the "not completed yet" check before
// either one wrote its claim, and both would execute the side effect. The
// in-memory case happens to be safe today because there's no `await`
// between the read and the write (single-threaded JS can't interleave
// there), but the Postgres case is a real two-round-trip race. This proves
// it against a real Postgres connection (gated on PASS_ALONG_TEST_DB_URL)
// and locks in the in-memory case too.
import { Pool } from "pg";
import { describe, expect, test } from "vitest";
import { createInMemoryJobStorage } from "./ports.js";
import { PgJobStorage } from "../db/adapters/job-storage.js";
import {
  JobStepInProgressError,
  runIdempotentStep,
  type JobAttemptIdentity
} from "./idempotency.js";
import type { StepApi } from "./runner.js";
import type { SqlExecutor, SqlQueryResult } from "../retrieval/pgvector.js";

const TEST_DB_URL = process.env.PASS_ALONG_TEST_DB_URL;

const inlineStep: StepApi = {
  async run(_name, fn) {
    return fn();
  },
  async waitForEvent() {
    return null;
  },
  async sleep() {
    return undefined;
  }
};

function identity(entityId: string): JobAttemptIdentity {
  return { jobName: "test_job", entityId, attemptGroup: "attempt-1" };
}

describe("runIdempotentStep concurrency", () => {
  test("in-memory storage: concurrent duplicate calls execute the side effect once", async () => {
    const storage = createInMemoryJobStorage();
    let executions = 0;
    const sideEffect = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      executions += 1;
      return "done";
    };

    // The loser of the race either resolves with the winner's cached
    // "done" (if it lands after completion) or rejects with
    // JobStepInProgressError (if it's genuinely concurrent) — never a
    // second execution of the side effect either way.
    const results = await Promise.allSettled([
      runIdempotentStep(storage, inlineStep, identity("rec_mem"), "step1", sideEffect, new Date()),
      runIdempotentStep(storage, inlineStep, identity("rec_mem"), "step1", sideEffect, new Date())
    ]);

    expect(executions).toBe(1);
    for (const result of results) {
      if (result.status === "fulfilled") {
        expect(result.value).toBe("done");
      } else {
        expect(result.reason).toBeInstanceOf(JobStepInProgressError);
      }
    }
  });

  describe.skipIf(!TEST_DB_URL)("Postgres storage", () => {
    test("concurrent duplicate calls execute the side effect once", async () => {
      const pool = new Pool({ connectionString: TEST_DB_URL });
      const sql: SqlExecutor = {
        async query<TRow>(sqlText: string, params: readonly unknown[]) {
          const result = await pool.query(sqlText, params as unknown[]);
          return { rows: result.rows as TRow[] } satisfies SqlQueryResult<TRow>;
        }
      };
      const storage = new PgJobStorage(sql);

      try {
        let executions = 0;
        const sideEffect = async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          executions += 1;
          return "done";
        };
        const entityId = `rec_pg_${Date.now()}`;

        const results = await Promise.allSettled([
          runIdempotentStep(storage, inlineStep, identity(entityId), "step1", sideEffect, new Date()),
          runIdempotentStep(storage, inlineStep, identity(entityId), "step1", sideEffect, new Date())
        ]);

        expect(executions).toBe(1);
        // Exactly one call should have executed and returned "done"; the
        // loser either returns the same cached result (if it lands after
        // the winner completes) or rejects with a distinct in-progress
        // error (if it lands while the winner is still running) — either
        // way, never a second execution of the side effect.
        const fulfilledValues = results
          .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
          .map((r) => r.value);
        for (const value of fulfilledValues) {
          expect(value).toBe("done");
        }
      } finally {
        await pool.end();
      }
    });
  });
});
