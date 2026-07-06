import type {
  RerankCandidate,
  RerankModelOutput
} from "../../../core/src/index.js";

export interface GroundedRerankItem {
  readonly id: string;
  readonly score: number;
  readonly why: string | null;
  readonly cited_span_ids: readonly string[];
}

export interface GroundedRerankResult {
  readonly results: readonly GroundedRerankItem[];
  readonly dropped_why_count: number;
  readonly dropped_result_count: number;
  readonly unknown_candidate_count: number;
}

export type RerankWarn = (
  event: "find.rerank_grounding_dropped",
  fields: {
    readonly dropped_why_count: number;
    readonly dropped_result_count: number;
    readonly unknown_candidate_count: number;
  }
) => void;

export function validateGroundedRerankResult(input: {
  readonly candidates: readonly RerankCandidate[];
  readonly output: RerankModelOutput;
  readonly warn?: RerankWarn;
}): GroundedRerankResult {
  const candidateSpans = new Map(
    input.candidates.map((candidate) => [
      candidate.id,
      new Map(
        candidate.snippets.map((snippet) => [snippet.span_id, snippet.text])
      )
    ])
  );
  const seenCandidates = new Set<string>();
  const results: GroundedRerankItem[] = [];
  let droppedWhyCount = 0;
  let droppedResultCount = 0;
  let unknownCandidateCount = 0;

  for (const item of input.output.results) {
    if (seenCandidates.has(item.id)) {
      droppedResultCount += 1;
      continue;
    }

    seenCandidates.add(item.id);
    const allowedSpans = candidateSpans.get(item.id);

    if (!allowedSpans) {
      unknownCandidateCount += 1;
      droppedResultCount += 1;
      continue;
    }

    const groundedWhy = item.why.filter((sentence) => {
      const hasOnlyRealSpans = sentence.cited_span_ids.every((spanId) =>
        allowedSpans.has(spanId)
      );
      const hasLexicalSupport =
        hasOnlyRealSpans &&
        hasEnoughLexicalSupport(
          sentence.text,
          sentence.cited_span_ids.map((spanId) => allowedSpans.get(spanId) ?? "")
        );

      if (!hasOnlyRealSpans || !hasLexicalSupport) {
        droppedWhyCount += 1;
      }

      return hasOnlyRealSpans && hasLexicalSupport;
    });
    const citedSpanIds = unique(
      groundedWhy.flatMap((sentence) => sentence.cited_span_ids)
    );

    results.push({
      id: item.id,
      score: item.score,
      why:
        groundedWhy.length > 0
          ? groundedWhy.map((sentence) => sentence.text).join(" ")
          : null,
      cited_span_ids: citedSpanIds
    });
  }

  if (
    input.warn &&
    (droppedWhyCount > 0 ||
      droppedResultCount > 0 ||
      unknownCandidateCount > 0)
  ) {
    input.warn("find.rerank_grounding_dropped", {
      dropped_why_count: droppedWhyCount,
      dropped_result_count: droppedResultCount,
      unknown_candidate_count: unknownCandidateCount
    });
  }

  return {
    results,
    dropped_why_count: droppedWhyCount,
    dropped_result_count: droppedResultCount,
    unknown_candidate_count: unknownCandidateCount
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

// This is a lexical support guard, not full semantic entailment. It blocks the
// easy fabricated-claim class where a model cites a real span while saying
// something with no shared content; fuller entailment is future work.
function hasEnoughLexicalSupport(
  whyText: string,
  citedSpanTexts: readonly string[]
): boolean {
  const whyWords = contentWords(whyText);
  const spanWords = new Set(citedSpanTexts.flatMap(contentWords));
  let overlap = 0;

  for (const word of whyWords) {
    if (spanWords.has(word)) {
      overlap += 1;
    }

    if (overlap >= 2) {
      return true;
    }
  }

  return false;
}

function contentWords(text: string): readonly string[] {
  return unique(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word))
  );
}

const STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "because",
  "been",
  "before",
  "being",
  "from",
  "have",
  "into",
  "only",
  "that",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "were",
  "when",
  "with",
  "would"
]);
