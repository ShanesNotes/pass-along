import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import fixtureCorpusJson from "../../../../../../evals/fixtures/corpus/recommendations.json";
import {
  cardsFromMatches,
  corpusTags,
  createInMemoryVectorStoreFromCorpus,
  findMatches,
  type FindResultCard,
  type ProviderKind,
  type RetrievalCorpus,
  type RetrievalFilters,
  type VectorSearchResult,
  type VectorStorePort
} from "../../../../../../packages/engine/src/retrieval/index";
import { embedTextDevOnly } from "../../../../../../packages/engine/src/llm/embed";
import {
  SafetyGateUnavailableError,
  safetyGate as defaultSafetyGate,
  type SafetyGateResult
} from "../../../../../../packages/engine/src/safety/index";
import {
  currentDatedVerifiedCheck,
  fixtureLicenseCheckForProviderId,
  type LicenseCheckRecord
} from "../../../../../../packages/engine/src/verification/index";
import {
  clarifyQuestionFor,
  understandQuery as defaultUnderstandQuery,
  type UnderstandQueryResult
} from "../../../../../../packages/engine/src/understand/index";
import {
  rerankMatches,
  type RerankEngineWarn,
  type RerankOutcome
} from "../../../../../../packages/engine/src/rerank/index";
import type { EmbeddingMetadata } from "../../../../../../packages/engine/src/retrieval/index";
import type {
  EventCatalog,
  RerankSource,
  UnderstoodQuery
} from "../../../../../../packages/core/src/index";

export type FindPerformedEvent = Extract<
  EventCatalog,
  { type: "find.performed" }
>;

export interface FindEventsPort {
  emit(event: FindPerformedEvent): Promise<void>;
}

export interface QueryAuditRow {
  readonly query_hash: string;
  readonly understood: UnderstoodQuery;
}

export interface QueryAuditPort {
  upsert(row: QueryAuditRow): Promise<void>;
}

export interface FindRerankInput {
  readonly understood: UnderstoodQuery;
  readonly matches: readonly VectorSearchResult[];
  readonly corpus: RetrievalCorpus;
}

export interface FindRouteDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly corpus: RetrievalCorpus;
  readonly store: VectorStorePort;
  readonly events: FindEventsPort;
  readonly queries?: QueryAuditPort;
  readonly safetyGate?: (text: string) => Promise<SafetyGateResult>;
  readonly understand?: (text: string) => Promise<UnderstandQueryResult>;
  readonly rerank?: (input: FindRerankInput) => Promise<RerankOutcome>;
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

type FindApiCard = Omit<FindResultCard, "verified"> & {
  readonly license_check?: LicenseCheckRecord;
};

const DEFAULT_RETRIEVAL_TOP_N = 40;
const DEFAULT_CARD_LIMIT = 6;
const CRISIS_FIND_RESPONSE = {
  crisis: true,
  support: {
    lifeline: "988",
    message: "Nothing was stored."
  }
} as const;

let defaultDepsPromise: Promise<FindRouteDeps> | undefined;

