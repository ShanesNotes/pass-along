import type { AppConfig } from "../../../core/src/index.js";
import { getDbClient } from "./client.js";
import { PgIntakeArtifactStorage } from "./adapters/intake-storage.js";
import { PgJobStorage } from "./adapters/job-storage.js";
import { PgPassStore } from "./adapters/pass-store.js";
import { PgVectorAdapter } from "./adapters/vector-store.js";

export interface DbBackedStores {
  readonly vectorStore: PgVectorAdapter;
  readonly jobStorage: PgJobStorage;
  readonly intakeStorage: PgIntakeArtifactStorage;
  readonly passStore: PgPassStore;
}

// Wire-up seam: returns DB-backed stores when config.db.url (DATABASE_URL)
// is set, else undefined so callers fall back to their in-memory demo
// stores. Not default-on — a route deps file has to opt in explicitly.
//
// passStore mirrors apps/web/src/app/api/pass/deps.ts's PassDemoStore shape
// (that interface is now fully async, PA-028) with its own local types —
// packages/engine can't import an apps/web-local type without inverting the
// monorepo dependency direction, so the wire-up call site in pass/deps.ts is
// where TypeScript actually proves the two are structurally compatible.
export function createStores(config: AppConfig): DbBackedStores | undefined {
  if (!config.db.url) {
    return undefined;
  }

  const client = getDbClient(config);

  return {
    vectorStore: new PgVectorAdapter(client),
    jobStorage: new PgJobStorage(client),
    intakeStorage: new PgIntakeArtifactStorage(client),
    passStore: new PgPassStore(client)
  };
}
