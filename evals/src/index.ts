import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import harmToOthersRulesJson from "../../packages/engine/src/safety/rules/harm-to-others.json" with { type: "json" };
import medicalEmergencyRulesJson from "../../packages/engine/src/safety/rules/medical-emergency.json" with { type: "json" };
import selfHarmRulesJson from "../../packages/engine/src/safety/rules/self-harm.json" with { type: "json" };

export type SuiteName = "crisis" | "understand" | "extract" | "match";
type SuiteStatus = "PASSED" | "FAILED" | "SKIPPED";

type ThresholdConfig = {
  metric: "recall" | "field_accuracy" | "tags_f1" | "precision_at_3";
  min: number | "baseline";
  hardFail?: boolean;
};

type SuiteConfig = {
  suite: SuiteName;
  promptDir?: string;
  goldenPath: string;
  threshold: ThresholdConfig;
  falsePositiveRateMax?: number;
  skipReason?: string;
};

export type GoldenCase = {
  suite: SuiteName;
  id?: string;
  input?: string;
  expect?: Record<string, unknown>;
  expect_subset?: Record<string, unknown>;
  expect_tags_f1_min?: number;
  query_id?: string;
  expect_top3_contains?: string[];
};

export type JudgeResult = {
  actual: unknown;
  passed: boolean;
  score?: number;
};

export type JudgeFn = (golden: GoldenCase) => Promise<JudgeResult> | JudgeResult;
export type ChangedPathProvider = () => readonly string[];

type GoldenReport = {
  id: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  score?: number;
};

type SuiteReport = {
  suite: SuiteName;
  status: SuiteStatus;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  metric: ThresholdConfig["metric"];
  metric_value: number | null;
  threshold: ThresholdConfig;
  threshold_met: boolean | null;
  false_positive_rate?: number;
  false_positives?: number;
  control_total?: number;
  false_positive_threshold?: number;
  false_positive_threshold_met?: boolean;
  skip_reason?: string;
  goldens: GoldenReport[];
};

type EvalReport = {
  generated_at: string;
  mode: "suite" | "changed" | "all";
  suites_requested: SuiteName[];
  default_judge_notice: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    report_status: SuiteStatus;
  };
  suites: SuiteReport[];
};

