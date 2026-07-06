import { SAFETY_RULE_FAMILIES } from "./index.js";
import type {
  CompiledSafetyRule,
  SafetyRuleFamilySpec,
  SafetyRuleMatch
} from "./types.js";

export interface Tier1SafetyResult {
  readonly triggered: boolean;
  readonly matches: readonly SafetyRuleMatch[];
}

export function loadSafetyRules(
  families: readonly SafetyRuleFamilySpec[] = SAFETY_RULE_FAMILIES
): readonly CompiledSafetyRule[] {
  const seen = new Set<string>();

  return families.flatMap((family) =>
    family.rules.map((rule) => {
      const key = `${family.id}:${rule.id}`;

      if (seen.has(key)) {
        throw new Error(`Duplicate safety rule id: ${key}`);
      }

      seen.add(key);

      return {
        familyId: family.id,
        id: rule.id,
        pattern: rule.pattern,
        regex: new RegExp(rule.pattern, "iu"),
        rationale: rule.rationale,
        examples: rule.examples
      };
    })
  );
}

export function matchSafetyRules(
  input: string,
  rules: readonly CompiledSafetyRule[] = loadSafetyRules()
): Tier1SafetyResult {
  const normalized = normalizeSafetyText(input);
  const matches = rules
    .filter((rule) => rule.regex.test(normalized))
    .map((rule) => ({
      familyId: rule.familyId,
      ruleId: rule.id,
      rationale: rule.rationale
    }));

  return {
    triggered: matches.length > 0,
    matches
  };
}

export function normalizeSafetyText(input: string): string {
  return input
    .toLowerCase()
    .replaceAll(/[’‘]/gu, "'")
    .replaceAll(/\s+/gu, " ")
    .trim();
}
