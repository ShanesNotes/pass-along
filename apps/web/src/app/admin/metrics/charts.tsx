// Inline-SVG chart primitives for the founder metrics dashboard.
// Validated palette (node scripts/validate_palette.js from the dataviz skill):
//   categorical: coverage #2a8a63 (green), demand #b8790f (gold) — PASS light & dark
//   sequential ramp (5-step, light surface): #6ec298 #4aab80 #2f8f68 #177050 #0a4a34
const COVERAGE_COLOR = "#2a8a63";
const DEMAND_COLOR = "#b8790f";
const RAMP = ["#6ec298", "#4aab80", "#2f8f68", "#177050", "#0a4a34"];

export function StatTile({
  label,
  value,
  caption
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="pa-card-sm" style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "180px" }}>
      <div className="pa-section-label" style={{ margin: 0 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "30px", color: "var(--ink)", fontWeight: 500 }}>
        {value}
      </div>
      <div style={{ fontSize: "13px", color: "var(--ink-soft)", lineHeight: 1.4 }}>{caption}</div>
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>{children}</div>;
}

export function PanelCaption({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: "2px 0 14px", fontSize: "13.5px", color: "var(--ink-soft)", maxWidth: "640px" }}>
      {children}
    </p>
  );
}

export function Sparkline({ points }: { points: { date: string; cumulative: number }[] }) {
  if (points.length === 0) {
    return <p style={{ color: "var(--ink-faint)", fontSize: "13px" }}>No data yet.</p>;
  }
  const width = 560;
  const height = 90;
  const pad = 6;
  const max = Math.max(...points.map((p) => p.cumulative));
  const stepX = (width - pad * 2) / Math.max(1, points.length - 1);

  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - p.cumulative / max);
    return [x, y] as const;
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1] as (typeof coords)[number];
  const areaPath = `${path} L${last[0]},${height - pad} L${pad},${height - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Corpus growth over time"
    >
      <title>Cumulative published recommendations, day by day</title>
      <path d={areaPath} fill={COVERAGE_COLOR} opacity={0.12} stroke="none" />
      <path d={path} fill="none" stroke={COVERAGE_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill={COVERAGE_COLOR} />
    </svg>
  );
}

export interface DemandSupplyDatum {
  issue: string;
  demandCount: number;
  supplyCount: number;
  unmet: boolean;
}

export function DemandSupplyBars({ rows }: { rows: DemandSupplyDatum[] }) {
  if (rows.length === 0) {
    return <p style={{ color: "var(--ink-faint)", fontSize: "13px" }}>No data yet.</p>;
  }
  const max = Math.max(...rows.flatMap((r) => [r.demandCount, r.supplyCount]), 1);
  const rowHeight = 34;
  const barMax = 260;

  return (
    <div>
      <Legend
        items={[
          { color: DEMAND_COLOR, label: "Search demand" },
          { color: COVERAGE_COLOR, label: "Corpus coverage" }
        ]}
      />
      <svg
        viewBox={`0 0 460 ${rows.length * rowHeight}`}
        width="100%"
        height={rows.length * rowHeight}
        role="img"
        aria-label="Search demand vs corpus coverage by issue"
      >
        {rows.map((row, i) => {
          const y = i * rowHeight;
          const demandW = (row.demandCount / max) * barMax;
          const supplyW = (row.supplyCount / max) * barMax;
          return (
            <g key={row.issue}>
              <text x={0} y={y + 12} fontSize={12} fill="var(--ink)" fontWeight={row.unmet ? 800 : 600}>
                {row.issue}
                {row.unmet ? " — unmet" : ""}
              </text>
              <rect x={150} y={y + 2} width={demandW} height={10} rx={4} fill={DEMAND_COLOR}>
                <title>{`${row.issue}: ${row.demandCount} searches`}</title>
              </rect>
              <text x={150 + demandW + 6} y={y + 11} fontSize={11} fill="var(--ink-soft)">
                {row.demandCount}
              </text>
              <rect x={150} y={y + 16} width={supplyW} height={10} rx={4} fill={COVERAGE_COLOR}>
                <title>{`${row.issue}: ${row.supplyCount} recommendations`}</title>
              </rect>
              <text x={150 + supplyW + 6} y={y + 25} fontSize={11} fill="var(--ink-soft)">
                {row.supplyCount}
              </text>
            </g>
          );
        })}
      </svg>
      <details style={{ marginTop: "10px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12.5px", color: "var(--ink-soft)" }}>Table view</summary>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "8px", fontSize: "13px" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "6px 8px" }}>Issue</th>
              <th style={{ padding: "6px 8px" }}>Searches</th>
              <th style={{ padding: "6px 8px" }}>Recommendations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.issue} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 8px" }}>{row.issue}</td>
                <td style={{ padding: "6px 8px" }}>{row.demandCount}</td>
                <td style={{ padding: "6px 8px" }}>{row.supplyCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", gap: "16px", marginBottom: "10px", flexWrap: "wrap" }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--ink-soft)" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: item.color, display: "inline-block" }} />
          {item.label}
        </div>
      ))}
    </div>
  );
}

export interface CoverageCellDatum {
  issue: string;
  metro: string;
  searches: number;
  recommendations: number;
  gap: boolean;
}

function rampIndexForCount(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

export function CoverageHeatmap({
  cells,
  metros
}: {
  cells: CoverageCellDatum[];
  metros: string[];
}) {
  const issues = [...new Set(cells.map((c) => c.issue))];
  if (issues.length === 0) {
    return <p style={{ color: "var(--ink-faint)", fontSize: "13px" }}>No data yet.</p>;
  }
  const cellW = 120;
  const cellH = 30;
  const labelW = 150;

  const byKey = new Map(cells.map((c) => [`${c.issue}|${c.metro}`, c]));

  return (
    <div>
      <svg
        viewBox={`0 0 ${labelW + metros.length * cellW} ${(issues.length + 1) * cellH}`}
        width="100%"
        height={(issues.length + 1) * cellH}
        role="img"
        aria-label="Search volume vs corpus coverage gaps by tag and metro"
      >
        {metros.map((metro, mi) => (
          <text
            key={metro}
            x={labelW + mi * cellW + cellW / 2}
            y={16}
            fontSize={12}
            fontWeight={700}
            textAnchor="middle"
            fill="var(--ink)"
          >
            {metro}
          </text>
        ))}
        {issues.map((issue, ri) => {
          const y = (ri + 1) * cellH;
          return (
            <g key={issue}>
              <text x={0} y={y + cellH / 2 + 4} fontSize={12} fill="var(--ink)">
                {issue}
              </text>
              {metros.map((metro, mi) => {
                const cell = byKey.get(`${issue}|${metro}`);
                const fill = RAMP[rampIndexForCount(cell?.recommendations ?? 0)];
                const x = labelW + mi * cellW;
                return (
                  <g key={metro}>
                    <rect
                      x={x + 2}
                      y={y + 2}
                      width={cellW - 4}
                      height={cellH - 4}
                      rx={4}
                      fill={fill}
                    >
                      <title>{`${issue} · ${metro}: ${cell?.searches ?? 0} searches, ${cell?.recommendations ?? 0} recommendations`}</title>
                    </rect>
                    <text x={x + cellW / 2} y={y + cellH / 2 + 4} fontSize={11} textAnchor="middle" fill="#fff">
                      {cell?.recommendations ?? 0}
                    </text>
                    {cell?.gap ? (
                      <text x={x + cellW - 10} y={y + 13} fontSize={12} textAnchor="middle" fill="#fff">
                        ⚠
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: "6px" }}>
        ⚠ = expansion gap: more than 10 searches but fewer than 3 recommendations. Cell shade = recommendation count (light → dark, more).
      </p>
    </div>
  );
}
