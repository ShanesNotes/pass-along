// DEPENDENCY: `pg` (node-postgres, MIT). Chosen over `postgres` (postgres.js,
// Unlicense) because every route here runs `export const runtime = "nodejs"`
// (never edge), so postgres.js's edge-friendly design buys nothing, while
// `pg`'s Pool is the more established, MIT-licensed, widely-audited choice
// for a long-lived Node process holding a direct connection.
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { AppConfig } from "../../../core/src/index.js";
import type { SqlExecutor, SqlQueryResult } from "../retrieval/pgvector.js";

export interface DbClient extends SqlExecutor {
  withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

// service_role semantics: this connects directly to Postgres with the full
// schema visible (no RLS bypass needed because we ARE the privileged role),
// mirroring how a Supabase server-side client uses the service_role key.
// PostgREST and the anon/authenticated paths are never used server-side;
// only the RLS-enforcing browser/anon path goes through Supabase's API.
export function createDbClient(config: AppConfig): DbClient {
  const url = config.db.url;

  if (!url) {
    throw new Error(
      "createDbClient requires config.db.url (DATABASE_URL) to be set"
    );
  }

  const pool = new Pool({ connectionString: url });

  return clientFromExecutor(pool);
}

function clientFromExecutor(pool: Pool): DbClient {
  return {
    async query<TRow>(
      sql: string,
      params: readonly unknown[]
    ): Promise<SqlQueryResult<TRow>> {
      const result = await pool.query<TRow & QueryResultRow>(
        sql,
        params as unknown[]
      );
      return { rows: result.rows };
    },

    async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();

      try {
        await client.query("begin");
        const result = await fn(executorFromPoolClient(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async end() {
      await pool.end();
    }
  };
}

function executorFromPoolClient(client: PoolClient): SqlExecutor {
  return {
    async query<TRow>(
      sql: string,
      params: readonly unknown[]
    ): Promise<SqlQueryResult<TRow>> {
      const result = await client.query<TRow & QueryResultRow>(
        sql,
        params as unknown[]
      );
      return { rows: result.rows };
    }
  };
}

let singleton: DbClient | undefined;

// Lazy singleton: the first caller to need a DB connection creates the pool;
// everyone after reuses it. Call resetDbClientForTests() between test files
// that need a fresh pool against a different PASS_ALONG_TEST_DB_URL.
export function getDbClient(config: AppConfig): DbClient {
  if (!singleton) {
    singleton = createDbClient(config);
  }

  return singleton;
}

export async function resetDbClientForTests(): Promise<void> {
  if (singleton) {
    await singleton.end();
    singleton = undefined;
  }
}
