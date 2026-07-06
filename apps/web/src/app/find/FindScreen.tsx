import * as React from "react";
import Link from "next/link";
import type { FacetKind, Facets } from "../../lib/understandQuery";
import type { CrisisSupport, FindApiCard } from "../../lib/findApi";

const SPARSE_RESULT_THRESHOLD = 3;

export type FindView =
  | { readonly kind: "input" }
  | {
      readonly kind: "loading";
      readonly queryText: string;
      readonly facets: Facets;
    }
  | {
      readonly kind: "error";
      readonly queryText: string;
      readonly facets: Facets;
      readonly message: string;
    }
  | {
      readonly kind: "crisis";
      readonly queryText: string;
      readonly support: CrisisSupport;
    }
  | {
      readonly kind: "results";
      readonly queryText: string;
      readonly facets: Facets;
      readonly cards: readonly FindApiCard[];
    };

export interface FindScreenProps {
  readonly text: string;
  readonly view: FindView;
  readonly onTextChange: (text: string) => void;
  readonly onSubmit: () => void;
  readonly onCrisisExample: () => void;
  readonly onBack: () => void;
  readonly onRemoveChip: (kind: FacetKind, value: string) => void;
}

export function FindScreen({
  text,
  view,
  onTextChange,
  onSubmit,
  onCrisisExample,
  onBack,
  onRemoveChip
}: FindScreenProps) {
  const isLoading = view.kind === "loading";

  return (
    <main>
      <h1>Find (Direction A)</h1>
      <LivePipelineLine />

      {view.kind === "crisis" ? (
        <CrisisCard support={view.support} onBack={onBack} />
      ) : (
        <>
          <p style={{ color: "#555" }}>Tell us what&rsquo;s going on, in your own words.</p>

          <textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            rows={4}
            style={{ width: "100%", fontSize: "1rem", padding: "10px", boxSizing: "border-box" }}
            placeholder="e.g. Looking for someone for my teenager's anxiety, ideally evenings"
          />

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={onSubmit} disabled={isLoading}>
              {isLoading ? "Searching..." : "Search recommendations"}
            </button>
            <Stub>voice input</Stub>
            <Stub>list / map toggle</Stub>
            <Stub>therapist / facility toggle</Stub>
          </div>

          <p style={{ marginTop: "1rem" }}>
            <button
              onClick={onCrisisExample}
              style={{ background: "none", border: "none", color: "#666", textDecoration: "underline", cursor: "pointer", padding: 0 }}
            >
              See crisis state example
            </button>
          </p>

          {view.kind === "loading" && (
            <p style={{ color: "#666" }}>Running the live route...</p>
          )}

          {view.kind === "error" && (
            <div
              role="status"
              style={{
                border: "1px solid #d8b7b7",
                background: "#fff7f7",
                borderRadius: 6,
                padding: "12px 16px",
                marginTop: "1rem"
              }}
            >
              {view.message}
            </div>
          )}

          {view.kind === "results" && (
            <Results
              facets={view.facets}
              cards={view.cards}
              onRemoveChip={onRemoveChip}
            />
          )}
        </>
      )}
    </main>
  );
}

function LivePipelineLine() {
  return (
    <p
      style={{
        margin: "0 0 1rem",
        color: "#555",
        fontSize: "0.85rem",
        letterSpacing: "0.02em"
      }}
    >
      real route · safety gate active · dev embeddings · nothing stored
    </p>
  );
}

function Stub({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed #999",
        borderRadius: 4,
        padding: "8px 12px",
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        color: "#777"
      }}
    >
      {children}
      <span style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        post-meeting
      </span>
    </div>
  );
}

