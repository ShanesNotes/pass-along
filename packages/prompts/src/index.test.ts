import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  PROMPT_REGISTRY,
  UNDERSTAND_2_PROMPT,
  assertRegisteredGoldensExist,
  listRegisteredPrompts,
  loadPrompt
} from "./index.js";

describe("prompt registry", () => {
  test("throws for unknown prompt id/version", () => {
    expect(() => loadPrompt("understand@999")).toThrow("Unknown prompt");
  });

  test("loads prompt file content by PROMPT_ID@version", () => {
    const prompt = loadPrompt("understand@2");

    expect(prompt.content).toContain("strict JSON");
    expect(prompt.content).toContain("UnderstoodQuerySchema");
    expect(prompt.promptRef).toBe("understand@2");
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
      "extract@1",
      "scrub@1",
      "understand@1",
      "understand@2"
    ]);
  });

  test("keeps the understand@2 runtime module synced to the markdown source", () => {
    const prompt = loadPrompt("understand@2");

    expect(readFileSync(prompt.filePath, "utf8")).toBe(UNDERSTAND_2_PROMPT);
  });
});
