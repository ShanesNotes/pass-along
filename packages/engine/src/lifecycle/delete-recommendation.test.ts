import { describe, expect, test } from "vitest";
import { deleteRecommendation } from "./delete-recommendation.js";
import { createInMemoryLifecycleStorage } from "./memory.js";

function seededStorage() {
  const storage = createInMemoryLifecycleStorage({
    recommendation: {
      id: "rec_1",
      status: "published",
      scrubbedStory: "A story about finding a good therapist.",
      recommenderContactHash: "hash_abc"
    },
    originalStory: "My name is Jane and I saw Dr. Smith for anxiety.",
    recTagIds: ["tag_1", "tag_2"],
    hasEmbedding: true,
    hasIntakeArtifacts: true,
    moderationEvents: [
      {
        id: "mod_1",
        action: "all_green",
        reason: "flagged for review: mentions a full name",
        metadata: { job_name: "decidePublish" }
      }
    ],
    outboxEvents: [
      {
        id: "event_1",
        type: "submission.published",
        payload: { recommendation_id: "rec_1" }
      }
    ]
  });

  return storage;
}

describe("deleteRecommendation", () => {
  test("cascades removal across every artifact tied to the recommendation", async () => {
    const storage = seededStorage();

    const result = await deleteRecommendation({
      recommendationId: "rec_1",
      storage,
      now: () => new Date("2026-07-07T00:00:00.000Z")
    });

    expect(result).toEqual({ recommendationId: "rec_1", deleted: true });

    // No orphans: every content-bearing artifact tied to rec_1 is gone.
    expect(storage.getOriginalStory("rec_1")).toBeUndefined();
    expect(storage.getRecTagIds("rec_1")).toEqual([]);
    expect(storage.hasEmbedding("rec_1")).toBe(false);
    expect(storage.hasIntakeArtifacts("rec_1")).toBe(false);

    // The recommendation row survives as a redacted stub (FK anchor for the
    // tombstone), not hard-deleted.
    const row = storage.getRecommendationRow("rec_1");
    expect(row).toMatchObject({
      status: "removed",
      scrubbedStory: null,
      recommenderContactHash: null
    });
    expect(row?.removedAt).toEqual(new Date("2026-07-07T00:00:00.000Z"));

    // Existing moderation events are redacted in place, not deleted, plus a
    // no-content tombstone row is appended recording the deletion.
    const moderationEvents = storage.getModerationEvents("rec_1");
    expect(moderationEvents).toHaveLength(2);
    const original = moderationEvents.find((event) => event.id === "mod_1");
    expect(original).toMatchObject({ reason: null, metadata: {} });
    const tombstone = moderationEvents.find((event) => event.action === "deleted");
    expect(tombstone).toMatchObject({ reason: null, metadata: {} });

    // Outbox events tied to rec_1 are redacted in place (append-only
    // exception), row count unchanged.
    const outboxEvents = storage.getOutboxEvents();
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.payload).toEqual({
      recommendation_id: "rec_1",
      redacted: true
    });
  });

  test("is idempotent: calling it twice does not duplicate the tombstone", async () => {
    const storage = seededStorage();
    const now = () => new Date("2026-07-07T00:00:00.000Z");

    await deleteRecommendation({ recommendationId: "rec_1", storage, now });
    await deleteRecommendation({ recommendationId: "rec_1", storage, now });

    const tombstones = storage
      .getModerationEvents("rec_1")
      .filter((event) => event.action === "deleted");
    expect(tombstones).toHaveLength(1);
  });

  test("reports storage_unavailable when the storage doesn't implement the lifecycle port", async () => {
    const result = await deleteRecommendation({
      recommendationId: "rec_1",
      storage: {}
    });

    expect(result).toEqual({
      recommendationId: "rec_1",
      deleted: false,
      skippedReason: "storage_unavailable"
    });
  });

  test("reports not_found for an unknown recommendation", async () => {
    const storage = seededStorage();

    const result = await deleteRecommendation({
      recommendationId: "rec_does_not_exist",
      storage
    });

    expect(result).toEqual({
      recommendationId: "rec_does_not_exist",
      deleted: false,
      skippedReason: "not_found"
    });
  });
});
