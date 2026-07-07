import { inspect } from "node:util";
import { z } from "zod";

export const DEFAULT_CONFIG_RERANK_TIMEOUT_MS = 8_000;
export const DEFAULT_RATE_LIMIT_FIND_PER_MIN = 20;
export const DEFAULT_RATE_LIMIT_PASS_PER_MIN = 5;
export const DEFAULT_RATE_LIMIT_TYPEAHEAD_PER_MIN = 60;

const RUNTIME_ENVS = ["development", "test", "production"] as const;
const REDACTED = "[redacted]";

const RuntimeEnvSchema = z.enum(RUNTIME_ENVS, {
  errorMap: () => ({
    message: "NODE_ENV must be one of development, test, production"
  })
});

const CrisisTier2OptionalSchema = z
  .enum(["1", "0", "true", "false"], {
    errorMap: () => ({
      message: "CRISIS_TIER2_OPTIONAL must be 1, 0, true, or false"
    })
  })
  .optional()
  .default("0")
  .transform((value) => value === "1" || value === "true");

const RerankTimeoutMsSchema = z
  .string()
  .regex(
    /^\d+$/u,
    "RERANK_TIMEOUT_MS must be a positive integer number of milliseconds"
  )
  .transform((value) => Number(value))
  .refine(
    (value) => Number.isSafeInteger(value) && value > 0,
    "RERANK_TIMEOUT_MS must be a positive integer number of milliseconds"
  )
  .optional()
  .default(String(DEFAULT_CONFIG_RERANK_TIMEOUT_MS))
  .transform((value) =>
    typeof value === "number" ? value : Number(value)
  );

const RateLimitFindPerMinuteSchema = positiveIntegerEnv(
  "RATE_LIMIT_FIND_PER_MIN",
  DEFAULT_RATE_LIMIT_FIND_PER_MIN
);
const RateLimitPassPerMinuteSchema = positiveIntegerEnv(
  "RATE_LIMIT_PASS_PER_MIN",
  DEFAULT_RATE_LIMIT_PASS_PER_MIN
);
const RateLimitTypeaheadPerMinuteSchema = positiveIntegerEnv(
  "RATE_LIMIT_TYPEAHEAD_PER_MIN",
  DEFAULT_RATE_LIMIT_TYPEAHEAD_PER_MIN
);

const ConfigEnvSchema = z.object({
  NODE_ENV: RuntimeEnvSchema.optional().default("development"),
  DATABASE_URL: optionalUrl("DATABASE_URL"),
  SUPABASE_URL: optionalUrl("SUPABASE_URL"),
  SUPABASE_ANON_KEY: optionalString(),
  SUPABASE_SERVICE_ROLE_KEY: optionalString(),
  SUPABASE_JWT_SECRET: optionalString(),
  GEMINI_API_KEY: optionalString(),
  GOOGLE_API_KEY: optionalString(),
  ANTHROPIC_API_KEY: optionalString(),
  OPENAI_API_KEY: optionalString(),
  ADMIN_DEMO_TOKEN: optionalString(),
  CRISIS_TIER2_OPTIONAL: CrisisTier2OptionalSchema,
  RERANK_TIMEOUT_MS: RerankTimeoutMsSchema,
  RATE_LIMIT_FIND_PER_MIN: RateLimitFindPerMinuteSchema,
  RATE_LIMIT_PASS_PER_MIN: RateLimitPassPerMinuteSchema,
  RATE_LIMIT_TYPEAHEAD_PER_MIN: RateLimitTypeaheadPerMinuteSchema
});

type RuntimeEnv = (typeof RUNTIME_ENVS)[number];

export type AppConfig = Readonly<{
  db: Readonly<{
    url?: string;
  }>;
  supabase: Readonly<{
    url?: string;
    anonKey?: string;
    serviceRoleKey?: string;
    jwtSecret?: string;
  }>;
  models: Readonly<{
    geminiApiKey?: string;
    googleApiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
  }>;
  safety: Readonly<{
    tier2Optional: boolean;
  }>;
  admin: Readonly<{
    demoToken?: string;
  }>;
  rerank: Readonly<{
    timeoutMs: number;
  }>;
  rateLimit: Readonly<{
    findPerMinute: number;
    passPerMinute: number;
    typeaheadPerMinute: number;
  }>;
  runtime: Readonly<{
    env: RuntimeEnv;
  }>;
}>;

export type ConfigRequirement =
  | "db.url"
  | "supabase.url"
  | "supabase.anonKey"
  | "supabase.serviceRoleKey"
  | "supabase.jwtSecret"
  | "models.geminiApiKey"
  | "models.googleApiKey"
  | "models.anthropicApiKey"
  | "models.openaiApiKey"
  | "admin.demoToken";

