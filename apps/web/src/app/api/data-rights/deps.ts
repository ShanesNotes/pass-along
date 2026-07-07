import { randomUUID } from "node:crypto";
import { loadConfig, type AppConfig } from "../../../../../../packages/core/src/index";
import { getDbClient } from "../../../../../../packages/engine/src/db/client";
import type { SqlExecutor } from "../../../../../../packages/engine/src/retrieval/pgvector";

export interface DataRightsRequestBody {
  readonly kind: "deletion_request";
  readonly recommendationId?: string;
  readonly contact?: string;
}

export interface DataRightsRequestRow {
  readonly id: string;
  readonly kind: "deletion_request";
  readonly recommendationId?: string;
  readonly contact?: string;
  readonly status: "pending";
  readonly requestedAt: string;
}

export interface DataRightsStorePort {
  insertRequest(
    input: DataRightsRequestBody & { readonly now: Date }
  ): Promise<DataRightsRequestRow>;
}

export interface DataRightsRouteDeps {
  readonly store: DataRightsStorePort;
  readonly now?: () => Date;
}

let defaultDepsPromise: Promise<DataRightsRouteDeps> | undefined;

export function createDataRightsPostHandler(deps: DataRightsRouteDeps) {
  return async (request: Request): Promise<Response> => {
    const parsed = parseDataRightsRequestBody(await readJson(request));

    if (!parsed.ok) {
      return json({ error: "INVALID_DATA_RIGHTS_REQUEST" }, 400);
    }

    const now = deps.now?.() ?? new Date();
    const row = await deps.store.insertRequest({ ...parsed.body, now });

    return json(
      {
        request_id: row.id,
        status: row.status
      },
      201
    );
  };
}

export async function defaultDataRightsRouteDeps(): Promise<DataRightsRouteDeps> {
  if (!defaultDepsPromise) {
    defaultDepsPromise = createDefaultDataRightsRouteDeps(loadConfig());
  }

  return defaultDepsPromise;
}

async function createDefaultDataRightsRouteDeps(
  config: AppConfig
): Promise<DataRightsRouteDeps> {
  return {
    store: config.db.url
      ? createPgDataRightsStore(getDbClient(config))
      : createInMemoryDataRightsStore()
  };
}

export function createInMemoryDataRightsStore(): DataRightsStorePort {
  const rows: DataRightsRequestRow[] = [];

  return {
    async insertRequest(input) {
      const row: DataRightsRequestRow = {
        id: randomUUID(),
        kind: input.kind,
        ...(input.recommendationId !== undefined
          ? { recommendationId: input.recommendationId }
          : {}),
        ...(input.contact !== undefined ? { contact: input.contact } : {}),
        status: "pending",
        requestedAt: input.now.toISOString()
      };

      rows.push(row);
      return row;
    }
  };
}

export function createPgDataRightsStore(sql: SqlExecutor): DataRightsStorePort {
  return {
    async insertRequest(input) {
      const result = await sql.query<{
        readonly id: string;
        readonly requested_at: Date;
      }>(
        `
insert into public.data_rights_requests
  (kind, recommendation_id, contact, status, requested_at)
values ($1, $2::uuid, $3, 'pending', $4)
returning id, requested_at
`.trim(),
        [
          input.kind,
          input.recommendationId ?? null,
          input.contact ?? null,
          input.now
        ]
      );
      const row = result.rows[0];

      if (!row) {
        throw new Error("data_rights_requests insert returned no row");
      }

      return {
        id: row.id,
        kind: input.kind,
        ...(input.recommendationId !== undefined
          ? { recommendationId: input.recommendationId }
          : {}),
        ...(input.contact !== undefined ? { contact: input.contact } : {}),
        status: "pending",
        requestedAt: row.requested_at.toISOString()
      };
    }
  };
}

function parseDataRightsRequestBody(
  value: unknown
):
  | { readonly ok: true; readonly body: DataRightsRequestBody }
  | { readonly ok: false } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;

  if (record.kind !== "deletion_request") {
    return { ok: false };
  }

  const recommendationId = trimmedStringOrUndefined(record.recommendation_id);
  const contact = trimmedStringOrUndefined(record.contact);

  // At least one identifier is required or there's nothing for a human to
  // act on.
  if (recommendationId === undefined && contact === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    body: {
      kind: "deletion_request",
      ...(recommendationId !== undefined ? { recommendationId } : {}),
      ...(contact !== undefined ? { contact } : {})
    }
  };
}

function trimmedStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
