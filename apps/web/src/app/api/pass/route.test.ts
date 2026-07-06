import { describe, expect, test, vi } from "vitest";
import {
  JOB_DEFINITIONS,
  createInlineJobRunner
} from "../../../../../../packages/engine/src/jobs/index.js";
import type { SafetyGateResult } from "../../../../../../packages/engine/src/safety/index.js";
import {
  createPassDemoStore,
  createPassPostHandler,
  type PassApiSuccessResponse
} from "./deps";

describe("POST /api/pass", () => {
  test("drives a clean story through scrub, extract, score, and publish", async () => {
    const harness = createHarness({
      safetyGate: nonCrisisSafetyGate
    });
    const story =
      "Maria Chen helped my sister Julia in Denver build a CBT plan for panic attacks that worked on the bus after two sessions.";
    const response = await harness.post({
      providerId: "p1",
      story,
      forWhom: ["a family member"]
    });
    const body = (await response.json()) as PassApiSuccessResponse;

    expect(response.status).toBe(200);
    expect(body.status).toBe("published");
    expect(body.scrubbed_story).toContain("Maria Chen");
    expect(body.scrubbed_story).toContain("Denver");
    expect(body.scrubbed_story).not.toContain("Julia");
    expect(body.pii_findings_count).toBe(1);
    expect(body.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "issue", value: "panic" }),
        expect.objectContaining({ type: "modality", value: "cbt" })
      ])
    );
    expect(body.keystone_quote.text).toContain("CBT plan");
    expect(body.quality.flags).toEqual([]);
    expect(body.transitions.map((transition) => transition.action)).toEqual([
      "scrub",
      "extract",
      "score",
      "all_green"
    ]);
    expect(JSON.stringify(body)).not.toContain("Julia");
    await expect(harness.store.debugCounts()).resolves.toMatchObject({
      originals: 1,
      recommendations: 1
    });
  });

  test("returns a crisis interstitial before persistence or intake steps", async () => {
    const safetyGate = vi.fn(async () => crisisSafetyGateResult);
    const harness = createHarness({ safetyGate });
    const story = "I do not see the point anymore.";
    const response = await harness.post({
      providerId: "p1",
      story,
      forWhom: ["myself"]
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      crisis: true,
      support: {
        lifeline: "988",
        message: "Nothing was stored."
      }
    });
    expect(safetyGate).toHaveBeenCalledWith(story);
    await expect(harness.store.debugCounts()).resolves.toEqual({
      originals: 0,
      recommendations: 0,
      events: 0
    });
  });
});

function createHarness(input: {
  readonly safetyGate: (story: string) => Promise<SafetyGateResult>;
}) {
  const store = createPassDemoStore();
  const runner = createInlineJobRunner({
    storage: store,
    jobs: JOB_DEFINITIONS,
    now: () => new Date("2026-07-06T12:00:00.000Z")
  });
  const handler = createPassPostHandler({
    store,
    runner,
    safetyGate: input.safetyGate,
    now: () => new Date("2026-07-06T12:00:00.000Z")
  });

  return {
    store,
    async post(body: unknown) {
      return handler(
        new Request("http://localhost/api/pass", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        })
      );
    }
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

const crisisSafetyGateResult: SafetyGateResult = {
  crisis: true,
  degraded: false,
  tier1: {
    triggered: true,
    matches: [
      {
        familyId: "self_harm",
        ruleId: "self_harm.indirect_hopelessness",
        rationale: "Active self-harm phrasing"
      }
    ]
  },
  tier2: {
    status: "skipped",
    promptId: "crisis_gate@1",
    crisis: false,
    reason: "missing_api_key",
    missingEnvVar: "ANTHROPIC_API_KEY"
  }
};
