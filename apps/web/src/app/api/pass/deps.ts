import {
  JOB_DEFINITIONS,
  createInMemoryJobStorage,
  createInlineJobRunner,
  type EventsOutboxRow,
  type IntakeArtifactStoragePort,
  type IntakeRecommendationSource,
  type JobStoragePort,
  type ModerationEventRow
} from "../../../../../../packages/engine/src/jobs/index";
import {
  SafetyGateUnavailableError,
  safetyGate as defaultSafetyGate,
  type SafetyGateResult
} from "../../../../../../packages/engine/src/safety/index";
import { logger } from "../../../../../../packages/engine/src/http/index";
import { createStores } from "../../../../../../packages/engine/src/db/stores";
import { AlreadyDecidedError } from "../../../../../../packages/engine/src/db/adapters/pass-store";
import {
  loadConfig,
  type AppConfig,
  type EventCatalog,
  type RecEnrichment,
  type RecEnrichmentTag,
  type SubmissionAction,
  type SubmissionState
} from "../../../../../../packages/core/src/index";
import {
  extractStory,
  scoreQuality,
  type PiiFinding,
  type ExtractStoryResult,
  type ScoreQualityResult,
  type ScrubStoryResult
} from "../../../../../../packages/engine/src/intake/index";
import type { RetrievalDocument } from "../../../../../../packages/engine/src/retrieval/index";
import { providers as fixtureProviders } from "../../../fixtures/providers";
import type { Provider } from "../../../fixtures/types";

type NewProviderInput = {
  readonly name: string;
  readonly credential?: string;
  readonly kind?: Provider["kind"];
  readonly metro?: Provider["metro"];
};

type PassRequestBody =
  | {
      readonly providerId: string;
      readonly newProvider?: undefined;
      readonly story: string;
      readonly forWhom: readonly string[];
    }
  | {
      readonly providerId?: undefined;
      readonly newProvider: NewProviderInput;
      readonly story: string;
      readonly forWhom: readonly string[];
    };

type StoredRecommendation = {
  readonly id: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly forWhom: readonly string[];
  readonly submittedAt: string;
};

type RestrictedOriginal = IntakeRecommendationSource & {
  readonly submittedAt: string;
};

export type AdminDecisionAction = "approve" | "reject" | "edit_scrub";

export type AdminPiiFindingSpan = {
  readonly start: number;
  readonly end: number;
  readonly kind: PiiFinding["kind"];
  readonly replacement: string;
  readonly label: string;
};

export type AdminReviewQueueItem = {
  readonly id: string;
  readonly status: "review_pending";
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly credential: string;
    readonly kind: Provider["kind"];
    // A DB-backed provider's location isn't confined to the fixture demo's
    // two metros (Provider["metro"]), so this is the wider, honest type.
    readonly metro: string;
  };
  readonly submitted_at: string;
  readonly flag_reasons: readonly string[];
  readonly raw_story: string;
  readonly scrubbed_story: string;
  readonly pii_findings: readonly AdminPiiFindingSpan[];
  readonly tags: readonly RecEnrichmentTag[];
  readonly quality: RecEnrichment["quality"] & {
    readonly flags: readonly string[];
  };
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
};

export type AdminDecisionResult = {
  readonly recommendation_id: string;
  readonly action: AdminDecisionAction;
  readonly status: SubmissionState;
  readonly transition: {
    readonly action: SubmissionAction;
    readonly from: SubmissionState | null;
    readonly to: SubmissionState;
  };
  readonly event: {
    readonly id: string;
    readonly type: "moderation.decided";
  };
};

export type PassApiTag = RecEnrichmentTag;

export type PassApiSuccessResponse = {
  readonly recommendation_id: string;
  readonly status: SubmissionState;
  readonly provider: {
    readonly id: string;
    readonly name: string;
  };
  readonly scrubbed_story: string;
  readonly pii_findings_count: number;
  readonly tags: readonly PassApiTag[];
  readonly keystone_quote: RecEnrichment["keystone_quote"];
  readonly quality: RecEnrichment["quality"] & {
    readonly flags: readonly string[];
  };
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
};

export type PassApiCrisisResponse = {
  readonly crisis: true;
  readonly support: {
    readonly lifeline: "988";
    readonly message: string;
  };
};