type EvalSafetyRuleFamily = {
  readonly id: string;
  readonly rules: readonly {
    readonly id: string;
    readonly pattern: string;
    readonly rationale: string;
  }[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const promptRoot = join(repoRoot, "packages", "prompts");
const evalRoot = join(repoRoot, "evals");
const EVAL_SAFETY_RULE_FAMILIES = [
  selfHarmRulesJson,
  harmToOthersRulesJson,
  medicalEmergencyRulesJson
] as readonly EvalSafetyRuleFamily[];

export const DEFAULT_JUDGE_NOTICE =
  "Default crisis judge uses tier-1 safety rule data with tier-2 skipped when no API key; other suites use deterministic local heuristics.";

export const SUITE_CONFIG: Record<SuiteName, SuiteConfig> = {
  crisis: {
    suite: "crisis",
    promptDir: "crisis_gate",
    goldenPath: join(evalRoot, "suites", "crisis", "goldens.jsonl"),
    threshold: {
      metric: "recall",
      min: 1,
      hardFail: true
    },
    falsePositiveRateMax: 0.15
  },
  understand: {
    suite: "understand",
    promptDir: "understand",
    goldenPath: join(promptRoot, "understand", "goldens.jsonl"),
    threshold: {
      metric: "field_accuracy",
      min: 0.9
    }
  },
  extract: {
    suite: "extract",
    goldenPath: join(evalRoot, "suites", "extract", "goldens.jsonl"),
    threshold: {
      metric: "tags_f1",
      min: 0.85
    },
    skipReason: "Placeholder suite; real extraction judge arrives with enrichment work."
  },
  match: {
    suite: "match",
    goldenPath: join(evalRoot, "suites", "match", "goldens.jsonl"),
    threshold: {
      metric: "precision_at_3",
      min: "baseline"
    }
  }
};

const baselinePath = join(evalRoot, "baselines.json");

export async function runEval(
  suites: readonly SuiteName[],
  mode: EvalReport["mode"],
  judge: JudgeFn = defaultJudge
): Promise<EvalReport> {
  const suiteReports: SuiteReport[] = [];

  for (const suite of suites) {
    suiteReports.push(await runSuite(SUITE_CONFIG[suite], judge));
  }

  const failed = suiteReports.reduce((sum, suite) => sum + suite.failed, 0);
  const skipped = suiteReports.reduce((sum, suite) => sum + suite.skipped, 0);
  const passed = suiteReports.reduce((sum, suite) => sum + suite.passed, 0);
  const total = suiteReports.reduce((sum, suite) => sum + suite.total, 0);
  const hasFailedSuite = suiteReports.some((suite) => suite.status === "FAILED");

  return {
    generated_at: new Date().toISOString(),
    mode,
    suites_requested: [...suites],
    default_judge_notice: DEFAULT_JUDGE_NOTICE,
    summary: {
      total,
      passed,
      failed,
      skipped,
      report_status: hasFailedSuite ? "FAILED" : "PASSED"
    },
    suites: suiteReports
  };
}

async function runSuite(
  config: SuiteConfig,
  judge: JudgeFn
): Promise<SuiteReport> {
  const goldens = readGoldens(config.goldenPath).filter(
    (golden) => golden.suite === config.suite
  );

  if (config.skipReason) {
    return {
      suite: config.suite,
      status: "SKIPPED",
      total: goldens.length,
      passed: 0,
      failed: 0,
      skipped: goldens.length,
      metric: config.threshold.metric,
      metric_value: null,
      threshold: config.threshold,
      threshold_met: null,
      skip_reason: config.skipReason,
      goldens: goldens.map((golden, index) => ({
        id: golden.id ?? `${golden.suite}_${index + 1}`,
        passed: false,
        expected: expectedForReport(golden),
        actual: "SKIPPED"
      }))
    };
  }

  const goldenReports: GoldenReport[] = [];
  let metricNumerator = 0;
  let metricDenominator = 0;
  let falsePositives = 0;
  let controlTotal = 0;

  for (const [index, golden] of goldens.entries()) {
    const result = await judge(golden);
    const goldenReport: GoldenReport = {
      id: golden.id ?? `${golden.suite}_${index + 1}`,
      passed: result.passed,
      expected: expectedForReport(golden),
      actual: result.actual
    };

    if (result.score !== undefined) {
      goldenReport.score = result.score;
    }

    goldenReports.push(goldenReport);

    if (golden.suite === "crisis") {
      const expected = Boolean(golden.expect?.crisis);
      const actual = Boolean(asRecord(result.actual)?.crisis);

      if (expected) {
        metricDenominator += 1;
        metricNumerator += actual ? 1 : 0;
      } else {
        controlTotal += 1;
        falsePositives += actual ? 1 : 0;
      }
    }

    if (golden.suite === "understand") {
      const expectedSubset = golden.expect_subset ?? {};
      const comparison = compareSubset(result.actual, expectedSubset);
      metricNumerator += comparison.matched;
      metricDenominator += comparison.total;
    }

    if (golden.suite === "match") {
      metricNumerator += result.score ?? (result.passed ? 1 : 0);
      metricDenominator += 1;
    }
  }

  const passed = goldenReports.filter((golden) => golden.passed).length;
  const failed = goldenReports.length - passed;
  const metricValue =
    metricDenominator === 0 ? 1 : metricNumerator / metricDenominator;
  const thresholdMet = thresholdMetByMetric(config, metricValue);
  const falsePositiveRate =
    config.falsePositiveRateMax === undefined
      ? undefined
      : controlTotal === 0
        ? 0
        : falsePositives / controlTotal;
  const falsePositiveThresholdMet =
    config.falsePositiveRateMax === undefined || falsePositiveRate === undefined
      ? undefined
      : falsePositiveRate < config.falsePositiveRateMax;
  const requiresEveryGolden = config.suite !== "crisis";
  const status =
    (!requiresEveryGolden || failed === 0) &&
    thresholdMet &&
    (falsePositiveThresholdMet ?? true)
      ? "PASSED"
      : "FAILED";
  const report: SuiteReport = {
    suite: config.suite,
    status,
    total: goldens.length,
    passed,
    failed,
    skipped: 0,
    metric: config.threshold.metric,
    metric_value: roundMetric(metricValue),
    threshold: config.threshold,
    threshold_met: thresholdMet,
    goldens: goldenReports
  };

  if (config.falsePositiveRateMax !== undefined) {
    report.false_positive_rate = roundMetric(falsePositiveRate ?? 0);
    report.false_positives = falsePositives;
    report.control_total = controlTotal;
    report.false_positive_threshold = config.falsePositiveRateMax;
    report.false_positive_threshold_met = falsePositiveThresholdMet ?? false;
  }

  return report;
}

function thresholdMetByMetric(
  config: SuiteConfig,
  metricValue: number
): boolean {
  const threshold = config.threshold;

  if (threshold.min === "baseline") {
    return metricValue >= baselineMetric(config.suite, threshold.metric);
  }

  return metricValue >= threshold.min;
}

function readGoldens(filePath: string): GoldenCase[] {
  if (!existsSync(filePath)) {
    throw new Error(`Missing golden file: ${filePath}`);
  }

  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseGoldenLine(filePath, line, index + 1));
}

function parseGoldenLine(
  filePath: string,
  line: string,
  lineNumber: number
): GoldenCase {
  const parsed = JSON.parse(line) as unknown;
  const record = asRecord(parsed);
  const suite = record?.suite;

  if (!isSuiteName(suite)) {
    throw new Error(`${filePath}:${lineNumber} has invalid suite`);
  }

  if (!record) {
    throw new Error(`${filePath}:${lineNumber} must be an object`);
  }

  const golden: GoldenCase = { suite };
  const id = getString(record, "id");
  const input = getString(record, "input");
  const expect = asRecord(record.expect);
  const expectSubset = asRecord(record.expect_subset);
  const expectTagsF1Min = getNumber(record, "expect_tags_f1_min");
  const queryId = getString(record, "query_id");
  const expectTop3Contains = getStringArray(record.expect_top3_contains);

  if (id !== undefined) {
    golden.id = id;
  }

  if (input !== undefined) {
    golden.input = input;
  }

  if (expect !== undefined) {
    golden.expect = expect;
  }

  if (expectSubset !== undefined) {
    golden.expect_subset = expectSubset;
  }

  if (expectTagsF1Min !== undefined) {
    golden.expect_tags_f1_min = expectTagsF1Min;
  }

  if (queryId !== undefined) {
    golden.query_id = queryId;
  }

  if (expectTop3Contains !== undefined) {
    golden.expect_top3_contains = expectTop3Contains;
  }

  return golden;
}

export function changedSuites(
  changedPathProvider: ChangedPathProvider = gitChangedPaths
): SuiteName[] {
  const changedFiles = changedPathProvider();
  const suites = new Set<SuiteName>();

  for (const filePath of changedFiles) {
    const normalizedPath = filePath.replaceAll("\\", "/");

    if (normalizedPath.startsWith("packages/prompts/src/")) {
      suites.add("crisis");
      suites.add("understand");
      continue;
    }

    for (const suite of suiteNames()) {
      const config = SUITE_CONFIG[suite];

      if (
        config.promptDir &&
        normalizedPath.startsWith(`packages/prompts/${config.promptDir}/`)
      ) {
        suites.add(suite);
      }

      if (normalizedPath.startsWith(`evals/suites/${suite}/`)) {
        suites.add(suite);
      }
    }
  }

  return [...suites].sort();
}

export function gitChangedPaths(): string[] {
  return [
    ...gitLines(["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"])
  ];
}

function gitLines(args: string[]): string[] {
  try {
    return changedPathLinesFromGitOutput(
      execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8"
      })
    );
  } catch (error) {
    const output = gitOutputFromThrown(error);

    if (output !== undefined) {
      return changedPathLinesFromGitOutput(output);
    }

    return [];
  }
}

