export type LlmProvider = "anthropic" | "openai" | "google";

export type RouteParams = {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
};

export type PromptRoute = {
  provider: LlmProvider;
  model: string;
  params: RouteParams;
};

export const PROMPT_ROUTING = {
  "understand@1": {
    provider: "openai",
    model: "gpt-4.1-mini",
    params: {
      temperature: 0,
      maxTokens: 900
    }
  },
  "understand@2": {
    provider: "google",
    model: "gemini-3.1-flash-lite",
    params: {
      temperature: 0,
      maxTokens: 900
    }
  },
  "crisis_gate@1": {
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    params: {
      temperature: 0,
      maxTokens: 300
    }
  },
  "scrub@1": {
    provider: "google",
    model: "gemini-3.1-flash-lite",
    params: {
      temperature: 0,
      maxTokens: 900
    }
  },
  "extract@1": {
    provider: "google",
    model: "gemini-3.1-flash-lite",
    params: {
      temperature: 0,
      maxTokens: 1200
    }
  },
  "aggregate@1": {
    provider: "google",
    model: "gemini-3.1-flash-lite",
    params: {
      temperature: 0.2,
      maxTokens: 1400
    }
  }
} as const satisfies Record<string, PromptRoute>;

export type PromptId = keyof typeof PROMPT_ROUTING;

export function getPromptRoute(promptId: string): PromptRoute {
  const route = PROMPT_ROUTING[promptId as PromptId];

  if (!route) {
    throw new UnknownPromptRouteError(promptId);
  }

  return route;
}

export class UnknownPromptRouteError extends Error {
  readonly promptId: string;

  constructor(promptId: string) {
    super(`No LLM route configured for prompt "${promptId}"`);
    this.name = "UnknownPromptRouteError";
    this.promptId = promptId;
  }
}