export interface LoadConfigOptions {
  readonly require?: readonly ConfigRequirement[];
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {}
): AppConfig {
  const parsed = parseEnv(env);
  const googleApiKey = parsed.GOOGLE_API_KEY ?? parsed.GEMINI_API_KEY;
  const config: AppConfig = {
    db: {
      ...(parsed.DATABASE_URL ? { url: parsed.DATABASE_URL } : {})
    },
    supabase: {
      ...(parsed.SUPABASE_URL ? { url: parsed.SUPABASE_URL } : {}),
      ...(parsed.SUPABASE_ANON_KEY
        ? { anonKey: parsed.SUPABASE_ANON_KEY }
        : {}),
      ...(parsed.SUPABASE_SERVICE_ROLE_KEY
        ? { serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY }
        : {}),
      ...(parsed.SUPABASE_JWT_SECRET
        ? { jwtSecret: parsed.SUPABASE_JWT_SECRET }
        : {})
    },
    models: {
      ...(parsed.GEMINI_API_KEY ? { geminiApiKey: parsed.GEMINI_API_KEY } : {}),
      ...(googleApiKey ? { googleApiKey } : {}),
      ...(parsed.ANTHROPIC_API_KEY
        ? { anthropicApiKey: parsed.ANTHROPIC_API_KEY }
        : {}),
      ...(parsed.OPENAI_API_KEY ? { openaiApiKey: parsed.OPENAI_API_KEY } : {})
    },
    safety: {
      tier2Optional: parsed.CRISIS_TIER2_OPTIONAL
    },
    admin: {
      ...(parsed.ADMIN_DEMO_TOKEN
        ? { demoToken: parsed.ADMIN_DEMO_TOKEN }
        : {})
    },
    rerank: {
      timeoutMs: parsed.RERANK_TIMEOUT_MS
    },
    rateLimit: {
      findPerMinute: parsed.RATE_LIMIT_FIND_PER_MIN,
      passPerMinute: parsed.RATE_LIMIT_PASS_PER_MIN,
      typeaheadPerMinute: parsed.RATE_LIMIT_TYPEAHEAD_PER_MIN
    },
    runtime: {
      env: parsed.NODE_ENV
    }
  };

  assertRequired(config, options.require ?? []);

  return deepFreeze(attachRedaction(config));
}

function optionalString() {
  return z.string().min(1).optional();
}

function optionalUrl(envVar: string) {
  return z.string().url(`${envVar} must be a valid URL`).optional();
}

function positiveIntegerEnv(envVar: string, defaultValue: number) {
  return z
    .string()
    .regex(
      /^\d+$/u,
      `${envVar} must be a positive integer`
    )
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isSafeInteger(value) && value > 0,
      `${envVar} must be a positive integer`
    )
    .optional()
    .default(String(defaultValue))
    .transform((value) =>
      typeof value === "number" ? value : Number(value)
    );
}

function parseEnv(env: NodeJS.ProcessEnv): z.output<typeof ConfigEnvSchema> {
  const normalized = {
    NODE_ENV: cleanEnvValue(env.NODE_ENV),
    DATABASE_URL: cleanEnvValue(env.DATABASE_URL),
    SUPABASE_URL: cleanEnvValue(env.SUPABASE_URL),
    SUPABASE_ANON_KEY: cleanEnvValue(env.SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: cleanEnvValue(env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_JWT_SECRET: cleanEnvValue(env.SUPABASE_JWT_SECRET),
    GEMINI_API_KEY: cleanEnvValue(env.GEMINI_API_KEY),
    GOOGLE_API_KEY: cleanEnvValue(env.GOOGLE_API_KEY),
    ANTHROPIC_API_KEY: cleanEnvValue(env.ANTHROPIC_API_KEY),
    OPENAI_API_KEY: cleanEnvValue(env.OPENAI_API_KEY),
    ADMIN_DEMO_TOKEN: cleanEnvValue(env.ADMIN_DEMO_TOKEN),
    CRISIS_TIER2_OPTIONAL: cleanEnvValue(env.CRISIS_TIER2_OPTIONAL),
    RERANK_TIMEOUT_MS: cleanEnvValue(env.RERANK_TIMEOUT_MS),
    RATE_LIMIT_FIND_PER_MIN: cleanEnvValue(env.RATE_LIMIT_FIND_PER_MIN),
    RATE_LIMIT_PASS_PER_MIN: cleanEnvValue(env.RATE_LIMIT_PASS_PER_MIN),
    RATE_LIMIT_TYPEAHEAD_PER_MIN: cleanEnvValue(
      env.RATE_LIMIT_TYPEAHEAD_PER_MIN
    )
  };
  const result = ConfigEnvSchema.safeParse(normalized);

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => issue.message)
    );
  }

  return result.data;
}

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function assertRequired(
  config: AppConfig,
  requirements: readonly ConfigRequirement[]
): void {
  const missing = requirements.filter(
    (requirement) => !valueForRequirement(config, requirement)
  );

  if (missing.length === 0) {
    return;
  }

  throw new ConfigError([
    `Missing required environment variables: ${missing
      .map((requirement) => `${envLabelFor(requirement)} (${requirement})`)
      .join(", ")}`
  ]);
}

