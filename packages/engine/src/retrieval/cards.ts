import type {
  FindResultCard,
  RetrievalCorpus,
  RetrievalDocument,
  VectorSearchResult
} from "./types.js";

export function cardsFromMatches(
  matches: readonly VectorSearchResult[],
  corpus: RetrievalCorpus,
  limit: number
): readonly FindResultCard[] {
  const providerOrder = [...new Set(matches.map((match) => match.document.providerId))];
  const cards: FindResultCard[] = [];

  for (const providerId of providerOrder) {
    const firstMatch = matches.find(
      (match) => match.document.providerId === providerId
    )?.document;

    if (!firstMatch) {
      continue;
    }

    const providerRecs = corpus.recommendations.filter(
      (recommendation) => recommendation.provider_id === providerId
    );

    cards.push(cardFor(firstMatch, providerRecs));

    if (cards.length >= limit) {
      break;
    }
  }

  return cards;
}

function cardFor(
  document: RetrievalDocument,
  providerRecs: RetrievalCorpus["recommendations"]
): FindResultCard {
  const tagCounts = new Map<string, number>();

  for (const recommendation of providerRecs) {
    for (const tag of recommendation.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return {
    id: document.providerId,
    name: document.providerName,
    credential: document.credential,
    loc: document.loc,
    passed_count: providerRecs.length,
    tags: [...tagCounts.entries()]
      .map(([value, freq]) => ({ value, freq }))
      .sort((left, right) => {
        const byFrequency = right.freq - left.freq;
        return byFrequency === 0
          ? left.value.localeCompare(right.value)
          : byFrequency;
      })
      .slice(0, 6),
    keystone: document.keystone,
    verified: document.verified,
    why: null,
    cited_span_ids: []
  };
}
