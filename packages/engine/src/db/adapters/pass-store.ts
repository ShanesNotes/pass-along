import { extractStory, scoreQuality } from "../../intake/index.js";
import type {
  ExtractStoryResult,
  PiiFinding,
  ScoreQualityResult,
  ScrubStoryResult
} from "../../intake/index.js";
import type {
  AppendEventInput,
  EventsOutboxRow,
  IntakeRecommendationSource,
  JobStepClaimResult,
  JobStepRecord,
  JobStoragePort,
  JobsDlqRow,
  ModerationEventRow,
  PublishDecision,
  TransitionRecordInput,
  WriteDlqInput
} from "../../jobs/ports.js";
import type { RetrievalDocument } from "../../retrieval/index.js";
import type {
  EventCatalog,
  RecEnrichment,
  RecEnrichmentTag,
  SubmissionAction,
  SubmissionState
} from "../../../../core/src/index.js";
import type { SqlExecutor } from "../../retrieval/pgvector.js";
import type {
  DeletionTombstoneInput,
  LifecycleStoragePort
} from "../../lifecycle/ports.js";
import { PgLifecycleStorage } from "../../lifecycle/pg-adapter.js";
import { PgIntakeArtifactStorage } from "./intake-storage.js";
import { PgJobStorage } from "./job-storage.js";

export interface PgNewProviderInput {
  readonly name: string;
  readonly credential?: string;
  readonly kind?: "therapist" | "facility";
  readonly metro?: string;
}

export type PgPassRequestBody =
  | {
      readonly providerId: string;
      readonly newProvider?: undefined;
      readonly story: string;
      readonly forWhom: readonly string[];
    }
  | {
      readonly providerId?: undefined;
      readonly newProvider: PgNewProviderInput;
      readonly story: string;
      readonly forWhom: readonly string[];
    };

export interface PgStoredRecommendation {
  readonly id: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly forWhom: readonly string[];
  readonly submittedAt: string;
}

export type PgAdminDecisionAction = "approve" | "reject" | "edit_scrub";

export interface PgAdminPiiFindingSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: PiiFinding["kind"];
  readonly replacement: string;
  readonly label: string;
}

export interface PgAdminReviewQueueItem {
  readonly id: string;
  readonly status: "review_pending";
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly credential: string;
    readonly kind: "therapist" | "facility";
    readonly metro: string;
  };
  readonly submitted_at: string;
  readonly flag_reasons: readonly string[];
  readonly raw_story: string;
  readonly scrubbed_story: string;
  readonly pii_findings: readonly PgAdminPiiFindingSpan[];
  readonly tags: readonly RecEnrichmentTag[];
  readonly quality: RecEnrichment["quality"] & { readonly flags: readonly string[] };
  readonly sources: {
    readonly scrub: ScrubStoryResult["source"];
    readonly extract: ExtractStoryResult["source"];
    readonly quality: ScoreQualityResult["source"];
  };
  readonly transitions: readonly {
    readonly action: string;
    readonly from: SubmissionState | null;
    readonly to: SubmissionState;
  }[];
}

export interface PgAdminDecisionResult {
  readonly recommendation_id: string;
  readonly action: PgAdminDecisionAction;
  readonly status: SubmissionState;
  readonly transition: {
    readonly action: SubmissionAction;
    readonly from: SubmissionState | null;
    readonly to: SubmissionState;
  };
  readonly event: { readonly id: string; readonly type: "moderation.decided" };
}

export interface PgPassApiSuccessResponse {
  readonly recommendation_id: string;
  readonly status: SubmissionState;
  readonly provider: { readonly id: string; readonly name: string };
  readonly scrubbed_story: string;
  readonly pii_findings_count: number;
  readonly tags: readonly RecEnrichmentTag[];
  readonly keystone_quote: RecEnrichment["keystone_quote"];
  readonly quality: RecEnrichment["quality"] & { readonly flags: readonly string[] };
  readonly sources: {
    readonly scrub: ScrubStoryResult["source"];
    readonly extract: ExtractStoryResult["source"];
    readonly quality: ScoreQualityResult["source"];
  };
  readonly review_status: string;
  readonly transitions: readonly {
    readonly action: string;
    readonly from: SubmissionState | null;
    readonly to: SubmissionState;
  }[];
}

