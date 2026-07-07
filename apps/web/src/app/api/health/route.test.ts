import { describe, expect, test } from "vitest";
import type { AppConfig } from "../../../../../../packages/core/src/index";
import { computeHealth, type HealthRouteDeps } from "./deps";
import { GET } from "./route";

function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    db: {},
    supabase: {},
    models: {
      googleApiKey: "google-secret-value",
      anthropicApiKey: "anthropic-secret-value",
      openaiApiKey: "openai-secret-value"
    },
    safety: { tier2Optional: false },
    admin: { demoToken: "admin-secret-token" },
    rerank: { timeoutMs: 8_000 },
    rateLimit: {
      findPerMinute: 20,
      passPerMinute: 5,
      typeaheadPerMinute: 60
    },
    runtime: { env: "test" },
    ...overrides
  };
}

function deps(overrides: Partial<HealthRouteDeps> = {}): HealthRouteDeps {
  return {
    config: fakeConfig(),
    checkDb: async () => "configured",
    startedAtMs: 0,
    nowMs: () => 0,
    ...overrides
  };
}

describe("computeHealth", () => {
  test("reports ok with a fully healthy config", async () => {
    const body = await computeHealth(deps());

    expect(body).toEqual({
      status: "ok",
      checks: {
        db: "configured",
        model_keys: { google: "present", anthropic: "present", openai: "present" },
        safety_gate: "strict",
        admin: "enabled"
      },
      version: "dev",
      uptime_s: 0
    });
  });

  test("db configured but unreachable marks the whole response degraded", async () => {
    const body = await computeHealth(deps({ checkDb: async () => "unreachable" }));

    expect(body.status).toBe("degraded");
    expect(body.checks.db).toBe("unreachable");
  });

  test("db ok (a live probe succeeded) is not degraded", async () => {
    const body = await computeHealth(deps({ checkDb: async () => "ok" }));

    expect(body.status).toBe("ok");
    expect(body.checks.db).toBe("ok");
  });

  test("strict safety gate with no anthropic key is degraded (matches the /api/find fail-closed 503)", async () => {
    const config = fakeConfig({
      models: { googleApiKey: "g", openaiApiKey: "o" },
      safety: { tier2Optional: false }
    });
    const body = await computeHealth(deps({ config }));

    expect(body.status).toBe("degraded");
    expect(body.checks.safety_gate).toBe("strict");
    expect(body.checks.model_keys.anthropic).toBe("absent");
  });

  test("tier1_only mode with no anthropic key is not degraded by that rule", async () => {
    const config = fakeConfig({
      models: { googleApiKey: "g", openaiApiKey: "o" },
      safety: { tier2Optional: true }
    });
    const body = await computeHealth(deps({ config, checkDb: async () => "configured" }));

    expect(body.status).toBe("ok");
    expect(body.checks.safety_gate).toBe("tier1_only");
    expect(body.checks.model_keys.anthropic).toBe("absent");
  });

  test("reports admin disabled when no demo token is set", async () => {
    const config = fakeConfig({ admin: {} });
    const body = await computeHealth(deps({ config }));

    expect(body.checks.admin).toBe("disabled");
  });

  test("reports absent for each missing model key independently", async () => {
    const config = fakeConfig({ models: {} });
    const body = await computeHealth(deps({ config }));

    expect(body.checks.model_keys).toEqual({
      google: "absent",
      anthropic: "absent",
      openai: "absent"
    });
  });

  test("version falls back to dev without a git sha, and echoes one when given", async () => {
    const withoutSha = await computeHealth(deps());
    expect(withoutSha.version).toBe("dev");

    const withSha = await computeHealth(deps({ gitSha: "abc1234" }));
    expect(withSha.version).toBe("abc1234");
  });

  test("computes uptime from the injected clock", async () => {
    const body = await computeHealth(
      deps({ startedAtMs: 1_000, nowMs: () => 61_000 })
    );

    expect(body.uptime_s).toBe(60);
  });

  test("never leaks secret values, urls, or raw config into the response", async () => {
    const config = fakeConfig({
      db: { url: "postgres://user:hunter2@example.com/db" },
      supabase: {
        url: "https://project.supabase.co",
        anonKey: "anon-secret",
        serviceRoleKey: "service-role-secret"
      }
    });
    const body = await computeHealth(
      deps({ config, checkDb: async () => "ok" })
    );
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("supabase.co");
    expect(serialized).not.toContain("anon-secret");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("google-secret-value");
    expect(serialized).not.toContain("anthropic-secret-value");
    expect(serialized).not.toContain("openai-secret-value");
    expect(serialized).not.toContain("admin-secret-token");
  });
});

describe("GET /api/health", () => {
  test("responds 200 with a well-formed body against real (test-env) config", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      readonly status: string;
      readonly checks: { readonly db: string };
      readonly version: string;
      readonly uptime_s: number;
    };

    expect(response.status).toBe(200);
    expect(["ok", "degraded"]).toContain(body.status);
    // No DATABASE_URL in the test environment, so the live-probe branch
    // (and any real network attempt) never runs.
    expect(body.checks.db).toBe("configured");
    expect(typeof body.version).toBe("string");
    expect(body.uptime_s).toBeGreaterThanOrEqual(0);
  });
});