function valueForRequirement(
  config: AppConfig,
  requirement: ConfigRequirement
): string | undefined {
  switch (requirement) {
    case "db.url":
      return config.db.url;
    case "supabase.url":
      return config.supabase.url;
    case "supabase.anonKey":
      return config.supabase.anonKey;
    case "supabase.serviceRoleKey":
      return config.supabase.serviceRoleKey;
    case "supabase.jwtSecret":
      return config.supabase.jwtSecret;
    case "models.geminiApiKey":
      return config.models.geminiApiKey;
    case "models.googleApiKey":
      return config.models.googleApiKey;
    case "models.anthropicApiKey":
      return config.models.anthropicApiKey;
    case "models.openaiApiKey":
      return config.models.openaiApiKey;
    case "admin.demoToken":
      return config.admin.demoToken;
  }
}

function envLabelFor(requirement: ConfigRequirement): string {
  switch (requirement) {
    case "db.url":
      return "DATABASE_URL";
    case "supabase.url":
      return "SUPABASE_URL";
    case "supabase.anonKey":
      return "SUPABASE_ANON_KEY";
    case "supabase.serviceRoleKey":
      return "SUPABASE_SERVICE_ROLE_KEY";
    case "supabase.jwtSecret":
      return "SUPABASE_JWT_SECRET";
    case "models.geminiApiKey":
      return "GEMINI_API_KEY";
    case "models.googleApiKey":
      return "GOOGLE_API_KEY or GEMINI_API_KEY";
    case "models.anthropicApiKey":
      return "ANTHROPIC_API_KEY";
    case "models.openaiApiKey":
      return "OPENAI_API_KEY";
    case "admin.demoToken":
      return "ADMIN_DEMO_TOKEN";
  }
}

function attachRedaction(config: AppConfig): AppConfig {
  Object.defineProperties(config, {
    toJSON: {
      value: () => redactConfig(config),
      enumerable: false
    },
    [inspect.custom]: {
      value: () => redactConfig(config),
      enumerable: false
    }
  });

  return config;
}

function redactConfig(config: AppConfig): AppConfig {
  return {
    db: {
      ...(config.db.url ? { url: REDACTED } : {})
    },
    supabase: {
      ...(config.supabase.url ? { url: config.supabase.url } : {}),
      ...(config.supabase.anonKey ? { anonKey: REDACTED } : {}),
      ...(config.supabase.serviceRoleKey ? { serviceRoleKey: REDACTED } : {}),
      ...(config.supabase.jwtSecret ? { jwtSecret: REDACTED } : {})
    },
    models: {
      ...(config.models.geminiApiKey ? { geminiApiKey: REDACTED } : {}),
      ...(config.models.googleApiKey ? { googleApiKey: REDACTED } : {}),
      ...(config.models.anthropicApiKey ? { anthropicApiKey: REDACTED } : {}),
      ...(config.models.openaiApiKey ? { openaiApiKey: REDACTED } : {})
    },
    safety: {
      tier2Optional: config.safety.tier2Optional
    },
    admin: {
      ...(config.admin.demoToken ? { demoToken: REDACTED } : {})
    },
    rerank: {
      timeoutMs: config.rerank.timeoutMs
    },
    rateLimit: {
      findPerMinute: config.rateLimit.findPerMinute,
      passPerMinute: config.rateLimit.passPerMinute,
      typeaheadPerMinute: config.rateLimit.typeaheadPerMinute
    },
    runtime: {
      env: config.runtime.env
    }
  };
}

function deepFreeze<T extends object>(value: T): T {
  for (const property of Object.values(value)) {
    if (isFreezable(property) && !Object.isFrozen(property)) {
      deepFreeze(property);
    }
  }

  return Object.freeze(value);
}

function isFreezable(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}
