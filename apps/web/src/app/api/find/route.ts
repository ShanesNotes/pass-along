import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  cardsFromMatches,
  corpusTags,
  createInMemoryVectorStoreFromCorpus,
  inferTagFiltersFromText,
  loadFixtureCorpus,
  type FindResultCard,
  type ProviderKind,
  type RetrievalCorpus,
  type RetrievalFilters,
  type VectorStorePort
} from "../../../../../../packages/engine/src/retrieval/index.js";
import { embedTextDevOnly } from "../../../../../../packages/engine/src/llm/embed.js";
import type { EmbeddingMetadata } from "../../../../../../packages/engine/src/retrieval/index.js";

export const runtime = "nodejs";

export interface FindPerformedEvent {
  readonly type: "find.performed";
  readonly payload: {
    readonly understood: null;
    readonly query_hash: string;
    readonly result_count: number;
    readonly latency_ms: number;
  };
}

export interface FindEventsPort {
  emit(event: FindPerformedEvent): Promise<void>;
}

export interface QueryAuditRow {
  readonly query_hash: string;
  readonly understood: null;
}

export interface QueryAuditPort {
  upsert(row: QueryAuditRow): Promise<void>;
}

export interface FindRouteDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly corpus: RetrievalCorpus;
  readonly store: VectorStorePort;
  readonly events: FindEventsPort;
  readonly queries?: QueryAuditPort;
  readonly embed: (text: string) => Promise<{
    readonly vector: readonly number[];
    readonly metadata: EmbeddingMetadata;
  }>;
  readonly now?: () => number;
}

interface FindRequestBody {
  readonly text: string;
  readonly kind?: ProviderKind | "either";
  readonly location?: string;
}

const SAFETY_GATE_ERROR = "UNAVAILABLE_PENDING_SAFETY_GATE";
const DEFAULT_RETRIEVAL_TOP_N = 40;
const DEFAULT_CARD_LIMIT = 6;

let defaultDepsPromise: Promise<FindRouteDeps> | undefined;

export async function POST(request: Request): Promise<Response> {
  if (!isSafetyGateDevEscapeEnabled(process.env)) {
    return json(
      {
        error: SAFETY_GATE_ERROR
      },
      503
    );
  }

  const deps = await defaultFindRouteDeps();
  return createFindPostHandler(deps)(request);
}

export function createFindPostHandler(deps: FindRouteDeps) {
  return async (request: Request): Promise<Response> => {
    const env = deps.env ?? process.env;

    if (!isSafetyGateDevEscapeEnabled(env)) {
      return json(
        {
          error: SAFETY_GATE_ERROR
        },
        503
      );
    }

    const parsed = parseFindRequestBody(await readJson(request));

    if (!parsed.ok) {
      return json({ error: "INVALID_FIND_REQUEST" }, 400);
    }

    const startedAt = deps.now?.() ?? performance.now();
    const body = parsed.body;
    const queryHash = sha256(body.text);
    const embedding = await deps.embed(body.text);
    const filters = filtersFor(body, deps.corpus);
    const matches = await deps.store.search({
      vector: embedding.vector,
      topN: DEFAULT_RETRIEVAL_TOP_N,
      filters
    });
    const cards = cardsFromMatches(matches, deps.corpus, DEFAULT_CARD_LIMIT);
    const latencyMs = Math.max(
      0,
      Math.round((deps.now?.() ?? performance.now()) - startedAt)
    );

    await deps.queries?.upsert({
      query_hash: queryHash,
      understood: null
    });
    await deps.events.emit({
      type: "find.performed",
      payload: {
        understood: null,
        query_hash: queryHash,
        result_count: cards.length,
        latency_ms: latencyMs
      }
    });

    return json({
      understood: null,
      results: cards
    } satisfies {
      understood: null;
      results: readonly FindResultCard[];
    });
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function defaultFindRouteDeps(): Promise<FindRouteDeps> {
  if (!defaultDepsPromise) {
    defaultDepsPromise = createDefaultFindRouteDeps();
  }

  return defaultDepsPromise;
}

async function createDefaultFindRouteDeps(): Promise<FindRouteDeps> {
  const corpus = loadFixtureCorpus();
  const embed = async (text: string) => {
    const embedding = embedTextDevOnly(text);
    return { vector: embedding.vector, metadata: embedding.metadata };
  };
  const store = await createInMemoryVectorStoreFromCorpus(corpus, embed);

  return {
    corpus,
    store,
    embed,
    events: {
      async emit() {
        return undefined;
      }
    }
  };
}

function isSafetyGateDevEscapeEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.FIND_SAFETY_GATE_DISABLED_I_UNDERSTAND === "1" &&
    env.NODE_ENV !== "production"
  );
}

function filtersFor(
  body: FindRequestBody,
  corpus: RetrievalCorpus
): RetrievalFilters {
  const tags = inferTagFiltersFromText(body.text, corpusTags(corpus));
  const filters: {
    kind?: ProviderKind | "either";
    location?: string;
    tags?: readonly string[];
  } = {};

  if (body.kind !== undefined) {
    filters.kind = body.kind;
  }

  if (body.location !== undefined) {
    filters.location = body.location;
  }

  if (tags.length > 0) {
    filters.tags = tags;
  }

  return filters;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function parseFindRequestBody(
  value: unknown
): { readonly ok: true; readonly body: FindRequestBody } | { readonly ok: false } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;
  const text = record.text;
  const kind = record.kind;
  const location = record.location;

  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false };
  }

  if (
    kind !== undefined &&
    kind !== "therapist" &&
    kind !== "facility" &&
    kind !== "either"
  ) {
    return { ok: false };
  }

  if (location !== undefined && typeof location !== "string") {
    return { ok: false };
  }

  const body: {
    text: string;
    kind?: ProviderKind | "either";
    location?: string;
  } = {
    text
  };

  if (kind !== undefined) {
    body.kind = kind;
  }

  if (location !== undefined) {
    body.location = location;
  }

  return {
    ok: true,
    body
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