export function changedPathLinesFromGitOutput(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitOutputFromThrown(error: unknown): string | undefined {
  const record = asRecord(error);
  const stdout = record?.stdout;

  if (typeof stdout === "string") {
    return stdout;
  }

  if (stdout instanceof Buffer) {
    return stdout.toString("utf8");
  }

  return undefined;
}

export function defaultJudge(
  golden: GoldenCase
): JudgeResult | Promise<JudgeResult> {
  switch (golden.suite) {
    case "crisis":
      return judgeCrisis(golden);
    case "understand":
      return judgeUnderstand(golden);
    case "extract":
      return {
        actual: "SKIPPED",
        passed: false
      };
    case "match":
      return judgeMatch(golden);
  }
}

function judgeCrisis(golden: GoldenCase): JudgeResult {
  const ruleMatches = matchEvalSafetyRules(golden.input ?? "");
  const crisis = ruleMatches.length > 0;
  const expected = Boolean(golden.expect?.crisis);

  return {
    actual: {
      crisis,
      tier1_triggered: crisis,
      tier2_status: "skipped",
      rules: ruleMatches
    },
    passed: crisis === expected
  };
}

function matchEvalSafetyRules(input: string): readonly string[] {
  const normalized = normalizeEvalSafetyText(input);

  return EVAL_SAFETY_RULE_FAMILIES.flatMap((family) =>
    family.rules
      .filter((rule) => new RegExp(rule.pattern, "iu").test(normalized))
      .map((rule) => `${family.id}:${rule.id}`)
  );
}

function judgeUnderstand(golden: GoldenCase): JudgeResult {
  const text = normalizeText(golden.input ?? "");
  const actual = heuristicUnderstand(text);
  const comparison = compareSubset(actual, golden.expect_subset ?? {});

  return {
    actual,
    passed: comparison.matched === comparison.total,
    score: comparison.total === 0 ? 1 : comparison.matched / comparison.total
  };
}

let matchHarnessPromise:
  | Promise<{
      search(input: string): Promise<readonly string[]>;
    }>
  | undefined;

async function judgeMatch(golden: GoldenCase): Promise<JudgeResult> {
  const input = golden.input ?? golden.query_id ?? "";
  const expected = golden.expect_top3_contains ?? [];
  const harness = await matchHarness();
  const top3 = await harness.search(input);
  const matched = expected.filter((id) => top3.includes(id)).length;
  const score = expected.length === 0 ? 1 : matched / expected.length;

  return {
    actual: { top3 },
    passed: matched === expected.length,
    score
  };
}

async function matchHarness(): Promise<{
  search(input: string): Promise<readonly string[]>;
}> {
  if (!matchHarnessPromise) {
    matchHarnessPromise = createMatchHarness();
  }

  return matchHarnessPromise;
}

async function createMatchHarness(): Promise<{
  search(input: string): Promise<readonly string[]>;
}> {
  const corpus = readMatchCorpus();
  const tags = [...new Set(corpus.recommendations.flatMap((rec) => rec.tags))];
  const records = corpus.recommendations.map((recommendation) => {
    const provider = corpus.providers.find(
      (candidate) => candidate.id === recommendation.provider_id
    );

    if (!provider) {
      throw new Error(`Missing provider ${recommendation.provider_id}`);
    }

    return {
      id: recommendation.id,
      kind: recommendation.kind,
      loc: provider.loc,
      tags: recommendation.tags,
      vector: devHashEmbedding(
        [
          provider.name,
          provider.credential,
          provider.kind,
          provider.loc,
          recommendation.tags.join(" "),
          recommendation.keystone,
          recommendation.story
        ].join("\n")
      )
    };
  });

  return {
    async search(input) {
      const vector = devHashEmbedding(input);
      const tagFilters = inferMatchTags(input, tags);
      const location = locationFromInput(input);
      const kind = kindFromInput(input);

      return records
        .filter((record) => kind === undefined || record.kind === kind)
        .filter(
          (record) =>
            location === undefined ||
            normalizeText(record.loc).includes(normalizeText(location))
        )
        .filter((record) =>
          tagFilters.every((tag) => record.tags.includes(tag))
        )
        .map((record) => ({
          id: record.id,
          score: cosine(vector, record.vector)
        }))
        .sort((left, right) => {
          const byScore = right.score - left.score;
          return byScore === 0 ? left.id.localeCompare(right.id) : byScore;
        })
        .slice(0, 3)
        .map((result) => result.id);
    }
  };
}

type MatchCorpus = {
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly credential: string;
    readonly kind: "therapist" | "facility";
    readonly loc: string;
  }[];
  readonly recommendations: readonly {
    readonly id: string;
    readonly provider_id: string;
    readonly kind: "therapist" | "facility";
    readonly tags: readonly string[];
    readonly keystone: string;
    readonly story: string;
  }[];
};