function Results({
  facets,
  cards,
  onRemoveChip
}: {
  readonly facets: Facets;
  readonly cards: readonly FindApiCard[];
  readonly onRemoveChip: (kind: FacetKind, value: string) => void;
}) {
  const hasFacets = facets.issues.length > 0 || facets.population || facets.prefers.length > 0;
  const sparse = cards.length < SPARSE_RESULT_THRESHOLD;

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

      {sparse && (
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
        {cards.map((card) => (
          <ResultCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

function Chip({ label, onRemove }: { readonly label: string; readonly onRemove: () => void }) {
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

function ResultCard({ card }: { readonly card: FindApiCard }) {
  const similar = useSimilarProviderRows(card.id);

  return (
    <article style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem", background: "#fff" }}>
      <h3 style={{ marginBottom: 0 }}>
        {card.name}, {card.credential}
      </h3>
      <p style={{ margin: "2px 0", color: "#666" }}>{card.loc}</p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "6px 0" }}>
        <span style={{ background: "#eef7ee", color: "#2a6", borderRadius: 999, padding: "2px 10px", fontSize: "0.8rem" }}>
          Passed along {card.passed_count} times
        </span>
        {card.verified && (
          <span style={{ background: "#eef2fb", color: "#357", borderRadius: 999, padding: "2px 10px", fontSize: "0.8rem" }}>
            license checked
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "6px 0" }}>
        {card.tags.map((entry) => (
          <span key={entry.value} style={{ fontSize: "0.75rem", color: "#555", border: "1px solid #ddd", borderRadius: 4, padding: "1px 6px" }}>
            {entry.value} ({entry.freq})
          </span>
        ))}
      </div>

      <blockquote style={{ margin: "8px 0", color: "#333" }}>&ldquo;{card.keystone}&rdquo;</blockquote>

      {card.why && (
        <div style={{ background: "#fffdf3", border: "1px solid #eee3b0", borderRadius: 6, padding: "8px 12px", margin: "8px 0" }}>
          <strong style={{ fontSize: "0.85rem" }}>Why this might fit you</strong>
          <p style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>{card.why}</p>
        </div>
      )}

      {similar.length > 0 && (
        <div style={{ borderTop: "1px solid #eee", marginTop: "10px", paddingTop: "8px" }}>
          <strong style={{ fontSize: "0.85rem" }}>See similar</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: "1.1rem" }}>
            {similar.map((entry) => (
              <li key={entry.providerId} style={{ fontSize: "0.9rem" }}>
                <Link href={`/provider/${entry.providerId}`}>{entry.name}</Link> — {entry.credential}, {entry.loc}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

interface SimilarProviderRow {
  readonly providerId: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
}

function useSimilarProviderRows(providerId: string): readonly SimilarProviderRow[] {
  const [rows, setRows] = React.useState<readonly SimilarProviderRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(
          `/api/similar?providerId=${encodeURIComponent(providerId)}`
        );

        if (!response.ok) {
          if (!cancelled) setRows([]);
          return;
        }

        const body: unknown = await response.json();
        const parsed = parseSimilarResponse(body);

        if (!cancelled) {
          setRows(parsed);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
        }
      }
    }

    setRows([]);
    void load();

    return () => {
      cancelled = true;
    };
  }, [providerId]);

  return rows;
}

function parseSimilarResponse(value: unknown): readonly SimilarProviderRow[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return [];
  }

  return value.results.map(parseSimilarRow).filter(isSimilarProviderRow);
}

function parseSimilarRow(value: unknown): SimilarProviderRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const providerId = value.providerId;
  const name = value.name;
  const credential = value.credential;
  const loc = value.loc;

  if (
    typeof providerId !== "string" ||
    typeof name !== "string" ||
    typeof credential !== "string" ||
    typeof loc !== "string"
  ) {
    return undefined;
  }

  return { providerId, name, credential, loc };
}

function isSimilarProviderRow(
  value: SimilarProviderRow | undefined
): value is SimilarProviderRow {
  return value !== undefined;
}

function CrisisCard({
  support,
  onBack
}: {
  readonly support: CrisisSupport;
  readonly onBack: () => void;
}) {
  return (
    <section
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
      <h2 style={{ fontSize: "2rem", margin: 0 }}>You&rsquo;re not alone right now</h2>
      <p style={{ maxWidth: 480 }}>
        This isn&rsquo;t a set of search results — what you wrote sounds like you might be in
        crisis, and we want to make sure you get to a person right away instead of a list of
        providers. {support.message}
      </p>
      <p style={{ fontSize: "1.2rem", fontWeight: 600 }}>Call or text {support.lifeline} — the Suicide &amp; Crisis Lifeline</p>
      <p style={{ maxWidth: 480, color: "#555" }}>
        Available 24/7, free and confidential. If you are in immediate danger, call 911.
      </p>
      <button onClick={onBack}>Back to find</button>
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
