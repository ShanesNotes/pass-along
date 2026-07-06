import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RERANK_1_PROMPT } from "./rerank1.js";

const promptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("rerank@1 prompt", () => {
  test("the static src module stays byte-identical to the markdown source", () => {
    const fileContent = readFileSync(join(promptRoot, "rerank", "1.md"), "utf8");

    expect(fileContent).toBe(RERANK_1_PROMPT);
  });
});
