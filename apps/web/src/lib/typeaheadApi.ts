export type TypeaheadFetch = typeof fetch;

export interface TypeaheadApiMatch {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
}

export async function postTypeaheadQuery(
  q: string,
  fetcher: TypeaheadFetch = fetch
): Promise<readonly TypeaheadApiMatch[]> {
  const response = await fetcher("/api/typeahead", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ q })
  });

  if (!response.ok) {
    return [];
  }

  return parseTypeaheadResponse(await response.json());
}

function parseTypeaheadResponse(value: unknown): readonly TypeaheadApiMatch[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return [];
  }

  return value.results.map(parseTypeaheadMatch).filter(isTypeaheadMatch);
}

function parseTypeaheadMatch(value: unknown): TypeaheadApiMatch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = value.id;
  const name = value.name;
  const credential = value.credential;
  const loc = value.loc;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof credential !== "string" ||
    typeof loc !== "string"
  ) {
    return undefined;
  }

  return { id, name, credential, loc };
}

function isTypeaheadMatch(
  value: TypeaheadApiMatch | undefined
): value is TypeaheadApiMatch {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
