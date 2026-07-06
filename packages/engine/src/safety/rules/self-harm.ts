import selfHarmRulesJson from "./self-harm.json" with { type: "json" };
import type { SafetyRuleFamilySpec } from "./types.js";

export const selfHarmRules = selfHarmRulesJson as SafetyRuleFamilySpec;
