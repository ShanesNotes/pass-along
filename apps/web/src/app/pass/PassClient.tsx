"use client";

import { useEffect, useState } from "react";
import { Stub } from "../../components/Stub";
import { postTypeaheadQuery, type TypeaheadApiMatch } from "../../lib/typeaheadApi";

const WHO_OPTIONS = ["myself", "a family member", "a friend", "someone I referred as a professional"];

const PIPELINE_STEPS = [
  { label: "Scrub PII", detail: "third-party names, employers, and dates are stripped automatically" },
  { label: "Structure", detail: "issues, population, and modality are extracted into tags" },
  { label: "Human review", detail: "anything flagged (or a random sample) is checked by a person" },
  { label: "Published", detail: "your story appears anonymously, credited only to \"a recommender\"" }
];

export function PassClient() {
  const [providerQuery, setProviderQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<TypeaheadApiMatch | undefined>(undefined);
  const [matches, setMatches] = useState<readonly TypeaheadApiMatch[]>([]);
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

    let cancelled = false;
    const timeout = setTimeout(() => {
      setSearchingProviders(true);
      void postTypeaheadQuery(trimmed)
        .then((results) => {
          if (!cancelled) {
            setMatches(results);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setMatches([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchingProviders(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [providerQuery, selectedProvider]);

  const canSubmit = Boolean(selectedProvider) && Boolean(who) && story.trim().length >= 20;

  if (submitted) {
    return (
      <main>
        <div className="pa-eyebrow">Pass along</div>
        <h1>Thank you for passing it along</h1>
        <p className="pa-sub">Here&rsquo;s what happens to your story next:</p>
        <PipelineStrip activeIndex={0} />
        <p style={{ marginTop: "1.5rem" }}>
          <button className="pa-btn" onClick={() => setSubmitted(false)}>
            Pass along another recommendation
          </button>
        </p>
      </main>
    );
  }

  return (
    <main>
      <div className="pa-eyebrow">Pass along</div>
      <h1>Pass along a recommendation</h1>
      <p className="pa-sub">
        This is anonymous. We never publish your name, and third-party names or identifying
        details you mention get scrubbed before anything is reviewed.
      </p>

      <div className="pa-card" style={{ marginTop: "1.5rem" }}>
        <section>
          <label htmlFor="provider-search" style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1.1rem", display: "block", marginBottom: 8 }}>
            Who are you recommending?
          </label>
          <input
            id="provider-search"
            className="pa-input"
            value={selectedProvider ? selectedProvider.name : providerQuery}
            onChange={(event) => {
              setSelectedProvider(undefined);
              setProviderQuery(event.target.value);
            }}
            placeholder="Start typing a provider name..."
          />
          {searchingProviders && !selectedProvider && (
            <p style={{ color: "var(--ink-faint)", fontSize: "0.85rem", margin: "6px 0 0" }}>
              Searching providers...
            </p>
          )}
          {matches.length > 0 && !selectedProvider && (
            <ul className="pa-card-sm" style={{ listStyle: "none", padding: 4, marginTop: 6 }}>
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
                      padding: "10px 8px",
                      minHeight: 44,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--ink)"
                    }}
                  >
                    {provider.name} — {provider.credential}, {provider.loc}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: "1.75rem" }}>
          <p style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1.1rem", margin: "0 0 10px" }}>Who was this for?</p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {WHO_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => setWho(option)}
                className="pa-chip"
                style={{
                  background: who === option ? "var(--green-soft)" : "var(--cream)",
                  borderColor: who === option ? "var(--green)" : "var(--line)",
                  color: who === option ? "var(--deep)" : "var(--ink-soft)",
                  cursor: "pointer"
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section style={{ marginTop: "1.75rem" }}>
          <label htmlFor="story" style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1.1rem", display: "block" }}>
            Tell the story that made you want to pass this along
          </label>
          <p style={{ fontSize: "0.9rem", color: "var(--ink-soft)", margin: "6px 0 10px" }}>
            The more specific the moment, the more useful this is to the next person — what did
            they do, in one concrete scene, that made the difference?
          </p>
          <textarea
            id="story"
            className="pa-textarea"
            value={story}
            onChange={(event) => setStory(event.target.value)}
            rows={5}
            placeholder="e.g. She helped me build a plan for panic attacks that actually works on the bus, not just in her office."
          />
        </section>

        <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="pa-btn" disabled={!canSubmit} onClick={() => setSubmitted(true)}>
            Submit recommendation
          </button>
          <Stub>attach a photo</Stub>
        </div>
      </div>

      <div style={{ marginTop: "2rem" }}>
        <p className="pa-section-label" style={{ marginTop: 0 }}>
          What happens after you submit
        </p>
        <PipelineStrip />
      </div>
    </main>
  );
}

function PipelineStrip({ activeIndex }: { activeIndex?: number }) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      {PIPELINE_STEPS.map((step, index) => (
        <div
          key={step.label}
          className="pa-card-sm"
          style={{
            background: activeIndex === index ? "var(--green-soft)" : "var(--cream)",
            borderColor: activeIndex === index ? "#cbe3dd" : "var(--line)",
            maxWidth: 190
          }}
        >
          <strong style={{ fontSize: "0.85rem", color: activeIndex === index ? "var(--deep)" : "var(--ink)" }}>
            {index + 1}. {step.label}
          </strong>
          <p style={{ fontSize: "0.8rem", color: "var(--ink-soft)", margin: "4px 0 0" }}>{step.detail}</p>
        </div>
      ))}
    </div>
  );
}
