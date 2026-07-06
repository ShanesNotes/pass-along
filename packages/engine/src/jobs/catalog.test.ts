import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_RETRY_CONFIG,
  EVENT_DEFINITIONS,
  EVENT_TYPES,
  JOB_DEFINITIONS,
  JOB_NAMES,
  createInMemoryJobStorage,
  createInlineJobRunner,
  replayDlq,
  type InMemoryJobStorage
} from "./index.js";
import type { EventCatalog } from "../../../core/src/index.js";

const fixedNow = () => new Date("2026-07-06T12:00:00.000Z");

describe("jobs catalog", () => {
  test("covers the spec event and job catalog", () => {
    expect(EVENT_DEFINITIONS.map((event) => event.type)).toEqual(EVENT_TYPES);
    expect(JOB_DEFINITIONS.map((job) => job.name)).toEqual(JOB_NAMES);
    expect(JOB_DEFINITIONS).toHaveLength(13);
  });

  test("drives a fake submission received to published", async () => {
    const { storage, runner } = createHarness();

    await runner.dispatch(submissionReceived("rec-publish"), {
      eventId: "event-publish"
    });

    await expect(storage.getRecommendationState("rec-publish")).resolves.toBe(
      "published"
    );
    await expect(actions(storage, "rec-publish")).resolves.toEqual([
      "scrub",
      "extract",
      "score",
      "all_green"
    ]);
    await expect(eventTypes(storage)).resolves.toEqual([
      "submission.received",
      "provider.created",
      "provider.verified",
      "submission.published"
    ]);
  });

  test("writes exhausted failures to DLQ and replays them to success", async () => {
    const { storage, runner } = createHarness({
      failSteps: { scoreQuality: DEFAULT_RETRY_CONFIG.maxAttempts }
    });

    await runner.dispatch(submissionReceived("rec-dlq"), {
      eventId: "event-dlq"
    });

    await expect(storage.getRecommendationState("rec-dlq")).resolves.toBe(
      "enriching"
    );
    const dlqRows = await storage.listDlq();
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]).toMatchObject({
      jobName: "onSubmissionReceived",
      entityId: "rec-dlq",
      attemptGroup: "event-dlq",
      replayedAt: null
    });

    const dlqRow = dlqRows[0];

    if (!dlqRow) {
      throw new Error("DLQ row missing");
    }

    await replayDlq({
      storage,
      runner,
      dlqId: dlqRow.id,
      now: fixedNow
    });

    await expect(storage.getRecommendationState("rec-dlq")).resolves.toBe(
      "published"
    );
    const replayed = await storage.getDlqRow(dlqRow.id);
    expect(replayed?.replayedAt).toEqual(fixedNow());
    await expect(actions(storage, "rec-dlq")).resolves.toEqual([
      "scrub",
      "extract",
      "score",
      "all_green"
    ]);
  });

  test("parks flagged submissions in review and resumes on approval", async () => {
    const { storage, runner } = createHarness();
    storage.setPublishDecision("rec-review", {
      outcome: "flag",
      reasons: ["stub quality review"],
      tier: "quality"
    });

    await runner.dispatch(submissionReceived("rec-review"), {
      eventId: "event-review"
    });

    await expect(storage.getRecommendationState("rec-review")).resolves.toBe(
      "review_pending"
    );
    await expect(actions(storage, "rec-review")).resolves.toEqual([
      "scrub",
      "extract",
      "score",
      "any_flag"
    ]);
    expect((await eventTypes(storage)).filter((type) => type === "submission.published")).toHaveLength(0);

    await runner.dispatch(
      {
        type: "moderation.decided",
        payload: {
          recommendation_id: "rec-review",
          action: "approve",
          reviewer: "reviewer-1"
        }
      },
      { eventId: "event-moderation-approve" }
    );

    await expect(storage.getRecommendationState("rec-review")).resolves.toBe(
      "published"
    );
    await expect(actions(storage, "rec-review")).resolves.toEqual([
      "scrub",
      "extract",
      "score",
      "any_flag",
      "approve"
    ]);
    expect((await eventTypes(storage)).filter((type) => type === "submission.published")).toHaveLength(1);
  });

  test("idempotent redelivery creates no duplicate outbox or transition rows", async () => {
    const { storage, runner } = createHarness();
    const event = submissionReceived("rec-idempotent");

    await runner.dispatch(event, { eventId: "event-idempotent" });
    const eventCount = (await storage.listEvents()).length;
    const transitionCount = (
      await storage.listModerationEvents("rec-idempotent")
    ).length;

    await runner.dispatch(event, { eventId: "event-idempotent" });

    await expect(storage.getRecommendationState("rec-idempotent")).resolves.toBe(
      "published"
    );
    await expect(storage.listEvents()).resolves.toHaveLength(eventCount);
    await expect(
      storage.listModerationEvents("rec-idempotent")
    ).resolves.toHaveLength(transitionCount);
  });

  test("keeps queue SDK imports contained in runner.ts", () => {
    const jobsDir = dirname(fileURLToPath(import.meta.url));
    const offenders = collectSourceFiles(jobsDir)
      .filter((file) => !file.endsWith("runner.ts"))
      .filter((file) => /from\s+["']inngest(?:\/[^"']*)?["']/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});

function createHarness(options?: { readonly failSteps?: Record<string, number> }) {
  const storage = createInMemoryJobStorage();
  const runnerOptions =
    options?.failSteps === undefined
      ? {
          storage,
          jobs: JOB_DEFINITIONS,
          now: fixedNow
        }
      : {
          storage,
          jobs: JOB_DEFINITIONS,
          now: fixedNow,
          failSteps: options.failSteps
        };
  const runner = createInlineJobRunner(runnerOptions);

  return { storage, runner };
}

function submissionReceived(
  recommendationId: string
): Extract<EventCatalog, { type: "submission.received" }> {
  return {
    type: "submission.received",
    payload: {
      recommendation_id: recommendationId
    }
  };
}

async function actions(
  storage: InMemoryJobStorage,
  recommendationId: string
): Promise<readonly string[]> {
  return (await storage.listModerationEvents(recommendationId)).map(
    (event) => event.action
  );
}

async function eventTypes(
  storage: InMemoryJobStorage
): Promise<readonly string[]> {
  return (await storage.listEvents()).map((event) => event.type);
}

function collectSourceFiles(dir: string): readonly string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}
