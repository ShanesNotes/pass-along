import {
  JOB_DEFINITIONS,
  createInMemoryJobStorage,
  createInlineJobRunner,
  type InMemoryJobStorage,
  type IntakeArtifactStoragePort,
  type IntakeRecommendationSource,
  type ModerationEventRow
} from "../../../../../../packages/engine/src/jobs/index";
import {
  safetyGate as defaultSafetyGate,
  type SafetyGateResult
} from "../../../../../../packages/engine/src/safety/index";
import type {
  EventCatalog,
  RecEnrichment,
  RecEnrichmentTag,
  SubmissionState
} from "../../../../../../packages/core/src/index";
import type {
  ExtractStoryResult,
  ScoreQualityResult,
  ScrubStoryResult
} from "../../../../../../packages/engine/src/intake/index";
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
  extends InMemoryJobStorage,
    IntakeArtifactStoragePort {
  hasProvider(providerId: string): boolean;
  createSubmission(input: PassRequestBody, now: Date): StoredRecommendation;
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
    const parsed = parsePassRequestBody(await readJson(request), deps.store);

    if (!parsed.ok) {
      return json({ error: "INVALID_PASS_REQUEST" }, 400);
    }

    const gate = await (deps.safetyGate ?? defaultRouteSafetyGate)(
      parsed.body.story
    );

    if (gate.crisis) {
      return json(CRISIS_PASS_RESPONSE);
    }

    const now = deps.now?.() ?? new Date();
    const recommendation = deps.store.createSubmission(parsed.body, now);
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
    const store = createPassDemoStore(fixtureProviders);

    defaultDeps = {
      store,
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
  let nextRecommendation = 1;
  let nextProvider = 1;
  const providers = new Map(seedProviders.map((provider) => [provider.id, provider]));
  const recommendationOriginals = new Map<string, RestrictedOriginal>();
  const recommendations = new Map<string, StoredRecommendation>();
  const scrubResults = new Map<string, ScrubStoryResult>();
  const extractResults = new Map<string, ExtractStoryResult>();
  const qualityResults = new Map<string, ScoreQualityResult>();

  const store: PassDemoStore = {
    ...base,

    hasProvider(providerId) {
      return providers.has(providerId);
    },

    createSubmission(input, now) {
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

function defaultRouteSafetyGate(story: string): Promise<SafetyGateResult> {
  return defaultSafetyGate(story, { env: process.env });
}

function parsePassRequestBody(
  value: unknown,
  store: PassDemoStore
): { readonly ok: true; readonly body: PassRequestBody } | { readonly ok: false } {
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
    if (!store.hasProvider(providerId)) {
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
