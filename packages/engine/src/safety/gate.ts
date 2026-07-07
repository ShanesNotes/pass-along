import {
  ConfigError,
  loadConfig
} from "../../../core/src/index.js";
import {
  matchSafetyRules,
  type Tier1SafetyResult
} from "./rules/loader.js";
import {
  CRISIS_GATE_PROMPT_ID,
  safetyClassify,
  type SafetyClassifierResult,
  type SafetyClassifyOptions
} from "./classifier.js";

export interface SafetyGateResult {
  readonly crisis: boolean;
  readonly degraded: boolean;
  readonly tier1: Tier1SafetyResult;
  readonly tier2: SafetyClassifierResult;
}

export type SafetyClassifier = (
  input: string
) => Promise<SafetyClassifierResult> | SafetyClassifierResult;

export type SafetyRuleMatcher = (
  input: string
) => Promise<Tier1SafetyResult> | Tier1SafetyResult;

export interface SafetyGateOptions extends SafetyClassifyOptions {
  readonly classifier?: SafetyClassifier;
  readonly ruleMatcher?: SafetyRuleMatcher;
}

export class SafetyGateUnavailableError extends Error {
  readonly code = "SAFETY_GATE_UNAVAILABLE";
  readonly missingEnvVar: string;

  constructor(missingEnvVar: string) {
    super("Safety gate unavailable because the tier-2 classifier key is missing");
    this.name = "SafetyGateUnavailableError";
    this.missingEnvVar = missingEnvVar;
  }
}

export async function safetyGate(
  input: string,
  options: SafetyGateOptions = {}
): Promise<SafetyGateResult> {
  const config = options.config ?? loadConfig(options.env);
  const tier1Promise = Promise.resolve(
    (options.ruleMatcher ?? matchSafetyRules)(input)
  );
  const tier2Promise = runClassifier(input, options);
  const [tier1, tier2] = await Promise.all([tier1Promise, tier2Promise]);

  if (
    tier2.status === "skipped" &&
    tier2.reason === "missing_api_key" &&
    !config.safety.tier2Optional
  ) {
    throw new SafetyGateUnavailableError(tier2.missingEnvVar);
  }

  return {
    crisis: tier1.triggered || tier2.crisis,
    degraded: tier2.status !== "completed",
    tier1,
    tier2
  };
}

async function runClassifier(
  input: string,
  options: SafetyGateOptions
): Promise<SafetyClassifierResult> {
  try {
    return await (options.classifier?.(input) ?? safetyClassify(input, options));
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    return {
      status: "failed_closed",
      promptId: CRISIS_GATE_PROMPT_ID,
      crisis: true,
      reason: "classifier_error",
      errorName: error instanceof Error ? error.name : "UnknownError"
    };
  }
}
