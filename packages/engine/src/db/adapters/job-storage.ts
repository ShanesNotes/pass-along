import {
  EventCatalogSchema,
  transition,
  type EventCatalog,
  type SubmissionAction,
  type SubmissionState
} from "../../../../core/src/index.js";
import {
  JOB_STEP_LEASE_MS,
  type AppendEventInput,
  type EventsOutboxRow,
  type JobStepClaimResult,
  type JobStepRecord,
  type JobStoragePort,
  type JobsDlqRow,
  type ModerationEventRow,
  type PublishDecision,
  type TransitionRecordInput,
  type WriteDlqInput
} from "../../jobs/ports.js";
import type { SqlExecutor } from "../../retrieval/pgvector.js";

interface RecommendationRow {
  readonly status: SubmissionState;
}

interface ModerationEventDbRow {
  readonly id: string;
  readonly recommendation_id: string;
  readonly from_state: SubmissionState | null;
  readonly action: SubmissionAction;
  readonly to_state: SubmissionState;
  readonly actor: string;
  readonly reason: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: Date;
  readonly idempotency_key: string | null;
}

interface EventDbRow {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly emitted_at: Date;
  readonly idempotency_key: string | null;
}

interface JobStepDbRow {
  readonly idempotency_key: string;
  readonly job_name: string;
  readonly entity_id: string;
  readonly attempt_group: string;
  readonly step_name: string;
  readonly status: JobStepRecord["status"];
  readonly result: unknown;
  readonly error: Record<string, unknown> | null;
}

interface JobsDlqDbRow {
  readonly id: string;
  readonly job_name: string;
  readonly entity_id: string;
  readonly event_id: string | null;
  readonly attempt_group: string;
  readonly error: Record<string, unknown>;
  readonly failed_at: Date;
  readonly replayed_at: Date | null;
}

interface QualityArtifactRow {
  readonly quality: { readonly flags?: readonly string[] } | null;
}

// Implements JobStoragePort against recommendations/moderation_events/
// events/jobs_dlq/job_steps. `ensureRecommendation` assumes the
// recommendations row already exists (created by the submission-writing
// step, which needs provider info this port doesn't carry) — it only reads
// back the current status, matching the in-memory adapter's "don't
// overwrite an already-tracked state" semantics.
export class PgJobStorage implements JobStoragePort {
  constructor(private readonly sql: SqlExecutor) {}

  async ensureRecommendation(
    recommendationId: string,
    initialState: SubmissionState
  ): Promise<void> {
    const existing = await this.getRecommendationState(recommendationId);

    if (existing !== undefined) {
      return;
    }

    throw new Error(
      `PgJobStorage.ensureRecommendation: no recommendations row for ${recommendationId} ` +
        `(expected status ${initialState}) — the row must be inserted by the ` +
        "submission-writing step first; this port has no provider info to create one."
    );
  }

  async getRecommendationState(
    recommendationId: string
  ): Promise<SubmissionState | undefined> {
    const result = await this.sql.query<RecommendationRow>(
      "select status from public.recommendations where id = $1::uuid",
      [recommendationId]
    );

    return result.rows[0]?.status;
  }

  async transitionRecommendation(
    input: TransitionRecordInput
  ): Promise<ModerationEventRow> {
    const existing = await this.sql.query<ModerationEventDbRow>(
      "select * from public.moderation_events where idempotency_key = $1",
      [input.idempotencyKey]
    );
    const existingRow = existing.rows[0];

    if (existingRow) {
      return moderationEventFromRow(existingRow);
    }

    const currentState = await this.getRecommendationState(
      input.recommendationId
    );

    if (currentState === undefined) {
      throw new Error(
        `Cannot transition unknown recommendation ${input.recommendationId}`
      );
    }

    const toState = transition(currentState, input.action);

    return this.writeTransition(input, currentState, toState);
  }

  private async writeTransition(
    input: TransitionRecordInput,
    fromState: SubmissionState,
    toState: SubmissionState
  ): Promise<ModerationEventRow> {
    await this.sql.query(
      "update public.recommendations set status = $2::text, updated_at = now() where id = $1::uuid",
      [input.recommendationId, toState]
    );

    const inserted = await this.sql.query<ModerationEventDbRow>(
      `
insert into public.moderation_events
  (recommendation_id, from_state, action, to_state, actor, reason, metadata, created_at, idempotency_key)
values ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
returning *
`.trim(),
      [
        input.recommendationId,
        fromState,
        input.action,
        toState,
        input.actor,
        input.reason ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.now,
        input.idempotencyKey
      ]
    );
    const row = inserted.rows[0];

    if (!row) {
      throw new Error("moderation_events insert returned no row");
    }

    return moderationEventFromRow(row);
  }

