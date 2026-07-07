import type { AppConfig } from "../../../core/src/index.js";
import { getDbClient } from "./client.js";
import { PgIntakeArtifactStorage } from "./adapters/intake-storage.js";
import { PgJobStorage } from "./adapters/job-storage.js";
import { PgVectorAdapter } from "./adapters/vector-store.js";

export interface DbBackedStores {
  readonly vectorStore: PgVectorAdapter;
  readonly jobStorage: PgJobStorage;
  readonly intakeStorage: PgIntakeArtifactStorage;
}

// Wire-up seam: returns DB-backed stores when config.db.url (DATABASE_URL)
// is set, else undefined so callers fall back to their in-memory demo
// stores. Not default-on — a route deps file has to opt in explicitly.
//
// NOTE: this does not cover the full PassDemoStore surface used by
// apps/web/src/app/api/pass/deps.ts. Two of its methods — hasProvider and
// createSubmission — are declared synchronous in that interface, which
// can't be honestly backed by a network database (a real INSERT/SELECT is
// inherently async). Wiring pass/deps.ts to this factory needs that
// interface made async first; see the PA-023 packet report for detail.
// find/deps.ts's VectorStorePort is fully async and IS wired to this.
export function createStores(config: AppConfig): DbBackedStores | undefined {
  if (!config.db.url) {
    return undefined;
  }

  const client = getDbClient(config);

  return {
    vectorStore: new PgVectorAdapter(client),
    jobStorage: new PgJobStorage(client),
    intakeStorage: new PgIntakeArtifactStorage(client)
  };
}
