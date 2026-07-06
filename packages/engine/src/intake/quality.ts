import type { RecEnrichment } from "../../../core/src/index.js";
import type { IntakeSource } from "./shared.js";

export interface ScoreQualityInput {
  readonly scrubbedStory: string;
  readonly enrichment: RecEnrichment;
}

export interface ScoreQualityResult {
  readonly quality: RecEnrichment["quality"];
  readonly flags: readonly string[];
  readonly source: IntakeSource;
}

export function scoreQuality(input: ScoreQualityInput): ScoreQualityResult {
  const flags = qualityFlags(input.enrichment);

  return {
    quality: input.enrichment.quality,
    flags,
    source: "fallback"
  };
}

export function qualityFlags(enrichment: RecEnrichment): readonly string[] {
  const flags: string[] = [];

  if (!enrichment.tags.some((tag) => tag.type === "issue")) {
    flags.push("needs_issue_tag");
  }

  if (enrichment.quality.specificity < 0.45) {
    flags.push("low_specificity");
  }

  if (enrichment.quality.lived_experience < 0.4) {
    flags.push("low_lived_experience");
  }

  if (enrichment.quality.ad_smell > 0.55) {
    flags.push("ad_smell");
  }

  if (enrichment.quality.dup_similarity > 0.93) {
    flags.push("possible_duplicate");
  }

  if (enrichment.pii_findings.length >= 4) {
    flags.push("pii_heavy");
  }

  return flags;
}

