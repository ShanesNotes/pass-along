import * as React from "react";
import Link from "next/link";
import { LandingFindBox } from "./LandingFindBox";

const TRUST_PROPS = [
  "Lived-experience stories — never star reviews",
  "Licenses actually verified against state boards",
  "Never pay-to-rank — results aren't for sale"
];

export default function LandingPage() {
  return (
    <main>
      <div className="pa-eyebrow">Pass Along</div>
      <h1 style={{ fontSize: "2.1rem", lineHeight: 1.15, maxWidth: 640, marginBottom: "0.6rem" }}>
        Find a therapist the way you&rsquo;d actually trust — passed along by someone
        who&rsquo;s been there.
      </h1>
      <p className="pa-sub" style={{ marginBottom: "1.75rem" }}>
        Describe what&rsquo;s going on, in your own words. We match you against real people&rsquo;s
        recommendations, grounded in their words — never a score we invented.
      </p>

      <LandingFindBox />

      <div
        style={{
          display: "grid",
          gap: "0.75rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          marginTop: "2rem"
        }}
      >
        {TRUST_PROPS.map((prop) => (
          <div key={prop} className="pa-card-sm" style={{ fontSize: "0.9rem", color: "var(--ink-soft)" }}>
            {prop}
          </div>
        ))}
      </div>

      <p style={{ marginTop: "2rem" }}>
        Know someone who helped?{" "}
        <Link className="pa-btn ghost" href="/pass">
          Pass one along →
        </Link>
      </p>

      <footer
        style={{
          marginTop: "3rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--line)",
          color: "var(--ink-faint)",
          fontSize: "0.8rem"
        }}
      >
        Concept preview · synthetic data · live pipeline · nothing stored
      </footer>
    </main>
  );
}
