import fixtureCorpusJson from "../../../../../../evals/fixtures/corpus/recommendations.json";
import type { RetrievalCorpus } from "../../../../../../packages/engine/src/retrieval/index";
import {
  InMemoryProviderNameSearch,
  type ProviderNameMatch,
  type ProviderNameSearchPort
} from "../../../../../../packages/engine/src/retrieval/typeahead";

export const runtime = "nodejs";

interface TypeaheadApiResult {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly kind: "therapist" | "facility";
  readonly loc: string;
  readonly verified: boolean;
  readonly score: number;
}

interface TypeaheadRouteDeps {
  readonly providerSearch: ProviderNameSearchPort;
  readonly limit?: number;
}

let defaultDepsPromise: Promise<TypeaheadRouteDeps> | undefined;

export async function POST(request: Request): Promise<Response> {
  const deps = await defaultTypeaheadRouteDeps();
  const q = qFromBody(await readJson(request));

  if (q.trim().length === 0) {
    return json({ results: [] });
  }

  const results = await deps.providerSearch.searchProvidersByName({
    query: q,
    limit: deps.limit ?? 5
  });

  return json({ results: results.map(toApiResult) });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function qFromBody(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }

  const q = (value as Record<string, unknown>).q;
  return typeof q === "string" ? q : "";
}

async function defaultTypeaheadRouteDeps(): Promise<TypeaheadRouteDeps> {
  if (!defaultDepsPromise) {
    defaultDepsPromise = createDefaultTypeaheadRouteDeps();
  }

  return defaultDepsPromise;
}

async function createDefaultTypeaheadRouteDeps(): Promise<TypeaheadRouteDeps> {
  const corpus = fixtureCorpusJson as RetrievalCorpus;

  return {
    providerSearch: new InMemoryProviderNameSearch(corpus.providers),
    limit: 5
  };
}

function toApiResult(match: ProviderNameMatch): TypeaheadApiResult {
  return {
    id: match.id,
    name: match.name,
    credential: match.credential,
    kind: match.kind,
    loc: match.loc,
    verified: match.verified,
    score: match.score
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
