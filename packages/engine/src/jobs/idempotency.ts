import type { StepApi } from "./runner.js";
import type { JobStoragePort, JsonObject, JobStepRecord } from "./ports.js";

export class JobStepInProgressError extends Error {
  constructor(idempotencyKey: string) {
    super(`Job step ${idempotencyKey} is already running elsewhere`);
    this.name = "JobStepInProgressError";
  }
}

export interface JobAttemptIdentity {
  readonly jobName: string;
  readonly entityId: string;
  readonly attemptGroup: string;
}

export function jobAttemptKey(identity: JobAttemptIdentity): string {
  return `${identity.jobName}:${identity.entityId}:${identity.attemptGroup}`;
}

export function jobStepKey(
  identity: JobAttemptIdentity,
  stepName: string
): string {
  return `${jobAttemptKey(identity)}:${stepName}`;
}

export function serializeJobError(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "NonErrorThrow",
    message: String(error)
  };
}

export async function runIdempotentStep<T>(
  storage: JobStoragePort,
  step: StepApi,
  identity: JobAttemptIdentity,
  stepName: string,
  run: () => Promise<T> | T,
  now: Date
): Promise<T> {
  const idempotencyKey = jobStepKey(identity, stepName);
  const claim = await storage.claimJobStep({
    idempotencyKey,
    jobName: identity.jobName,
    entityId: identity.entityId,
    attemptGroup: identity.attemptGroup,
    stepName,
    status: "running",
    updatedAt: now
  });

  if (!claim.claimed) {
    if (claim.existing?.status === "completed") {
      return claim.existing.result as T;
    }

    // Genuinely concurrent with another still-running (non-stale) claim on
    // this exact idempotency key: never execute the side effect a second
    // time. The runner's own retry loop (runJob, up to maxAttempts) is what
    // turns this into "try again shortly" rather than a hard failure — by
    // the time of a retry the winner has likely finished and this step
    // reads back a completed result via the fast path above.
    throw new JobStepInProgressError(idempotencyKey);
  }

  try {
    const result = await step.run(stepName, run);
    const completed: JobStepRecord =
      result === undefined
        ? {
            idempotencyKey,
            jobName: identity.jobName,
            entityId: identity.entityId,
            attemptGroup: identity.attemptGroup,
            stepName,
            status: "completed",
            updatedAt: now
          }
        : {
            idempotencyKey,
            jobName: identity.jobName,
            entityId: identity.entityId,
            attemptGroup: identity.attemptGroup,
            stepName,
            status: "completed",
            updatedAt: now,
            result
          };

    await storage.upsertJobStep(completed);
    return result;
  } catch (error) {
    await storage.upsertJobStep({
      idempotencyKey,
      jobName: identity.jobName,
      entityId: identity.entityId,
      attemptGroup: identity.attemptGroup,
      stepName,
      status: "failed",
      updatedAt: now,
      error: serializeJobError(error)
    });
    throw error;
  }
}