  async listModerationEvents(
    recommendationId?: string
  ): Promise<readonly ModerationEventRow[]> {
    const result = recommendationId
      ? await this.sql.query<ModerationEventDbRow>(
          "select * from public.moderation_events where recommendation_id = $1::uuid order by created_at asc",
          [recommendationId]
        )
      : await this.sql.query<ModerationEventDbRow>(
          "select * from public.moderation_events order by created_at asc",
          []
        );

    return result.rows.map(moderationEventFromRow);
  }

  async appendEvent<TEvent extends EventCatalog>(
    event: TEvent,
    input: AppendEventInput
  ): Promise<EventsOutboxRow<TEvent>> {
    const existing = await this.sql.query<EventDbRow>(
      "select * from public.events where idempotency_key = $1",
      [input.idempotencyKey]
    );
    const existingRow = existing.rows[0];

    if (existingRow) {
      return eventRowFrom(existingRow) as EventsOutboxRow<TEvent>;
    }

    const parsed = EventCatalogSchema.parse(event) as TEvent;
    const inserted = await this.sql.query<EventDbRow>(
      `
insert into public.events (type, payload, emitted_at, idempotency_key)
values ($1, $2::jsonb, $3, $4)
returning *
`.trim(),
      [
        parsed.type,
        JSON.stringify(parsed.payload),
        input.emittedAt,
        input.idempotencyKey
      ]
    );
    const row = inserted.rows[0];

    if (!row) {
      throw new Error("events insert returned no row");
    }

    return eventRowFrom(row) as EventsOutboxRow<TEvent>;
  }

  async findEvent<TType extends EventCatalog["type"]>(
    type: TType,
    predicate: (event: Extract<EventCatalog, { type: TType }>) => boolean
  ): Promise<EventsOutboxRow<Extract<EventCatalog, { type: TType }>> | undefined> {
    const result = await this.sql.query<EventDbRow>(
      "select * from public.events where type = $1 order by emitted_at asc",
      [type]
    );

    for (const row of result.rows) {
      const event = EventCatalogSchema.parse({
        type: row.type,
        payload: row.payload
      }) as Extract<EventCatalog, { type: TType }>;

      if (predicate(event)) {
        return eventRowFrom(row) as EventsOutboxRow<
          Extract<EventCatalog, { type: TType }>
        >;
      }
    }

    return undefined;
  }

  async getEventById(eventId: string): Promise<EventsOutboxRow | undefined> {
    const result = await this.sql.query<EventDbRow>(
      "select * from public.events where id = $1::uuid",
      [eventId]
    );

    const row = result.rows[0];
    return row ? eventRowFrom(row) : undefined;
  }

  async listEvents(): Promise<readonly EventsOutboxRow[]> {
    const result = await this.sql.query<EventDbRow>(
      "select * from public.events order by emitted_at asc",
      []
    );

    return result.rows.map(eventRowFrom);
  }

  // No mutable override table: the DB adapter derives the publish decision
  // straight from the persisted quality flags (rec_intake_artifacts.quality),
  // matching publishDecisionForFlags() in jobs/catalog.ts. There is no
  // DB-backed equivalent of the in-memory setPublishDecision escape hatch
  // (hasMutablePublishDecision guards it off for any storage that doesn't
  // implement it, so this is a safe, intentional omission).
  async getPublishDecision(recommendationId: string): Promise<PublishDecision> {
    const result = await this.sql.query<QualityArtifactRow>(
      "select quality from public.rec_intake_artifacts where recommendation_id = $1::uuid",
      [recommendationId]
    );
    const flags = result.rows[0]?.quality?.flags ?? [];

    if (flags.length === 0) {
      return { outcome: "publish" };
    }

    return { outcome: "flag", reasons: flags, tier: "intake_quality" };
  }

  async getJobStep(idempotencyKey: string): Promise<JobStepRecord | undefined> {
    const result = await this.sql.query<JobStepDbRow>(
      "select * from public.job_steps where idempotency_key = $1",
      [idempotencyKey]
    );

    const row = result.rows[0];
    return row ? jobStepFromRow(row) : undefined;
  }