export interface PassDemoStore
  extends JobStoragePort,
    IntakeArtifactStoragePort {
  hasProvider(providerId: string): Promise<boolean>;
  createSubmission(
    input: PassRequestBody,
    now: Date
  ): Promise<StoredRecommendation>;
  listAdminReviewQueue(): Promise<readonly AdminReviewQueueItem[]>;
  decideAdminReview(input: {
    readonly recommendationId: string;
    readonly action: AdminDecisionAction;
    readonly editedScrub?: string;
    readonly reason?: string;
    readonly reviewer: string;
    readonly now: Date;
  }): Promise<AdminDecisionResult>;
  getRecommendationEmbeddingSource(
    recommendationId: string
  ): Promise<RetrievalDocument | undefined>;
  resultFor(recommendationId: string): Promise<PassApiSuccessResponse>;
  debugCounts(): Promise<{
    readonly originals: number;
    readonly recommendations: number;
    readonly events: number;
  }>;
}

export interface PassRouteDeps {
  readonly store: PassDemoStore;
  readonly runner: ReturnType<typeof createInlineJobRunner>;
  readonly env?: NodeJS.ProcessEnv;
  readonly config?: AppConfig;
  readonly safetyGate?: (story: string) => Promise<SafetyGateResult>;
  readonly now?: () => Date;
}

const CRISIS_PASS_RESPONSE: PassApiCrisisResponse = {
  crisis: true,
  support: {
    lifeline: "988",
    message: "Nothing was stored."
  }
};

let defaultDeps: PassRouteDeps | undefined;

export function createPassPostHandler(deps: PassRouteDeps) {
  return async (request: Request): Promise<Response> => {
    const config = deps.config ?? loadConfig(deps.env);
    const parsed = await parsePassRequestBody(await readJson(request), deps.store);

    if (!parsed.ok) {
      return json({ error: "INVALID_PASS_REQUEST" }, 400);
    }

    const gate = await routeSafetyGate(
      deps.safetyGate ?? defaultRouteSafetyGate(config),
      parsed.body.story
    );

    if (gate instanceof Response) {
      return gate;
    }

    if (gate.crisis) {
      return json(CRISIS_PASS_RESPONSE);
    }

    warnIfSafetyGateDegraded(gate);

    const now = deps.now?.() ?? new Date();
    const recommendation = await deps.store.createSubmission(parsed.body, now);
    const event: Extract<EventCatalog, { type: "submission.received" }> = {
      type: "submission.received",
      payload: {
        recommendation_id: recommendation.id
      }
    };

    await deps.runner.dispatch(event, {
      eventId: `pass:${recommendation.id}:received`
    });

    return json(await deps.store.resultFor(recommendation.id));
  };
}

export function defaultPassRouteDeps(): PassRouteDeps {
  if (!defaultDeps) {
    const config = loadConfig();
    // DB-backed PassStore when DATABASE_URL is set (expects migrations
    // applied + real provider data, not the fixture roster); otherwise the
    // in-memory demo store, unchanged from before.
    const store = createStores(config)?.passStore ?? createPassDemoStore(fixtureProviders);

    defaultDeps = {
      store,
      config,
      runner: createInlineJobRunner({
        storage: store,
        jobs: JOB_DEFINITIONS
      })
    };
  }

  return defaultDeps;
}

