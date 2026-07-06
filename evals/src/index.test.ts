import { describe, expect, test } from "vitest";
import {
  DEFAULT_JUDGE_NOTICE,
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

  test("marks extract and match placeholder suites as skipped", async () => {
    const report = await runEval(["extract", "match"], "all");

    expect(report.suites.map((suite) => suite.status)).toEqual([
      "SKIPPED",
      "SKIPPED"
    ]);
    expect(report.summary.skipped).toBe(4);
  });

  test("supports a pluggable judge", async () => {
    const report = await runEval(["crisis"], "suite", (golden) => ({
      actual: golden.expect ?? {},
      passed: true
    }));

    expect(report.suites[0]?.passed).toBe(26);
  });

  test("detects changed prompt directories from git state", () => {
    expect(changedSuites()).toEqual(
      expect.arrayContaining(["crisis", "understand"])
    );
  });
});
