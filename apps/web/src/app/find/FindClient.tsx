"use client";

import * as React from "react";
import { postFindQuery, type FindApiResponse } from "../../lib/findApi";
import {
  removeFacetFromQueryText,
  understandQuery,
  type FacetKind,
  type Facets
} from "../../lib/understandQuery";
import { FindScreen, type FindView } from "./FindScreen";

const CRISIS_EXAMPLE_TEXT = "I do not see the point anymore.";

export function FindClient() {
  const [text, setText] = React.useState("");
  const [view, setView] = React.useState<FindView>({ kind: "input" });

  async function submitSearch(queryText: string) {
    const trimmed = queryText.trim();

    if (trimmed.length === 0) {
      setText("");
      setView({ kind: "input" });
      return;
    }

    const facets = displayFacetsForQuery(trimmed);
    setText(trimmed);
    setView({ kind: "loading", queryText: trimmed, facets });

    try {
      const response = await postFindQuery(trimmed);
      setView(viewFromFindResponse(trimmed, response));
    } catch {
      setView({
        kind: "error",
        queryText: trimmed,
        facets,
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

  return (
    <FindScreen
      text={text}
      view={view}
      onTextChange={setText}
      onSubmit={() => void submitSearch(text)}
      onCrisisExample={() => void submitSearch(CRISIS_EXAMPLE_TEXT)}
      onBack={() => setView({ kind: "input" })}
      onRemoveChip={removeChip}
    />
  );
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

  return {
    kind: "results",
    queryText,
    facets: displayFacetsForQuery(queryText),
    cards: response.results
  };
}

function displayFacetsForQuery(queryText: string): Facets {
  // Display-side echo pending L1-S3: /api/find v0 returns understood:null,
  // so chips are derived locally for UI affordances only. The raw query is
  // sent only to POST /api/find, and chips never choose results client-side.
  const understood = understandQuery(queryText);

  if (understood.kind !== "understood") {
    return emptyFacets();
  }

  return understood.facets;
}

function emptyFacets(): Facets {
  return { issues: [], population: undefined, prefers: [] };
}
