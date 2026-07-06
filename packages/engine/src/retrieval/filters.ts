import type { RetrievalDocument, RetrievalFilters } from "./types.js";

export function matchesFilters(
  document: RetrievalDocument,
  filters: RetrievalFilters | undefined
): boolean {
  if (!filters) {
    return true;
  }

  if (
    filters.kind !== undefined &&
    filters.kind !== "either" &&
    document.kind !== filters.kind
  ) {
    return false;
  }

  if (
    filters.location !== undefined &&
    !normalize(document.loc).includes(normalize(filters.location))
  ) {
    return false;
  }

  if (filters.tags !== undefined && filters.tags.length > 0) {
    const documentTags = new Set(document.tags.map(normalize));
    const requestedTags = filters.tags.map(normalize);

    if (!requestedTags.every((tag) => documentTags.has(tag))) {
      return false;
    }
  }

  return true;
}

export function inferTagFiltersFromText(
  text: string,
  corpusTags: readonly string[]
): readonly string[] {
  const normalizedText = ` ${normalize(text)} `;
  const matches = corpusTags
    .filter((tag) => normalizedText.includes(` ${normalize(tag)} `))
    .sort((left, right) => right.length - left.length);

  return [...new Set(matches)];
}

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
