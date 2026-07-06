import { Inngest } from "inngest";
import { serve } from "inngest/next";
import {
  EventCatalogSchema,
  type EventCatalog
} from "../../../core/src/index.js";
import { serializeJobError } from "./idempotency.js";
import type {
  EventsOutboxRow,
  JobStoragePort,
  WriteDlqInput
} from "./ports.js";

export type JobTrigger =
  | { kind: "event"; event: EventCatalog["type"] }
  | { kind: "cron"; cron: string }
  | { kind: "internal" };

export interface RetryBackoffConfig {
  readonly strategy: "exponential";
  readonly initialMs: number;
  readonly maxMs: number;
}

export interface RetryConfig {
  readonly maxAttempts: 4;
  readonly backoff: RetryBackoffConfig;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 4,
  backoff: {
    strategy: "exponential",
    initialMs: 1_000,
    maxMs: 60_000
  }
};

export interface EventMatch {
  readonly recommendation_id?: string;
  readonly provider_id?: string;
  readonly rec_id?: string;
}

export interface WaitForEventOptions<TType extends EventCatalog["type"]> {
  readonly event: TType;
  readonly timeout: "14d" | string | number;
  readonly match?: EventMatch;
}

export interface StepApi {
  run<T>(stepName: string, run: () => Promise<T> | T): Promise<T>;
  waitForEvent<TType extends EventCatalog["type"]>(
    stepName: string,
    options: WaitForEventOptions<TType>
  ): Promise<Extract<EventCatalog, { type: TType }> | null>;
  sleep(stepName: string, duration: string | number): Promise<void>;
}

export interface JobHandlerInput<
  TEvent extends EventCatalog | null = EventCatalog | null
> {
  readonly event: TEvent;
  readonly step: StepApi;
  readonly storage: JobStoragePort;
  readonly attemptGroup: string;
  readonly now: () => Date;
}

export interface JobDefinition<
  TEvent extends EventCatalog | null = EventCatalog | null
> {
  readonly name: string;
  readonly trigger: JobTrigger;
  readonly retries: RetryConfig;
  readonly handler: (input: JobHandlerInput<TEvent>) => Promise<unknown>;
}

export type RouteHandler = (request: Request, response?: unknown) => Promise<Response>;

export interface NextServeHandlers {
  readonly GET: RouteHandler;
  readonly POST: RouteHandler;
  readonly PUT: RouteHandler;
}

export interface InngestRunner {
  readonly client: unknown;
  readonly functions: readonly unknown[];
  serveNext(): NextServeHandlers;
}

export interface CreateInngestRunnerOptions {
  readonly id?: string;
  readonly storage: JobStoragePort;
  readonly jobs: readonly JobDefinition[];
  readonly now?: () => Date;
}

interface InngestRawEvent {
  readonly id?: string;
  readonly name?: string;
  readonly data?: unknown;
}

interface InngestStepAdapter {
  run<T>(stepName: string, run: () => Promise<T> | T): Promise<T>;
  waitForEvent(
    stepName: string,
    options: {
      readonly event: string;
      readonly timeout: string | number;
      readonly if?: string;
    }
  ): Promise<unknown | null>;
  sleep(stepName: string, duration: string | number): Promise<void>;
}

type RegisteredJob = JobDefinition & {
  readonly trigger: Exclude<JobTrigger, { kind: "internal" }>;
};

interface InngestFailureInput {
  readonly event: {
    readonly data: {
      readonly event: InngestRawEvent;
    };
  };
  readonly error: Error;
}

export function createInngestRunner(
  options: CreateInngestRunnerOptions
): InngestRunner {
  const client = new Inngest({ id: options.id ?? "pass-along" });
  const now = options.now ?? (() => new Date());
  const registeredJobs = options.jobs.filter(isRegisteredJob);

  const functions = registeredJobs.map((job) => {
    const trigger =
      job.trigger.kind === "event"
        ? { event: job.trigger.event }
        : { cron: job.trigger.cron };

    return client.createFunction(
      {
        id: job.name,
        name: job.name,
        retries: job.retries.maxAttempts,
        triggers: [trigger],
        onFailure: async (failure: InngestFailureInput) => {
          if (job.trigger.kind !== "event") {
            return;
          }

          const failedEvent = parseInngestFailureEvent(
            failure,
            job.trigger.event
          );
          const attemptGroup = attemptGroupForEvent(
            failedEvent,
            failure.event.data.event.id
          );
          const eventRow = await findOutboxRow(options.storage, failedEvent);

          await writeDlq(options.storage, {
            job,
            event: failedEvent,
            eventRow: eventRow ?? null,
            attemptGroup,
            error: failure.error,
            now: now()
          });
        }
      },
      async ({ event, step }) => {
        const typedEvent =
          job.trigger.kind === "event"
            ? parseInngestEvent(
                event as unknown as InngestRawEvent,
                job.trigger.event
              )
            : null;
        const attemptGroup =
          typedEvent === null
            ? `${job.name}:${now().toISOString()}`
            : attemptGroupForEvent(
                typedEvent,
                (event as unknown as InngestRawEvent).id
              );
        if (typedEvent !== null) {
          await appendIncomingEvent(
            options.storage,
            typedEvent,
            attemptGroup,
            now()
          );
        }

        return job.handler({
          event: typedEvent,
          step: createInngestStepApi(step as unknown as InngestStepAdapter),
          storage: options.storage,
          attemptGroup,
          now
        });
      }
    );
  });

  return {
    client,
    functions: functions as readonly unknown[],
    serveNext() {
      const served = serve({ client, functions });
      return {
        GET: wrapRouteHandler(served.GET),
        POST: wrapRouteHandler(served.POST),
        PUT: wrapRouteHandler(served.PUT)
      };
    }
  };
}

