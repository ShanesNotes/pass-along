import fixtureCorpusJson from "../../../../../../evals/fixtures/corpus/recommendations.json";
import { embedTextDevOnly } from "../../../../../../packages/engine/src/llm/embed";
import {
  createInMemoryVectorStoreFromCorpus,
  type RetrievalCorpus
} from "../../../../../../packages/engine/src/retrieval/index";
import {
  createInMemorySimilarLookup,
  findSimilarNeighbors,
  type SimilarNeighbor,
  type SimilarTarget
} from "../../../../../../packages/engine/src/retrieval/similar";
import {
  currentDatedVerifiedCheck,
  fixtureLicenseCheckForProviderId,
  type LicenseCheckRecord
} from "../../../../../../packages/engine/src/verification/index";

export const runtime = "nodejs";

interface SimilarApiResult {
  readonly providerId: string;
  readonly recommendationId: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
  readonly kind: "therapist" | "facility";
  readonly tags: readonly string[];
  readonly keystone: string;
  readonly license_check?: LicenseCheckRecord;
  readonly score: number;
  readonly sameMetro: boolean;
}

interface SimilarRouteDeps {
  readonly findSimilar: (
    target: SimilarTarget
  ) => Promise<readonly SimilarApiResult[]>;
}

let defaultDepsPromise: Promise<SimilarRouteDeps> | undefined;

export async function GET(request: Request): Promise<Response> {
  const deps = await defaultSimilarRouteDeps();
  const parsed = parseTarget(new URL(request.url));

  if (!parsed.ok) {
    return json({ error: "INVALID_SIMILAR_REQUEST" }, 400);
  }

  const results = await deps.findSimilar(parsed.target);
  return json({ results });
}

async function defaultSimilarRouteDeps(): Promise<SimilarRouteDeps> {
  if (!defaultDepsPromise) {
    defaultDepsPromise = createDefaultSimilarRouteDeps();
  }

  return defaultDepsPromise;
}

async function createDefaultSimilarRouteDeps(): Promise<SimilarRouteDeps> {
  const corpus = fixtureCorpusJson as RetrievalCorpus;
  const store = await createInMemoryVectorStoreFromCorpus(corpus, async (text) => {
    const embedding = embedTextDevOnly(text);
    return { vector: embedding.vector, metadata: embedding.metadata };
  });
  const lookup = createInMemorySimilarLookup(store.allRecords());

  return {
    async findSimilar(target) {
      const neighbors = await findSimilarNeighbors({
        target,
        store,
        lookup,
        limit: 3
      });

      return neighbors.map(toApiResult);
    }
  };
}

function parseTarget(
  url: URL
): { readonly ok: true; readonly target: SimilarTarget } | { readonly ok: false } {
  const recId = trimmedParam(url, "recId");
  const providerId = trimmedParam(url, "providerId");

  if (recId && providerId) {
    return { ok: false };
  }

  if (recId) {
    return { ok: true, target: { recId } };
  }

  if (providerId) {
    return { ok: true, target: { providerId } };
  }

  return { ok: false };
}

function trimmedParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value && value.length > 0 ? value : undefined;
}

function toApiResult(neighbor: SimilarNeighbor): SimilarApiResult {
  const licenseCheck = currentDatedVerifiedCheck(
    fixtureLicenseCheckForProviderId(neighbor.providerId)
  );
  const result = {
    providerId: neighbor.providerId,
    recommendationId: neighbor.recommendationId,
    name: neighbor.providerName,
    credential: neighbor.credential,
    loc: neighbor.loc,
    kind: neighbor.kind,
    tags: neighbor.tags,
    keystone: neighbor.keystone,
    score: neighbor.score,
    sameMetro: neighbor.sameMetro
  };

  if (licenseCheck) {
    return {
      ...result,
      license_check: licenseCheck
    };
  }

  return result;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