interface ProviderRow {
  readonly id: string;
  readonly name: string;
  readonly credential: string | null;
  readonly kind: "therapist" | "facility" | "other";
  readonly loc: string | null;
}

interface RecommendationRow {
  readonly id: string;
  readonly provider_id: string | null;
  readonly provider_name_snapshot: string;
  readonly status: SubmissionState;
  readonly scrubbed_story: string | null;
}

// Thrown by decideAdminReview (audit finding F2) when, under the row lock,
// the recommendation is no longer "review_pending" — i.e. a concurrent
// decide already won the race. Callers (apps/web's admin decide route)
// should treat this as a clean, expected outcome, not a server error: the
// recommendation WAS decided, just not by this call.
export class AlreadyDecidedError extends Error {
  readonly recommendationId: string;
  readonly status: SubmissionState;

  constructor(recommendationId: string, status: SubmissionState) {
    super(
      `Recommendation ${recommendationId} was already decided (now ${status})`
    );
    this.name = "AlreadyDecidedError";
    this.recommendationId = recommendationId;
    this.status = status;
  }
}

interface TransactionalExecutor extends SqlExecutor {
  withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

function isTransactional(sql: SqlExecutor): sql is TransactionalExecutor {
  return (
    typeof (sql as { readonly withTransaction?: unknown }).withTransaction ===
    "function"
  );
}

// Full DB-backed PassDemoStore equivalent (apps/web/src/app/api/pass/deps.ts
// defines PassDemoStore locally — packages/engine can't import it without
// inverting the monorepo dependency direction, so this mirrors its shape
// field-for-field with its own local types. The wire-up call site in
// pass/deps.ts is where TypeScript actually proves the two are structurally
// compatible.)
//
// NOTE inherited from PA-023: `providers.license_status` is overloaded in
// the existing schema/read path (pgvector.ts) to mean both "credential
// display text" (e.g. "LPC") and "the literal string 'verified'" for the
// verified badge. This store follows that existing precedent rather than
// fixing it — flagging it again here since it now also affects newly
// created providers.
export class PgPassStore implements JobStoragePort, LifecycleStoragePort {
  private readonly jobStorage: PgJobStorage;
  private readonly intakeStorage: PgIntakeArtifactStorage;
  private readonly lifecycleStorage: PgLifecycleStorage;

  constructor(private readonly sql: SqlExecutor) {
    this.jobStorage = new PgJobStorage(sql);
    this.intakeStorage = new PgIntakeArtifactStorage(sql);
    this.lifecycleStorage = new PgLifecycleStorage(sql);
  }

  // --- LifecycleStoragePort passthrough (audit F1: this is what makes
  // hasLifecycleStorage() true for the real DB-backed store, so the
  // deleteSubmission job's MHMDA cascade actually runs instead of always
  // reporting storage_unavailable) ---
  getRecommendationStatus(recommendationId: string): Promise<string | undefined> {
    return this.lifecycleStorage.getRecommendationStatus(recommendationId);
  }

  redactRecommendation(recommendationId: string, now: Date): Promise<void> {
    return this.lifecycleStorage.redactRecommendation(recommendationId, now);
  }

  deleteOriginalStory(recommendationId: string): Promise<void> {
    return this.lifecycleStorage.deleteOriginalStory(recommendationId);
  }

  deleteRecTags(recommendationId: string): Promise<void> {
    return this.lifecycleStorage.deleteRecTags(recommendationId);
  }

  deleteEmbedding(recommendationId: string): Promise<void> {
    return this.lifecycleStorage.deleteEmbedding(recommendationId);
  }

  deleteIntakeArtifacts(recommendationId: string): Promise<void> {
    return this.lifecycleStorage.deleteIntakeArtifacts(recommendationId);
  }

  redactModerationEventsForRecommendation(recommendationId: string): Promise<void> {
    return this.lifecycleStorage.redactModerationEventsForRecommendation(
      recommendationId
    );
  }

