import Link from "next/link";
import { notFound } from "next/navigation";
import {
  composeAggregatePage,
  type AggregatePageDraft
} from "../../../../../../../packages/engine/src/aggregate/index";
import { providers } from "../../../../fixtures/providers";

const METRO_BY_SLUG: Record<string, string> = {
  denver: "Denver, CO",
  austin: "Austin, TX"
};

export function generateStaticParams() {
  return [
    { issue: "anxiety", metro: "denver" },
    { issue: "grief", metro: "austin" }
  ];
}

export default async function WhatHelpedPage({
  params
}: {
  params: Promise<{ issue: string; metro: string }>;
}) {
  const { issue, metro: metroSlug } = await params;
  const metro = METRO_BY_SLUG[metroSlug];

  if (!metro) {
    notFound();
  }

  const draft = await composeAggregatePage(issue, metro);

  if (!draft) {
    notFound();
  }

  return (
    <main>
      <div className="pa-eyebrow">What helped · {draft.metro}</div>
      <h1 style={{ marginBottom: "0.3rem" }}>{draft.headline}</h1>
      <p className="pa-sub" style={{ marginBottom: "1.75rem" }}>
        People who dealt with {humanize(draft.issue)} in {draft.metro} passed these along —
        not advice, just what worked for them. Every quote below is a real recommender&rsquo;s
        own words, scrubbed of identifying details.
      </p>

      <div style={{ display: "grid", gap: "1.25rem" }}>
        {draft.themes.map((theme) => (
          <section key={theme.title} className="pa-card">
            <h2 style={{ marginTop: 0, fontSize: "1.2rem" }}>{theme.title}</h2>
            <div style={{ display: "grid", gap: "0.9rem", marginTop: "0.75rem" }}>
              {theme.quotes.map((quote) => (
                <blockquote key={`${quote.storyId}-${quote.text}`} className="pa-keystone">
                  &ldquo;{quote.text}&rdquo;
                  <footer>— passed along about {providerName(quote.providerId)}</footer>
                </blockquote>
              ))}
            </div>
          </section>
        ))}
      </div>

      <ProviderList draft={draft} />

      <p style={{ marginTop: "2rem" }}>
        <Link className="pa-btn" href="/find">
          Find help like this →
        </Link>{" "}
        <Link className="pa-btn ghost" href="/pass" style={{ marginLeft: "0.6rem" }}>
          Know someone who helped? Pass them along →
        </Link>
      </p>

      <footer
        style={{
          marginTop: "2.5rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--line)",
          color: "var(--ink-faint)",
          fontSize: "0.8rem"
        }}
      >
        <p style={{ margin: "0 0 6px" }}>
          Concept preview · synthetic data · every quote traces to a real fixture story
        </p>
        <p style={{ margin: 0 }}>
          If you&rsquo;re in crisis right now,{" "}
          <a href="tel:988">call or text 988</a> — the Suicide &amp; Crisis Lifeline, available
          24/7.
        </p>
      </footer>
    </main>
  );
}

function ProviderList({ draft }: { readonly draft: AggregatePageDraft }) {
  return (
    <section style={{ marginTop: "2rem" }}>
      <div className="pa-section-label" style={{ marginTop: 0 }}>
        Passed along by this community
      </div>
      <div style={{ display: "grid", gap: "0.6rem" }}>
        {draft.providers.map((mention) => {
          const provider = providers.find((entry) => entry.id === mention.providerId);

          if (!provider) {
            return null;
          }

          return (
            <div
              key={mention.providerId}
              className="pa-card-sm"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <span>
                <strong>{provider.name}</strong>, {provider.credential} · {provider.metro}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="pa-pill pa-pill-passed">
                  {mention.storyCount} {mention.storyCount === 1 ? "story" : "stories"} here
                </span>
                {provider.license.status === "verified" ? (
                  <span className="pa-pill-verified">✓ Verified</span>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>verification pending</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function providerName(providerId: string): string {
  const provider = providers.find((entry) => entry.id === providerId);
  return provider ? provider.name : "a provider in this community";
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
