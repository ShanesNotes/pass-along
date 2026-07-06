export type SafetyRuleFamilyId =
  | "self_harm"
  | "harm_to_others"
  | "medical_emergency";

export interface SafetyRuleExamples {
  readonly match: readonly string[];
  readonly controls: readonly string[];
}

export interface SafetyRuleSpec {
  readonly id: string;
  readonly pattern: string;
  readonly rationale: string;
  readonly examples: SafetyRuleExamples;
}

export interface SafetyRuleFamilySpec {
  readonly id: SafetyRuleFamilyId;
  readonly rules: readonly SafetyRuleSpec[];
}

export interface CompiledSafetyRule {
  readonly familyId: SafetyRuleFamilyId;
  readonly id: string;
  readonly pattern: string;
  readonly regex: RegExp;
  readonly rationale: string;
  readonly examples: SafetyRuleExamples;
}

export interface SafetyRuleMatch {
  readonly familyId: SafetyRuleFamilyId;
  readonly ruleId: string;
  readonly rationale: string;
}
