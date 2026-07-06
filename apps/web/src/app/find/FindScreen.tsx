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
      readonly kind: "clarify";
      readonly queryText: string;
      readonly facets: Facets;
      readonly question: string;
      readonly chips: readonly string[];
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
  readonly onClarifyChip: (value: string) => void;
}

export function FindScreen({
  text,
  view,
  onTextChange,
  onSubmit,
  onCrisisExample,
  onBack,
  onRemoveChip,
  onClarifyChip
}: FindScreenProps) {
  const isLoading = view.kind === "loading";

  return (
    <main>
      <div className="pa-eyebrow">Find</div>
      <h1>Find help</h1>
      <LivePipelineLine />

      {view.kind === "crisis" ? (
        <CrisisCard support={view.support} onBack={onBack} />
      ) : (
        <div className="pa-card">
          <p className="pa-sub" style={{ marginTop: 0 }}>
            Tell us what&rsquo;s going on, in your own words.
          </p>

          <textarea
            className="pa-textarea"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            rows={4}
            placeholder="e.g. Looking for someone for my teenager's anxiety, ideally evenings"
          />

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.9rem", alignItems: "center", flexWrap: "wrap" }}>
            <button className="pa-btn" onClick={onSubmit} disabled={isLoading}>
              {isLoading ? "Searching..." : "Find help"}
            </button>
            <Stub>voice input</Stub>
            <Stub>list / map toggle</Stub>
            <Stub>therapist / facility toggle</Stub>
          </div>

          <p style={{ marginTop: "1rem" }}>
            <button className="pa-btn text" onClick={onCrisisExample}>
              See crisis state example
            </button>
          </p>

          {view.kind === "loading" && <p style={{ color: "var(--ink-soft)" }}>Running the live route...</p>}

          {view.kind === "error" && (
            <div role="status" className="pa-card-sm" style={{ borderColor: "#f3d6c9", background: "#fcefea", marginTop: "1rem" }}>
              {view.message}
            </div>
          )}

          {view.kind === "clarify" && (
            <Clarify
              question={view.question}
              chips={view.chips}
              onClarifyChip={onClarifyChip}
            />
          )}

          {view.kind === "results" && (
            <Results facets={view.facets} cards={view.cards} onRemoveChip={onRemoveChip} />
          )}
        </div>
      )}
    </main>
  );
}

function Clarify({
  question,
  chips,
  onClarifyChip
}: {
  readonly question: string;
  readonly chips: readonly string[];
  readonly onClarifyChip: (value: string) => void;
}) {
  return (
    <div className="pa-card-sm" style={{ marginTop: "1rem" }}>
      <p style={{ margin: "0 0 0.75rem", fontWeight: 800 }}>{question}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {chips.map((chip) => (
          <button
            key={chip}
            className="pa-chip"
            onClick={() => onClarifyChip(chip)}
          >
            {formatFacetValue(chip)}
          </button>
        ))}
      </div>
    </div>
  );
}

function LivePipelineLine() {
  return (
    <p
      style={{
        margin: "0 0 1rem",
        color: "var(--ink-faint)",
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
    <div className="pa-stub">
      {children}
      <span className="label">post-meeting</span>
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
      <div style={{ background: "var(--green-soft)", border: "1px solid #cfe2dc", borderRadius: "var(--radius-sm)", padding: "14px 18px", marginBottom: "1.25rem" }}>
        <span style={{ fontWeight: 800, marginRight: 6, color: "var(--deep)" }}>We heard:</span>{" "}
        {hasFacets ? (
          <>
            {facets.issues.map((issue) => (
              <Chip key={issue} label={`issues: ${formatFacetValue(issue)}`} onRemove={() => onRemoveChip("issue", issue)} />
            ))}
            {facets.population && (
              <Chip
                label={`population: ${formatFacetValue(facets.population)}`}
                onRemove={() => onRemoveChip("population", facets.population ?? "")}
              />
            )}
            {facets.prefers.map((pref) => (
              <Chip key={pref} label={`prefers: ${formatFacetValue(pref)}`} onRemove={() => onRemoveChip("prefer", pref)} />
            ))}
          </>
        ) : (
          <em style={{ color: "var(--ink-soft)" }}>no specific facets — showing a broad sample</em>
        )}
        <span style={{ display: "block", marginTop: 7, fontSize: 13, color: "var(--ink-faint)" }}>
          Tap an × to correct it — the search adapts.
        </span>
      </div>

      {sparse && (
        <div className="pa-notice">
          <p style={{ margin: 0 }}>
            We don&rsquo;t have many recommendations for exactly this yet — here are the closest
            experiences we do have.
          </p>
          <Link href="/#direction-b" style={{ fontWeight: 700 }}>
            Ask the network instead →
          </Link>
        </div>
      )}

      <div style={{ display: "grid", gap: "1.25rem" }}>
        {cards.map((card) => (
          <ResultCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

function formatFacetValue(value: string): string {
  return value.replaceAll("_", " ");
}

function Chip({ label, onRemove }: { readonly label: string; readonly onRemove: () => void }) {
  return (
    <span className="pa-chip" style={{ marginRight: 6, marginBottom: 4 }}>
      {label}
      <button onClick={onRemove} aria-label={`remove ${label}`}>
        ×
      </button>
    </span>
  );
}

function ResultCard({ card }: { readonly card: FindApiCard }) {
  const similar = useSimilarProviderRows(card.id);

  return (
    <article className="pa-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ marginBottom: 0, fontSize: "1.3rem" }}>
            {card.name}, {card.credential}
          </h3>
          <p style={{ margin: "3px 0 0", color: "var(--ink-faint)", fontSize: "0.9rem" }}>{card.loc}</p>
        </div>
        <span className="pa-pill-verified">✓ Verified · checked this month</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
        <span className="pa-pill pa-pill-passed">Passed along {card.passed_count} times</span>
        {card.verified && <span className="pa-pill pa-pill-like">✳ From people like you</span>}
      </div>

      <div className="pa-section-label">What people talked about</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {card.tags.map((entry) => (
          <span key={entry.value} className="pa-tag shared">
            {entry.value} <span className="freq">({entry.freq})</span>
          </span>
        ))}
      </div>

      <blockquote className="pa-keystone" style={{ margin: "15px 0 4px" }}>
        &ldquo;{card.keystone}&rdquo;
      </blockquote>

      {card.why && (
        <div className="pa-whymatch">
          <b>Why this might fit you</b>
          {card.why}
        </div>
      )}

      {similar.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 10 }}>
          <div className="pa-section-label" style={{ marginTop: 0 }}>
            See similar
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: "1.1rem" }}>
            {similar.map((entry) => (
              <li key={entry.providerId} style={{ fontSize: "0.92rem", marginBottom: 4 }}>
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
    <section className="pa-crisis">
      <h2>You&rsquo;re not alone right now</h2>
      <p>
        This isn&rsquo;t a set of search results — what you wrote sounds like you might be in
        crisis, and we want to make sure you get to a person right away instead of a list of
        providers. {support.message}
      </p>
      <a className="call" href={`tel:${support.lifeline}`}>
        Call or text {support.lifeline} — Suicide &amp; Crisis Lifeline
      </a>
      <p style={{ maxWidth: 480, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
        Available 24/7, free and confidential. If you are in immediate danger, call 911.
      </p>
      <button className="pa-btn ghost" onClick={onBack}>
        Back to find
      </button>
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