  redactOutboxEventsForRecommendation(recommendationId: string): Promise<void> {
    return this.lifecycleStorage.redactOutboxEventsForRecommendation(
      recommendationId
    );
  }

  writeDeletionTombstone(input: DeletionTombstoneInput): Promise<void> {
    return this.lifecycleStorage.writeDeletionTombstone(input);
  }

  // Audit finding F2: runs the deletion cascade's eight steps as one
  // transaction when this.sql supports it (real Postgres), else runs them
  // against the plain executor (best-effort, no atomicity — matches how
  // decideAdminReview degrades for test doubles that don't implement
  // withTransaction).
  withLifecycleTransaction<T>(
    fn: (tx: LifecycleStoragePort) => Promise<T>
  ): Promise<T> {
    if (isTransactional(this.sql)) {
      return this.sql.withTransaction((tx) => fn(new PgLifecycleStorage(tx)));
    }

    return fn(this.lifecycleStorage);
  }

  // --- JobStoragePort passthrough ---
  ensureRecommendation(
    recommendationId: string,
    initialState: SubmissionState
  ): Promise<void> {
    return this.jobStorage.ensureRecommendation(recommendationId, initialState);
  }

  getRecommendationState(
    recommendationId: string
  ): Promise<SubmissionState | undefined> {
    return this.jobStorage.getRecommendationState(recommendationId);
  }

  transitionRecommendation(
    input: TransitionRecordInput
  ): Promise<ModerationEventRow> {
    return this.jobStorage.transitionRecommendation(input);
  }

  listModerationEvents(
    recommendationId?: string
  ): Promise<readonly ModerationEventRow[]> {
    return this.jobStorage.listModerationEvents(recommendationId);
  }

  appendEvent<TEvent extends EventCatalog>(
    event: TEvent,
    input: AppendEventInput
  ): Promise<EventsOutboxRow<TEvent>> {
    return this.jobStorage.appendEvent(event, input);
  }

  findEvent<TType extends EventCatalog["type"]>(
    type: TType,
    predicate: (event: Extract<EventCatalog, { type: TType }>) => boolean
  ): Promise<EventsOutboxRow<Extract<EventCatalog, { type: TType }>> | undefined> {
    return this.jobStorage.findEvent(type, predicate);
  }

  getEventById(eventId: string): Promise<EventsOutboxRow | undefined> {
    return this.jobStorage.getEventById(eventId);
  }

  listEvents(): Promise<readonly EventsOutboxRow[]> {
    return this.jobStorage.listEvents();
  }

  getPublishDecision(recommendationId: string): Promise<PublishDecision> {
    return this.jobStorage.getPublishDecision(recommendationId);
  }

  getJobStep(idempotencyKey: string): Promise<JobStepRecord | undefined> {
    return this.jobStorage.getJobStep(idempotencyKey);
  }

  claimJobStep(record: JobStepRecord): Promise<JobStepClaimResult> {
    return this.jobStorage.claimJobStep(record);
  }

  upsertJobStep(record: JobStepRecord): Promise<JobStepRecord> {
    return this.jobStorage.upsertJobStep(record);
  }

  writeDlq(input: WriteDlqInput): Promise<JobsDlqRow> {
    return this.jobStorage.writeDlq(input);
  }

  getDlqRow(dlqId: string): Promise<JobsDlqRow | undefined> {
    return this.jobStorage.getDlqRow(dlqId);
  }

  listDlq(): Promise<readonly JobsDlqRow[]> {
    return this.jobStorage.listDlq();
  }

  markDlqReplayed(dlqId: string, replayedAt: Date): Promise<JobsDlqRow> {
    return this.jobStorage.markDlqReplayed(dlqId, replayedAt);
  }

  // --- IntakeArtifactStoragePort passthrough ---
  getRestrictedOriginalRecommendation(
    recommendationId: string
  ): Promise<IntakeRecommendationSource | undefined> {
    return this.intakeStorage.getRestrictedOriginalRecommendation(recommendationId);
  }

