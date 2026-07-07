import { loadConfig, type AppConfig } from "../../../../../../packages/core/src/index";
import { getDbClient } from "../../../../../../packages/engine/src/db/client";

// Kept short: this endpoint gets polled, and a slow/hanging health check is
// worse than a fast "unreachable".
const DB_HEALTH_CHECK_TIMEOUT_MS = 1_500;

// "configured" here means "no DATABASE_URL for this deployment tier — the
// fixture/in-memory demo path is in effect," not an error. "unreachable" is
// reserved for the case where a DB URL *is* set but the probe query failed
// or timed out; "ok" means it succeeded.
export type DbCheckStatus = "configured" | "unreachable" | "ok";

export interface HealthChecks {
  readonly db: DbCheckStatus;
  readonly model_keys: {
    readonly google: "present" | "absent";
    readonly anthropic: "present" | "absent";
    readonly openai: "present" | "absent";
  };
  readonly safety_gate: "strict" | "tier1_only";
  readonly admin: "enabled" | "disabled";
}

export interface HealthResponseBody {
  readonly status: "ok" | "degraded";
  readonly checks: HealthChecks;
  readonly version: string;
  readonly uptime_s: number;
}

export interface HealthRouteDeps {
  readonly config: AppConfig;
  readonly checkDb: () => Promise<DbCheckStatus>;
  readonly startedAtMs: number;
  readonly nowMs?: () => number;
  readonly gitSha?: string;
}

// Pure and dependency-injected so tests never need a real Postgres or real
// process.env — only defaultHealthRouteDeps() below touches those.
export async function computeHealth(
  deps: HealthRouteDeps
): Promise<HealthResponseBody> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const db = await deps.checkDb();
  const modelKeys = {
    google: presence(deps.config.models.googleApiKey),
    anthropic: presence(deps.config.models.anthropicApiKey),
    openai: presence(deps.config.models.openaiApiKey)
  } as const;
  const safetyGate = deps.config.safety.tier2Optional ? "tier1_only" : "strict";
  const admin = deps.config.admin.demoToken ? "enabled" : "disabled";

  // Degraded, not just informational, whenever something the app depends on
  // is actually broken: a configured DB we can't reach, or a strict safety
  // gate with no key to run tier-2 (which fail-closes /api/find and
  // /api/pass with a 503 today — see docs/OPERATIONS.md).
  const degraded =
    db === "unreachable" ||
    (safetyGate === "strict" && modelKeys.anthropic === "absent");

  return {
    status: degraded ? "degraded" : "ok",
    checks: {
      db,
      model_keys: modelKeys,
      safety_gate: safetyGate,
      admin
    },
    version: deps.gitSha ?? "dev",
    uptime_s: Math.max(0, Math.round((nowMs() - deps.startedAtMs) / 1000))
  };
}

function presence(value: string | undefined): "present" | "absent" {
  return value ? "present" : "absent";
}

export async function defaultCheckDb(config: AppConfig): Promise<DbCheckStatus> {
  if (!config.db.url) {
    return "configured";
  }

  try {
    const client = getDbClient(config);
    await withTimeout(
      client.query("select 1", []),
      DB_HEALTH_CHECK_TIMEOUT_MS
    );
    return "ok";
  } catch {
    return "unreachable";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("db health check timed out")),
      ms
    );

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

const startedAtMs = Date.now();
let cachedDeps: HealthRouteDeps | undefined;

export function defaultHealthRouteDeps(): HealthRouteDeps {
  if (!cachedDeps) {
    const config = loadConfig();

    cachedDeps = {
      config,
      checkDb: () => defaultCheckDb(config),
      startedAtMs,
      ...(process.env.VERCEL_GIT_COMMIT_SHA
        ? { gitSha: process.env.VERCEL_GIT_COMMIT_SHA }
        : {})
    };
  }

  return cachedDeps;
}
