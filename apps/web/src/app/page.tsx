import Link from "next/link";

interface Direction {
  letter: string;
  name: string;
  pitch: string;
  href: string;
  isDefault: boolean;
}

const directions: Direction[] = [
  {
    letter: "A",
    name: "Community Find Engine",
    pitch:
      "Free-text find over the recommendation corpus: someone describes what's going on in their own words, and we surface people who've been passed along for similar situations — with why-this-fits grounding quoted straight from other people's stories, never a score we invented. This is the spec's core direction and the default recommendation.",
    href: "/find",
    isDefault: true
  },
  {
    letter: "B",
    name: "Ask the Network",
    pitch:
      "When the corpus is sparse for a niche or geography, a seeker's need becomes a routed request to recommenders who've navigated something similar — Angi's post-a-request mechanic, transposed to be trust-safe: no bidding, no lead sale, just \"do you know someone for this?\" This is how we accumulate demand signal in places the corpus hasn't reached yet.",
    href: "/find",
    isDefault: false
  },
  {
    letter: "C",
    name: "Trust Registry",
    pitch:
      "A provider-centric surface: verified profiles aggregating recommendations, license status, and freshness confirmation. This is the SEO/aggregation play — providers and the people who search for them by name land here directly.",
    href: "/provider/p1",
    isDefault: false
  }
];

export default function DirectionsPage() {
  return (
    <main>
      <h1>Three directions for Pass Along</h1>
      <p style={{ color: "#555", maxWidth: 640 }}>
        Pass Along transposes the Angi playbook to mental-health providers, with the trust
        economics inverted: instead of star reviews, background-check badges, and response-time
        stats, the trust signals are lived-experience recommendations (never called
        &ldquo;reviews&rdquo;), state license verification as an anti-ghost-network measure, and
        freshness confirmation from the recommender. One Angi mechanic we explicitly reject: paid
        placement or lead-gen ranking. Results are never for sale.
      </p>

      <div style={{ display: "grid", gap: "1.25rem", marginTop: "2rem" }}>
        {directions.map((direction) => (
          <article
            key={direction.letter}
            id={direction.letter === "B" ? "direction-b" : undefined}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "1.25rem",
              background: direction.isDefault ? "#fff" : "#f2f2f2"
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              Direction {direction.letter}: {direction.name}
              {direction.isDefault && (
                <span style={{ fontSize: "0.7rem", marginLeft: 10, color: "#0a6", fontWeight: 600 }}>
                  DEFAULT RECOMMENDATION
                </span>
              )}
            </h2>
            <p style={{ color: "#444" }}>{direction.pitch}</p>
            <Link href={direction.href}>Walk through this flow →</Link>
          </article>
        ))}
      </div>
    </main>
  );
}
