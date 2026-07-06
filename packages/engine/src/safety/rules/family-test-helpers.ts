import { describe, expect, test } from "vitest";
import { loadSafetyRules, matchSafetyRules } from "./loader.js";
import type { SafetyRuleFamilySpec } from "./types.js";

export function describeRuleFamily(family: SafetyRuleFamilySpec): void {
  describe(`${family.id} rules`, () => {
    const compiled = loadSafetyRules([family]);

    test("has unique rule ids and compiled patterns", () => {
      expect(new Set(compiled.map((rule) => rule.id)).size).toBe(
        compiled.length
      );

      for (const rule of compiled) {
        expect(rule.regex).toBeInstanceOf(RegExp);
        expect(rule.rationale.length).toBeGreaterThan(20);
        expect(rule.examples.match.length).toBeGreaterThan(0);
        expect(rule.examples.controls.length).toBeGreaterThan(0);
      }
    });

    for (const rule of family.rules) {
      test(`${rule.id} matches its positive examples`, () => {
        for (const example of rule.examples.match) {
          const result = matchSafetyRules(example, compiled);

          expect(result.matches.map((match) => match.ruleId)).toContain(
            rule.id
          );
        }
      });

      test(`${rule.id} does not trip on its controls`, () => {
        for (const example of rule.examples.controls) {
          expect(matchSafetyRules(example, compiled).triggered).toBe(false);
        }
      });
    }
  });
}
