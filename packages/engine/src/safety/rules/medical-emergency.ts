import medicalEmergencyRulesJson from "./medical-emergency.json" with { type: "json" };
import type { SafetyRuleFamilySpec } from "./types.js";

export const medicalEmergencyRules =
  medicalEmergencyRulesJson as SafetyRuleFamilySpec;
