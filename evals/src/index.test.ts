import { describe, expect, test } from "vitest";
import {
  DEFAULT_JUDGE_NOTICE,
  changedPathLinesFromGitOutput,
  changedSuites,
  runEval
} from "./index.js";

describe("eval runner", () => {
  test("runs the crisis suite against the deterministic smoke judge", async () => {
    const report = await runEval(["crisis"], "suite");

    expect(report.default_judge_notice).toBe(DEFAULT_JUDGE_NOTICE);
    expect(report.suites).toHaveLength(1);
    expect(report.suites[0]).toMatchObject({
      suite: "crisis",
      status: "PASSED",
      total: 26,
      passed: 26,
      failed: 0,
      metric: "recall",
      metric_value: 1,
      threshold_met: true
    });
  });

  test("runs understand goldens with field accuracy threshold", async () => {
    const report = await runEval(["understand"], "suite");

    expect(report.suites[0]).toMatchObject({
      suite: "understand",
      status: "PASSED",
      total: 26,
      passed: 26,
      failed: 0,
      metric: "field_accuracy",
      threshold_met: true
    });
  });

  test("marks extract placeholder suite as skipped and runs match", async () => {
    const report = await runEval(["extract", "match"], "all");

    expect(report.suites.map((suite) => suite.status)).toEqual([
      "SKIPPED",
      "PASSED"
    ]);
    expect(report.suites[1]).toMatchObject({
      suite: "match",
      total: 12,
      passed: 12,
      metric: "precision_at_3",
      metric_value: 1,
      threshold_met: true
    });
    expect(report.summary.skipped).toBe(2);
  });

  test("supports a pluggable judge", async () => {
    const report = await runEval(["crisis"], "suite", (golden) => ({
      actual: golden.expect ?? {},
      passed: true
    }));

    expect(report.suites[0]?.passed).toBe(26);
  });

  test("maps a changed understand prompt path to the understand suite", () => {
    expect(
      changedSuites(() => ["packages/prompts/understand/1.md"])
    ).toEqual(["understand"]);
  });

  test("ignores unrelated changed paths", () => {
    expect(changedSuites(() => ["apps/web/src/app/page.tsx"])).toEqual([]);
  });

  test("returns sorted unique suites for multiple changed paths", () => {
    expect(
      changedSuites(() => [
        "packages/prompts/understand/1.md",
        "evals/suites/match/goldens.jsonl",
        "packages/prompts/crisis_gate/goldens.jsonl",
        "packages/prompts/understand/goldens.jsonl",
        "packages/prompts/src/index.ts"
      ])
    ).toEqual(["crisis", "match", "understand"]);
  });

  test("parses git name-only output into changed path lines", () => {
    expect(
      changedPathLinesFromGitOutput(
        "\npackages/prompts/understand/1.md\n\napps/web/src/app/page.tsx\n"
      )
    ).toEqual([
      "packages/prompts/understand/1.md",
      "apps/web/src/app/page.tsx"
    ]);
  });
});
