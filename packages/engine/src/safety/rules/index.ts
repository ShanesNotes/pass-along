import { harmToOthersRules } from "./harm-to-others.js";
import { medicalEmergencyRules } from "./medical-emergency.js";
import { selfHarmRules } from "./self-harm.js";
import type { SafetyRuleFamilySpec } from "./types.js";

export const SAFETY_RULE_FAMILIES = [
  selfHarmRules,
  harmToOthersRules,
  medicalEmergencyRules
] as const satisfies readonly SafetyRuleFamilySpec[];

export {
  harmToOthersRules,
  medicalEmergencyRules,
  selfHarmRules
};

export type {
  CompiledSafetyRule,
  SafetyRuleExamples,
  SafetyRuleFamilyId,
  SafetyRuleFamilySpec,
  SafetyRuleMatch,
  SafetyRuleSpec
} from "./types.js";
