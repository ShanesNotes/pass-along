import { describe, expect, test } from "vitest";
import {
  CRISIS_GATE_PROMPT_ID,
  SafetyGateUnavailableError,
  safetyGate,
  type SafetyClassifierResult
} from "./index.js";

describe("safetyGate", () => {
  test("strict mode rejects a missing tier-2 classifier key instead of degrading silently", async () => {
    await expect(
      safetyGate("I do not see the point anymore.", { env: {} })
    ).rejects.toBeInstanceOf(SafetyGateUnavailableError);

    await expect(
      safetyGate("Looking for teen anxiety CBT in Denver.", { env: {} })
    ).rejects.toMatchObject({
      code: "SAFETY_GATE_UNAVAILABLE",
      missingEnvVar: "ANTHROPIC_API_KEY"
    });
  });

  test("lets tier 1 decide when tier 2 is explicitly optional for local demos", async () => {
    const env = { CRISIS_TIER2_OPTIONAL: "1" };

    await expect(
      safetyGate("I do not see the point anymore.", { env })
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
      safetyGate("Looking for teen anxiety CBT in Denver.", { env })
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