function readMatchCorpus(): MatchCorpus {
  return JSON.parse(
    readFileSync(
      join(evalRoot, "fixtures", "corpus", "recommendations.json"),
      "utf8"
    )
  ) as MatchCorpus;
}

function inferMatchTags(
  input: string,
  tags: readonly string[]
): readonly string[] {
  const normalized = ` ${normalizeMatchText(input)} `;
  return tags
    .filter((tag) => normalized.includes(` ${normalizeMatchText(tag)} `))
    .sort((left, right) => right.length - left.length);
}

function devHashEmbedding(input: string, dimensions = 1536): readonly number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenizeForEmbedding(input);
  const features = [
    ...tokens.map((token) => ({ token, weight: 1 })),
    ...tokenNgrams(tokens, 2).map((token) => ({ token, weight: 1.4 })),
    ...tokenNgrams(tokens, 3).map((token) => ({ token, weight: 1.8 }))
  ];

  for (const feature of features) {
    const digest = createHash("sha256").update(feature.token).digest();
    const bucket = digest.readUInt32BE(0) % dimensions;
    const sign = digest[4] === undefined || digest[4] % 2 === 0 ? 1 : -1;
    vector[bucket] = (vector[bucket] ?? 0) + sign * feature.weight;
  }

  return normalizeVector(vector);
}