export interface InlineJobRunnerOptions {
  readonly storage: JobStoragePort;
  readonly jobs: readonly JobDefinition[];
  readonly now?: () => Date;
  readonly failSteps?: Readonly<Record<string, number>>;
}

export interface InlineJobRunner {
  dispatch(event: EventCatalog, options?: { readonly eventId?: string }): Promise<void>;
  replayJob(
    jobName: string,
    event: EventCatalog,
    attemptGroup: string
  ): Promise<void>;
}

interface PendingWait {
  readonly key: string;
  readonly jobName: string;
  readonly event: EventCatalog;
  readonly attemptGroup: string;
  readonly waitingFor: EventCatalog["type"];
  readonly match?: EventMatch;
}

export function createInlineJobRunner(
  options: InlineJobRunnerOptions
): InlineJobRunner {
  const now = options.now ?? (() => new Date());
  const failSteps = new Map<string, number>(
    Object.entries(options.failSteps ?? {})
  );
  const pendingWaits = new Map<string, PendingWait>();
  const jobsByName = new Map(options.jobs.map((job) => [job.name, job]));

  const runJob = async (
    job: JobDefinition,
    event: EventCatalog | null,
    attemptGroup: string,
    eventRow: EventsOutboxRow | null
  ) => {
    const maxAttempts = job.retries.maxAttempts;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await job.handler({
          event,
          step: createInlineStepApi({
            failSteps,
            storage: options.storage,
            pendingWaits,
            jobName: job.name,
            event,
            attemptGroup
          }),
          storage: options.storage,
          attemptGroup,
          now
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (event !== null) {
      await writeDlq(options.storage, {
        job,
        event,
        eventRow,
        attemptGroup,
        error: lastError,
        now: now()
      });
    }
  };

  const resumeWaitsFor = async (event: EventCatalog) => {
    const waits = [...pendingWaits.values()].filter(
      (wait) => wait.waitingFor === event.type && eventMatches(event, wait.match)
    );

    for (const wait of waits) {
      pendingWaits.delete(wait.key);
      const job = jobsByName.get(wait.jobName);

      if (!job) {
        throw new Error(`Cannot resume unknown job ${wait.jobName}`);
      }

      const eventRow = await findOutboxRow(options.storage, wait.event);
      await runJob(job, wait.event, wait.attemptGroup, eventRow ?? null);
    }
  };

  return {
    async dispatch(event, dispatchOptions) {
      const attemptGroup = attemptGroupForEvent(event, dispatchOptions?.eventId);
      const eventRow = await appendIncomingEvent(
        options.storage,
        event,
        attemptGroup,
        now()
      );
      const matchingJobs = options.jobs.filter(
        (job) => job.trigger.kind === "event" && job.trigger.event === event.type
      );

      for (const job of matchingJobs) {
        await runJob(job, event, attemptGroup, eventRow);
      }

      await resumeWaitsFor(event);
    },

    async replayJob(jobName, event, attemptGroup) {
      const job = jobsByName.get(jobName);

      if (!job) {
        throw new Error(`Cannot replay unknown job ${jobName}`);
      }

      const eventRow = await appendIncomingEvent(
        options.storage,
        event,
        attemptGroup,
        now()
      );
      await runJob(job, event, attemptGroup, eventRow);
    }
  };
}

function isRegisteredJob(job: JobDefinition): job is RegisteredJob {
  return job.trigger.kind !== "internal";
}

export function entityIdForEvent(event: EventCatalog): string {
  switch (event.type) {
    case "submission.received":
    case "submission.published":
    case "submission.flagged":
    case "moderation.decided":
      return event.payload.recommendation_id;
    case "provider.created":
    case "provider.verified":
      return event.payload.provider_id;
    case "followup.answered":
      return event.payload.rec_id;
    case "find.performed":
      return event.payload.query_hash_sha256;
    case "find.unmet":
      return "find.unmet";
  }
}

export function attemptGroupForEvent(
  event: EventCatalog,
  eventId?: string
): string {
  return eventId ?? `${event.type}:${entityIdForEvent(event)}`;
}

export async function appendIncomingEvent<TEvent extends EventCatalog>(
  storage: JobStoragePort,
  event: TEvent,
  attemptGroup: string,
  now: Date
): Promise<EventsOutboxRow<TEvent>> {
  return storage.appendEvent(event, {
    idempotencyKey: `incoming:${event.type}:${entityIdForEvent(event)}:${attemptGroup}`,
    emittedAt: now
  });
}

function parseInngestEvent(
  event: InngestRawEvent,
  expectedType: EventCatalog["type"]
): EventCatalog {
  return EventCatalogSchema.parse({
    type: event.name ?? expectedType,
    payload: event.data
  });
}

function parseInngestFailureEvent(
  failure: InngestFailureInput,
  expectedType: EventCatalog["type"]
): EventCatalog {
  return parseInngestEvent(failure.event.data.event, expectedType);
}

function createInngestStepApi(step: InngestStepAdapter): StepApi {
  return {
    run(stepName, run) {
      return step.run(stepName, run);
    },

    async waitForEvent(stepName, options) {
      const waitOptions:
        | {
            readonly event: string;
            readonly timeout: string | number;
          }
        | {
            readonly event: string;
            readonly timeout: string | number;
            readonly if: string;
          } =
        options.match === undefined
          ? {
              event: options.event,
              timeout: options.timeout
            }
          : {
              event: options.event,
              timeout: options.timeout,
              if: eventMatchExpression(options.match)
            };
      const waited = await step.waitForEvent(stepName, waitOptions);

      if (waited === null) {
        return null;
      }

      const raw = waited as { readonly data?: unknown };
      return EventCatalogSchema.parse({
        type: options.event,
        payload: raw.data
      }) as Extract<EventCatalog, { type: typeof options.event }>;
    },

    sleep(stepName, duration) {
      return step.sleep(stepName, duration);
    }
  };
}

function createInlineStepApi(input: {
  readonly failSteps: Map<string, number>;
  readonly storage: JobStoragePort;
  readonly pendingWaits: Map<string, PendingWait>;
  readonly jobName: string;
  readonly event: EventCatalog | null;
  readonly attemptGroup: string;
}): StepApi {
  return {
    async run(stepName, run) {
      const remainingFailures = input.failSteps.get(stepName) ?? 0;

      if (remainingFailures > 0) {
        input.failSteps.set(stepName, remainingFailures - 1);
        throw new Error(`Forced step failure: ${stepName}`);
      }

      return run();
    },

    async waitForEvent(stepName, options) {
      const found = await input.storage.findEvent(options.event, (event) =>
        eventMatches(event, options.match)
      );

      if (found) {
        return EventCatalogSchema.parse({
          type: found.type,
          payload: found.payload
        }) as Extract<EventCatalog, { type: typeof options.event }>;
      }

      if (input.event !== null) {
        const key = `${input.jobName}:${input.attemptGroup}:${stepName}`;
        const pendingWait =
          options.match === undefined
            ? {
                key,
                jobName: input.jobName,
                event: input.event,
                attemptGroup: input.attemptGroup,
                waitingFor: options.event
              }
            : {
                key,
                jobName: input.jobName,
                event: input.event,
                attemptGroup: input.attemptGroup,
                waitingFor: options.event,
                match: options.match
              };
        input.pendingWaits.set(key, pendingWait);
      }

      return null;
    },

    async sleep() {
      return;
    }
  };
}

function eventMatches(event: EventCatalog, match: EventMatch | undefined): boolean {
  if (match === undefined) {
    return true;
  }

  const payload = event.payload as Record<string, unknown>;
  return Object.entries(match).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }

    return payload[key] === value;
  });
}

