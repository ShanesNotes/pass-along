"use client";

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
      <h1>Moderation queue</h1>
      <p style={{ color: "#a55", fontWeight: 600 }}>internal — Danielle&rsquo;s review bench</p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Flagged submissions ({flaggedSubmissions.length})</h2>
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
        <h2 style={{ fontSize: "1.05rem" }}>Taxonomy promotion candidates</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 4px" }}>Term</th>
              <th style={{ padding: "6px 4px" }}>Occurrences</th>
              <th style={{ padding: "6px 4px" }}>Suggested parent</th>
              <th style={{ padding: "6px 4px" }} />
            </tr>
          </thead>
          <tbody>
            {taxonomyCandidates.map((candidate) => (
              <tr key={candidate.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 4px" }}>{candidate.term}</td>
                <td style={{ padding: "6px 4px" }}>{candidate.occurrences}</td>
                <td style={{ padding: "6px 4px" }}>{candidate.suggestedParent}</td>
                <td style={{ padding: "6px 4px" }}>
                  <button
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
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Dead-letter queue</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 4px" }}>Job</th>
              <th style={{ padding: "6px 4px" }}>Entity</th>
              <th style={{ padding: "6px 4px" }}>Attempts</th>
              <th style={{ padding: "6px 4px" }}>Last error</th>
              <th style={{ padding: "6px 4px" }}>Failed at</th>
            </tr>
          </thead>
          <tbody>
            {dlqEntries.map((entry) => (
              <tr key={entry.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 4px" }}>{entry.jobName}</td>
                <td style={{ padding: "6px 4px" }}>{entry.entityId}</td>
                <td style={{ padding: "6px 4px" }}>{entry.attempts}</td>
                <td style={{ padding: "6px 4px", color: "#a55" }}>{entry.lastError}</td>
                <td style={{ padding: "6px 4px" }}>{entry.failedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <article style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{submission.providerName}</strong>
        <span style={{ fontSize: "0.8rem", color: "#777" }}>{submission.submittedAt}</span>
      </div>
      <p style={{ fontSize: "0.8rem", color: "#a55" }}>Flags: {submission.flagReasons.join(", ")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
        <div>
          <p style={{ fontSize: "0.75rem", color: "#777", margin: "0 0 4px" }}>RAW</p>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            {rawSegments.map((segment, index) =>
              segment.label ? (
                <mark key={index} style={{ background: "#fce8e8" }} title={segment.label}>
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )}
          </p>
        </div>
        <div>
          <p style={{ fontSize: "0.75rem", color: "#777", margin: "0 0 4px" }}>SCRUBBED</p>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>{submission.scrubbed}</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button onClick={() => onDecide("approved")} disabled={decision === "approved"}>
          approve
        </button>
        <button onClick={() => onDecide("edit-scrub")} disabled={decision === "edit-scrub"}>
          edit scrub
        </button>
        <button onClick={() => onDecide("rejected")} disabled={decision === "rejected"}>
          reject
        </button>
        {decision && <span style={{ alignSelf: "center", fontSize: "0.85rem", color: "#2a6" }}>{decision}</span>}
      </div>
    </article>
  );
}