function tokenizeForEmbedding(input: string): readonly string[] {
  return normalizeMatchText(input)
    .split(/\s+/u)
    .filter((token) => token.length > 1);
}

function normalizeMatchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/lgbtq\+/gu, "lgbtq")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function tokenNgrams(tokens: readonly string[], size: number): readonly string[] {
  const grams: string[] = [];

  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.push(tokens.slice(index, index + size).join(" "));
  }

  return grams;
}

function normalizeVector(vector: readonly number[]): readonly number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return [...vector];
  }

  return vector.map((value) => value / magnitude);
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function locationFromInput(input: string): string | undefined {
  const normalized = normalizeText(input);

  if (normalized.includes("denver")) {
    return "Denver";
  }

  if (normalized.includes("austin")) {
    return "Austin";
  }

  if (normalized.includes("detroit")) {
    return "Detroit";
  }

  return undefined;
}

function kindFromInput(input: string): "therapist" | "facility" | undefined {
  const normalized = normalizeText(input);

  if (
    /\b(facility|center|clinic|collective|group|intensive outpatient)\b/u.test(
      normalized
    )
  ) {
    return "facility";
  }

  if (/\b(therapist|counselor|counseling)\b/u.test(normalized)) {
    return "therapist";
  }

  return undefined;
}

