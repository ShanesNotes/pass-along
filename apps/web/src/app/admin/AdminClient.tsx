"use client";

import Link from "next/link";
import { useState } from "react";
import {
  flaggedSubmissions,
  taxonomyCandidates,
  dlqEntries,
  type FlaggedSubmission
} from "../../fixtures/adminQueue";
import { highlightSpans } from "../../lib/highlightSpans";

type Decision = "approved" | "rejected" | "edit-scrub" | undefined;

export function AdminClient() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [promoted, setPromoted] = useState<Record<string, boolean>>({});

  return (
    <main>
      <div className="pa-eyebrow">Danielle&rsquo;s bench</div>
      <h1>Moderation queue</h1>
      <p style={{ color: "#9a5a3f", fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        internal — not public
      </p>
      <p style={{ margin: "6px 0 20px" }}>
        <Link href="/admin/metrics">View founder metrics dashboard →</Link>
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Flagged submissions ({flaggedSubmissions.length})</h2>
        <div style={{ display: "grid", gap: "1rem" }}>
          {flaggedSubmissions.map((submission) => (
            <SubmissionRow
              key={submission.id}
              submission={submission}
              decision={decisions[submission.id]}
              onDecide={(decision) => setDecisions((prev) => ({ ...prev, [submission.id]: decision }))}
            />
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Taxonomy promotion candidates</h2>
        <div className="pa-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)", background: "var(--cream)" }}>
                <th style={{ padding: "10px 14px" }}>Term</th>
                <th style={{ padding: "10px 14px" }}>Occurrences</th>
                <th style={{ padding: "10px 14px" }}>Suggested parent</th>
                <th style={{ padding: "10px 14px" }} />
              </tr>
            </thead>
            <tbody>
              {taxonomyCandidates.map((candidate) => (
                <tr key={candidate.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 14px" }}>{candidate.term}</td>
                  <td style={{ padding: "10px 14px" }}>{candidate.occurrences}</td>
                  <td style={{ padding: "10px 14px" }}>{candidate.suggestedParent}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <button
                      className="pa-btn ghost"
                      style={{ padding: "8px 14px", fontSize: "0.85rem" }}
                      onClick={() => setPromoted((prev) => ({ ...prev, [candidate.id]: true }))}
                      disabled={Boolean(promoted[candidate.id])}
                    >
                      {promoted[candidate.id] ? "promoted" : "promote to taxonomy"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Dead-letter queue</h2>
        <div className="pa-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)", background: "var(--cream)" }}>
                <th style={{ padding: "10px 14px" }}>Job</th>
                <th style={{ padding: "10px 14px" }}>Entity</th>
                <th style={{ padding: "10px 14px" }}>Attempts</th>
                <th style={{ padding: "10px 14px" }}>Last error</th>
                <th style={{ padding: "10px 14px" }}>Failed at</th>
              </tr>
            </thead>
            <tbody>
              {dlqEntries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 14px" }}>{entry.jobName}</td>
                  <td style={{ padding: "10px 14px" }}>{entry.entityId}</td>
                  <td style={{ padding: "10px 14px" }}>{entry.attempts}</td>
                  <td style={{ padding: "10px 14px", color: "#9a5a3f" }}>{entry.lastError}</td>
                  <td style={{ padding: "10px 14px" }}>{entry.failedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function SubmissionRow({
  submission,
  decision,
  onDecide
}: {
  submission: FlaggedSubmission;
  decision: Decision;
  onDecide: (decision: Decision) => void;
}) {
  const rawSegments = highlightSpans(submission.raw, submission.piiSpans);

  return (
    <article className="pa-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <strong>{submission.providerName}</strong>
        <span style={{ fontSize: "0.8rem", color: "var(--ink-faint)" }}>{submission.submittedAt}</span>
      </div>
      <p style={{ fontSize: "0.8rem", color: "#9a5a3f", fontWeight: 700 }}>Flags: {submission.flagReasons.join(", ")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
        <div>
          <p style={{ fontSize: "0.75rem", color: "var(--ink-faint)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>
            Raw
          </p>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            {rawSegments.map((segment, index) =>
              segment.label ? (
                <mark key={index} style={{ background: "var(--sun-soft)" }} title={segment.label}>
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </p>
        </div>
        <div>
          <p style={{ fontSize: "0.75rem", color: "var(--ink-faint)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>
            Scrubbed
          </p>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>{submission.scrubbed}</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.9rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="pa-btn" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={() => onDecide("approved")} disabled={decision === "approved"}>
          approve
        </button>
        <button className="pa-btn ghost" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={() => onDecide("edit-scrub")} disabled={decision === "edit-scrub"}>
          edit scrub
        </button>
        <button className="pa-btn ghost" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={() => onDecide("rejected")} disabled={decision === "rejected"}>
          reject
        </button>
        {decision && <span style={{ fontSize: "0.85rem", color: "var(--deep)", fontWeight: 700 }}>{decision}</span>}
      </div>
    </article>
  );
}
