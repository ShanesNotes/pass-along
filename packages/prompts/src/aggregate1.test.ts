import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { AGGREGATE_1_PROMPT } from "./aggregate1.js";

const promptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("aggregate@1 prompt", () => {
  test("the static src module (imported directly by engine code, no runtime fs) stays byte-identical to the markdown source", () => {
    const fileContent = readFileSync(join(promptRoot, "aggregate", "1.md"), "utf8");

    expect(fileContent).toBe(AGGREGATE_1_PROMPT);
  });
});
