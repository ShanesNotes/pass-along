import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_JUDGE_NOTICE,
  changedPathLinesFromGitOutput,
  changedSuites,
  gitChangedPaths,
  runEval,
  selectEvalSuites
} from "./index.js";

describe("eval runner", () => {
  test("runs the crisis suite against the deterministic smoke judge", async () => {
    const report = await runEval(["crisis"], "suite");

    expect(report.default_judge_notice).toBe(DEFAULT_JUDGE_NOTICE);
    expect(report.suites).toHaveLength(1);
    expect(report.suites[0]).toMatchObject({
      suite: "crisis",
      status: "PASSED",
      total: 74,
      passed: 74,
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

  test("selects all suites by default even when a clean checkout has no changed paths", async () => {
    const plan = selectEvalSuites([], () => []);
    const report = await runEval(plan.suites, plan.mode);
    const crisis = report.suites.find((suite) => suite.suite === "crisis");

    expect(plan).toEqual({
      mode: "all",
      suites: ["crisis", "understand", "scrub", "extract", "match"]
    });
    expect(crisis?.total).toBeGreaterThanOrEqual(70);
    expect(crisis?.metric_value).toBe(1);
  });

  test("CI runs every eval suite instead of changed-only evals", () => {
    const ci = readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8"
    );

    expect(ci).toContain("run: pnpm eval\n");
    expect(ci).not.toContain("run: pnpm eval --changed");
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
      total: 36,
      passed: 36,
      failed: 0,
      metric: "field_accuracy",
      threshold_met: true
    });
  });

  test("runs scrub, extract, and match suites", async () => {
    const report = await runEval(["scrub", "extract", "match"], "all");

    expect(report.suites.map((suite) => suite.status)).toEqual([
      "PASSED",
      "PASSED",
      "PASSED"
    ]);
    expect(report.suites[0]).toMatchObject({
      suite: "scrub",
      total: 30,
      passed: 30,
      metric: "span_f1",
      threshold_met: true
    });
    expect(report.suites[1]).toMatchObject({
      suite: "extract",
      total: 15,
      passed: 15,
      metric: "tags_f1",
      threshold_met: true
    });
    expect(report.suites[2]).toMatchObject({
      suite: "match",
      total: 12,
      passed: 12,
      metric: "precision_at_3",
      metric_value: 1,
      threshold_met: true
    });
    expect(report.summary.skipped).toBe(0);
  });

  test("supports a pluggable judge", async () => {
    const report = await runEval(["crisis"], "suite", (golden) => ({
      actual: golden.expect ?? {},
      passed: true
    }));

    expect(report.suites[0]?.passed).toBe(74);
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
    ).toEqual(["crisis", "extract", "match", "scrub", "understand"]);
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

  test("uses a GitHub base ref merge-base for changed paths when available", () => {
    const calls: string[][] = [];
    const changed = gitChangedPaths({
      env: { GITHUB_BASE_REF: "main" },
      git(args) {
        calls.push([...args]);

        if (args[0] === "merge-base") {
          return "abc123\n";
        }

        if (args[0] === "diff") {
          return "evals/suites/crisis/goldens.jsonl\n";
        }

        return "";
      }
    });

    expect(changed).toEqual(["evals/suites/crisis/goldens.jsonl"]);
    expect(calls).toContainEqual(["merge-base", "HEAD", "origin/main"]);
    expect(calls).toContainEqual([
      "diff",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      "abc123...HEAD"
    ]);
  });
});