export function createFindPostHandler(deps: FindRouteDeps) {
  return async (request: Request): Promise<Response> => {
    const env = deps.env ?? process.env;

    const parsed = parseFindRequestBody(await readJson(request));

    if (!parsed.ok) {
      return json({ error: "INVALID_FIND_REQUEST" }, 400);
    }

    const startedAt = deps.now?.() ?? performance.now();
    const body = parsed.body;
    const gate = await routeSafetyGate(
      deps.safetyGate ?? defaultRouteSafetyGate(env),
      body.text
    );

    if (gate instanceof Response) {
      return gate;
    }

    if (gate.crisis) {
      return json(CRISIS_FIND_RESPONSE);
    }

    warnIfSafetyGateDegraded(gate);

    const queryHash = sha256(body.text);
    const [understanding, embedding] = await Promise.all([
      (deps.understand ?? defaultRouteUnderstand(env))(body.text),
      deps.embed(body.text)
    ]);
    const understoodJson = understoodWithRequestOverrides(
      understanding.understood,
      body
    );

    if (understoodJson.confidence < 0.55) {
      const latencyMs = Math.max(
        0,
        Math.round((deps.now?.() ?? performance.now()) - startedAt)
      );

      await recordFindAttempt({
        deps,
        queryHash,
        understood: understoodJson,
        resultCount: 0,
        latencyMs,
        degraded: gate.degraded,
        understoodSource: understanding.source
      });

      return json({
        understood: understoodJson,
        source: understanding.source,
        clarify: clarifyQuestionFor(body.text, understoodJson)
      });
    }

    const filters = filtersFor(body, deps.corpus, understoodJson);
    const { matches, unmet } = await findMatches({
      store: deps.store,
      vector: embedding.vector,
      filters,
      topN: DEFAULT_RETRIEVAL_TOP_N
    });
    const reranked = await (deps.rerank ?? defaultRouteRerank(env))({
      understood: understoodJson,
      matches,
      corpus: deps.corpus
    });
    const cards = cardsFromMatches(
      orderMatchesByRerank(matches, reranked.results),
      deps.corpus,
      DEFAULT_CARD_LIMIT
    )
      .map((card) => applyRerankToCard(card, reranked))
      .map(toFindApiCard);
    const latencyMs = Math.max(
      0,
      Math.round((deps.now?.() ?? performance.now()) - startedAt)
    );

    await recordFindAttempt({
      deps,
      queryHash,
      understood: understoodJson,
      resultCount: cards.length,
      latencyMs,
      degraded: gate.degraded,
      understoodSource: understanding.source,
      rerankSource: reranked.source
    });

    return json({
      understood: understoodJson,
      source: understanding.source,
      rerank_source: reranked.source,
      unmet,
      results: cards
    } satisfies {
      understood: UnderstoodQuery;
      source: UnderstandQueryResult["source"];
      rerank_source: RerankSource;
      unmet: boolean;
      results: readonly FindApiCard[];
    });
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function defaultFindRouteDeps(): Promise<FindRouteDeps> {
  if (!defaultDepsPromise) {
    defaultDepsPromise = createDefaultFindRouteDeps();
  }

  return defaultDepsPromise;
}

async function createDefaultFindRouteDeps(): Promise<FindRouteDeps> {
  const corpus = fixtureCorpusJson as RetrievalCorpus;
  const embed = async (text: string) => {
    const embedding = embedTextDevOnly(text);
    return { vector: embedding.vector, metadata: embedding.metadata };
  };
  const store = await createInMemoryVectorStoreFromCorpus(corpus, embed);

  return {
    corpus,
    store,
    embed,
    safetyGate: (text) => defaultSafetyGate(text, { env: process.env }),
    understand: (text) => defaultUnderstandQuery(text, { env: process.env }),
    events: {
      async emit() {
        return undefined;
      }
    }
  };
}

function defaultRouteSafetyGate(env: NodeJS.ProcessEnv) {
  return (text: string) => defaultSafetyGate(text, { env });
}

async function routeSafetyGate(
  gate: (text: string) => Promise<SafetyGateResult>,
  text: string
): Promise<SafetyGateResult | Response> {
  try {
    return await gate(text);
  } catch (error) {
    if (error instanceof SafetyGateUnavailableError) {
      return json({ error: "SAFETY_GATE_UNAVAILABLE" }, 503);
    }

    throw error;
  }
}

function defaultRouteUnderstand(env: NodeJS.ProcessEnv) {
  return (text: string) => defaultUnderstandQuery(text, { env });
}

function defaultRouteRerank(env: NodeJS.ProcessEnv) {
  return (input: FindRerankInput) =>
    rerankMatches({
      understood: input.understood,
      matches: input.matches,
      corpus: input.corpus,
      options: { env },
      warn: warnRerank
    });
}

function warnIfSafetyGateDegraded(gate: SafetyGateResult): void {
  if (!gate.degraded) {
    return;
  }

  console.warn("find.safety_gate_degraded", {
    reason: gate.tier2.reason
  });
}

const warnRerank: RerankEngineWarn = (event, fields) => {
  console.warn(event, fields);
};

function orderMatchesByRerank(
  matches: readonly VectorSearchResult[],
  results: RerankOutcome["results"]
): readonly VectorSearchResult[] {
  const providerOrder = new Map(
    results.map((result, index) => [result.id, index])
  );

  return [...matches].sort((left, right) => {
    const leftRank =
      providerOrder.get(left.document.providerId) ?? Number.POSITIVE_INFINITY;
    const rightRank =
      providerOrder.get(right.document.providerId) ?? Number.POSITIVE_INFINITY;

    if (leftRank === rightRank) {
      return 0;
    }

    return leftRank < rightRank ? -1 : 1;
  });
}

function applyRerankToCard(
  card: FindResultCard,
  reranked: RerankOutcome
): FindResultCard {
  const rerankResult = reranked.results.find((result) => result.id === card.id);

  if (!rerankResult) {
    return card;
  }

  return {
    ...card,
    why: rerankResult.why,
    cited_span_ids: rerankResult.cited_span_ids
  };
}

function toFindApiCard(card: FindResultCard): FindApiCard {
  const licenseCheck = currentDatedVerifiedCheck(
    fixtureLicenseCheckForProviderId(card.id)
  );
  const result = {
    id: card.id,
    name: card.name,
    credential: card.credential,
    loc: card.loc,
    passed_count: card.passed_count,
    tags: card.tags,
    keystone: card.keystone,
    why: card.why,
    cited_span_ids: card.cited_span_ids
  };

  if (licenseCheck) {
    return {
      ...result,
      license_check: licenseCheck
    };
  }

  return result;
}

function filtersFor(
  body: FindRequestBody,
  corpus: RetrievalCorpus,
  understood: UnderstoodQuery
): RetrievalFilters {
  const tags = tagsForUnderstood(understood, corpusTags(corpus));
  const filters: {
    kind?: ProviderKind | "either";
    location?: string;
    tags?: readonly string[];
  } = {};

  if (body.kind !== undefined) {
    filters.kind = body.kind;
  } else if (understood.kind !== "either") {
    filters.kind = understood.kind;
  }

  if (body.location !== undefined) {
    filters.location = body.location;
  } else if (understood.location !== undefined) {
    filters.location = understood.location.text;
  }

  if (tags.length > 0) {
    filters.tags = tags;
  }

  return filters;
}

function understoodWithRequestOverrides(
  understood: UnderstoodQuery,
  body: FindRequestBody
): UnderstoodQuery {
  const result: UnderstoodQuery = {
    ...understood,
    preferences: {
      ...understood.preferences
    },
    kind: body.kind ?? understood.kind
  };

  if (body.location !== undefined && body.location.trim().length > 0) {
    result.location = {
      text: body.location.trim()
    };
  }

  return result;
}

function tagsForUnderstood(
  understood: UnderstoodQuery,
  availableTags: readonly string[]
): readonly string[] {
  const available = new Set(availableTags.map(normalizeTag));
  const candidates = [
    ...understood.issues.flatMap((issue) => corpusTagCandidates(issue.value)),
    ...(understood.population
      ? corpusTagCandidates(understood.population)
      : []),
    ...(understood.preferences.modality ?? []).flatMap((modality) =>
      corpusTagCandidates(modality.value)
    ),
    ...(understood.preferences.logistics ?? []).flatMap(corpusTagCandidates),
    ...(understood.preferences.style ?? []).flatMap(corpusTagCandidates)
  ];
  const tags = candidates.filter((candidate) =>
    available.has(normalizeTag(candidate))
  );

  return [...new Set(tags)];
}

function corpusTagCandidates(value: string): readonly string[] {
  const explicit: Record<string, readonly string[]> = {
    trauma_ptsd: ["trauma", "ptsd"],
    eating_disorders: ["eating disorder"],
    substance_use: ["substance use"],
    chronic_illness: ["chronic illness"],
    relationship_issues: ["relationship"],
    stress_burnout: ["stress", "burnout"],
    gender_identity: ["gender identity"],
    family_conflict: ["family"],
    life_transitions: ["life transitions"],
    chronic_pain: ["chronic pain"],
    social_anxiety: ["social anxiety"],
    lgbtq_plus: ["lgbtq"],
    new_parent: ["new parent"],
    older_adult: ["adult"],
    college_student: ["college student"],
    first_responder: ["first responder"],
    sliding_scale: ["sliding scale"],
    exposure_erp: ["exposure erp"],
    family_systems: ["family systems"],
    mindfulness_based: ["mindfulness"],
    medication_management: ["medication management"],
    ketamine_assisted: ["ketamine"],
    motivational_interviewing: ["motivational interviewing"]
  };

  return explicit[value] ?? [value.replaceAll("_", " ")];
}

function normalizeTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+]+/gu, " ").trim();
}

async function recordFindAttempt(input: {
  readonly deps: FindRouteDeps;
  readonly queryHash: string;
  readonly understood: UnderstoodQuery;
  readonly resultCount: number;
  readonly latencyMs: number;
  readonly degraded: boolean;
  readonly understoodSource: UnderstandQueryResult["source"];
  readonly rerankSource?: RerankSource;
}): Promise<void> {
  await input.deps.queries?.upsert({
    query_hash: input.queryHash,
    understood: input.understood
  });
  await input.deps.events.emit({
    type: "find.performed",
    payload: {
      understood_json: input.understood,
      query_hash_sha256: input.queryHash,
      result_count: input.resultCount,
      latency_ms: input.latencyMs,
      understood_source: input.understoodSource,
      ...(input.rerankSource ? { rerank_source: input.rerankSource } : {}),
      ...(input.degraded ? { degraded: true } : {})
    }
  });
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