export function createPassDemoStore(
  seedProviders: readonly Provider[] = fixtureProviders
): PassDemoStore {
  const base = createInMemoryJobStorage();
  // Audit finding F2 (TOCTOU): mirrors PgPassStore's row-lock fix so both
  // stores throw the same AlreadyDecidedError for a concurrent decide,
  // rather than one store silently double-transitioning. The Set.has/
  // Set.add pair below has no `await` between them, so it's an atomic
  // claim the same way the DB row lock is — only one concurrent call ever
  // proceeds past it.
  const decidingClaims = new Set<string>();
  let nextRecommendation = 1;
  let nextProvider = 1;
  const providers = new Map(
    seedProviders.map((provider) => [provider.id, provider])
  );
  const recommendationOriginals = new Map<string, RestrictedOriginal>();
  const recommendations = new Map<string, StoredRecommendation>();
  const scrubResults = new Map<string, ScrubStoryResult>();
  const extractResults = new Map<string, ExtractStoryResult>();
  const qualityResults = new Map<string, ScoreQualityResult>();

  const store: PassDemoStore = {
    ...base,

    async hasProvider(providerId) {
      return providers.has(providerId);
    },

    async createSubmission(input, now) {
      const provider = providerForInput(input, providers, () => `new_${nextProvider++}`);
      const recommendationId = `pass_rec_${nextRecommendation++}`;
      const submittedAt = now.toISOString();
      const recommendation: StoredRecommendation = {
        id: recommendationId,
        providerId: provider.id,
        providerName: provider.name,
        forWhom: [...input.forWhom],
        submittedAt
      };

      recommendations.set(recommendationId, recommendation);
      recommendationOriginals.set(recommendationId, {
        story: input.story,
        providerName: provider.name,
        forWhom: [...input.forWhom],
        submittedAt
      });

      return recommendation;
    },

    async getRestrictedOriginalRecommendation(recommendationId) {
      return recommendationOriginals.get(recommendationId);
    },

    async saveScrubResult(recommendationId, result) {
      scrubResults.set(recommendationId, result);
    },

    async getScrubResult(recommendationId) {
      const result = scrubResults.get(recommendationId);

      if (!result) {
        return undefined;
      }

      return {
        scrubbedStory: result.scrubbedStory,
        piiFindings: result.piiFindings,
        flags: result.flags,
        source: result.source
      };
    },

    async saveExtractResult(recommendationId, result) {
      extractResults.set(recommendationId, result);
    },

    async getExtractResult(recommendationId) {
      const result = extractResults.get(recommendationId);

      if (!result) {
        return undefined;
      }

      return {
        enrichment: result.enrichment,
        source: result.source
      };
    },

    async saveQualityResult(recommendationId, result) {
      qualityResults.set(recommendationId, result);
    },

    async getQualityResult(recommendationId) {
      return qualityResults.get(recommendationId);
    },

    async listAdminReviewQueue() {
      const rows: AdminReviewQueueItem[] = [];

      for (const recommendation of recommendations.values()) {
        const state = await store.getRecommendationState(recommendation.id);

        if (state !== "review_pending") {
          continue;
        }

        const item = await adminQueueItemFor(recommendation);

        if (item) {
          rows.push(item);
        }
      }

      return rows.sort((left, right) =>
        left.submitted_at.localeCompare(right.submitted_at)
      );
    },

    async decideAdminReview(input) {
      if (decidingClaims.has(input.recommendationId)) {
        while (decidingClaims.has(input.recommendationId)) {
          await Promise.resolve();
        }

        const state =
          (await store.getRecommendationState(input.recommendationId)) ??
          "received";
        throw new AlreadyDecidedError(input.recommendationId, state);
      }

      decidingClaims.add(input.recommendationId);

      try {
        const currentState = await store.getRecommendationState(
          input.recommendationId
        );

        if (currentState === undefined) {
          throw new Error(`Unknown recommendation ${input.recommendationId}`);
        }

        if (currentState !== "review_pending") {
          throw new AlreadyDecidedError(input.recommendationId, currentState);
        }

        if (input.action === "edit_scrub") {
          await applyEditedScrub(input.recommendationId, input.editedScrub);
        }

        const transitionAction = transitionActionForAdminDecision(input.action);
        const transitionRow = await store.transitionRecommendation({
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
        const eventAction = moderationEventActionForAdminDecision(input.action);
        const moderationEvent = await appendModerationDecidedEvent({
          recommendationId: input.recommendationId,
          action: eventAction,
          reviewer: input.reviewer,
          transitionRow,
          now: input.now
        });

        if (transitionRow.toState === "published") {
          await store.appendEvent(
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
          event: {
            id: moderationEvent.id,
            type: "moderation.decided"
          }
        };
      } finally {
        decidingClaims.delete(input.recommendationId);
      }
    },

    async getRecommendationEmbeddingSource(recommendationId) {
      return embeddingSourceFor(recommendationId);
    },

    async resultFor(recommendationId) {
      const recommendation = recommendations.get(recommendationId);
      const state = await store.getRecommendationState(recommendationId);
      const scrubResult = scrubResults.get(recommendationId);
      const extractResult = extractResults.get(recommendationId);
      const qualityResult = qualityResults.get(recommendationId);

      if (!recommendation || !state || !scrubResult || !extractResult || !qualityResult) {
        throw new Error(`Incomplete pass intake result ${recommendationId}`);
      }

      return {
        recommendation_id: recommendationId,
        status: state,
        provider: {
          id: recommendation.providerId,
          name: recommendation.providerName
        },
        scrubbed_story: scrubResult.scrubbedStory,
        pii_findings_count: scrubResult.piiFindings.length,
        tags: extractResult.enrichment.tags,
        keystone_quote: extractResult.enrichment.keystone_quote,
        quality: {
          ...qualityResult.quality,
          flags: qualityResult.flags
        },
        sources: {
          scrub: scrubResult.source,
          extract: extractResult.source,
          quality: qualityResult.source
        },
        review_status: reviewStatusFor(state),
        transitions: transitionRows(
          await store.listModerationEvents(recommendationId)
        )
      };
    },

    async debugCounts() {
      return {
        originals: recommendationOriginals.size,
        recommendations: recommendations.size,
        events: (await store.listEvents()).length
      };
    }
  };

  async function adminQueueItemFor(
    recommendation: StoredRecommendation
  ): Promise<AdminReviewQueueItem | undefined> {
    const original = recommendationOriginals.get(recommendation.id);
    const provider = providers.get(recommendation.providerId);
    const scrubResult = scrubResults.get(recommendation.id);
    const extractResult = extractResults.get(recommendation.id);
    const qualityResult = qualityResults.get(recommendation.id);

    if (!original || !provider || !scrubResult || !extractResult || !qualityResult) {
      return undefined;
    }

    return {
      id: recommendation.id,
      status: "review_pending",
      provider: {
        id: provider.id,
        name: provider.name,
        credential: provider.credential,
        kind: provider.kind,
        metro: provider.metro
      },
      submitted_at: recommendation.submittedAt,
      flag_reasons: flagReasonsFor(scrubResult, qualityResult),
      raw_story: original.story,
      scrubbed_story: scrubResult.scrubbedStory,
      pii_findings: piiSpansFor(scrubResult.piiFindings),
      tags: extractResult.enrichment.tags,
      quality: {
        ...qualityResult.quality,
        flags: qualityResult.flags
      },
      sources: {
        scrub: scrubResult.source,
        extract: extractResult.source,
        quality: qualityResult.source
      },
      transitions: transitionRows(
        await store.listModerationEvents(recommendation.id)
      )
    };
  }

  async function applyEditedScrub(
    recommendationId: string,
    editedScrub: string | undefined
  ): Promise<void> {
    const scrubbedStory = editedScrub?.trim();
    const original = recommendationOriginals.get(recommendationId);
    const existingScrub = scrubResults.get(recommendationId);

    if (!scrubbedStory) {
      throw new Error("editedScrub is required for edit_scrub");
    }

    if (!existingScrub) {
      throw new Error(`Missing scrub result for ${recommendationId}`);
    }

    const nextScrubResult: ScrubStoryResult = {
      ...existingScrub,
      scrubbedStory
    };
    const nextExtractResult = await extractStory(
      original
        ? {
            scrubbedStory,
            forWhom: original.forWhom,
            piiFindings: existingScrub.piiFindings
          }
        : {
            scrubbedStory,
            piiFindings: existingScrub.piiFindings
          }
    );
    const nextQualityResult = scoreQuality({
      scrubbedStory,
      enrichment: nextExtractResult.enrichment
    });

    scrubResults.set(recommendationId, nextScrubResult);
    extractResults.set(recommendationId, nextExtractResult);
    qualityResults.set(recommendationId, nextQualityResult);
  }

  async function appendModerationDecidedEvent(input: {
    readonly recommendationId: string;
    readonly action: Extract<
      EventCatalog,
      { type: "moderation.decided" }
    >["payload"]["action"];
    readonly reviewer: string;
    readonly transitionRow: ModerationEventRow;
    readonly now: Date;
  }): Promise<EventsOutboxRow<Extract<EventCatalog, { type: "moderation.decided" }>>> {
    return store.appendEvent(
      {
        type: "moderation.decided",
        payload: {
          recommendation_id: input.recommendationId,
          action: input.action,
          reviewer: input.reviewer
        }
      },
      {
        idempotencyKey: `admin:${input.transitionRow.id}:moderation.decided`,
        emittedAt: input.now
      }
    );
  }

  function embeddingSourceFor(
    recommendationId: string
  ): RetrievalDocument | undefined {
    const recommendation = recommendations.get(recommendationId);
    const scrubResult = scrubResults.get(recommendationId);
    const extractResult = extractResults.get(recommendationId);
    const provider = recommendation
      ? providers.get(recommendation.providerId)
      : undefined;

    if (!recommendation || !provider || !scrubResult || !extractResult) {
      return undefined;
    }

    const tags = extractResult.enrichment.tags.map((tag) => tag.value);
    const keystone = extractResult.enrichment.keystone_quote.text;

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
        scrubResult.scrubbedStory
      ].join("\n"),
      verified: provider.license.status === "verified"
    };
  }

  return store;
}

function providerForInput(
  input: PassRequestBody,
  providers: Map<string, Provider>,
  nextProviderId: () => string
): Provider {
  if ("providerId" in input && input.providerId !== undefined) {
    const provider = providers.get(input.providerId);

    if (!provider) {
      throw new Error(`Unknown provider ${input.providerId}`);
    }

    return provider;
  }

  const provider: Provider = {
    id: nextProviderId(),
    name: input.newProvider.name,
    credential: input.newProvider.credential ?? "Pending verification",
    kind: input.newProvider.kind ?? "therapist",
    metro: input.newProvider.metro ?? "Denver, CO",
    license: {
      status: "pending",
      board: "manual review",
      checkedAt: new Date(0).toISOString().slice(0, 10)
    }
  };

  providers.set(provider.id, provider);
  return provider;
}

function flagReasonsFor(
  scrubResult: ScrubStoryResult,
  qualityResult: ScoreQualityResult
): readonly string[] {
  return [...new Set([...scrubResult.flags, ...qualityResult.flags])];
}

function piiSpansFor(
  findings: readonly PiiFinding[]
): readonly AdminPiiFindingSpan[] {
  return findings.map((finding) => ({
    start: finding.span[0],
    end: finding.span[1],
    kind: finding.kind,
    replacement: finding.replacement,
    label: `${finding.kind}: ${finding.replacement}`
  }));
}

function transitionActionForAdminDecision(
  action: AdminDecisionAction
): SubmissionAction {
  return action === "edit_scrub" ? "edit_approve" : action;
}

function moderationEventActionForAdminDecision(
  action: AdminDecisionAction
): Extract<EventCatalog, { type: "moderation.decided" }>["payload"]["action"] {
  return action === "edit_scrub" ? "edit_approve" : action;
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

function defaultRouteSafetyGate(config: AppConfig) {
  return (story: string) => defaultSafetyGate(story, { config });
}

async function routeSafetyGate(
  gate: (story: string) => Promise<SafetyGateResult>,
  story: string
): Promise<SafetyGateResult | Response> {
  try {
    return await gate(story);
  } catch (error) {
    if (error instanceof SafetyGateUnavailableError) {
      return json({ error: "SAFETY_GATE_UNAVAILABLE" }, 503);
    }

    throw error;
  }
}

function warnIfSafetyGateDegraded(gate: SafetyGateResult): void {
  if (!gate.degraded) {
    return;
  }

  logger.log("pass.safety_gate_degraded", {
    reason: gate.tier2.reason
  });
}

async function parsePassRequestBody(
  value: unknown,
  store: PassDemoStore
): Promise<
  { readonly ok: true; readonly body: PassRequestBody } | { readonly ok: false }
> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;
  const providerId = record.providerId;
  const newProvider = parseNewProvider(record.newProvider);
  const story = record.story;
  const forWhom = parseStringArray(record.forWhom);
  const hasProviderId = typeof providerId === "string" && providerId.length > 0;
  const hasNewProvider = newProvider !== undefined;

  if (
    typeof story !== "string" ||
    story.trim().length < 20 ||
    forWhom.length === 0 ||
    hasProviderId === hasNewProvider
  ) {
    return { ok: false };
  }

  if (hasProviderId) {
    if (!(await store.hasProvider(providerId))) {
      return { ok: false };
    }

    return {
      ok: true,
      body: {
        providerId,
        story,
        forWhom
      }
    };
  }

  if (!newProvider) {
    return { ok: false };
  }

  return {
    ok: true,
    body: {
      newProvider,
      story,
      forWhom
    }
  };
}

function parseNewProvider(value: unknown): NewProviderInput | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const name = record.name;

  if (typeof name !== "string" || name.trim().length < 2) {
    return undefined;
  }

  const parsed: {
    name: string;
    credential?: string;
    kind?: Provider["kind"];
    metro?: Provider["metro"];
  } = {
    name: name.trim()
  };

  if (typeof record.credential === "string" && record.credential.trim().length > 0) {
    parsed.credential = record.credential.trim();
  }

  if (record.kind === "therapist" || record.kind === "facility") {
    parsed.kind = record.kind;
  }

  if (record.metro === "Denver, CO" || record.metro === "Austin, TX") {
    parsed.metro = record.metro;
  }

  return parsed;
}

function parseStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
