import type { CompleteOptions } from "../llm/adapter.js";

export type IntakeSource = "model" | "fallback";

export type IntakeModelOptions = Pick<
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

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
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

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function getString(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll(/[’‘]/gu, "'")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}
