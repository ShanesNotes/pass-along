import { normalize } from "./filters.js";
import type { CorpusProvider } from "./types.js";

export interface ProviderNameSearchInput {
  readonly query: string;
  readonly limit?: number;
}

export interface ProviderNameMatch {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly kind: CorpusProvider["kind"];
  readonly loc: string;
  readonly verified: boolean;
  readonly score: number;
}

export interface ProviderNameSearchPort {
  searchProvidersByName(
    input: ProviderNameSearchInput
  ): Promise<readonly ProviderNameMatch[]>;
}

export class InMemoryProviderNameSearch implements ProviderNameSearchPort {
  constructor(private readonly providers: readonly CorpusProvider[]) {}

  async searchProvidersByName(
    input: ProviderNameSearchInput
  ): Promise<readonly ProviderNameMatch[]> {
    return scoreProviderNameMatches(this.providers, input.query, input.limit);
  }
}

const DEFAULT_LIMIT = 5;
const MIN_FUZZY_SCORE = 0.28;

export function scoreProviderNameMatches(
  providers: readonly CorpusProvider[],
  query: string,
  limit = DEFAULT_LIMIT
): readonly ProviderNameMatch[] {
  const normalizedQuery = normalize(query);
  const boundedLimit = Math.max(0, limit);

  if (normalizedQuery.length === 0 || boundedLimit === 0) {
    return [];
  }

  return providers
    .map((provider) => scoreProvider(provider, normalizedQuery))
    .filter((match): match is ProviderNameMatch => match !== undefined)
    .sort((left, right) => {
      const byScore = right.score - left.score;

      if (byScore !== 0) {
        return byScore;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, boundedLimit);
}

function scoreProvider(
  provider: CorpusProvider,
  normalizedQuery: string
): ProviderNameMatch | undefined {
  const normalizedName = normalize(provider.name);
  const prefixScore = scorePrefix(normalizedName, normalizedQuery);
  const initialsScore = scoreInitials(normalizedName, normalizedQuery);
  const fuzzyScore = trigramSimilarity(normalizedQuery, normalizedName);
  const score = Math.max(prefixScore, initialsScore, fuzzyScore);

  if (!passesThreshold(normalizedQuery, prefixScore, initialsScore, score)) {
    return undefined;
  }

  return {
    id: provider.id,
    name: provider.name,
    credential: provider.credential,
    kind: provider.kind,
    loc: provider.loc,
    verified: provider.verified,
    score
  };
}

function scorePrefix(normalizedName: string, normalizedQuery: string): number {
  if (normalizedName === normalizedQuery) {
    return 1;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 0.96;
  }

  if (
    normalizedName
      .split(" ")
      .some((word) => word.startsWith(normalizedQuery))
  ) {
    return 0.9;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return 0.76;
  }

  return 0;
}

function scoreInitials(normalizedName: string, normalizedQuery: string): number {
  const initials = normalizedName
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("");

  return initials.startsWith(normalizedQuery) ? 0.86 : 0;
}

function passesThreshold(
  normalizedQuery: string,
  prefixScore: number,
  initialsScore: number,
  score: number
): boolean {
  if (normalizedQuery.length <= 2) {
    return prefixScore > 0 || initialsScore > 0;
  }

  return score >= MIN_FUZZY_SCORE;
}

function trigramSimilarity(left: string, right: string): number {
  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);

  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const trigram of leftTrigrams) {
    if (rightTrigrams.has(trigram)) {
      shared += 1;
    }
  }

  return (2 * shared) / (leftTrigrams.size + rightTrigrams.size);
}

function trigrams(value: string): ReadonlySet<string> {
  const padded = `  ${value} `;
  const values = new Set<string>();

  for (let index = 0; index <= padded.length - 3; index += 1) {
    values.add(padded.slice(index, index + 3));
  }

  return values;
}
