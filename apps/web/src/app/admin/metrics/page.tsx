import Link from "next/link";
import { metricsEvents, recommendationTopics, METRICS_METROS } from "../../../fixtures/metricsEvents";
import { recommendations } from "../../../fixtures/recommendations";
import { corpusGrowth, coverageGaps, demandVsSupply, searchQuality, trustHealth } from "../../../lib/metrics";
import { CoverageHeatmap, DemandSupplyBars, PanelCaption, Sparkline, StatRow, StatTile } from "./charts";

// Anchor matches the generator's synthetic window in fixtures/metricsEvents.ts.
const ANCHOR_DATE = "2026-07-05";
const ANCHOR_MONTH = "2026-07";

export default function MetricsPage() {
  const growth = corpusGrowth(recommendationTopics, metricsEvents, ANCHOR_MONTH);
  const demandSupply = demandVsSupply(metricsEvents, recommendationTopics);
  const gaps = coverageGaps(metricsEvents, recommendationTopics, METRICS_METROS);
  const trust = trustHealth(metricsEvents, recommendations, ANCHOR_DATE);
  const quality = searchQuality(metricsEvents);

  const topGapIssues = [...new Set(demandSupply.map((r) => r.issue))];
  const gapCells = gaps.filter((c) => topGapIssues.includes(c.issue));

  return (
    <main>
      <div className="pa-eyebrow">Founder view</div>
      <h1>Metrics — is the flywheel turning?</h1>
      <p style={{ color: "#9a5a3f", fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        internal — not public
      </p>
      <p style={{ margin: "6px 0 20px" }}>
        <Link href="/admin">← back to moderation queue</Link>
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Corpus growth</h2>
        <PanelCaption>
          The moat is the corpus, not the AI — this is the number that compounds.
        </PanelCaption>
        <div className="pa-card" style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 320px", minWidth: "280px" }}>
            <Sparkline points={growth.series} />
          </div>
          <StatRow>
            <StatTile label="Total recommendations" value={String(growth.total)} caption="Published, all time" />
            <StatTile label="This month" value={String(growth.thisMonth)} caption={ANCHOR_MONTH} />
            <StatTile
              label="Median specificity"
              value={growth.medianSpecificity.toFixed(2)}
              caption="Higher = more concrete lived-experience detail"
            />
          </StatRow>
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Demand vs supply</h2>
        <PanelCaption>
          Top issues people search for versus what the corpus can already answer — unmet issues are the Ask-the-Network
          pipeline.
        </PanelCaption>
        <div className="pa-card">
          <DemandSupplyBars rows={demandSupply} />
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Coverage gaps</h2>
        <PanelCaption>
          Tag × metro cells with real search demand but thin coverage — this is the expansion roadmap.
        </PanelCaption>
        <div className="pa-card" style={{ overflowX: "auto" }}>
          <CoverageHeatmap cells={gapCells} metros={[...METRICS_METROS]} />
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Trust health</h2>
        <PanelCaption>
          The anti-ghost-network signals: verified providers, freshness-confirmed recommendations, and how fast the
          moderation queue clears.
        </PanelCaption>
        <div className="pa-card">
          <StatRow>
            <StatTile
              label="License-verified"
              value={`${trust.verifiedPct.toFixed(0)}%`}
              caption="Of providers created in the window"
            />
            <StatTile
              label="Freshness-confirmed"
              value={`${trust.freshnessConfirmedPct.toFixed(0)}%`}
              caption="Recommendations confirmed in the last quarter"
            />
            <StatTile
              label="Moderation latency"
              value={trust.medianModerationLatencyDays !== undefined ? `${trust.medianModerationLatencyDays.toFixed(1)}d` : "—"}
              caption="Median days from flag to decision"
            />
          </StatRow>
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Search quality</h2>
        <PanelCaption>
          How well the find flow is serving people — crisis-gate count is counts only, never the text that triggered it.
        </PanelCaption>
        <div className="pa-card">
          <StatRow>
            <StatTile label="Matched rate" value={`${quality.matchedRate.toFixed(0)}%`} caption="Searches that returned results" />
            <StatTile label="Clarify rate" value={`${quality.clarifyRate.toFixed(0)}%`} caption="Understood with confidence < 0.5" />
            <StatTile label="Crisis-gate triggers" value={String(quality.crisisGateTriggers)} caption="Count only — no query text" />
            <StatTile
              label="p95 latency"
              value={quality.p95LatencyMs !== undefined ? `${quality.p95LatencyMs}ms` : "—"}
              caption="Find flow response time"
            />
          </StatRow>
        </div>
      </section>
    </main>
  );
}
