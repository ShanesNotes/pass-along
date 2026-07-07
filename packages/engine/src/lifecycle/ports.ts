// Storage surface deleteRecommendation() (delete-recommendation.ts) needs to
// honor a WA MHMDA-style deletion request end to end. Deliberately its own
// port rather than an addition to JobStoragePort (jobs/ports.ts): the cascade
// touches tables (recommendation_originals, rec_tags, rec_embeddings,
// rec_intake_artifacts) that JobStoragePort's implementers don't all own, and
// widening that interface would ripple into every existing caller. Any store
// that wants to support deletion implements this port additively, duck-typed
// via hasLifecycleStorage() the same way embedRecommendation() and the
// scrub/extract/score steps duck-type their own storage extensions.
export interface LifecycleStoragePort {
  // undefined => no recommendation with this id is known to this store.
  getRecommendationStatus(recommendationId: string): Promise<string | undefined>;

  // Redacts the recommendations row in place rather than deleting it: the
  // row is the FK anchor for moderation_events (including the tombstone this
  // cascade writes) and for provider/aggregate stats, so it survives as a
  // "removed" stub with its content columns cleared.
  redactRecommendation(recommendationId: string, now: Date): Promise<void>;

  deleteOriginalStory(recommendationId: string): Promise<void>;
  deleteRecTags(recommendationId: string): Promise<void>;
  deleteEmbedding(recommendationId: string): Promise<void>;
  deleteIntakeArtifacts(recommendationId: string): Promise<void>;

  // Exception to the events-outbox append-only invariant (documented in
  // docs/PRIVACY-LIFECYCLE.md): existing rows survive with their id/type/
  // emitted_at/idempotency_key intact, but any PII-bearing payload/metadata/
  // reason content tied to this recommendation is overwritten in place.
  redactModerationEventsForRecommendation(recommendationId: string): Promise<void>;
  redactOutboxEventsForRecommendation(recommendationId: string): Promise<void>;

  writeDeletionTombstone(input: DeletionTombstoneInput): Promise<void>;
}

export interface DeletionTombstoneInput {
  readonly recommendationId: string;
  readonly fromState: string | null;
  readonly now: Date;
}

// Optional capability (audit finding F2): a store that can run the whole
// eight-step cascade atomically implements this too, additive to
// LifecycleStoragePort the same way the port itself is additive to
// JobStoragePort. deleteRecommendation() uses it when present so a crash
// mid-cascade can't leave content deleted but no tombstone written (or vice
// versa); storage that doesn't implement it (e.g. the in-memory test
// double) just runs the steps sequentially as before.
export interface TransactionalLifecycleStorage {
  withLifecycleTransaction<T>(
    fn: (tx: LifecycleStoragePort) => Promise<T>
  ): Promise<T>;
}

export function hasTransactionalLifecycleStorage(
  value: unknown
): value is TransactionalLifecycleStorage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly withLifecycleTransaction?: unknown })
      .withLifecycleTransaction === "function"
  );
}

export function hasLifecycleStorage(
  value: unknown
): value is LifecycleStoragePort {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.getRecommendationStatus === "function" &&
    typeof candidate.redactRecommendation === "function" &&
    typeof candidate.deleteOriginalStory === "function" &&
    typeof candidate.deleteRecTags === "function" &&
    typeof candidate.deleteEmbedding === "function" &&
    typeof candidate.deleteIntakeArtifacts === "function" &&
    typeof candidate.redactModerationEventsForRecommendation === "function" &&
    typeof candidate.redactOutboxEventsForRecommendation === "function" &&
    typeof candidate.writeDeletionTombstone === "function"
  );
}
