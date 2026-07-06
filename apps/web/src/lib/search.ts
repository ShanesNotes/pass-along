import type { Provider, Recommendation } from "../fixtures/types";
import type { Facets } from "./understandQuery";
import { providerStats } from "./aggregate";

export interface FindResultCard {
  provider: Provider;
  matchingRecs: Recommendation[];
  passedCount: number;
  likeYouLine: string;
  tagFrequencies: { tag: string; count: number }[];
  keystoneQuote: string;
}

const SPARSE_THRESHOLD = 2;

function scoreRecommendation(rec: Recommendation, facets: Facets): number {
  let score = 0;
  for (const issue of facets.issues) {
    if (rec.issues.includes(issue)) score += 2;
  }
  if (facets.population && rec.population === facets.population) score += 1;
  return score;
}

export interface FindResults {
  sparse: boolean;
  cards: FindResultCard[];
}

export function findMatches(
  facets: Facets,
  providers: Provider[],
  recommendations: Recommendation[]
): FindResults {
  const scored = recommendations
    .map((rec) => ({ rec, score: scoreRecommendation(rec, facets) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const matchedProviderIds = [...new Set(scored.map((entry) => entry.rec.providerId))];
  const sparse = matchedProviderIds.length < SPARSE_THRESHOLD;

  const providerIdsToShow = sparse
    ? [...new Set(recommendations.map((rec) => rec.providerId))].slice(0, 3)
    : matchedProviderIds;

  const cards: FindResultCard[] = providerIdsToShow
    .map((providerId) => {
      const provider = providers.find((entry) => entry.id === providerId);
      if (!provider) return undefined;
      const matchingRecs = scored
        .filter((entry) => entry.rec.providerId === providerId)
        .map((entry) => entry.rec);
      const stats = providerStats(providerId, recommendations);
      const likeYouCount = matchingRecs.length;
      const contextLine = matchingRecs[0]?.recommenderContext ?? stats.quotes[0] ?? "";
      return {
        provider,
        matchingRecs,
        passedCount: stats.passedCount,
        likeYouLine:
          likeYouCount > 0
            ? `${likeYouCount} ${contextLine}`
            : "closest match on record — not an exact fit",
        tagFrequencies: stats.tagFrequencies.slice(0, 5),
        keystoneQuote: matchingRecs[0]?.quote ?? stats.quotes[0] ?? ""
      };
    })
    .filter((card): card is FindResultCard => card !== undefined);

  return { sparse, cards };
}