function eventMatchExpression(match: EventMatch): string {
  return Object.entries(match)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `event.data.${key} == "${escapeExpression(value)}"`)
    .join(" && ");
}

function escapeExpression(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function findOutboxRow(
  storage: JobStoragePort,
  event: EventCatalog
): Promise<EventsOutboxRow | undefined> {
  return storage.findEvent(event.type, (candidate) =>
    entityIdForEvent(candidate) === entityIdForEvent(event)
  );
}

async function writeDlq(
  storage: JobStoragePort,
  input: {
    readonly job: JobDefinition;
    readonly event: EventCatalog;
    readonly eventRow: EventsOutboxRow | null;
    readonly attemptGroup: string;
    readonly error: unknown;
    readonly now: Date;
  }
): Promise<void> {
  const dlqInput: WriteDlqInput = {
    jobName: input.job.name,
    entityId: entityIdForEvent(input.event),
    eventId: input.eventRow?.id ?? null,
    attemptGroup: input.attemptGroup,
    error: serializeJobError(input.error),
    failedAt: input.now
  };

  await storage.writeDlq(dlqInput);
}

function wrapRouteHandler(handler: unknown): RouteHandler {
  return (request, response) => {
    const routeHandler = handler as (
      request: Request,
      response?: unknown
    ) => Promise<Response>;
    return routeHandler(request, response);
  };
}
