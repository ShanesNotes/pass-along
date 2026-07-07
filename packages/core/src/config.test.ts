import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_CONFIG_RERANK_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_FIND_PER_MIN,
  DEFAULT_RATE_LIMIT_PASS_PER_MIN,
  DEFAULT_RATE_LIMIT_TYPEAHEAD_PER_MIN,
  loadConfig
} from "./config.js";

describe("loadConfig", () => {
  test("boots keyless with typed defaults", () => {
    const config = loadConfig({});

    expect(config).toEqual({
      db: {},
      supabase: {},
      models: {},
      safety: { tier2Optional: false },
      admin: {},
      rerank: { timeoutMs: DEFAULT_CONFIG_RERANK_TIMEOUT_MS },
      rateLimit: {
        findPerMinute: DEFAULT_RATE_LIMIT_FIND_PER_MIN,
        passPerMinute: DEFAULT_RATE_LIMIT_PASS_PER_MIN,
        typeaheadPerMinute: DEFAULT_RATE_LIMIT_TYPEAHEAD_PER_MIN
      },
      runtime: { env: "development" }
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.models)).toBe(true);
  });

  test("normalizes configured values and aliases GEMINI_API_KEY for Google", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@example.test/pass_along",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      SUPABASE_JWT_SECRET: " jwt-secret ",
      GEMINI_API_KEY: " gemini-key ",
      ANTHROPIC_API_KEY: "anthropic-key",
      OPENAI_API_KEY: "openai-key",
      ADMIN_DEMO_TOKEN: " admin-token ",
      CRISIS_TIER2_OPTIONAL: "1",
      RERANK_TIMEOUT_MS: "1234",
      RATE_LIMIT_FIND_PER_MIN: "30",
      RATE_LIMIT_PASS_PER_MIN: "10",
      RATE_LIMIT_TYPEAHEAD_PER_MIN: "90"
    });

    expect(config).toMatchObject({
      db: { url: "postgres://user:pass@example.test/pass_along" },
      supabase: {
        url: "https://example.supabase.co",
        anonKey: "anon-key",
        serviceRoleKey: "service-role-key",
        jwtSecret: "jwt-secret"
      },
      models: {
        geminiApiKey: "gemini-key",
        googleApiKey: "gemini-key",
        anthropicApiKey: "anthropic-key",
        openaiApiKey: "openai-key"
      },
      safety: { tier2Optional: true },
      admin: { demoToken: "admin-token" },
      rerank: { timeoutMs: 1234 },
      rateLimit: {
        findPerMinute: 30,
        passPerMinute: 10,
        typeaheadPerMinute: 90
      },
      runtime: { env: "production" }
    });
  });

  test("prefers GOOGLE_API_KEY over the Gemini alias when both are set", () => {
    const config = loadConfig({
      GEMINI_API_KEY: "gemini-key",
      GOOGLE_API_KEY: "google-key"
    });

    expect(config.models.googleApiKey).toBe("google-key");
    expect(config.models.geminiApiKey).toBe("gemini-key");
  });

  test("throws actionable errors for malformed values", () => {
    expect(() => loadConfig({ DATABASE_URL: "not a url" })).toThrow(
      /DATABASE_URL.*valid URL/u
    );
    expect(() => loadConfig({ RERANK_TIMEOUT_MS: "1100ms" })).toThrow(
      /RERANK_TIMEOUT_MS.*positive integer/u
    );
    expect(() => loadConfig({ RATE_LIMIT_FIND_PER_MIN: "many" })).toThrow(
      /RATE_LIMIT_FIND_PER_MIN.*positive integer/u
    );
  });

  test("supports requiring secrets for production paths", () => {
    expect(() =>
      loadConfig({}, { require: ["models.anthropicApiKey"] })
    ).toThrow(/ANTHROPIC_API_KEY/u);

    expect(() =>
      loadConfig(
        { GEMINI_API_KEY: "gemini-key" },
        { require: ["models.googleApiKey"] }
      )
    ).not.toThrow();
  });

  test("redacts secret material from JSON and inspection", () => {
    const secretValues = [
      "postgres://user:secret-pass@example.test/pass_along",
      "anon-secret",
      "service-role-secret",
      "jwt-secret-value",
      "gemini-secret",
      "google-secret",
      "anthropic-secret",
      "openai-secret",
      "admin-secret"
    ];
    const config = loadConfig({
      DATABASE_URL: secretValues[0],
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: secretValues[1],
      SUPABASE_SERVICE_ROLE_KEY: secretValues[2],
      SUPABASE_JWT_SECRET: secretValues[3],
      GEMINI_API_KEY: secretValues[4],
      GOOGLE_API_KEY: secretValues[5],
      ANTHROPIC_API_KEY: secretValues[6],
      OPENAI_API_KEY: secretValues[7],
      ADMIN_DEMO_TOKEN: secretValues[8]
    });
    const serialized = JSON.stringify(config);
    const inspected = inspect(config);

    for (const secret of secretValues) {
      expect(serialized).not.toContain(secret);
      expect(inspected).not.toContain(secret);
    }
    expect(serialized).toContain("[redacted]");
    expect(inspected).toContain("[redacted]");
  });
});
