import { describe, expect, test } from "vitest";
import {
  JOB_DEFINITIONS,
  createInlineJobRunner
} from "../../../../../../packages/engine/src/jobs/index.js";
import {
  createInMemoryVectorStoreFromCorpus,
  loadFixtureCorpus
} from "../../../../../../packages/engine/src/retrieval/index.js";
import { embedTextDevOnly } from "../../../../../../packages/engine/src/llm/embed.js";
import type { SafetyGateResult } from "../../../../../../packages/engine/src/safety/index.js";
import type { UnderstoodQuery } from "../../../../../../packages/core/src/index.js";
import {
  createFindPostHandler,
  type FindRouteDeps
} from "../find/deps";
import {
  createPassDemoStore,
  createPassPostHandler,
  type PassApiSuccessResponse
} from "../pass/deps";
import {
  createAdminDecidePostHandler,
  createAdminQueueGetHandler,
  embedApprovedRecommendationInFindStore,
  type AdminDecisionResponse,
  type AdminQueueResponse
} from "./deps";

const REVIEW_STORY =
  "Maria Chen helped my teen daughter with panic and anxiety using CBT bus practice steps in Denver. Afterward, my sister Julia joined us at 123 Pine Street on March 3 after I emailed julia@example.com and called 303-555-1212 about evening routines.";

describe("admin review API", () => {
  test("GET /api/admin/queue without a bearer token never exposes raw stories", async () => {
    const harness = await createHarness();
    await harness.submitReviewPending(REVIEW_STORY);
    const response = await harness.getQueueWithoutToken();
    const text = await response.text();

    expect([401, 503]).toContain(response.status);
    expect(text).not.toContain("raw_story");
    expect(text).not.toContain(REVIEW_STORY);
  });

  test("GET /api/admin/queue returns ADMIN_DISABLED when the demo token is unset", async () => {
    const harness = await createHarness();
    await harness.submitReviewPending(REVIEW_STORY);
    const queueHandler = createAdminQueueGetHandler({
      store: harness.store,
      env: { ...process.env, ADMIN_DEMO_TOKEN: undefined }
    });
    const response = await queueHandler(adminRequest());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("ADMIN_DISABLED");
    expect(text).not.toContain("raw_story");
    expect(text).not.toContain(REVIEW_STORY);
  });

  test("POST /api/admin/decide without a bearer token is rejected before moderation", async () => {
    const harness = await createHarness();
    const id = await harness.submitReviewPending(REVIEW_STORY);
    const response = await harness.decideWithoutToken({
      id,
      action: "approve"
    });
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toContain("ADMIN_UNAUTHORIZED");
    await expect(harness.store.getRecommendationState(id)).resolves.toBe(
      "review_pending"
    );
  });

  test("GET /api/admin/queue returns review-pending shape with reviewer-only raw story", async () => {
    const harness = await createHarness();
    const passResponse = await harness.postPass(REVIEW_STORY);
    const passBody = (await passResponse.json()) as PassApiSuccessResponse;
    const response = await harness.getQueue();
    const body = (await response.json()) as AdminQueueResponse;
    const item = body.queue[0];

    expect(passBody.status).toBe("review_pending");
    expect(response.status).toBe(200);
    expect(body.queue).toHaveLength(1);
    expect(item).toMatchObject({
      id: passBody.recommendation_id,
      status: "review_pending",
      provider: {
        name: "Maria Chen",
        kind: "therapist"
      },
      raw_story: REVIEW_STORY
    });
    expect(item?.scrubbed_story).not.toContain("Julia");
    expect(item?.flag_reasons).toContain("pii_heavy");
    expect(item?.pii_findings.length).toBeGreaterThanOrEqual(4);
    expect(item?.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "issue", value: "panic" }),
        expect.objectContaining({ type: "modality", value: "cbt" })
      ])
    );
    expect(item?.quality.specificity).toBeGreaterThan(0);
    expect(JSON.stringify(passBody)).not.toContain(REVIEW_STORY);
    expect(JSON.stringify(passBody)).not.toContain("Julia");
  });

  test("POST /api/admin/decide drives the transition and emits moderation.decided", async () => {
    const harness = await createHarness();
    const id = await harness.submitReviewPending(REVIEW_STORY);
    const response = await harness.decide({
      id,
      action: "approve",
      reason: "scrub looks safe"
    });
    const body = (await response.json()) as AdminDecisionResponse;
    const moderationRows = await harness.store.listModerationEvents(id);
    const events = await harness.store.listEvents();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      recommendation_id: id,
      action: "approve",
      status: "published",
      transition: {
        action: "approve",
        from: "review_pending",
        to: "published"
      },
      event: {
        type: "moderation.decided"
      },
      embedding: {
        embedded: true
      }
    });
    await expect(harness.store.getRecommendationState(id)).resolves.toBe(
      "published"
    );
    expect(moderationRows.at(-1)).toMatchObject({
      recommendationId: id,
      action: "approve",
      actor: "test-reviewer",
      reason: "scrub looks safe",
      toState: "published"
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "moderation.decided",
          payload: {
            recommendation_id: id,
            action: "approve",
            reviewer: "test-reviewer"
          }
        }),
        expect.objectContaining({
          type: "submission.published",
          payload: { recommendation_id: id }
        })
      ])
    );
  });

  test("approved submissions become findable and non-admin responses omit raw story", async () => {
    const harness = await createHarness();
    const passResponse = await harness.postPass(REVIEW_STORY);
    const passBody = (await passResponse.json()) as PassApiSuccessResponse;
    const approveResponse = await harness.decide({
      id: passBody.recommendation_id,
      action: "approve"
    });
    const findResponse = await harness.find({
      text: "Maria Chen teen panic anxiety CBT bus practice Denver",
      kind: "therapist",
      location: "Denver"
    });
    const findBody = (await findResponse.json()) as {
      readonly results: readonly { readonly name: string }[];
    };
    const nonAdminResponses = JSON.stringify([passBody, findBody]);

    expect(approveResponse.status).toBe(200);
    expect(findResponse.status).toBe(200);
    expect(findBody.results.map((result) => result.name)).toContain(
      "Maria Chen"
    );
    expect(nonAdminResponses).not.toContain(REVIEW_STORY);
    expect(nonAdminResponses).not.toContain("Julia");
    expect(nonAdminResponses).not.toContain("123 Pine Street");
    expect(nonAdminResponses).not.toContain("julia@example.com");
    expect(nonAdminResponses).not.toContain("303-555-1212");
    expect(nonAdminResponses).not.toContain("March 3");
  });
});

