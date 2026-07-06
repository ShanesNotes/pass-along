import type { Provider, Recommendation } from "../fixtures/types";

export interface TagFrequency {
  tag: string;
  count: number;
}

export interface ProviderStats {
  passedCount: number;
  tagFrequencies: TagFrequency[];
  quotes: string[];
}

function recTags(rec: Recommendation): string[] {
  return [...rec.issues, rec.population, ...rec.modality];
}

export function recommendationsForProvider(
  providerId: string,
  recommendations: Recommendation[]
): Recommendation[] {
  return recommendations.filter((rec) => rec.providerId === providerId);
}

export function providerStats(providerId: string, recommendations: Recommendation[]): ProviderStats {
  const recs = recommendationsForProvider(providerId, recommendations);
  const counts = new Map<string, number>();
  for (const rec of recs) {
    for (const tag of recTags(rec)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tagFrequencies = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return {
    passedCount: recs.length,
    tagFrequencies,
    quotes: recs.map((rec) => rec.quote)
  };
}

export function similarProviders(
  providerId: string,
  providers: Provider[],
  recommendations: Recommendation[],
  limit = 3
): Provider[] {
  const target = providers.find((provider) => provider.id === providerId);
  if (!target) return [];

  const targetTags = new Set(
    recommendationsForProvider(providerId, recommendations).flatMap(recTags)
  );

  const scored = providers
    .filter((provider) => provider.id !== providerId)
    .map((provider) => {
      const tags = new Set(recommendationsForProvider(provider.id, recommendations).flatMap(recTags));
      const overlap = [...tags].filter((tag) => targetTags.has(tag)).length;
      const sameMetro = provider.metro === target.metro ? 1 : 0;
      return { provider, score: overlap * 2 + sameMetro };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.provider);
}
