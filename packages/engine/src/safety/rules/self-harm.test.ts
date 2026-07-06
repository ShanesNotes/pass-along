import { describe, expect, test } from "vitest";
import { selfHarmRules } from "./self-harm.js";
import { describeRuleFamily } from "./family-test-helpers.js";
import { loadSafetyRules, matchSafetyRules } from "./loader.js";

describeRuleFamily(selfHarmRules);

describe("self_harm normalization", () => {
  const compiled = loadSafetyRules([selfHarmRules]);

  test("matches existing patterns through zero-width, compatibility, case, and spacing variants", () => {
    expect(
      matchSafetyRules("I might kill\u200Bmyself tonight.", compiled).matches.map(
        (match) => match.ruleId
      )
    ).toContain("self_harm.direct_intent");
    expect(
      matchSafetyRules("I might \uFF48\uFF55\uFF52\uFF54 myself tonight.", compiled)
        .matches.map((match) => match.ruleId)
    ).toContain("self_harm.direct_intent");
    expect(
      matchSafetyRules("I DO NOT    SEE THE POINT ANYMORE.", compiled).matches.map(
        (match) => match.ruleId
      )
    ).toContain("self_harm.indirect_hopelessness");
    expect(
      matchSafetyRules("I   cannot\tstay safe tonight.", compiled).matches.map(
        (match) => match.ruleId
      )
    ).toContain("self_harm.cannot_stay_safe");
  });
});
