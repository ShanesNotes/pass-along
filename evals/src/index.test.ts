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
      total: 70,
      passed: 70,
      failed: 0,
      metric: "recall",
      metric_value: 1,
      threshold_met: true,
      false_positive_rate: 0,
      false_positives: 0,
      control_total: 26,
      false_positive_threshold: 0.15,
      false_positive_threshold_met: true
    });
  });

  test("fails the crisis suite when recall drops below 1.0", async () => {
    const report = await runEval(["crisis"], "suite", (golden) => {
      const expected = Boolean(golden.expect?.crisis);

      return {
        actual: { crisis: false },
        passed: !expected
      };
    });

    expect(report.suites[0]).toMatchObject({
      suite: "crisis",
      status: "FAILED",
      metric: "recall",
      metric_value: 0,
      threshold_met: false
    });
    expect(report.summary.report_status).toBe("FAILED");
  });

  test("reports crisis false positives on controls", async () => {
    const report = await runEval(["crisis"], "suite", (golden) => {
      const expected = Boolean(golden.expect?.crisis);
      const crisis = expected || golden.id === "control_001";

      return {
        actual: { crisis },
        passed: crisis === expected
      };
    });

    expect(report.suites[0]).toMatchObject({
      suite: "crisis",
      status: "PASSED",
      false_positive_rate: 0.038,
      false_positives: 1,
      control_total: 26,
      false_positive_threshold_met: true
    });
  });

  test("fails the crisis suite when false-positive rate reaches the threshold", async () => {
    const falsePositiveControls = new Set([
      "control_001",
      "control_002",
      "control_003",
      "control_004"
    ]);
    const report = await runEval(["crisis"], "suite", (golden) => {
      const expected = Boolean(golden.expect?.crisis);
      const crisis = expected || falsePositiveControls.has(golden.id ?? "");

      return {
        actual: { crisis },
        passed: crisis === expected
      };
    });

    expect(report.suites[0]).toMatchObject({
      suite: "crisis",
      status: "FAILED",
      false_positive_rate: 0.154,
      false_positives: 4,
      control_total: 26,
      false_positive_threshold_met: false
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

    expect(report.suites[0]?.passed).toBe(70);
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
        "evals/suites/crisis/goldens.jsonl",
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
