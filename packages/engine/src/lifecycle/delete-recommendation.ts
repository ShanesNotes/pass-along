import { hasLifecycleStorage } from "./ports.js";

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

  const status = await input.storage.getRecommendationStatus(
    input.recommendationId
  );

  if (status === undefined) {
    return {
      recommendationId: input.recommendationId,
      deleted: false,
      skippedReason: "not_found"
    };
  }

  const now = input.now?.() ?? new Date();

  await input.storage.deleteOriginalStory(input.recommendationId);
  await input.storage.deleteRecTags(input.recommendationId);
  await input.storage.deleteEmbedding(input.recommendationId);
  await input.storage.deleteIntakeArtifacts(input.recommendationId);
  await input.storage.redactRecommendation(input.recommendationId, now);
  await input.storage.redactModerationEventsForRecommendation(
    input.recommendationId
  );
  await input.storage.redactOutboxEventsForRecommendation(
    input.recommendationId
  );
  await input.storage.writeDeletionTombstone({
    recommendationId: input.recommendationId,
    fromState: status,
    now
  });

  return { recommendationId: input.recommendationId, deleted: true };
}
