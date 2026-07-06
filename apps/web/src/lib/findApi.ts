export type FindFetch = typeof fetch;

export interface FindApiTag {
  readonly value: string;
  readonly freq: number;
}

export interface FindApiCard {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
  readonly passed_count: number;
  readonly tags: readonly FindApiTag[];
  readonly keystone: string;
  readonly verified: boolean;
  readonly why: string | null;
}

export interface CrisisSupport {
  readonly lifeline: string;
  readonly message: string;
}

export type FindApiResponse =
  | {
      readonly crisis: true;
      readonly support: CrisisSupport;
    }
  | {
      readonly understood: null;
      readonly unmet: boolean;
      readonly results: readonly FindApiCard[];
    };

export async function postFindQuery(
  text: string,
  fetcher: FindFetch = fetch
): Promise<FindApiResponse> {
  const response = await fetcher("/api/find", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Find request failed with status ${response.status}`);
  }

  const body: unknown = await response.json();
  return parseFindApiResponse(body);
}

function parseFindApiResponse(value: unknown): FindApiResponse {
  if (!isRecord(value)) {
    throw new Error("Find response must be an object");
  }

  if (value.crisis === true) {
    const support = value.support;

    if (!isRecord(support)) {
      throw new Error("Find crisis response must include support");
    }

    return {
      crisis: true,
      support: {
        lifeline: stringField(support, "lifeline"),
        message: stringField(support, "message")
      }
    };
  }

  if (value.understood !== null || !Array.isArray(value.results)) {
    throw new Error("Find response must include understood:null and results");
  }

  return {
    understood: null,
    unmet: booleanField(value, "unmet"),
    results: value.results.map(parseFindCard)
  };
}

function parseFindCard(value: unknown): FindApiCard {
  if (!isRecord(value)) {
    throw new Error("Find result card must be an object");
  }

  const tags = value.tags;

  if (!Array.isArray(tags)) {
    throw new Error("Find result card tags must be an array");
  }

  const why = value.why;

  if (why !== null && typeof why !== "string") {
    throw new Error("Find result card why must be null or a string");
  }

  return {
    id: stringField(value, "id"),
    name: stringField(value, "name"),
    credential: stringField(value, "credential"),
    loc: stringField(value, "loc"),
    passed_count: numberField(value, "passed_count"),
    tags: tags.map(parseFindTag),
    keystone: stringField(value, "keystone"),
    verified: booleanField(value, "verified"),
    why
  };
}

function parseFindTag(value: unknown): FindApiTag {
  if (!isRecord(value)) {
    throw new Error("Find result tag must be an object");
  }

  return {
    value: stringField(value, "value"),
    freq: numberField(value, "freq")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected string field ${field}`);
  }

  return value;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];

  if (typeof value !== "number") {
    throw new Error(`Expected number field ${field}`);
  }

  return value;
}

function booleanField(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean field ${field}`);
  }

  return value;
}
