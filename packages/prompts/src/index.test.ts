import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  PROMPT_REGISTRY,
  assertRegisteredGoldensExist,
  listRegisteredPrompts,
  loadPrompt
} from "./index.js";

describe("prompt registry", () => {
  test("throws for unknown prompt id/version", () => {
    expect(() => loadPrompt("understand@999")).toThrow("Unknown prompt");
  });

  test("loads prompt file content by PROMPT_ID@version", () => {
    const prompt = loadPrompt("understand@1");

    expect(prompt.content).toContain("DRAFT pending clinical review");
    expect(prompt.content).toContain("UnderstoodQuerySchema");
    expect(prompt.promptRef).toBe("understand@1");
  });

  test("every registered prompt has a colocated goldens file", () => {
    assertRegisteredGoldensExist();

    for (const prompt of listRegisteredPrompts()) {
      expect(existsSync(prompt.goldensPath)).toBe(true);
    }
  });

  test("registry keys are exact id@version prompt refs", () => {
    expect(Object.keys(PROMPT_REGISTRY).sort()).toEqual([
      "crisis_gate@1",
      "understand@1"
    ]);
  });
});