  // Atomic claim (audit finding F4): a single INSERT ... ON CONFLICT DO
  // UPDATE ... WHERE <reclaimable> RETURNING *. Postgres serializes
  // concurrent statements that conflict on the same key (row-level lock
  // under READ COMMITTED), so exactly one concurrent caller ever sees a
  // returned row here — a completed row is never matched by the WHERE
  // clause, so it's never touched by this call.
  async claimJobStep(record: JobStepRecord): Promise<JobStepClaimResult> {
    const leaseSeconds = JOB_STEP_LEASE_MS / 1000;
    const claim = await this.sql.query<JobStepDbRow>(
      `
insert into public.job_steps
  (idempotency_key, job_name, entity_id, attempt_group, step_name, status, updated_at)
values ($1, $2, $3, $4, $5, 'running', $6)
on conflict (idempotency_key) do update set
  status = 'running',
  updated_at = excluded.updated_at
where public.job_steps.status = 'failed'
   or (
     public.job_steps.status = 'running'
     and public.job_steps.updated_at < $6::timestamptz - make_interval(secs => $7)
   )
returning *
`.trim(),
      [
        record.idempotencyKey,
        record.jobName,
        record.entityId,
        record.attemptGroup,
        record.stepName,
        record.updatedAt,
        leaseSeconds
      ]
    );

    if (claim.rows[0]) {
      return { claimed: true };
    }

    const existing = await this.getJobStep(record.idempotencyKey);
    return { claimed: false, ...(existing ? { existing } : {}) };
  }

  async upsertJobStep(record: JobStepRecord): Promise<JobStepRecord> {
    await this.sql.query(
      `
insert into public.job_steps
  (idempotency_key, job_name, entity_id, attempt_group, step_name, status, result, error, updated_at)
values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now())
on conflict (idempotency_key) do update set
  status = excluded.status,
  result = excluded.result,
  error = excluded.error,
  updated_at = now()
`.trim(),
      [
        record.idempotencyKey,
        record.jobName,
        record.entityId,
        record.attemptGroup,
        record.stepName,
        record.status,
        record.result === undefined ? null : JSON.stringify(record.result),
        record.error === undefined ? null : JSON.stringify(record.error)
      ]
    );

    return record;
  }

  async writeDlq(input: WriteDlqInput): Promise<JobsDlqRow> {
    const inserted = await this.sql.query<JobsDlqDbRow>(
      `
insert into public.jobs_dlq (job_name, entity_id, event_id, attempt_group, error, failed_at)
values ($1, $2, $3::uuid, $4, $5::jsonb, $6)
returning *
`.trim(),
      [
        input.jobName,
        input.entityId,
        input.eventId,
        input.attemptGroup,
        JSON.stringify(input.error),
        input.failedAt
      ]
    );
    const row = inserted.rows[0];

    if (!row) {
      throw new Error("jobs_dlq insert returned no row");
    }

    return dlqRowFrom(row);
  }

  async getDlqRow(dlqId: string): Promise<JobsDlqRow | undefined> {
    const result = await this.sql.query<JobsDlqDbRow>(
      "select * from public.jobs_dlq where id = $1::uuid",
      [dlqId]
    );

    const row = result.rows[0];
    return row ? dlqRowFrom(row) : undefined;
  }

  async listDlq(): Promise<readonly JobsDlqRow[]> {
    const result = await this.sql.query<JobsDlqDbRow>(
      "select * from public.jobs_dlq order by failed_at asc",
      []
    );

    return result.rows.map(dlqRowFrom);
  }

  async markDlqReplayed(dlqId: string, replayedAt: Date): Promise<JobsDlqRow> {
    const result = await this.sql.query<JobsDlqDbRow>(
      "update public.jobs_dlq set replayed_at = $2 where id = $1::uuid returning *",
      [dlqId, replayedAt]
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error(`Cannot mark unknown DLQ row ${dlqId} replayed`);
    }

    return dlqRowFrom(row);
  }
}

function moderationEventFromRow(row: ModerationEventDbRow): ModerationEventRow {
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    fromState: row.from_state,
    action: row.action,
    toState: row.to_state,
    actor: row.actor,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.created_at,
    idempotencyKey: row.idempotency_key ?? ""
  };
}

function eventRowFrom(row: EventDbRow): EventsOutboxRow {
  return {
    id: row.id,
    type: row.type as EventCatalog["type"],
    payload: row.payload as EventCatalog["payload"],
    emittedAt: row.emitted_at,
    idempotencyKey: row.idempotency_key ?? ""
  };
}

function jobStepFromRow(row: JobStepDbRow): JobStepRecord {
  return {
    idempotencyKey: row.idempotency_key,
    jobName: row.job_name,
    entityId: row.entity_id,
    attemptGroup: row.attempt_group,
    stepName: row.step_name,
    status: row.status,
    updatedAt: new Date(),
    ...(row.result !== null && row.result !== undefined
      ? { result: row.result }
      : {}),
    ...(row.error ? { error: row.error } : {})
  };
}

function dlqRowFrom(row: JobsDlqDbRow): JobsDlqRow {
  return {
    id: row.id,
    jobName: row.job_name,
    entityId: row.entity_id,
    eventId: row.event_id,
    attemptGroup: row.attempt_group,
    error: row.error,
    failedAt: row.failed_at,
    replayedAt: row.replayed_at
  };
}
