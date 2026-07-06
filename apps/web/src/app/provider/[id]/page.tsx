import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  checkedMonthYear,
  currentDatedVerifiedCheck
} from "../../../../../../packages/engine/src/verification/index";
import { providers } from "../../../fixtures/providers";
import { recommendations } from "../../../fixtures/recommendations";
import { providerStats, recommendationsForProvider } from "../../../lib/aggregate";

export function generateStaticParams() {
  return providers.map((provider) => ({ id: provider.id }));
}

export default async function ProviderProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const provider = providers.find((entry) => entry.id === id);
  if (!provider) notFound();

  const stats = providerStats(id, recommendations);
  const recs = recommendationsForProvider(id, recommendations);
  const similar = await fetchSimilarProviders(id);
  const licenseCheck = currentDatedVerifiedCheck(provider.license.check);
  const freshest = recs.reduce<string | undefined>((latest, rec) => {
    if (!latest || rec.freshnessConfirmedAt > latest) return rec.freshnessConfirmedAt;
    return latest;
  }, undefined);
  const maxCount = stats.tagFrequencies[0]?.count ?? 1;

  return (
    <main>
      <div className="pa-eyebrow">Provider profile</div>
      <h1 style={{ marginBottom: 0 }}>
        {provider.name}, {provider.credential}
      </h1>
      <p style={{ color: "var(--ink-faint)", marginTop: "4px" }}>
        {provider.metro} · {provider.kind === "facility" ? "group practice" : "individual therapist"}
      </p>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", margin: "12px 0" }}>
        <span className="pa-pill pa-pill-passed">Passed along {stats.passedCount} times</span>
      </div>

      {licenseCheck && (
        <section
          className="pa-card"
          style={{
            background: "var(--sage-soft)",
            borderColor: "#cbe3dd",
            margin: "1rem 0"
          }}
        >
          <strong style={{ color: "var(--deep)" }}>
            ✓ Verified · checked {checkedMonthYear(licenseCheck)}
          </strong>
          <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "var(--ink-soft)" }}>
            {licenseCheck.source}
          </p>
        </section>
      )}

      {freshest && (
        <p style={{ color: "var(--sage-text)", fontWeight: 600, fontSize: "0.9rem" }}>
          A recommender confirmed {provider.name.split(" ")[0]} was still practicing as of {freshest}.
        </p>
      )}

      <section style={{ margin: "1.75rem 0" }}>
        <h2 style={{ fontSize: "1.1rem" }}>What people bring this provider up for</h2>
        <div style={{ display: "grid", gap: "8px" }}>
          {stats.tagFrequencies.map((entry) => (
            <div key={entry.tag} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ width: 140, fontSize: "0.85rem", color: "var(--ink-soft)" }}>{entry.tag}</span>
              <div style={{ background: "var(--cream)", borderRadius: 999, flex: 1, height: 10 }}>
                <div
                  style={{
                    width: `${(entry.count / maxCount) * 100}%`,
                    background: "var(--green)",
                    height: "100%",
                    borderRadius: 999
                  }}
                />
              </div>
              <span style={{ fontSize: "0.8rem", color: "var(--ink-faint)" }}>{entry.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ margin: "1.75rem 0" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Recommendations ({recs.length})</h2>
        <div style={{ display: "grid", gap: "1rem" }}>
          {recs.map((rec) => (
            <blockquote key={rec.id} className="pa-keystone">
              &ldquo;{rec.quote}&rdquo;
              <footer>— {rec.recommenderContext}</footer>
            </blockquote>
          ))}
        </div>
      </section>

      {similar.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1.1rem" }}>See similar providers</h2>
          <ul style={{ paddingLeft: "1.1rem" }}>
            {similar.map((entry) => (
              <li key={entry.providerId} style={{ marginBottom: 4 }}>
                <Link href={`/provider/${entry.providerId}`}>{entry.name}</Link> — {entry.credential}, {entry.loc}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

interface SimilarProvider {
  readonly providerId: string;
  readonly name: string;
  readonly credential: string;
  readonly loc: string;
}

async function fetchSimilarProviders(
  providerId: string
): Promise<readonly SimilarProvider[]> {
  try {
    const response = await fetch(similarUrl(providerId), {
      next: { revalidate: 60 }
    });

    if (!response.ok) {
      return [];
    }

    const body: unknown = await response.json();
    return parseSimilarProviders(body);
  } catch {
    return [];
  }
}

function similarUrl(providerId: string): string {
  const url = new URL("/api/similar", selfBaseUrl());
  url.searchParams.set("providerId", providerId);
  return url.toString();
}

function selfBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

function parseSimilarProviders(value: unknown): readonly SimilarProvider[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return [];
  }

  return value.results.map(parseSimilarProvider).filter(isSimilarProvider);
}

function parseSimilarProvider(value: unknown): SimilarProvider | undefined {
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

function isSimilarProvider(
  value: SimilarProvider | undefined
): value is SimilarProvider {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
