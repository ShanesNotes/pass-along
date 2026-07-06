import {
  EventCatalogSchema,
  transition,
  type RecEnrichment,
  type EventCatalog,
  type SubmissionAction,
  type SubmissionState
} from "../../../core/src/index.js";
import type {
  ExtractStoryResult,
  PiiFinding,
  ScoreQualityResult,
  ScrubStoryResult
} from "../intake/index.js";

export type JsonObject = Record<string, unknown>;

export type PublishDecision =
  | { outcome: "publish" }
  | { outcome: "flag"; reasons: readonly string[]; tier: string };

export interface EventsOutboxRow<TEvent extends EventCatalog = EventCatalog> {
  readonly id: string;
  readonly type: TEvent["type"];
  readonly payload: TEvent["payload"];
  readonly emittedAt: Date;
  readonly idempotencyKey: string;
}

export interface ModerationEventRow {
  readonly id: string;
  readonly recommendationId: string;
  readonly fromState: SubmissionState | null;
  readonly action: SubmissionAction;
  readonly toState: SubmissionState;
  readonly actor: string;
  readonly reason: string | null;
  readonly metadata: JsonObject;
  readonly createdAt: Date;
  readonly idempotencyKey: string;
}

export type JobStepStatus = "running" | "completed" | "failed";

export interface JobStepRecord {
  readonly idempotencyKey: string;
  readonly jobName: string;
  readonly entityId: string;
  readonly attemptGroup: string;
  readonly stepName: string;
  readonly status: JobStepStatus;
  readonly updatedAt: Date;
  readonly result?: unknown;
  readonly error?: JsonObject;
}

export interface JobsDlqRow {
  readonly id: string;
  readonly jobName: string;
  readonly entityId: string;
  readonly eventId: string | null;
  readonly attemptGroup: string;
  readonly error: JsonObject;
  readonly failedAt: Date;
  readonly replayedAt: Date | null;
}

export interface TransitionRecordInput {
  readonly recommendationId: string;
  readonly action: SubmissionAction;
  readonly actor: string;
  readonly reason?: string;
  readonly metadata?: JsonObject;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export interface AppendEventInput {
  readonly idempotencyKey: string;
  readonly emittedAt: Date;
}

export interface WriteDlqInput {
  readonly jobName: string;
  readonly entityId: string;
  readonly eventId: string | null;
  readonly attemptGroup: string;
  readonly error: JsonObject;
  readonly failedAt: Date;
}

export interface JobStoragePort {
  ensureRecommendation(
    recommendationId: string,
    initialState: SubmissionState
  ): Promise<void>;
  getRecommendationState(
    recommendationId: string
  ): Promise<SubmissionState | undefined>;
  transitionRecommendation(
    input: TransitionRecordInput
  ): Promise<ModerationEventRow>;
  listModerationEvents(
    recommendationId?: string
  ): Promise<readonly ModerationEventRow[]>;

  appendEvent<TEvent extends EventCatalog>(
    event: TEvent,
    input: AppendEventInput
  ): Promise<EventsOutboxRow<TEvent>>;
  findEvent<TType extends EventCatalog["type"]>(
    type: TType,
    predicate: (event: Extract<EventCatalog, { type: TType }>) => boolean
  ): Promise<EventsOutboxRow<Extract<EventCatalog, { type: TType }>> | undefined>;
  getEventById(eventId: string): Promise<EventsOutboxRow | undefined>;
  listEvents(): Promise<readonly EventsOutboxRow[]>;

  getPublishDecision(recommendationId: string): Promise<PublishDecision>;

  getJobStep(idempotencyKey: string): Promise<JobStepRecord | undefined>;
  upsertJobStep(record: JobStepRecord): Promise<JobStepRecord>;

  writeDlq(input: WriteDlqInput): Promise<JobsDlqRow>;
  getDlqRow(dlqId: string): Promise<JobsDlqRow | undefined>;
  listDlq(): Promise<readonly JobsDlqRow[]>;
  markDlqReplayed(dlqId: string, replayedAt: Date): Promise<JobsDlqRow>;
}

export interface IntakeRecommendationSource {
  readonly story: string;
  readonly providerName: string;
  readonly forWhom: readonly string[];
}

export interface IntakeArtifactStoragePort {
  getRestrictedOriginalRecommendation(
    recommendationId: string
  ): Promise<IntakeRecommendationSource | undefined>;
  saveScrubResult(
    recommendationId: string,
    result: ScrubStoryResult
  ): Promise<void>;
  getScrubResult(
    recommendationId: string
  ): Promise<
    | {
        readonly scrubbedStory: string;
        readonly piiFindings: readonly PiiFinding[];
        readonly flags: readonly string[];
        readonly source: ScrubStoryResult["source"];
      }
    | undefined
  >;
  saveExtractResult(
    recommendationId: string,
    result: ExtractStoryResult
  ): Promise<void>;
  getExtractResult(
    recommendationId: string
  ): Promise<
    | {
        readonly enrichment: RecEnrichment;
        readonly source: ExtractStoryResult["source"];
      }
    | undefined
  >;
  saveQualityResult(
    recommendationId: string,
    result: ScoreQualityResult
  ): Promise<void>;
  getQualityResult(
    recommendationId: string
  ): Promise<ScoreQualityResult | undefined>;
}

export function hasIntakeArtifactStorage(
  value: unknown
): value is IntakeArtifactStoragePort {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.getRestrictedOriginalRecommendation === "function" &&
    typeof candidate.saveScrubResult === "function" &&
    typeof candidate.getScrubResult === "function" &&
    typeof candidate.saveExtractResult === "function" &&
    typeof candidate.getExtractResult === "function" &&
    typeof candidate.saveQualityResult === "function" &&
    typeof candidate.getQualityResult === "function"
  );
}

