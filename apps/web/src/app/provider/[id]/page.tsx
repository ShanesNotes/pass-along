import Link from "next/link";
import { notFound } from "next/navigation";
import { providers } from "../../../fixtures/providers";
import { recommendations } from "../../../fixtures/recommendations";
import { providerStats, recommendationsForProvider, similarProviders } from "../../../lib/aggregate";

export function generateStaticParams() {
  return providers.map((provider) => ({ id: provider.id }));
}

export default async function ProviderProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const provider = providers.find((entry) => entry.id === id);
  if (!provider) notFound();

  const stats = providerStats(id, recommendations);
  const recs = recommendationsForProvider(id, recommendations);
  const similar = similarProviders(id, providers, recommendations, 3);
  const freshest = recs.reduce<string | undefined>((latest, rec) => {
    if (!latest || rec.freshnessConfirmedAt > latest) return rec.freshnessConfirmedAt;
    return latest;
  }, undefined);
  const maxCount = stats.tagFrequencies[0]?.count ?? 1;

  return (
    <main>
      <h1 style={{ marginBottom: 0 }}>
        {provider.name}, {provider.credential}
      </h1>
      <p style={{ color: "#666", marginTop: "2px" }}>
        {provider.metro} · {provider.kind === "facility" ? "group practice" : "individual therapist"}
      </p>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", margin: "10px 0" }}>
        <span style={{ background: "#eef7ee", color: "#2a6", borderRadius: 999, padding: "3px 12px", fontSize: "0.85rem" }}>
          Passed along {stats.passedCount} times
        </span>
      </div>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: "1rem",
          background: provider.license.status === "verified" ? "#eef2fb" : "#fff8e6",
          margin: "1rem 0"
        }}
      >
        <strong>
          {provider.license.status === "verified" ? "✓ License verified" : "License verification pending"}
        </strong>
        <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "#444" }}>
          {provider.license.board} · checked {provider.license.checkedAt}
        </p>
      </section>

      {freshest && (
        <p style={{ color: "#2a6", fontSize: "0.9rem" }}>
          A recommender confirmed {provider.name.split(" ")[0]} was still practicing as of {freshest}.
        </p>
      )}

      <section style={{ margin: "1.5rem 0" }}>
        <h2 style={{ fontSize: "1rem" }}>What people bring this provider up for</h2>
        <div style={{ display: "grid", gap: "4px" }}>
          {stats.tagFrequencies.map((entry) => (
            <div key={entry.tag} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: 140, fontSize: "0.85rem" }}>{entry.tag}</span>
              <div style={{ background: "#e8e8e8", borderRadius: 4, flex: 1, height: 10 }}>
                <div
                  style={{
                    width: `${(entry.count / maxCount) * 100}%`,
                    background: "#5a8",
                    height: "100%",
                    borderRadius: 4
                  }}
                />
              </div>
              <span style={{ fontSize: "0.8rem", color: "#666" }}>{entry.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ margin: "1.5rem 0" }}>
        <h2 style={{ fontSize: "1rem" }}>Recommendations ({recs.length})</h2>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {recs.map((rec) => (
            <blockquote
              key={rec.id}
              style={{ margin: 0, borderLeft: "3px solid #ddd", paddingLeft: "12px", color: "#333" }}
            >
              &ldquo;{rec.quote}&rdquo;
              <footer style={{ fontSize: "0.8rem", color: "#777" }}>— {rec.recommenderContext}</footer>
            </blockquote>
          ))}
        </div>
      </section>

      {similar.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1rem" }}>See similar providers</h2>
          <ul>
            {similar.map((entry) => (
              <li key={entry.id}>
                <Link href={`/provider/${entry.id}`}>{entry.name}</Link> — {entry.credential}, {entry.metro}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
