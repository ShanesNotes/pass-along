"use client";

import { useEffect, useState } from "react";
import { Stub } from "../../components/Stub";

const WHO_OPTIONS = ["myself", "a family member", "a friend", "someone I referred as a professional"];

const PIPELINE_STEPS = [
  { label: "Scrub PII", detail: "third-party names, employers, and dates are stripped automatically" },
  { label: "Structure", detail: "issues, population, and modality are extracted into tags" },
  { label: "Human review", detail: "anything flagged (or a random sample) is checked by a person" },
  { label: "Published", detail: "your story appears anonymously, credited only to \"a recommender\"" }
];

export function PassClient() {
  const [providerQuery, setProviderQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderMatch | undefined>(undefined);
  const [matches, setMatches] = useState<readonly ProviderMatch[]>([]);
  const [searchingProviders, setSearchingProviders] = useState(false);
  const [who, setWho] = useState<string | undefined>(undefined);
  const [story, setStory] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (selectedProvider) {
      setMatches([]);
      setSearchingProviders(false);
      return;
    }

    const trimmed = providerQuery.trim();

    if (trimmed.length === 0) {
      setMatches([]);
      setSearchingProviders(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setSearchingProviders(true);
      void fetch(`/api/typeahead?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) {
            return [];
          }

          return parseTypeaheadResponse(await response.json());
        })
        .then((results) => {
          setMatches(results);
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) {
            setMatches([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearchingProviders(false);
          }
        });
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [providerQuery, selectedProvider]);

  const canSubmit = Boolean(selectedProvider) && Boolean(who) && story.trim().length >= 20;

  if (submitted) {
    return (
      <main>
        <h1>Thank you for passing it along</h1>
        <p style={{ color: "#555" }}>Here&rsquo;s what happens to your story next:</p>
        <PipelineStrip activeIndex={0} />
        <p style={{ marginTop: "1.5rem" }}>
          <button onClick={() => setSubmitted(false)}>Pass along another recommendation</button>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Pass along a recommendation</h1>
      <p style={{ color: "#555", maxWidth: 560 }}>
        This is anonymous. We never publish your name, and third-party names or identifying
        details you mention get scrubbed before anything is reviewed.
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <label htmlFor="provider-search">
          <strong>Who are you recommending?</strong>
        </label>
        <div>
          <input
            id="provider-search"
            value={selectedProvider ? selectedProvider.name : providerQuery}
            onChange={(event) => {
              setSelectedProvider(undefined);
              setProviderQuery(event.target.value);
            }}
            placeholder="Start typing a provider name..."
            style={{ width: "100%", padding: "8px", boxSizing: "border-box", marginTop: "6px" }}
          />
        </div>
        {searchingProviders && !selectedProvider && (
          <p style={{ color: "#666", fontSize: "0.85rem", margin: "4px 0 0" }}>
            Searching providers...
          </p>
        )}
        {matches.length > 0 && !selectedProvider && (
          <ul style={{ listStyle: "none", padding: 0, border: "1px solid #ddd", borderRadius: 6, marginTop: "4px" }}>
            {matches.map((provider) => (
              <li key={provider.id}>
                <button
                  onClick={() => {
                    setSelectedProvider(provider);
                    setProviderQuery("");
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px",
                    background: "none",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  {provider.name} — {provider.credential}, {provider.loc}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p>
          <strong>Who was this for?</strong>
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {WHO_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => setWho(option)}
              style={{
                background: who === option ? "#333" : "#eee",
                color: who === option ? "#fff" : "#333",
                border: "none",
                borderRadius: 999,
                padding: "6px 14px"
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <label htmlFor="story">
          <strong>Tell the story that made you want to pass this along</strong>
        </label>
        <p style={{ fontSize: "0.85rem", color: "#777", marginTop: "4px" }}>
          The more specific the moment, the more useful this is to the next person — what did
          they do, in one concrete scene, that made the difference?
        </p>
        <textarea
          id="story"
          value={story}
          onChange={(event) => setStory(event.target.value)}
          rows={5}
          style={{ width: "100%", padding: "10px", boxSizing: "border-box" }}
          placeholder="e.g. She helped me build a plan for panic attacks that actually works on the bus, not just in her office."
        />
      </section>

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button disabled={!canSubmit} onClick={() => setSubmitted(true)}>
          Submit recommendation
        </button>
        <Stub>attach a photo</Stub>
      </div>

      <div style={{ marginTop: "2rem" }}>
        <p style={{ fontSize: "0.85rem", color: "#777" }}>What happens after you submit:</p>
        <PipelineStrip />
      </div>
    </main>
  );
}

function PipelineStrip({ activeIndex }: { activeIndex?: number }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {PIPELINE_STEPS.map((step, index) => (
        <div
          key={step.label}
          style={{
            border: "1px solid #ddd",
            borderRadius: 6,
            padding: "8px 12px",
            background: activeIndex === index ? "#eef7ee" : "#fafafa",
            maxWidth: 180
          }}
        >
          <strong style={{ fontSize: "0.85rem" }}>
            {index + 1}. {step.label}
          </strong>
          <p style={{ fontSize: "0.75rem", color: "#666", margin: "4px 0 0" }}>{step.detail}</p>
        </div>
      ))}
    </div>
  );
}

interface ProviderMatch {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
}

function parseTypeaheadResponse(value: unknown): readonly ProviderMatch[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return [];
  }

  return value.results.map(parseProviderMatch).filter(isProviderMatch);
}

function parseProviderMatch(value: unknown): ProviderMatch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = value.id;
  const name = value.name;
  const credential = value.credential;
  const loc = value.loc;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof credential !== "string" ||
    typeof loc !== "string"
  ) {
    return undefined;
  }

  return { id, name, credential, loc };
}

function isProviderMatch(value: ProviderMatch | undefined): value is ProviderMatch {
  return value !== undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
