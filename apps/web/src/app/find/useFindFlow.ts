"use client";

import * as React from "react";
import { postFindQuery, type FindApiResponse } from "../../lib/findApi";
import {
  emptyFacets,
  facetsFromUnderstood,
  removeFacetFromQueryText,
  type FacetKind
} from "../../lib/understandQuery";
import type { FindView } from "./FindBox";

const CRISIS_EXAMPLE_TEXT = "I do not see the point anymore.";

export interface FindFlow {
  readonly text: string;
  readonly view: FindView;
  readonly onTextChange: (text: string) => void;
  readonly onSubmit: () => void;
  readonly onCrisisExample: () => void;
  readonly onBack: () => void;
  readonly onRemoveChip: (kind: FacetKind, value: string) => void;
  readonly onClarifyChip: (value: string) => void;
}

/** Owns the live find pipeline's state (POST /api/find, crisis/clarify/results
 * routing). Shared by every surface that embeds the find box, so submitting
 * behaves identically everywhere it appears. */
export function useFindFlow(): FindFlow {
  const [text, setText] = React.useState("");
  const [view, setView] = React.useState<FindView>({ kind: "input" });

  async function submitSearch(queryText: string) {
    const trimmed = queryText.trim();

    if (trimmed.length === 0) {
      setText("");
      setView({ kind: "input" });
      return;
    }

    setText(trimmed);
    setView({ kind: "loading", queryText: trimmed, facets: emptyFacets() });

    try {
      const response = await postFindQuery(trimmed);
      setView(viewFromFindResponse(trimmed, response));
    } catch {
      setView({
        kind: "error",
        queryText: trimmed,
        facets: emptyFacets(),
        message: "Search is unavailable right now. Nothing was stored."
      });
    }
  }

  function removeChip(kind: FacetKind, value: string) {
    if (view.kind !== "results") {
      return;
    }

    const amendedText = removeFacetFromQueryText(view.queryText, kind, value);

    if (amendedText.length === 0) {
      setText("");
      setView({ kind: "input" });
      return;
    }

    void submitSearch(amendedText);
  }

  function answerClarifyChip(value: string) {
    if (view.kind !== "clarify") {
      return;
    }

    const enrichedText = enrichTextWithClarifyChip(view.queryText, value);
    setText(enrichedText);
    void submitSearch(enrichedText);
  }

  return {
    text,
    view,
    onTextChange: setText,
    onSubmit: () => void submitSearch(text),
    onCrisisExample: () => void submitSearch(CRISIS_EXAMPLE_TEXT),
    onBack: () => setView({ kind: "input" }),
    onRemoveChip: removeChip,
    onClarifyChip: answerClarifyChip
  };
}

function viewFromFindResponse(
  queryText: string,
  response: FindApiResponse
): FindView {
  if ("crisis" in response) {
    return {
      kind: "crisis",
      queryText,
      support: response.support
    };
  }

  if ("clarify" in response) {
    return {
      kind: "clarify",
      queryText,
      facets: facetsFromUnderstood(response.understood),
      question: response.clarify.question,
      chips: response.clarify.chips
    };
  }

  return {
    kind: "results",
    queryText,
    facets: facetsFromUnderstood(response.understood),
    cards: response.results
  };
}

function enrichTextWithClarifyChip(queryText: string, value: string): string {
  const readable = value.replaceAll("_", " ");

  if (queryText.toLowerCase().includes(readable.toLowerCase())) {
    return queryText;
  }

  return `${queryText} ${readable}`.trim();
}
