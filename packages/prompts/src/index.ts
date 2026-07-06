import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export { UNDERSTAND_2_PROMPT } from "./understand2.js";

export type PromptRegistryEntry = {
  id: string;
  version: string;
  filePath: string;
  goldensPath: string;
};

export type LoadedPrompt = PromptRegistryEntry & {
  promptRef: string;
  content: string;
};

const promptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PROMPT_REGISTRY = {
  "understand@1": {
    id: "understand",
    version: "1",
    filePath: join(promptRoot, "understand", "1.md"),
    goldensPath: join(promptRoot, "understand", "goldens.jsonl")
  },
  "understand@2": {
    id: "understand",
    version: "2",
    filePath: join(promptRoot, "understand", "2.md"),
    goldensPath: join(promptRoot, "understand", "goldens.jsonl")
  },
  "crisis_gate@1": {
    id: "crisis_gate",
    version: "1",
    filePath: join(promptRoot, "crisis_gate", "1.md"),
    goldensPath: join(promptRoot, "crisis_gate", "goldens.jsonl")
  }
} as const satisfies Record<string, PromptRegistryEntry>;

export type PromptRef = keyof typeof PROMPT_REGISTRY;

export function loadPrompt(promptRef: string): LoadedPrompt {
  const entry = PROMPT_REGISTRY[promptRef as PromptRef];

  if (!entry) {
    throw new UnknownPromptError(promptRef);
  }

  return {
    ...entry,
    promptRef,
    content: readFileSync(entry.filePath, "utf8")
  };
}

export function listRegisteredPrompts(): PromptRegistryEntry[] {
  return Object.values(PROMPT_REGISTRY);
}

export function assertRegisteredGoldensExist(): void {
  for (const entry of listRegisteredPrompts()) {
    if (!existsSync(entry.goldensPath)) {
      throw new Error(`Missing goldens for ${entry.id}@${entry.version}`);
    }
  }
}

export class UnknownPromptError extends Error {
  readonly promptRef: string;

  constructor(promptRef: string) {
    super(`Unknown prompt "${promptRef}"`);
    this.name = "UnknownPromptError";
    this.promptRef = promptRef;
  }
}
