import harmToOthersRulesJson from "./harm-to-others.json" with { type: "json" };
import type { SafetyRuleFamilySpec } from "./types.js";

export const harmToOthersRules =
  harmToOthersRulesJson as SafetyRuleFamilySpec;