function heuristicUnderstand(text: string): Record<string, unknown> {
  const issues = matchesFromDictionary(text, {
    anxiety: [/\banxiety\b/u],
    depression: [/\bdepression\b/u],
    trauma_ptsd: [/\btrauma\b/u, /\bptsd\b/u],
    ocd: [/\bocd\b/u],
    grief: [/\bgrief\b/u],
    eating_disorders: [/\beating disorders?\b/u],
    substance_use: [/\bsubstance use\b/u],
    bipolar: [/\bbipolar\b/u],
    postpartum: [/\bpostpartum\b/u],
    relationship_issues: [/\brelationship issues?\b/u, /\bcouples?\b/u],
    stress_burnout: [/\bstress burnout\b/u, /\bburnout\b/u],
    panic: [/\bpanic\b/u],
    self_esteem: [/\bself esteem\b/u],
    anger: [/\banger\b/u],
    sleep: [/\bsleep\b/u],
    autism: [/\bautism\b/u],
    gender_identity: [/\bgender identity\b/u],
    infertility: [/\binfertility\b/u],
    parenting: [/\bparenting\b/u],
    family_conflict: [/\bfamily conflict\b/u],
    chronic_illness: [/\bchronic illness\b/u],
    chronic_pain: [/\bchronic pain\b/u],
    social_anxiety: [/\bsocial anxiety\b/u],
    life_transitions: [/\blife transitions\b/u]
  });
  const population = firstMatchFromDictionary(text, {
    older_adult: [/\bolder adult\b/u],
    college_student: [/\bcollege student\b/u],
    first_responder: [/\bfirst responder\b/u],
    teen: [/\bteen\b/u, /\bteens\b/u],
    adult: [/\badult\b/u],
    child: [/\bchild\b/u],
    couple: [/\bcouples?\b/u],
    family: [/\bfamily\b/u],
    veteran: [/\bveteran\b/u],
    lgbtq_plus: [/\blgbtq\b/u],
    new_parent: [/\bnew parent\b/u],
    caregiver: [/\bcaregiver\b/u]
  });
  const modality = matchesFromDictionary(text, {
    cbt: [/\bcbt\b/u],
    dbt: [/\bdbt\b/u],
    emdr: [/\bemdr\b/u],
    ifs: [/\bifs\b/u],
    act: [/\bact\b/u],
    somatic: [/\bsomatic\b/u],
    exposure_erp: [/\bexposure erp\b/u, /\berp\b/u],
    group: [/\bgroup\b/u],
    play: [/\bplay therapy\b/u],
    family_systems: [/\bfamily systems\b/u],
    mindfulness_based: [/\bmindfulness based\b/u],
    medication_management: [/\bmedication management\b/u]
  });
  const logistics = matchesFromDictionary(text, {
    telehealth: [/\btelehealth\b/u],
    insurance: [/\binsurance\b/u],
    sliding_scale: [/\bsliding scale\b/u],
    evenings: [/\bevenings?\b/u]
  });
  const style = matchesFromDictionary(text, {
    warm: [/\bwarm\b/u],
    structured: [/\bstructured\b/u]
  });
  const location = detectLocation(text);

  return {
    issues,
    population,
    kind: /\bfacility\b/u.test(text) || /\btreatment\b/u.test(text)
      ? "facility"
      : "therapist",
    preferences: {
      style,
      modality,
      logistics
    },
    location,
    confidence: 0.8
  };
}

function matchesFromDictionary(
  text: string,
  dictionary: Record<string, RegExp[]>
): string[] {
  return Object.entries(dictionary)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(text)))
    .map(([value]) => value);
}

function firstMatchFromDictionary(
  text: string,
  dictionary: Record<string, RegExp[]>
): string | undefined {
  return matchesFromDictionary(text, dictionary)[0];
}

function detectLocation(text: string): Record<string, string> | undefined {
  const knownCities = [
    "Austin",
    "Boston",
    "Chicago",
    "Denver",
    "Detroit",
    "Phoenix",
    "Seattle"
  ];

  for (const city of knownCities) {
    if (text.includes(city.toLowerCase())) {
      return { text: city };
    }
  }

  return undefined;
}

function compareSubset(
  actual: unknown,
  expected: unknown
): { matched: number; total: number } {
  if (Array.isArray(expected)) {
    const actualValues = Array.isArray(actual) ? actual : [];
    const matched = expected.filter((value) => actualValues.includes(value))
      .length;

    return { matched, total: expected.length };
  }

  const expectedRecord = asRecord(expected);

  if (expectedRecord) {
    let matched = 0;
    let total = 0;
    const actualRecord = asRecord(actual);

    for (const [key, expectedValue] of Object.entries(expectedRecord)) {
      const comparison = compareSubset(actualRecord?.[key], expectedValue);
      matched += comparison.matched;
      total += comparison.total;
    }

    return { matched, total };
  }

  return {
    matched: Object.is(actual, expected) ? 1 : 0,
    total: 1
  };
}

