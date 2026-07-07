import { ConfigError } from "../../../core/src/index.js";
import {
  MissingKeyError,
  complete,
  type CompleteOptions
} from "../llm/adapter.js";

export const CRISIS_GATE_PROMPT_ID = "crisis_gate@1";

export type SafetyClassifierStatus =
  | "completed"
  | "skipped"
  | "failed_closed";

export type SafetyClassifierResult =
  | {
      readonly status: "completed";
      readonly promptId: typeof CRISIS_GATE_PROMPT_ID;
      readonly crisis: boolean;
      readonly reason: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly status: "skipped";
      readonly promptId: typeof CRISIS_GATE_PROMPT_ID;
      readonly crisis: false;
      readonly reason: "missing_api_key";
      readonly missingEnvVar: string;
    }
  | {
      readonly status: "failed_closed";
      readonly promptId: typeof CRISIS_GATE_PROMPT_ID;
      readonly crisis: true;
      readonly reason: "classifier_error";
      readonly errorName: string;
    };

export type SafetyClassifyOptions = Pick<
  CompleteOptions,
  | "env"
  | "config"
  | "transport"
  | "timeoutMs"
  | "maxRetries"
  | "backoffBaseMs"
  | "inference_geo"
  | "sleep"
>;

export async function safetyClassify(
  input: string,
  options: SafetyClassifyOptions = {}
): Promise<SafetyClassifierResult> {
  try {
    const completion = await complete(
      CRISIS_GATE_PROMPT_ID,
      {
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              task: "classify_find_path_safety",
              input
            })
          }
        ]
      },
      options
    );
    const parsed = parseClassifierJson(completion.text);

    if (!parsed) {
      return failedClosed(new Error("Invalid classifier JSON"));
    }

    return {
      status: "completed",
      promptId: CRISIS_GATE_PROMPT_ID,
      crisis: parsed.crisis,
      reason: parsed.reason,
      provider: completion.provider,
      model: completion.model
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    if (error instanceof MissingKeyError) {
      return {
        status: "skipped",
        promptId: CRISIS_GATE_PROMPT_ID,
        crisis: false,
        reason: "missing_api_key",
        missingEnvVar: error.envVar
      };
    }

    return failedClosed(error);
  }
}

function parseClassifierJson(
  text: string
): { readonly crisis: boolean; readonly reason: string } | undefined {
  const parsed = parseJsonObject(text);

  if (!parsed) {
    return undefined;
  }

  const crisis = parsed.crisis;
  const reason = parsed.reason;

  if (typeof crisis !== "boolean") {
    return undefined;
  }

  return {
    crisis,
    reason: typeof reason === "string" ? reason : ""
  };
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function failedClosed(error: unknown): SafetyClassifierResult {
  return {
    status: "failed_closed",
    promptId: CRISIS_GATE_PROMPT_ID,
    crisis: true,
    reason: "classifier_error",
    errorName: errorName(error)
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
