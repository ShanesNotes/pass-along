import type {
  CorpusProvider,
  CorpusRecommendation,
  RetrievalCorpus,
  RetrievalDocument,
  VectorRecord,
  VectorStorePort,
  VectorWritePort
} from "../../../../../../packages/engine/src/retrieval/index";
import {
  embedRecommendation,
  type EmbedRecommendationResult
} from "../../../../../../packages/engine/src/jobs/embed-recommendation";
import {
  defaultFindRouteDeps,
  type FindRouteDeps
} from "../find/deps";
import {
  defaultPassRouteDeps,
  type AdminDecisionAction,
  type AdminDecisionResult,
  type AdminReviewQueueItem,
  type PassDemoStore
} from "../pass/deps";

export type AdminQueueResponse = {
  readonly queue: readonly AdminReviewQueueItem[];
};

export type AdminDecisionResponse = AdminDecisionResult & {
  readonly embedding?: EmbedRecommendationResult;
};

export interface AdminRouteDeps {
  readonly store: PassDemoStore;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly reviewer?: string;
  readonly embedApprovedRecommendation?: (
    recommendationId: string
  ) => Promise<EmbedRecommendationResult | undefined>;
}

type AdminDecisionBody = {
  readonly id: string;
  readonly action: AdminDecisionAction;
  readonly editedScrub?: string;
  readonly reason?: string;
};

export function defaultAdminRouteDeps(): AdminRouteDeps {
  const passDeps = defaultPassRouteDeps();

  return {
    store: passDeps.store,
    env: process.env,
    embedApprovedRecommendation: (recommendationId) =>
      embedApprovedRecommendationInFindStore({
        passStore: passDeps.store,
        getFindDeps: defaultFindRouteDeps,
        recommendationId
      })
  };
}

export function createAdminQueueGetHandler(deps: AdminRouteDeps) {
  return async (request: Request): Promise<Response> => {
    const auth = authorizeAdmin(request, deps.env);

    if (!auth.ok) {
      return auth.response;
    }

    return json({
      queue: await deps.store.listAdminReviewQueue()
    } satisfies AdminQueueResponse);
  };
}

export function createAdminDecidePostHandler(deps: AdminRouteDeps) {
  return async (request: Request): Promise<Response> => {
    const auth = authorizeAdmin(request, deps.env);

    if (!auth.ok) {
      return auth.response;
    }

    const parsed = parseAdminDecisionBody(await readJson(request));

    if (!parsed.ok) {
      return json({ error: "INVALID_ADMIN_DECISION" }, 400);
    }

    const currentState = await deps.store.getRecommendationState(parsed.body.id);

    if (currentState === undefined) {
      return json({ error: "RECOMMENDATION_NOT_FOUND" }, 404);
    }

    if (currentState !== "review_pending") {
      return json({ error: "RECOMMENDATION_NOT_REVIEW_PENDING" }, 409);
    }

    const decision = await deps.store.decideAdminReview({
      recommendationId: parsed.body.id,
      action: parsed.body.action,
      ...(parsed.body.editedScrub
        ? { editedScrub: parsed.body.editedScrub }
        : {}),
      ...(parsed.body.reason ? { reason: parsed.body.reason } : {}),
      reviewer: deps.reviewer ?? "demo-admin",
      now: deps.now?.() ?? new Date()
    });
    const embedding =
      decision.status === "published"
        ? await deps.embedApprovedRecommendation?.(parsed.body.id)
        : undefined;

    return json({
      ...decision,
      ...(embedding ? { embedding } : {})
    } satisfies AdminDecisionResponse);
  };
}

export async function embedApprovedRecommendationInFindStore(input: {
  readonly passStore: PassDemoStore;
  readonly getFindDeps: () => Promise<FindRouteDeps>;
  readonly recommendationId: string;
}): Promise<EmbedRecommendationResult | undefined> {
  const document = await input.passStore.getRecommendationEmbeddingSource(
    input.recommendationId
  );

  if (!document) {
    return undefined;
  }

  const findDeps = await input.getFindDeps();
  const vectorStore = findDeps.store;

  if (!hasVectorWritePort(vectorStore)) {
    return {
      recommendationId: input.recommendationId,
      embedded: false,
      skippedReason: "storage_unavailable"
    };
  }

  addDocumentToFindCorpus(findDeps.corpus, document);

  return embedRecommendation({
    recommendationId: input.recommendationId,
    storage: {
      async getRecommendationEmbeddingSource() {
        return document;
      },
      async upsertRecommendationEmbedding(record: VectorRecord) {
        await vectorStore.upsert(record);
      }
    },
    embed: findDeps.embed
  });
}

function authorizeAdmin(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
):
  | { readonly ok: true }
  | { readonly ok: false; readonly response: Response } {
  const expectedToken = env.ADMIN_DEMO_TOKEN?.trim();

  if (!expectedToken) {
    return {
      ok: false,
      response: json({ error: "ADMIN_DISABLED" }, 503)
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const suppliedToken = /^Bearer\s+(.+)$/iu.exec(authorization)?.[1]?.trim();

  if (suppliedToken !== expectedToken) {
    return {
      ok: false,
      response: json({ error: "ADMIN_UNAUTHORIZED" }, 401)
    };
  }

  return { ok: true };
}

function addDocumentToFindCorpus(
  corpus: RetrievalCorpus,
  document: RetrievalDocument
): void {
  const mutableCorpus = corpus as {
    providers: CorpusProvider[];
    recommendations: CorpusRecommendation[];
  };

  if (
    !mutableCorpus.providers.some((provider) => provider.id === document.providerId)
  ) {
    mutableCorpus.providers.push({
      id: document.providerId,
      name: document.providerName,
      credential: document.credential,
      kind: document.kind,
      loc: document.loc,
      verified: document.verified
    });
  }

  if (
    !mutableCorpus.recommendations.some(
      (recommendation) => recommendation.id === document.recommendationId
    )
  ) {
    mutableCorpus.recommendations.push({
      id: document.recommendationId,
      provider_id: document.providerId,
      kind: document.kind,
      tags: document.tags,
      keystone: document.keystone,
      story: document.text
    });
  }
}

function hasVectorWritePort(
  store: VectorStorePort
): store is VectorStorePort & VectorWritePort {
  return typeof (store as { readonly upsert?: unknown }).upsert === "function";
}

function parseAdminDecisionBody(
  value: unknown
): { readonly ok: true; readonly body: AdminDecisionBody } | { readonly ok: false } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;
  const id = record.id;
  const action = record.action;
  const editedScrub = record.editedScrub;
  const reason = record.reason;

  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    !isAdminDecisionAction(action)
  ) {
    return { ok: false };
  }

  if (
    action === "edit_scrub" &&
    (typeof editedScrub !== "string" || editedScrub.trim().length === 0)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    body: {
      id: id.trim(),
      action,
      ...(typeof editedScrub === "string" && editedScrub.trim().length > 0
        ? { editedScrub: editedScrub.trim() }
        : {}),
      ...(typeof reason === "string" && reason.trim().length > 0
        ? { reason: reason.trim() }
        : {})
    }
  };
}

function isAdminDecisionAction(value: unknown): value is AdminDecisionAction {
  return value === "approve" || value === "reject" || value === "edit_scrub";
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
