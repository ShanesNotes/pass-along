import { describe, expect, test } from "vitest";
import {
  CRISIS_GATE_PROMPT_ID,
  safetyGate,
  type SafetyClassifierResult
} from "./index.js";

describe("safetyGate", () => {
  test("lets tier 1 decide when tier 2 is skipped for missing API key", async () => {
    await expect(
      safetyGate("I do not see the point anymore.", { env: {} })
    ).resolves.toMatchObject({
      crisis: true,
      degraded: true,
      tier1: {
        triggered: true
      },
      tier2: {
        status: "skipped",
        crisis: false,
        reason: "missing_api_key"
      }
    });

    await expect(
      safetyGate("Looking for teen anxiety CBT in Denver.", { env: {} })
    ).resolves.toMatchObject({
      crisis: false,
      degraded: true,
      tier1: {
        triggered: false
      },
      tier2: {
        status: "skipped",
        crisis: false
      }
    });
  });

  test("returns crisis when only the classifier triggers", async () => {
    const tier2: SafetyClassifierResult = {
      status: "completed",
      promptId: CRISIS_GATE_PROMPT_ID,
      crisis: true,
      reason: "classifier flagged implicit risk",
      provider: "anthropic",
      model: "test-model"
    };

    await expect(
      safetyGate("veiled phrasing", {
        classifier: () => tier2,
        ruleMatcher: () => ({
          triggered: false,
          matches: []
        })
      })
    ).resolves.toMatchObject({
      crisis: true,
      degraded: false,
      tier2
    });
  });

  test("fails closed when an injected classifier throws", async () => {
    await expect(
      safetyGate("ordinary search", {
        classifier: () => {
          throw new Error("classifier unavailable");
        },
        ruleMatcher: () => ({
          triggered: false,
          matches: []
        })
      })
    ).resolves.toMatchObject({
      crisis: true,
      degraded: true,
      tier2: {
        status: "failed_closed",
        crisis: true,
        reason: "classifier_error",
        errorName: "Error"
      }
    });
  });

  test("starts rules and classifier before awaiting either result", async () => {
    const started: string[] = [];
    let releaseRules: (() => void) | undefined;

    const gatePromise = safetyGate("ordinary search", {
      ruleMatcher: async () => {
        started.push("rules");
        await new Promise<void>((resolve) => {
          releaseRules = resolve;
        });

        return {
          triggered: false,
          matches: []
        };
      },
      classifier: () => {
        started.push("classifier");

        return {
          status: "completed",
          promptId: CRISIS_GATE_PROMPT_ID,
          crisis: false,
          reason: "no safety signal",
          provider: "anthropic",
          model: "test-model"
        };
      }
    });

    await Promise.resolve();
    expect(started).toEqual(["rules", "classifier"]);
    releaseRules?.();
    await expect(gatePromise).resolves.toMatchObject({ crisis: false });
  });
});
