import {
  type EventCatalog,
  type SubmissionAction,
  type SubmissionState
} from "../../../core/src/index.js";
import { runIdempotentStep, type JobAttemptIdentity } from "./idempotency.js";
import type { PublishDecision } from "./ports.js";
import {
  DEFAULT_RETRY_CONFIG,
  entityIdForEvent,
  type JobDefinition,
  type JobHandlerInput
} from "./runner.js";

export const EVENT_TYPES = [
  "submission.received",
  "submission.published",
  "submission.flagged",
  "provider.created",
  "provider.verified",
  "find.performed",
  "find.unmet",
  "followup.answered",
  "moderation.decided"
] as const satisfies readonly EventCatalog["type"][];

export interface EventDefinition<TType extends EventCatalog["type"]> {
  readonly type: TType;
}

export const EVENT_DEFINITIONS = EVENT_TYPES.map((type) => ({
  type
})) as readonly EventDefinition<EventCatalog["type"]>[];

export const JOB_NAMES = [
  "onSubmissionReceived",
  "scrubPii",
  "extractTags",
  "scoreQuality",
  "resolveProvider",
  "verifyLicense",
  "embedRecommendation",
  "decidePublish",
  "freshnessBatch",
  "licenseRecheck",
  "aggregateRebuild",
  "weeklyDigest",
  "dlqSweep"
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export interface PipelineDecisionResult {
  readonly outcome: "published" | "review_pending";
}

export interface ModerationWaitResult {
  readonly outcome: "published" | "rejected" | "review_pending";
}

const PIPELINE_JOB_NAMES = [
  "scrubPii",
  "extractTags",
  "scoreQuality",
  "resolveProvider",
  "verifyLicense",
  "embedRecommendation",
  "decidePublish"
] as const satisfies readonly JobName[];

const SYSTEM_ACTOR = "jobs";

const scrubPiiJob = defineJob({
  name: "scrubPii",
  trigger: { kind: "internal" },
  async handler(input) {
    return transitionStep(input, "scrubPii", "scrub");
  }
});

const extractTagsJob = defineJob({
  name: "extractTags",
  trigger: { kind: "internal" },
  async handler(input) {
    return transitionStep(input, "extractTags", "extract");
  }
});

const scoreQualityJob = defineJob({
  name: "scoreQuality",
  trigger: { kind: "internal" },
  async handler(input) {
    return transitionStep(input, "scoreQuality", "score");
  }
});

const resolveProviderJob = defineJob({
  name: "resolveProvider",
  trigger: { kind: "internal" },
  async handler(input) {
    const event = requireSubmissionEvent(input.event);
    const recommendationId = event.payload.recommendation_id;
    const identity = identityFor("resolveProvider", recommendationId, input);

    return runIdempotentStep(
      input.storage,
      input.step,
      identity,
      "resolveProvider",
      async () => {
        const providerId = providerIdForRecommendation(recommendationId);
        await emitEvent(
          input,
          identity,
          {
            type: "provider.created",
            payload: {
              provider_id: providerId,
              source: "submission"
            }
          },
          "provider.created"
        );
        return { providerId };
      },
      input.now()
    );
  }
});

const verifyLicenseJob = defineJob({
  name: "verifyLicense",
  trigger: { kind: "internal" },
  async handler(input) {
    const event = requireSubmissionEvent(input.event);
    const recommendationId = event.payload.recommendation_id;
    const identity = identityFor("verifyLicense", recommendationId, input);

    return runIdempotentStep(
      input.storage,
      input.step,
      identity,
      "verifyLicense",
      async () => {
        const providerId = providerIdForRecommendation(recommendationId);
        await emitEvent(
          input,
          identity,
          {
            type: "provider.verified",
            payload: {
              provider_id: providerId,
              status: "manual_review",
              source: "stub",
              checked_at: input.now().toISOString()
            }
          },
          "provider.verified"
        );
        return { providerId, status: "manual_review" };
      },
      input.now()
    );
  }
});

const embedRecommendationJob = defineJob({
  name: "embedRecommendation",
  trigger: { kind: "internal" },
  async handler(input) {
    const event = requireSubmissionEvent(input.event);
    const recommendationId = event.payload.recommendation_id;
    const identity = identityFor("embedRecommendation", recommendationId, input);

    return runIdempotentStep(
      input.storage,
      input.step,
      identity,
      "embedRecommendation",
      () => ({ recommendationId, embedded: false }),
      input.now()
    );
  }
});

const decidePublishJob = defineJob({
  name: "decidePublish",
  trigger: { kind: "internal" },
  async handler(input): Promise<PipelineDecisionResult> {
    const event = requireSubmissionEvent(input.event);
    const recommendationId = event.payload.recommendation_id;
    const identity = identityFor("decidePublish", recommendationId, input);

    return runIdempotentStep(
      input.storage,
      input.step,
      identity,
      "decidePublish",
      async () => {
        const decision = await input.storage.getPublishDecision(recommendationId);
        return applyPublishDecision(input, identity, decision);
      },
      input.now()
    );
  }
});

const onSubmissionReceivedJob = defineJob({
  name: "onSubmissionReceived",
  trigger: { kind: "event", event: "submission.received" },
  async handler(input): Promise<PipelineDecisionResult | ModerationWaitResult> {
    const event = requireSubmissionEvent(input.event);
    const recommendationId = event.payload.recommendation_id;
    await input.storage.ensureRecommendation(recommendationId, "received");

    for (const jobName of PIPELINE_JOB_NAMES) {
      const job = requireJob(jobName);
      const result = await job.handler({
        ...input,
        event
      });

      if (jobName === "decidePublish") {
        const decision = result as PipelineDecisionResult;

        if (decision.outcome === "published") {
          return decision;
        }
      }
    }

    return await waitForModeration(input, recommendationId);
  }
});

const freshnessBatchJob = defineJob({
  name: "freshnessBatch",
  trigger: { kind: "cron", cron: "0 9 1 */3 *" },
  async handler(input) {
    await input.step.sleep("freshnessBatch.stub", 0);
    return { queued: 0 };
  }
});

const licenseRecheckJob = defineJob({
  name: "licenseRecheck",
  trigger: { kind: "cron", cron: "0 10 * * *" },
  async handler(input) {
    await input.step.sleep("licenseRecheck.stub", 0);
    return { checked: 0 };
  }
});

const aggregateRebuildJob = defineJob({
  name: "aggregateRebuild",
  trigger: { kind: "cron", cron: "0 2 * * *" },
  async handler(input) {
    await input.step.sleep("aggregateRebuild.stub", 0);
    return { rebuilt: 0 };
  }
});

const weeklyDigestJob = defineJob({
  name: "weeklyDigest",
  trigger: { kind: "cron", cron: "0 8 * * 1" },
  async handler(input) {
    await input.step.sleep("weeklyDigest.stub", 0);
    return { sent: false };
  }
});

const dlqSweepJob = defineJob({
  name: "dlqSweep",
  trigger: { kind: "cron", cron: "*/30 * * * *" },
  async handler(input) {
    return { deadLetters: (await input.storage.listDlq()).length };
  }
});

export const JOB_DEFINITIONS = [
  onSubmissionReceivedJob,
  scrubPiiJob,
  extractTagsJob,
  scoreQualityJob,
  resolveProviderJob,
  verifyLicenseJob,
  embedRecommendationJob,
  decidePublishJob,
  freshnessBatchJob,
  licenseRecheckJob,
  aggregateRebuildJob,
  weeklyDigestJob,
  dlqSweepJob
] as const satisfies readonly JobDefinition[];

const JOBS_BY_NAME = new Map<JobName, JobDefinition>(
  JOB_DEFINITIONS.map((job) => [job.name as JobName, job])
);

function defineJob<TEvent extends EventCatalog | null>(
  definition: Omit<JobDefinition<TEvent>, "retries"> & {
    readonly name: JobName;
  }
): JobDefinition<TEvent> {
  return {
    ...definition,
    retries: DEFAULT_RETRY_CONFIG
  };
}

function requireJob(name: JobName): JobDefinition {
  const job = JOBS_BY_NAME.get(name);

  if (!job) {
    throw new Error(`Missing job definition ${name}`);
  }

  return job;
}

function requireSubmissionEvent(
  event: EventCatalog | null
): Extract<EventCatalog, { type: "submission.received" }> {
  if (event?.type !== "submission.received") {
    throw new Error("Expected submission.received event");
  }

  return event;
}

async function transitionStep(
  input: JobHandlerInput,
  jobName: JobName,
  action: SubmissionAction
): Promise<{ readonly state: SubmissionState }> {
  const event = requireSubmissionEvent(input.event);
  const recommendationId = event.payload.recommendation_id;
  const identity = identityFor(jobName, recommendationId, input);

  return runIdempotentStep(
    input.storage,
    input.step,
    identity,
    jobName,
    async () => {
      const row = await input.storage.transitionRecommendation({
        recommendationId,
        action,
        actor: SYSTEM_ACTOR,
        metadata: { job_name: jobName },
        idempotencyKey: `${identity.jobName}:${identity.entityId}:${identity.attemptGroup}:${action}`,
        now: input.now()
      });
      return { state: row.toState };
    },
    input.now()
  );
}

async function applyPublishDecision(
  input: JobHandlerInput,
  identity: JobAttemptIdentity,
  decision: PublishDecision
): Promise<PipelineDecisionResult> {
  const event = requireSubmissionEvent(input.event);
  const recommendationId = event.payload.recommendation_id;

  if (decision.outcome === "publish") {
    await input.storage.transitionRecommendation({
      recommendationId,
      action: "all_green",
      actor: SYSTEM_ACTOR,
      metadata: { job_name: "decidePublish" },
      idempotencyKey: `${identity.jobName}:${identity.entityId}:${identity.attemptGroup}:all_green`,
      now: input.now()
    });
    await emitEvent(
      input,
      identity,
      {
        type: "submission.published",
        payload: { recommendation_id: recommendationId }
      },
      "submission.published"
    );
    return { outcome: "published" };
  }

  await input.storage.transitionRecommendation({
    recommendationId,
    action: "any_flag",
    actor: SYSTEM_ACTOR,
    reason: decision.reasons.join(", "),
    metadata: { job_name: "decidePublish", tier: decision.tier },
    idempotencyKey: `${identity.jobName}:${identity.entityId}:${identity.attemptGroup}:any_flag`,
    now: input.now()
  });
  await emitEvent(
    input,
    identity,
    {
      type: "submission.flagged",
      payload: {
        recommendation_id: recommendationId,
        reasons: [...decision.reasons],
        tier: decision.tier
      }
    },
    "submission.flagged"
  );
  return { outcome: "review_pending" };
}

async function waitForModeration(
  input: JobHandlerInput,
  recommendationId: string
): Promise<ModerationWaitResult> {
  const moderationEvent = await input.step.waitForEvent("awaitModeration", {
    event: "moderation.decided",
    timeout: "14d",
    match: { recommendation_id: recommendationId }
  });

  if (moderationEvent === null) {
    return { outcome: "review_pending" };
  }

  const identity = identityFor("onSubmissionReceived", recommendationId, input);
  const action = moderationEvent.payload.action;
  const transitionAction: SubmissionAction =
    action === "remove" ? "reject" : action;
  const row = await input.storage.transitionRecommendation({
    recommendationId,
    action: transitionAction,
    actor: moderationEvent.payload.reviewer,
    metadata: {
      job_name: "awaitModeration",
      moderation_action: action
    },
    idempotencyKey: `${identity.jobName}:${identity.entityId}:${identity.attemptGroup}:moderation.${action}`,
    now: input.now()
  });

  if (row.toState === "published") {
    await emitEvent(
      input,
      identity,
      {
        type: "submission.published",
        payload: { recommendation_id: recommendationId }
      },
      "submission.published.after_moderation"
    );
    return { outcome: "published" };
  }

  return { outcome: "rejected" };
}

async function emitEvent<TEvent extends EventCatalog>(
  input: JobHandlerInput,
  identity: JobAttemptIdentity,
  event: TEvent,
  suffix: string
) {
  await input.storage.appendEvent(event, {
    idempotencyKey: `output:${identity.jobName}:${identity.entityId}:${identity.attemptGroup}:${suffix}:${entityIdForEvent(event)}`,
    emittedAt: input.now()
  });
}

function identityFor(
  jobName: JobName,
  recommendationId: string,
  input: JobHandlerInput
): JobAttemptIdentity {
  return {
    jobName,
    entityId: recommendationId,
    attemptGroup: input.attemptGroup
  };
}

function providerIdForRecommendation(recommendationId: string): string {
  return `provider:${recommendationId}`;
}