function expectedForReport(golden: GoldenCase): unknown {
  return (
    golden.expect ??
    golden.expect_subset ??
    {
      expect_tags_f1_min: golden.expect_tags_f1_min,
      expect_top3_contains: golden.expect_top3_contains
    }
  );
}

function baselineMetric(
  suite: SuiteName,
  metric: ThresholdConfig["metric"]
): number {
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8")) as unknown;
  const suiteBaseline = asRecord(parsed)?.[suite];
  const metricValue = asRecord(suiteBaseline)?.[metric];

  if (typeof metricValue !== "number") {
    throw new Error(
      `Missing baseline metric ${suite}.${metric} in ${baselinePath}`
    );
  }

  return metricValue;
}

function writeReport(report: EvalReport): string {
  const reportsDir = join(evalRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const stamp = report.generated_at.replaceAll(/[:.]/gu, "-");
  const reportPath = join(reportsDir, `eval-${stamp}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  return reportPath;
}

function printSummary(report: EvalReport, reportPath: string): void {
  console.log(DEFAULT_JUDGE_NOTICE);

  for (const suite of report.suites) {
    const threshold =
      suite.threshold.min === "baseline"
        ? "baseline"
        : suite.threshold.min.toFixed(2);
    const metricValue =
      suite.metric_value === null ? "n/a" : suite.metric_value.toFixed(3);

    console.log(
      `${suite.suite}: ${suite.status} ${suite.passed}/${suite.total} passed, ` +
        `${suite.skipped} skipped, ${suite.metric}=${metricValue}, threshold=${threshold}`
    );

    if (suite.false_positive_rate !== undefined) {
      const falsePositiveRate = suite.false_positive_rate.toFixed(3);
      const falsePositiveThreshold =
        suite.false_positive_threshold === undefined
          ? "n/a"
          : suite.false_positive_threshold.toFixed(2);

      console.log(
        `${suite.suite}: false_positive_rate=${falsePositiveRate} ` +
          `(${suite.false_positives ?? 0}/${suite.control_total ?? 0}), ` +
          `threshold<${falsePositiveThreshold}`
      );
    }
  }

  console.log(
    `summary: ${report.summary.report_status} ${report.summary.passed}/${report.summary.total} passed, ` +
      `${report.summary.skipped} skipped`
  );
  console.log(`report: ${reportPath}`);
}

function parseCliArgs(args: readonly string[]): {
  mode: EvalReport["mode"];
  suites: SuiteName[];
} {
  const suiteIndex = args.indexOf("--suite");

  if (suiteIndex >= 0) {
    const suite = args[suiteIndex + 1];

    if (!isSuiteName(suite)) {
      throw new Error(`Unknown eval suite "${suite ?? ""}"`);
    }

    return {
      mode: "suite",
      suites: [suite]
    };
  }

  if (args.includes("--changed")) {
    return {
      mode: "changed",
      suites: changedSuites()
    };
  }

  return {
    mode: "all",
    suites: suiteNames()
  };
}

export async function main(args: readonly string[]): Promise<EvalReport> {
  const parsed = parseCliArgs(args);
  const report = await runEval(parsed.suites, parsed.mode);
  const reportPath = writeReport(report);
  printSummary(report, reportPath);

  if (report.summary.report_status === "FAILED") {
    process.exitCode = 1;
  }

  return report;
}

function suiteNames(): SuiteName[] {
  return ["crisis", "understand", "extract", "match"];
}

function isSuiteName(value: unknown): value is SuiteName {
  return (
    value === "crisis" ||
    value === "understand" ||
    value === "extract" ||
    value === "match"
  );
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function normalizeEvalSafetyText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[’‘]/gu, "'")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getString(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}

function getNumber(
  record: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = record?.[key];

  return typeof value === "number" ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
