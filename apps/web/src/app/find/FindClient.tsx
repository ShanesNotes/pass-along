"use client";

import { useState } from "react";
import Link from "next/link";
import { providers } from "../../fixtures/providers";
import { recommendations } from "../../fixtures/recommendations";
import { understandQuery, type Facets } from "../../lib/understandQuery";
import { findMatches, type FindResultCard } from "../../lib/search";
import { similarProviders } from "../../lib/aggregate";
import { Stub } from "../../components/Stub";

type View =
  | { kind: "input" }
  | { kind: "clarify" }
  | { kind: "crisis" }
  | { kind: "results"; facets: Facets };

const CLARIFYING_OPTIONS = ["anxiety", "depression", "a relationship", "something else"];

function emptyFacets(): Facets {
  return { issues: [], population: undefined, prefers: [] };
}

export function FindClient() {
  const [text, setText] = useState("");
  const [view, setView] = useState<View>({ kind: "input" });

  function handleSubmit() {
    const understood = understandQuery(text);
    if (understood.kind === "crisis") {
      setView({ kind: "crisis" });
    } else if (understood.kind === "low-confidence") {
      setView({ kind: "clarify" });
    } else {
      setView({ kind: "results", facets: understood.facets });
    }
  }

  function pickClarifyOption(option: string) {
    if (option === "something else") {
      setView({ kind: "results", facets: emptyFacets() });
      return;
    }
    const issue = option === "a relationship" ? "relationship" : option;
    setView({ kind: "results", facets: { issues: [issue], population: undefined, prefers: [] } });
  }

  function removeChip(kind: "issue" | "population" | "prefer", value: string) {
    if (view.kind !== "results") return;
    const facets = { ...view.facets };
    if (kind === "issue") facets.issues = facets.issues.filter((issue) => issue !== value);
    if (kind === "population") facets.population = undefined;
    if (kind === "prefer") facets.prefers = facets.prefers.filter((pref) => pref !== value);
    setView({ kind: "results", facets });
  }

  if (view.kind === "crisis") {
    return <CrisisCard onBack={() => setView({ kind: "input" })} />;
  }

  return (
    <main>
      <h1>Find (Direction A)</h1>
      <p style={{ color: "#555" }}>Tell us what&rsquo;s going on, in your own words.</p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        style={{ width: "100%", fontSize: "1rem", padding: "10px", boxSizing: "border-box" }}
        placeholder="e.g. Looking for someone for my teenager's anxiety, ideally evenings"
      />

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", alignItems: "center" }}>
        <button onClick={handleSubmit}>Search recommendations</button>
        <Stub>🎤 voice input</Stub>
        <Stub>list / map toggle</Stub>
        <Stub>therapist / facility toggle</Stub>
      </div>

      <p style={{ marginTop: "1rem" }}>
        <button
          onClick={() => setView({ kind: "crisis" })}
          style={{ background: "none", border: "none", color: "#666", textDecoration: "underline", cursor: "pointer", padding: 0 }}
        >
          See crisis state example
        </button>
      </p>

      {view.kind === "clarify" && (
        <div style={{ marginTop: "1.5rem" }}>
          <p>We want to point you the right way — what&rsquo;s the main thing on your mind?</p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {CLARIFYING_OPTIONS.map((option) => (
              <button key={option} onClick={() => pickClarifyOption(option)}>
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {view.kind === "results" && <Results facets={view.facets} onRemoveChip={removeChip} />}
    </main>
  );
}

function Results({
  facets,
  onRemoveChip
}: {
  facets: Facets;
  onRemoveChip: (kind: "issue" | "population" | "prefer", value: string) => void;
}) {
  const results = findMatches(facets, providers, recommendations);
  const hasFacets = facets.issues.length > 0 || facets.population || facets.prefers.length > 0;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <p>
        <strong>Understood:</strong>{" "}
        {hasFacets ? (
          <>
            {facets.issues.map((issue) => (
              <Chip key={issue} label={`issues: ${issue}`} onRemove={() => onRemoveChip("issue", issue)} />
            ))}
            {facets.population && (
              <Chip
                label={`population: ${facets.population}`}
                onRemove={() => onRemoveChip("population", facets.population ?? "")}
              />
            )}
            {facets.prefers.map((pref) => (
              <Chip key={pref} label={`prefers: ${pref}`} onRemove={() => onRemoveChip("prefer", pref)} />
            ))}
          </>
        ) : (
          <em>no specific facets — showing a broad sample</em>
        )}
      </p>

      {results.sparse && (
        <div
          style={{
            border: "1px solid #e0c060",
            background: "#fffaf0",
            borderRadius: 6,
            padding: "12px 16px",
            marginBottom: "1rem"
          }}
        >
          <p style={{ margin: 0 }}>
            We don&rsquo;t have many recommendations for exactly this yet — here are the closest
            experiences we do have.
          </p>
          <Link href="/#direction-b">Ask the network instead →</Link>
        </div>
      )}

      <div style={{ display: "grid", gap: "1rem" }}>
        {results.cards.map((card) => (
          <ResultCard key={card.provider.id} card={card} />
        ))}
      </div>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        background: "#e8e8e8",
        borderRadius: 999,
        padding: "2px 10px",
        marginRight: "6px",
        fontSize: "0.85rem"
      }}
    >
      {label}
      <button
        onClick={onRemove}
        aria-label={`remove ${label}`}
        style={{ border: "none", background: "none", cursor: "pointer", color: "#666" }}
      >
        ×
      </button>
    </span>
  );
}

function ResultCard({ card }: { card: FindResultCard }) {
  const similar = similarProviders(card.provider.id, providers, recommendations, 3);
  return (
    <article style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem", background: "#fff" }}>
      <h3 style={{ marginBottom: 0 }}>
        <Link href={`/provider/${card.provider.id}`}>{card.provider.name}</Link>,{" "}
        {card.provider.credential}
      </h3>
      <p style={{ margin: "2px 0", color: "#666" }}>{card.provider.metro}</p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "6px 0" }}>
        <span style={{ background: "#eef7ee", color: "#2a6", borderRadius: 999, padding: "2px 10px", fontSize: "0.8rem" }}>
          Passed along {card.passedCount} times
        </span>
        {card.provider.license.status === "verified" && (
          <span style={{ background: "#eef2fb", color: "#357", borderRadius: 999, padding: "2px 10px", fontSize: "0.8rem" }}>
            ✓ license checked {card.provider.license.checkedAt}
          </span>
        )}
      </div>

      <p style={{ fontStyle: "italic", color: "#444" }}>{card.likeYouLine}</p>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "6px 0" }}>
        {card.tagFrequencies.map((entry) => (
          <span key={entry.tag} style={{ fontSize: "0.75rem", color: "#555", border: "1px solid #ddd", borderRadius: 4, padding: "1px 6px" }}>
            {entry.tag} ({entry.count})
          </span>
        ))}
      </div>

      {card.keystoneQuote && <blockquote style={{ margin: "8px 0", color: "#333" }}>&ldquo;{card.keystoneQuote}&rdquo;</blockquote>}

      {card.matchingRecs[0] && (
        <div style={{ background: "#fffdf3", border: "1px solid #eee3b0", borderRadius: 6, padding: "8px 12px", margin: "8px 0" }}>
          <strong style={{ fontSize: "0.85rem" }}>Why this might fit you</strong>
          <p style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
            &ldquo;{card.matchingRecs[0].quote}&rdquo; — {card.matchingRecs[0].recommenderContext}
          </p>
        </div>
      )}

      {similar.length > 0 && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          See similar:{" "}
          {similar.map((provider, index) => (
            <span key={provider.id}>
              <Link href={`/provider/${provider.id}`}>{provider.name}</Link>
              {index < similar.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
    </article>
  );
}

function CrisisCard({ onBack }: { onBack: () => void }) {
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        gap: "1rem"
      }}
    >
      <h1>You&rsquo;re not alone right now</h1>
      <p style={{ maxWidth: 480 }}>
        This isn&rsquo;t a set of search results — what you wrote sounds like you might be in
        crisis, and we want to make sure you get to a person right away instead of a list of
        providers. Nothing you wrote here has been stored.
      </p>
      <p style={{ fontSize: "1.2rem", fontWeight: 600 }}>Call or text 988 — the Suicide &amp; Crisis Lifeline</p>
      <p style={{ maxWidth: 480, color: "#555" }}>
        Available 24/7, free and confidential. If you are in immediate danger, call 911.
      </p>
      <button onClick={onBack}>Back to find</button>
    </main>
  );
}