async function createHarness() {
  const now = () => new Date("2026-07-06T12:00:00.000Z");
  const store = createPassDemoStore();
  const runner = createInlineJobRunner({
    storage: store,
    jobs: JOB_DEFINITIONS,
    now
  });
  const passHandler = createPassPostHandler({
    store,
    runner,
    safetyGate: nonCrisisSafetyGate,
    now
  });
  const findDeps = await createFindDeps();
  const adminEnv = { ...process.env, ADMIN_DEMO_TOKEN: "test-admin-token" };
  const queueHandler = createAdminQueueGetHandler({ store, env: adminEnv });
  const decideHandler = createAdminDecidePostHandler({
    store,
    env: adminEnv,
    now,
    reviewer: "test-reviewer",
    embedApprovedRecommendation: (recommendationId) =>
      embedApprovedRecommendationInFindStore({
        passStore: store,
        getFindDeps: async () => findDeps,
        recommendationId
      })
  });
  const findHandler = createFindPostHandler(findDeps);
  const postPass = async (story: string) =>
    passHandler(
      new Request("http://localhost/api/pass", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "p1",
          story,
          forWhom: ["my child"]
        })
      })
    );

  return {
    store,
    postPass,
    async submitReviewPending(story: string) {
      const response = await postPass(story);
      const body = (await response.json()) as PassApiSuccessResponse;

      expect(body.status).toBe("review_pending");
      return body.recommendation_id;
    },
    async getQueue() {
      return queueHandler(adminRequest());
    },
    async getQueueWithoutToken() {
      return queueHandler(
        new Request("http://localhost/api/admin/queue", {
          method: "GET"
        })
      );
    },
    async decide(body: unknown) {
      return decideHandler(
        new Request("http://localhost/api/admin/decide", {
          method: "POST",
          headers: {
            "authorization": "Bearer test-admin-token",
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        })
      );
    },
    async decideWithoutToken(body: unknown) {
      return decideHandler(
        new Request("http://localhost/api/admin/decide", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        })
      );
    },
    async find(body: unknown) {
      return findHandler(
        new Request("http://localhost/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
      );
    }
  };
}

function adminRequest(): Request {
  return new Request("http://localhost/api/admin/queue", {
    method: "GET",
    headers: {
      authorization: "Bearer test-admin-token"
    }
  });
}

async function createFindDeps(): Promise<FindRouteDeps> {
  const corpus = loadFixtureCorpus();
  const store = await createInMemoryVectorStoreFromCorpus(corpus, embedForText);

  return {
    corpus,
    store,
    embed: embedForText,
    safetyGate: nonCrisisSafetyGate,
    understand: async () => ({
      understood: understoodFixture(),
      source: "fallback"
    }),
    events: {
      async emit() {
        return undefined;
      }
    },
    now: clock([100, 115])
  };
}

async function embedForText(text: string) {
  const embedding = embedTextDevOnly(text);
  return { vector: embedding.vector, metadata: embedding.metadata };
}

function understoodFixture(): UnderstoodQuery {
  return {
    issues: [
      { value: "anxiety", vocab: true, confidence: 0.9 },
      { value: "panic", vocab: true, confidence: 0.9 }
    ],
    population: "teen",
    kind: "therapist",
    preferences: {
      modality: [{ value: "cbt", vocab: true, confidence: 0.9 }]
    },
    location: {
      text: "Denver"
    },
    confidence: 0.9
  };
}

function clock(values: readonly number[]) {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
}

async function nonCrisisSafetyGate(): Promise<SafetyGateResult> {
  return {
    crisis: false,
    degraded: false,
    tier1: {
      triggered: false,
      matches: []
    },
    tier2: {
      status: "skipped",
      promptId: "crisis_gate@1",
      crisis: false,
      reason: "missing_api_key",
      missingEnvVar: "ANTHROPIC_API_KEY"
    }
  };
}