  saveScrubResult(recommendationId: string, result: ScrubStoryResult): Promise<void> {
    return this.intakeStorage.saveScrubResult(recommendationId, result);
  }

  getScrubResult(
    recommendationId: string
  ): ReturnType<PgIntakeArtifactStorage["getScrubResult"]> {
    return this.intakeStorage.getScrubResult(recommendationId);
  }

  saveExtractResult(
    recommendationId: string,
    result: ExtractStoryResult
  ): Promise<void> {
    return this.intakeStorage.saveExtractResult(recommendationId, result);
  }

  getExtractResult(
    recommendationId: string
  ): ReturnType<PgIntakeArtifactStorage["getExtractResult"]> {
    return this.intakeStorage.getExtractResult(recommendationId);
  }

  saveQualityResult(
    recommendationId: string,
    result: ScoreQualityResult
  ): Promise<void> {
    return this.intakeStorage.saveQualityResult(recommendationId, result);
  }

  getQualityResult(
    recommendationId: string
  ): Promise<ScoreQualityResult | undefined> {
    return this.intakeStorage.getQualityResult(recommendationId);
  }

  // Deliberately NOT implementing upsertRecommendationEmbedding here: the
  // in-memory demo store omits it too, so embedRecommendation's job step
  // no-ops (skippedReason: "storage_unavailable") for both, which is what
  // keeps this store in parity with the demo pipeline. Wiring it up would
  // make the real embed step activate and require OPENAI_API_KEY — that's
  // find/deps.ts's PgVectorAdapter's job (already wired in PA-023), not this
  // store's.

  // --- Pass-specific surface ---
  async hasProvider(providerId: string): Promise<boolean> {
    const result = await this.sql.query<{ id: string }>(
      "select id from public.providers where id = $1::uuid",
      [providerId]
    );

    return result.rows.length > 0;
  }

  async createSubmission(
    input: PgPassRequestBody,
    now: Date
  ): Promise<PgStoredRecommendation> {
    const provider = await this.resolveProvider(input);
    const submittedAt = now.toISOString();

    const inserted = await this.sql.query<{ id: string }>(
      `insert into public.recommendations (provider_id, provider_name_snapshot, status)
       values ($1::uuid, $2, 'received') returning id`,
      [provider.id, provider.name]
    );
    const recommendationId = inserted.rows[0]?.id;

    if (!recommendationId) {
      throw new Error("recommendations insert returned no id");
    }

    await this.sql.query(
      `insert into public.recommendation_originals
         (recommendation_id, original_story, for_whom, submitted_at)
       values ($1::uuid, $2, $3::text[], $4)`,
      [recommendationId, input.story, [...input.forWhom], now]
    );

    return {
      id: recommendationId,
      providerId: provider.id,
      providerName: provider.name,
      forWhom: [...input.forWhom],
      submittedAt
    };
  }

