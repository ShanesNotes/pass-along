import type { DeletionTombstoneInput, LifecycleStoragePort } from "./ports.js";

export interface InMemoryModerationEventRow {
  readonly id: string;
  readonly recommendationId: string;
  readonly action: string;
  readonly reason: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface InMemoryOutboxEventRow {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface InMemoryRecommendationRow {
  readonly id: string;
  status: string;
  removedAt: Date | null;
  scrubbedStory: string | null;
  recommenderContactHash: string | null;
}

export interface LifecycleSeed {
  readonly recommendation: {
    readonly id: string;
    readonly status: string;
    readonly scrubbedStory?: string;
    readonly recommenderContactHash?: string;
  };
  readonly originalStory?: string;
  readonly recTagIds?: readonly string[];
  readonly hasEmbedding?: boolean;
  readonly hasIntakeArtifacts?: boolean;
  readonly moderationEvents?: readonly Omit<
    InMemoryModerationEventRow,
    "recommendationId"
  >[];
  readonly outboxEvents?: readonly (Omit<InMemoryOutboxEventRow, "payload"> & {
    readonly payload: Record<string, unknown>;
  })[];
}

// In-memory LifecycleStoragePort for delete-recommendation.test.ts and any
// caller that hasn't wired a DB. Inspection getters (getOriginalStory,
// getRecTagIds, ...) exist only so tests can assert the cascade actually
// removed each artifact — production callers only ever see the port
// methods.
export class InMemoryLifecycleStorage implements LifecycleStoragePort {
  private readonly recommendations = new Map<string, InMemoryRecommendationRow>();
  private readonly originalStories = new Map<string, string>();
  private readonly recTagIds = new Map<string, Set<string>>();
  private readonly embeddings = new Set<string>();
  private readonly intakeArtifacts = new Set<string>();
  private readonly moderationEvents: InMemoryModerationEventRow[] = [];
  private readonly outboxEvents: InMemoryOutboxEventRow[] = [];
  private readonly tombstoned = new Set<string>();

  seed(input: LifecycleSeed): void {
    this.recommendations.set(input.recommendation.id, {
      id: input.recommendation.id,
      status: input.recommendation.status,
      removedAt: null,
      scrubbedStory: input.recommendation.scrubbedStory ?? null,
      recommenderContactHash: input.recommendation.recommenderContactHash ?? null
    });

    if (input.originalStory !== undefined) {
      this.originalStories.set(input.recommendation.id, input.originalStory);
    }

    if (input.recTagIds && input.recTagIds.length > 0) {
      this.recTagIds.set(input.recommendation.id, new Set(input.recTagIds));
    }

    if (input.hasEmbedding) {
      this.embeddings.add(input.recommendation.id);
    }

    if (input.hasIntakeArtifacts) {
      this.intakeArtifacts.add(input.recommendation.id);
    }

    for (const event of input.moderationEvents ?? []) {
      this.moderationEvents.push({
        ...event,
        recommendationId: input.recommendation.id
      });
    }

    for (const event of input.outboxEvents ?? []) {
      this.outboxEvents.push(event);
    }
  }

  async getRecommendationStatus(
    recommendationId: string
  ): Promise<string | undefined> {
    return this.recommendations.get(recommendationId)?.status;
  }

  async redactRecommendation(recommendationId: string, now: Date): Promise<void> {
    const row = this.recommendations.get(recommendationId);

    if (!row) {
      return;
    }

    this.recommendations.set(recommendationId, {
      ...row,
      status: "removed",
      removedAt: now,
      scrubbedStory: null,
      recommenderContactHash: null
    });
  }

  async deleteOriginalStory(recommendationId: string): Promise<void> {
    this.originalStories.delete(recommendationId);
  }

  async deleteRecTags(recommendationId: string): Promise<void> {
    this.recTagIds.delete(recommendationId);
  }

  async deleteEmbedding(recommendationId: string): Promise<void> {
    this.embeddings.delete(recommendationId);
  }

  async deleteIntakeArtifacts(recommendationId: string): Promise<void> {
    this.intakeArtifacts.delete(recommendationId);
  }

  async redactModerationEventsForRecommendation(
    recommendationId: string
  ): Promise<void> {
    for (let index = 0; index < this.moderationEvents.length; index += 1) {
      const event = this.moderationEvents[index];

      if (event && event.recommendationId === recommendationId) {
        this.moderationEvents[index] = { ...event, reason: null, metadata: {} };
      }
    }
  }

  async redactOutboxEventsForRecommendation(
    recommendationId: string
  ): Promise<void> {
    for (let index = 0; index < this.outboxEvents.length; index += 1) {
      const event = this.outboxEvents[index];
      const id =
        event?.payload.recommendation_id ?? event?.payload.rec_id ?? undefined;

      if (event && id === recommendationId) {
        this.outboxEvents[index] = {
          ...event,
          payload: { recommendation_id: recommendationId, redacted: true }
        };
      }
    }
  }

  async writeDeletionTombstone(input: DeletionTombstoneInput): Promise<void> {
    const key = `deletion:${input.recommendationId}`;

    if (this.tombstoned.has(key)) {
      return;
    }

    this.tombstoned.add(key);
    this.moderationEvents.push({
      id: `moderation_tombstone_${this.moderationEvents.length + 1}`,
      recommendationId: input.recommendationId,
      action: "deleted",
      reason: null,
      metadata: {}
    });
  }

  getRecommendationRow(
    recommendationId: string
  ): InMemoryRecommendationRow | undefined {
    return this.recommendations.get(recommendationId);
  }

  getOriginalStory(recommendationId: string): string | undefined {
    return this.originalStories.get(recommendationId);
  }

  getRecTagIds(recommendationId: string): readonly string[] {
    return [...(this.recTagIds.get(recommendationId) ?? [])];
  }

  hasEmbedding(recommendationId: string): boolean {
    return this.embeddings.has(recommendationId);
  }

  hasIntakeArtifacts(recommendationId: string): boolean {
    return this.intakeArtifacts.has(recommendationId);
  }

  getModerationEvents(
    recommendationId: string
  ): readonly InMemoryModerationEventRow[] {
    return this.moderationEvents.filter(
      (event) => event.recommendationId === recommendationId
    );
  }

  getOutboxEvents(): readonly InMemoryOutboxEventRow[] {
    return [...this.outboxEvents];
  }
}

export function createInMemoryLifecycleStorage(
  seed?: LifecycleSeed
): InMemoryLifecycleStorage {
  const store = new InMemoryLifecycleStorage();

  if (seed) {
    store.seed(seed);
  }

  return store;
}
