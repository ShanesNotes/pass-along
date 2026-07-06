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
  const candidateSpanIds = new Map(
    input.candidates.map((candidate) => [
      candidate.id,
      new Set(candidate.snippets.map((snippet) => snippet.span_id))
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
    const allowedSpanIds = candidateSpanIds.get(item.id);

    if (!allowedSpanIds) {
      unknownCandidateCount += 1;
      droppedResultCount += 1;
      continue;
    }

    const groundedWhy = item.why.filter((sentence) => {
      const hasOnlyRealSpans = sentence.cited_span_ids.every((spanId) =>
        allowedSpanIds.has(spanId)
      );

      if (!hasOnlyRealSpans) {
        droppedWhyCount += 1;
      }

      return hasOnlyRealSpans;
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