  private async resolveProvider(
    input: PgPassRequestBody
  ): Promise<{ readonly id: string; readonly name: string }> {
    if (input.providerId !== undefined) {
      const result = await this.sql.query<{ id: string; name: string }>(
        "select id, name from public.providers where id = $1::uuid",
        [input.providerId]
      );
      const row = result.rows[0];

      if (!row) {
        throw new Error(`Unknown provider ${input.providerId}`);
      }

      return row;
    }

    const [city, state] = (input.newProvider.metro ?? "Denver, CO").split(", ");
    const inserted = await this.sql.query<{ id: string }>(
      `insert into public.providers (name, provider_kind, city, state, license_status)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        input.newProvider.name,
        input.newProvider.kind ?? "therapist",
        city ?? "Denver",
        state ?? "CO",
        input.newProvider.credential ?? "Pending verification"
      ]
    );
    const id = inserted.rows[0]?.id;

    if (!id) {
      throw new Error("providers insert returned no id");
    }

    return { id, name: input.newProvider.name };
  }

  async listAdminReviewQueue(): Promise<readonly PgAdminReviewQueueItem[]> {
    const result = await this.sql.query<
      RecommendationRow & { readonly submitted_at: string }
    >(
      `select r.id, r.provider_id, r.provider_name_snapshot, r.status, r.scrubbed_story,
              o.submitted_at
       from public.recommendations r
       join public.recommendation_originals o on o.recommendation_id = r.id
       where r.status = 'review_pending'
       order by o.submitted_at asc`,
      []
    );

    const items: PgAdminReviewQueueItem[] = [];

    for (const row of result.rows) {
      const item = await this.adminQueueItemFor(row);

      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  private async adminQueueItemFor(
    row: RecommendationRow & { readonly submitted_at: string }
  ): Promise<PgAdminReviewQueueItem | undefined> {
    const [provider, original, scrub, extract, quality] = await Promise.all([
      this.providerFor(row.provider_id),
      this.getRestrictedOriginalRecommendation(row.id),
      this.getScrubResult(row.id),
      this.getExtractResult(row.id),
      this.getQualityResult(row.id)
    ]);

    if (!provider || !original || !scrub || !extract || !quality) {
      return undefined;
    }

    return {
      id: row.id,
      status: "review_pending",
      provider,
      submitted_at: row.submitted_at,
      flag_reasons: flagReasonsFor(scrub.flags, quality.flags),
      raw_story: original.story,
      scrubbed_story: scrub.scrubbedStory,
      pii_findings: piiSpansFor(scrub.piiFindings),
      tags: extract.enrichment.tags,
      quality: { ...quality.quality, flags: quality.flags },
      sources: { scrub: scrub.source, extract: extract.source, quality: quality.source },
      transitions: transitionRows(await this.listModerationEvents(row.id))
    };
  }

  // Audit finding F2 (TOCTOU): the old version read the current state, then
  // later wrote a transition, with nothing in between stopping a second
  // concurrent decide from reading the same "review_pending" state and also
  // transitioning. This runs the whole read-check -> edit -> transition ->
  // events sequence inside one transaction with `select ... for update` on
  // the recommendation row: whichever concurrent caller's transaction
  // starts first holds the row lock until it commits, so the second
  // caller's `for update` blocks until the first is done, then re-reads the
  // (now-changed) state and throws AlreadyDecidedError instead of quietly
  // double-transitioning. When `this.sql` doesn't support transactions
  // (some tests hand PgPassStore a bare SqlExecutor), this degrades to the
  // old best-effort behavior with a comment at the duck-type check.
  async decideAdminReview(input: {
    readonly recommendationId: string;
    readonly action: PgAdminDecisionAction;
    readonly editedScrub?: string;
    readonly reason?: string;
    readonly reviewer: string;
    readonly now: Date;
  }): Promise<PgAdminDecisionResult> {
    if (isTransactional(this.sql)) {
      return this.sql.withTransaction((tx) =>
        this.decideAdminReviewWithExecutor(tx, input)
      );
    }

    return this.decideAdminReviewWithExecutor(this.sql, input);
  }

  private async decideAdminReviewWithExecutor(
    tx: SqlExecutor,
    input: {
      readonly recommendationId: string;
      readonly action: PgAdminDecisionAction;
      readonly editedScrub?: string;
      readonly reason?: string;
      readonly reviewer: string;
      readonly now: Date;
    }
  ): Promise<PgAdminDecisionResult> {
    const jobStorage = new PgJobStorage(tx);
    const intakeStorage = new PgIntakeArtifactStorage(tx);

    const locked = await tx.query<{ status: SubmissionState }>(
      "select status from public.recommendations where id = $1::uuid for update",
      [input.recommendationId]
    );
    const currentState = locked.rows[0]?.status;

    if (currentState === undefined) {
      throw new Error(`Unknown recommendation ${input.recommendationId}`);
    }

    if (currentState !== "review_pending") {
      throw new AlreadyDecidedError(input.recommendationId, currentState);
    }

    if (input.action === "edit_scrub") {
      await this.applyEditedScrub(
        intakeStorage,
        input.recommendationId,
        input.editedScrub
      );
    }

    const transitionAction: SubmissionAction =
      input.action === "edit_scrub" ? "edit_approve" : input.action;
    const transitionRow = await jobStorage.transitionRecommendation({
      recommendationId: input.recommendationId,
      action: transitionAction,
      actor: input.reviewer,
      ...(input.reason ? { reason: input.reason } : {}),
      metadata: {
        source: "admin_demo",
        admin_action: input.action,
        edited_scrub: input.action === "edit_scrub"
      },
      idempotencyKey: [
        "admin_decide",
        input.recommendationId,
        transitionAction,
        input.now.toISOString()
      ].join(":"),
      now: input.now
    });

    const moderationEventAction: Extract<
      EventCatalog,
      { type: "moderation.decided" }
    >["payload"]["action"] =
      input.action === "edit_scrub" ? "edit_approve" : input.action;
    const moderationEvent = await jobStorage.appendEvent(
      {
        type: "moderation.decided",
        payload: {
          recommendation_id: input.recommendationId,
          action: moderationEventAction,
          reviewer: input.reviewer
        }
      },
      {
        idempotencyKey: `admin:${transitionRow.id}:moderation.decided`,
        emittedAt: input.now
      }
    );

    if (transitionRow.toState === "published") {
      await jobStorage.appendEvent(
        {
          type: "submission.published",
          payload: { recommendation_id: input.recommendationId }
        },
        {
          idempotencyKey: `admin:${transitionRow.id}:submission.published`,
          emittedAt: input.now
        }
      );
    }

    return {
      recommendation_id: input.recommendationId,
      action: input.action,
      status: transitionRow.toState,
      transition: {
        action: transitionRow.action,
        from: transitionRow.fromState,
        to: transitionRow.toState
      },
      event: { id: moderationEvent.id, type: "moderation.decided" }
    };
  }

  private async applyEditedScrub(
    intakeStorage: PgIntakeArtifactStorage,
    recommendationId: string,
    editedScrub: string | undefined
  ): Promise<void> {
    const scrubbedStory = editedScrub?.trim();
    const existingScrub = await intakeStorage.getScrubResult(recommendationId);
    const original =
      await intakeStorage.getRestrictedOriginalRecommendation(recommendationId);

    if (!scrubbedStory) {
      throw new Error("editedScrub is required for edit_scrub");
    }

    if (!existingScrub) {
      throw new Error(`Missing scrub result for ${recommendationId}`);
    }

    const nextExtractResult = await extractStory(
      original
        ? {
            scrubbedStory,
            forWhom: original.forWhom,
            piiFindings: existingScrub.piiFindings
          }
        : { scrubbedStory, piiFindings: existingScrub.piiFindings }
    );
    const nextQualityResult = scoreQuality({
      scrubbedStory,
      enrichment: nextExtractResult.enrichment
    });

    await intakeStorage.saveScrubResult(recommendationId, {
      scrubbedStory,
      piiFindings: existingScrub.piiFindings,
      flags: existingScrub.flags,
      confidence: 1,
      source: existingScrub.source,
      promptId: "scrub@1"
    });
    await intakeStorage.saveExtractResult(recommendationId, nextExtractResult);
    await intakeStorage.saveQualityResult(recommendationId, nextQualityResult);
  }

  async getRecommendationEmbeddingSource(
    recommendationId: string
  ): Promise<RetrievalDocument | undefined> {
    const result = await this.sql.query<RecommendationRow>(
      `select id, provider_id, provider_name_snapshot, status, scrubbed_story
       from public.recommendations where id = $1::uuid`,
      [recommendationId]
    );
    const row = result.rows[0];
    const [provider, scrub, extract] = await Promise.all([
      row ? this.providerFor(row.provider_id) : Promise.resolve(undefined),
      this.getScrubResult(recommendationId),
      this.getExtractResult(recommendationId)
    ]);

    if (!row || !provider || !scrub || !extract) {
      return undefined;
    }

    const tags = extract.enrichment.tags.map((tag) => tag.value);
    const keystone = extract.enrichment.keystone_quote.text;

    return {
      recommendationId,
      providerId: provider.id,
      providerName: provider.name,
      credential: provider.credential,
      loc: provider.metro,
      kind: provider.kind,
      tags,
      keystone,
      text: [
        provider.name,
        provider.credential,
        provider.kind,
        provider.metro,
        tags.join(" "),
        keystone,
        scrub.scrubbedStory
      ].join("\n"),
      verified: provider.credential === "verified"
    };
  }

  async resultFor(recommendationId: string): Promise<PgPassApiSuccessResponse> {
    const result = await this.sql.query<RecommendationRow>(
      `select id, provider_id, provider_name_snapshot, status, scrubbed_story
       from public.recommendations where id = $1::uuid`,
      [recommendationId]
    );
    const row = result.rows[0];
    const [state, scrub, extract, quality] = await Promise.all([
      this.getRecommendationState(recommendationId),
      this.getScrubResult(recommendationId),
      this.getExtractResult(recommendationId),
      this.getQualityResult(recommendationId)
    ]);

    if (!row || !state || !scrub || !extract || !quality) {
      throw new Error(`Incomplete pass intake result ${recommendationId}`);
    }

    return {
      recommendation_id: recommendationId,
      status: state,
      provider: { id: row.provider_id ?? "", name: row.provider_name_snapshot },
      scrubbed_story: scrub.scrubbedStory,
      pii_findings_count: scrub.piiFindings.length,
      tags: extract.enrichment.tags,
      keystone_quote: extract.enrichment.keystone_quote,
      quality: { ...quality.quality, flags: quality.flags },
      sources: { scrub: scrub.source, extract: extract.source, quality: quality.source },
      review_status: reviewStatusFor(state),
      transitions: transitionRows(await this.listModerationEvents(recommendationId))
    };
  }

  async debugCounts(): Promise<{
    readonly originals: number;
    readonly recommendations: number;
    readonly events: number;
  }> {
    const [originals, recommendations, events] = await Promise.all([
      this.sql.query<{ count: string }>(
        "select count(*)::text as count from public.recommendation_originals",
        []
      ),
      this.sql.query<{ count: string }>(
        "select count(*)::text as count from public.recommendations",
        []
      ),
      this.sql.query<{ count: string }>(
        "select count(*)::text as count from public.events",
        []
      )
    ]);

    return {
      originals: Number(originals.rows[0]?.count ?? 0),
      recommendations: Number(recommendations.rows[0]?.count ?? 0),
      events: Number(events.rows[0]?.count ?? 0)
    };
  }

  private async providerFor(providerId: string | null): Promise<
    | {
        readonly id: string;
        readonly name: string;
        readonly credential: string;
        readonly kind: "therapist" | "facility";
        readonly metro: string;
      }
    | undefined
  > {
    if (!providerId) {
      return undefined;
    }

    const result = await this.sql.query<ProviderRow>(
      `select id, name, coalesce(nullif(license_status, ''), provider_kind) as credential,
              case when provider_kind = 'facility' then 'facility' else 'therapist' end as kind,
              concat_ws(', ', city, state) as loc
       from public.providers where id = $1::uuid`,
      [providerId]
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      credential: row.credential ?? "",
      kind: row.kind === "facility" ? "facility" : "therapist",
      metro: row.loc ?? ""
    };
  }
}

function flagReasonsFor(
  scrubFlags: readonly string[],
  qualityFlags: readonly string[]
): readonly string[] {
  return [...new Set([...scrubFlags, ...qualityFlags])];
}

function piiSpansFor(
  findings: readonly PiiFinding[]
): readonly PgAdminPiiFindingSpan[] {
  return findings.map((finding) => ({
    start: finding.span[0],
    end: finding.span[1],
    kind: finding.kind,
    replacement: finding.replacement,
    label: `${finding.kind}: ${finding.replacement}`
  }));
}

function transitionRows(rows: readonly ModerationEventRow[]) {
  return rows.map((row) => ({
    action: row.action,
    from: row.fromState,
    to: row.toState
  }));
}

function reviewStatusFor(state: SubmissionState): string {
  if (state === "published") {
    return "Published in the demo corpus after automated intake checks.";
  }

  if (state === "review_pending") {
    return "A human reviews flagged stories before publish.";
  }

  return "Intake is still processing this story.";
}
