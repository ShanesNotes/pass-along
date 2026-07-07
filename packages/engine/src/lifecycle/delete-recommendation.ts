import {
  hasLifecycleStorage,
  hasTransactionalLifecycleStorage,
  type LifecycleStoragePort
} from "./ports.js";

export interface DeleteRecommendationInput {
  readonly recommendationId: string;
  readonly storage: unknown;
  readonly now?: () => Date;
}

export interface DeleteRecommendationResult {
  readonly recommendationId: string;
  readonly deleted: boolean;
  readonly skippedReason?: "storage_unavailable" | "not_found";
}

// Cascade order matches docs/PRIVACY-LIFECYCLE.md: original story, tags,
// embedding, and intake artifacts are deleted outright (100% derived from or
// equal to raw submitted content); the recommendations row itself survives
// as a redacted "removed" stub (FK anchor for the tombstone below); existing
// moderation/outbox events tied to this recommendation are redacted in
// place; then one tombstone moderation_events row records that a deletion
// happened, with no content beyond the fact of it.
//
// Audit finding F2: the whole cascade runs inside one transaction when the
// storage supports it (TransactionalLifecycleStorage) — otherwise a crash
// between, say, deleting the original story and writing the tombstone would
// leave a partially-deleted recommendation with no record that a deletion
// was ever attempted.
export async function deleteRecommendation(
  input: DeleteRecommendationInput
): Promise<DeleteRecommendationResult> {
  if (!hasLifecycleStorage(input.storage)) {
    return {
      recommendationId: input.recommendationId,
      deleted: false,
      skippedReason: "storage_unavailable"
    };
  }

  const now = input.now?.() ?? new Date();

  if (hasTransactionalLifecycleStorage(input.storage)) {
    return input.storage.withLifecycleTransaction((tx) =>
      runCascade(tx, input.recommendationId, now)
    );
  }

  return runCascade(input.storage, input.recommendationId, now);
}

async function runCascade(
  storage: LifecycleStoragePort,
  recommendationId: string,
  now: Date
): Promise<DeleteRecommendationResult> {
  const status = await storage.getRecommendationStatus(recommendationId);

  if (status === undefined) {
    return { recommendationId, deleted: false, skippedReason: "not_found" };
  }

  await storage.deleteOriginalStory(recommendationId);
  await storage.deleteRecTags(recommendationId);
  await storage.deleteEmbedding(recommendationId);
  await storage.deleteIntakeArtifacts(recommendationId);
  await storage.redactRecommendation(recommendationId, now);
  await storage.redactModerationEventsForRecommendation(recommendationId);
  await storage.redactOutboxEventsForRecommendation(recommendationId);
  await storage.writeDeletionTombstone({
    recommendationId,
    fromState: status,
    now
  });

  return { recommendationId, deleted: true };
}