export function hasMutablePublishDecision(
  value: unknown
): value is Pick<InMemoryJobStorage, "setPublishDecision"> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly setPublishDecision?: unknown }).setPublishDecision ===
      "function"
  );
}

export interface InMemoryJobStorage extends JobStoragePort {
  setPublishDecision(recommendationId: string, decision: PublishDecision): void;
}

export function createInMemoryJobStorage(): InMemoryJobStorage {
  let nextId = 1;
  const states = new Map<string, SubmissionState>();
  const publishDecisions = new Map<string, PublishDecision>();
  const moderationEvents: ModerationEventRow[] = [];
  const moderationEventsByKey = new Map<string, ModerationEventRow>();
  const events: EventsOutboxRow[] = [];
  const eventsByKey = new Map<string, EventsOutboxRow>();
  const eventsById = new Map<string, EventsOutboxRow>();
  const jobSteps = new Map<string, JobStepRecord>();
  const dlqRows: JobsDlqRow[] = [];
  const dlqRowsById = new Map<string, JobsDlqRow>();
  const dlqRowsByKey = new Map<string, JobsDlqRow>();

  const makeId = (prefix: string) => `${prefix}_${nextId++}`;

  return {
    async ensureRecommendation(recommendationId, initialState) {
      if (!states.has(recommendationId)) {
        states.set(recommendationId, initialState);
      }
    },

    async getRecommendationState(recommendationId) {
      return states.get(recommendationId);
    },

    async transitionRecommendation(input) {
      const existing = moderationEventsByKey.get(input.idempotencyKey);

      if (existing) {
        return existing;
      }

      const fromState = states.get(input.recommendationId) ?? null;

      if (fromState === null) {
        throw new Error(
          `Cannot transition unknown recommendation ${input.recommendationId}`
        );
      }

      const toState = transition(fromState, input.action);
      states.set(input.recommendationId, toState);

      const row: ModerationEventRow = {
        id: makeId("moderation"),
        recommendationId: input.recommendationId,
        fromState,
        action: input.action,
        toState,
        actor: input.actor,
        reason: input.reason ?? null,
        metadata: input.metadata ?? {},
        createdAt: input.now,
        idempotencyKey: input.idempotencyKey
      };

      moderationEvents.push(row);
      moderationEventsByKey.set(input.idempotencyKey, row);
      return row;
    },

    async listModerationEvents(recommendationId) {
      if (recommendationId === undefined) {
        return [...moderationEvents];
      }

      return moderationEvents.filter(
        (event) => event.recommendationId === recommendationId
      );
    },

    async appendEvent(event, input) {
      const existing = eventsByKey.get(input.idempotencyKey);

      if (existing) {
        return existing as EventsOutboxRow<typeof event>;
      }

      const parsed = EventCatalogSchema.parse(event) as typeof event;
      const row: EventsOutboxRow<typeof parsed> = {
        id: makeId("event"),
        type: parsed.type,
        payload: parsed.payload,
        emittedAt: input.emittedAt,
        idempotencyKey: input.idempotencyKey
      };

      events.push(row);
      eventsByKey.set(input.idempotencyKey, row);
      eventsById.set(row.id, row);
      return row;
    },

    async findEvent(type, predicate) {
      for (const row of events) {
        if (row.type !== type) {
          continue;
        }

        const event = EventCatalogSchema.parse({
          type: row.type,
          payload: row.payload
        }) as Extract<EventCatalog, { type: typeof type }>;

        if (predicate(event)) {
          return row as EventsOutboxRow<typeof event>;
        }
      }

      return undefined;
    },

    async getEventById(eventId) {
      return eventsById.get(eventId);
    },

    async listEvents() {
      return [...events];
    },

    async getPublishDecision(recommendationId) {
      return publishDecisions.get(recommendationId) ?? { outcome: "publish" };
    },

    async getJobStep(idempotencyKey) {
      return jobSteps.get(idempotencyKey);
    },

    async upsertJobStep(record) {
      jobSteps.set(record.idempotencyKey, record);
      return record;
    },

    async writeDlq(input) {
      const key = `${input.jobName}:${input.entityId}:${input.attemptGroup}`;
      const existing = dlqRowsByKey.get(key);

      if (existing) {
        return existing;
      }

      const row: JobsDlqRow = {
        id: makeId("dlq"),
        jobName: input.jobName,
        entityId: input.entityId,
        eventId: input.eventId,
        attemptGroup: input.attemptGroup,
        error: input.error,
        failedAt: input.failedAt,
        replayedAt: null
      };

      dlqRows.push(row);
      dlqRowsById.set(row.id, row);
      dlqRowsByKey.set(key, row);
      return row;
    },

    async getDlqRow(dlqId) {
      return dlqRowsById.get(dlqId);
    },

    async listDlq() {
      return [...dlqRows];
    },

    async markDlqReplayed(dlqId, replayedAt) {
      const row = dlqRowsById.get(dlqId);

      if (!row) {
        throw new Error(`Cannot mark unknown DLQ row ${dlqId} replayed`);
      }

      const updated: JobsDlqRow = { ...row, replayedAt };
      dlqRowsById.set(dlqId, updated);
      const index = dlqRows.findIndex((candidate) => candidate.id === dlqId);

      if (index >= 0) {
        dlqRows[index] = updated;
      }

      return updated;
    },

    setPublishDecision(recommendationId, decision) {
      publishDecisions.set(recommendationId, decision);
    }
  };
}
