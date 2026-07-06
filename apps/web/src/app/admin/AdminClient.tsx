"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { taxonomyCandidates, dlqEntries } from "../../fixtures/adminQueue";
import { highlightSpans } from "../../lib/highlightSpans";

type DecisionAction = "approve" | "reject" | "edit_scrub";

type QueueTag = {
  readonly type: string;
  readonly value: string;
  readonly vocab: boolean;
  readonly confidence: number;
};

type QueuePiiFinding = {
  readonly start: number;
  readonly end: number;
  readonly kind: string;
  readonly replacement: string;
  readonly label: string;
};

type QueueSubmission = {
  readonly id: string;
  readonly status: "review_pending";
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly credential: string;
    readonly kind: string;
    readonly metro: string;
  };
  readonly submitted_at: string;
  readonly flag_reasons: readonly string[];
  readonly raw_story: string;
  readonly scrubbed_story: string;
  readonly pii_findings: readonly QueuePiiFinding[];
  readonly tags: readonly QueueTag[];
  readonly quality: {
    readonly specificity: number;
    readonly lived_experience: number;
    readonly ad_smell: number;
    readonly dup_similarity: number;
    readonly flags: readonly string[];
  };
};

type QueueResponse = {
  readonly queue: readonly QueueSubmission[];
};

export function AdminClient() {
  const [submissions, setSubmissions] = useState<readonly QueueSubmission[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;

    async function loadQueue() {
      try {
        const response = await fetch("/api/admin/queue", { cache: "no-store" });

        if (!response.ok) {
          throw new Error("queue request failed");
        }

        const body = (await response.json()) as QueueResponse;

        if (active) {
          setSubmissions(body.queue);
          setError(undefined);
        }
      } catch {
        if (active) {
          setError("Queue unavailable.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadQueue();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSelectedIndex((index) =>
      Math.min(index, Math.max(0, submissions.length - 1))
    );
  }, [submissions.length]);

  const decide = useCallback(
    async (submission: QueueSubmission, action: DecisionAction) => {
      const editedScrub = drafts[submission.id] ?? submission.scrubbed_story;
      const body = {
        id: submission.id,
        action,
        ...(action === "edit_scrub" ? { editedScrub } : {})
      };

      setBusyId(submission.id);
      setError(undefined);

      try {
        const response = await fetch("/api/admin/decide", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error("decision request failed");
        }

        setSubmissions((current) =>
          current.filter((item) => item.id !== submission.id)
        );
        setEditingId((current) =>
          current === submission.id ? undefined : current
        );
        setDrafts((current) => {
          const next = { ...current };
          delete next[submission.id];
          return next;
        });
      } catch {
        setError("Decision failed.");
      } finally {
        setBusyId(undefined);
      }
    },
    [drafts]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === "j") {
        event.preventDefault();
        setSelectedIndex((index) =>
          Math.min(index + 1, Math.max(0, submissions.length - 1))
        );
        return;
      }

      if (event.key === "k") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(0, index - 1));
        return;
      }

      const selected = submissions[selectedIndex];

      if (!selected || busyId || editingId) {
        return;
      }

      if (event.key === "a") {
        event.preventDefault();
        void decide(selected, "approve");
      }

      if (event.key === "r") {
        event.preventDefault();
        void decide(selected, "reject");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busyId, decide, editingId, selectedIndex, submissions]);

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
        <h2 style={{ fontSize: "1.1rem" }}>Flagged submissions ({submissions.length})</h2>
        {error && <p style={{ color: "#9a5a3f", fontWeight: 700 }}>{error}</p>}
        {loading && <p style={{ color: "var(--ink-faint)" }}>Loading queue…</p>}
        {!loading && submissions.length === 0 && (
          <p style={{ color: "var(--ink-faint)" }}>No submissions waiting for review.</p>
        )}
        <div style={{ display: "grid", gap: "1rem" }}>
          {submissions.map((submission, index) => (
            <SubmissionRow
              key={submission.id}
              submission={submission}
              selected={index === selectedIndex}
              busy={busyId === submission.id}
              editing={editingId === submission.id}
              draft={drafts[submission.id] ?? submission.scrubbed_story}
              onSelect={() => setSelectedIndex(index)}
              onDraftChange={(value) =>
                setDrafts((current) => ({ ...current, [submission.id]: value }))
              }
              onEdit={() => setEditingId(submission.id)}
              onCancelEdit={() => setEditingId(undefined)}
              onDecide={(action) => void decide(submission, action)}
            />
          ))}
        </div>
      </section>

      <StaticTaxonomyPanel />
      <StaticDlqPanel />
    </main>
  );
}

function SubmissionRow({
  submission,
  selected,
  busy,
  editing,
  draft,
  onSelect,
  onDraftChange,
  onEdit,
  onCancelEdit,
  onDecide
}: {
  submission: QueueSubmission;
  selected: boolean;
  busy: boolean;
  editing: boolean;
  draft: string;
  onSelect: () => void;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDecide: (decision: DecisionAction) => void;
}) {
  const rawSegments = highlightSpans(submission.raw_story, [
    ...submission.pii_findings
  ]);

  return (
    <article
      className="pa-card"
      tabIndex={0}
      onFocus={onSelect}
      onClick={onSelect}
      aria-selected={selected}
      style={{
        outline: selected ? "2px solid var(--deep)" : "1px solid transparent",
        outlineOffset: 2
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong>{submission.provider.name}</strong>
          <div style={{ fontSize: "0.82rem", color: "var(--ink-faint)", marginTop: 2 }}>
            {submission.provider.credential} · {submission.provider.kind} · {submission.provider.metro}
          </div>
        </div>
        <span style={{ fontSize: "0.8rem", color: "var(--ink-faint)" }}>
          {formatDate(submission.submitted_at)}
        </span>
      </div>
      <p style={{ fontSize: "0.8rem", color: "#9a5a3f", fontWeight: 700 }}>
        Flags: {submission.flag_reasons.join(", ")}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "0.5rem" }}>
        <div>
          <PanelLabel>Raw</PanelLabel>
          <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.55 }}>
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
          <PanelLabel>Scrubbed</PanelLabel>
          {editing ? (
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              style={{
                width: "100%",
                minHeight: 130,
                resize: "vertical",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 10,
                font: "inherit",
                lineHeight: 1.5,
                background: "var(--paper)"
              }}
            />
          ) : (
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.55 }}>
              {submission.scrubbed_story}
            </p>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem", marginTop: "0.9rem" }}>
        <div>
          <PanelLabel>Tags</PanelLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {submission.tags.map((tag) => (
              <span key={`${tag.type}:${tag.value}`} style={{ fontSize: "0.78rem", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 8px", background: tag.vocab ? "var(--cream)" : "var(--sun-soft)" }}>
                {tag.value}
              </span>
            ))}
          </div>
        </div>
        <div>
          <PanelLabel>Quality</PanelLabel>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px 12px", margin: 0, fontSize: "0.82rem" }}>
            <Metric label="specificity" value={submission.quality.specificity} />
            <Metric label="lived" value={submission.quality.lived_experience} />
            <Metric label="ad smell" value={submission.quality.ad_smell} />
            <Metric label="duplicate" value={submission.quality.dup_similarity} />
          </dl>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.9rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="pa-btn" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={() => onDecide("approve")} disabled={busy} aria-keyshortcuts="a">
          approve
        </button>
        {editing ? (
          <>
            <button className="pa-btn" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={() => onDecide("edit_scrub")} disabled={busy || draft.trim().length === 0}>
              save edit
            </button>
            <button className="pa-btn ghost" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={onCancelEdit} disabled={busy}>
              cancel
            </button>
          </>
        ) : (
          <button className="pa-btn ghost" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={onEdit} disabled={busy}>
            edit scrub
          </button>
        )}
        <button className="pa-btn ghost" style={{ padding: "9px 16px", fontSize: "0.9rem" }} onClick={() => onDecide("reject")} disabled={busy} aria-keyshortcuts="r">
          reject
        </button>
        {busy && <span style={{ fontSize: "0.85rem", color: "var(--ink-faint)" }}>saving…</span>}
      </div>
    </article>
  );
}

function StaticTaxonomyPanel() {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Taxonomy promotion candidates</h2>
      <p style={{ color: "var(--ink-faint)", marginTop: -4 }}>Static wireframe — backend lands in a later packet.</p>
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
                  <button className="pa-btn ghost" style={{ padding: "8px 14px", fontSize: "0.85rem" }} disabled>
                    promote
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StaticDlqPanel() {
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Dead-letter queue</h2>
      <p style={{ color: "var(--ink-faint)", marginTop: -4 }}>Static wireframe — backend lands in a later packet.</p>
      <div className="pa-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)", background: "var(--cream)" }}>
              <th style={{ padding: "10px 14px" }}>Job</th>
              <th style={{ padding: "10px 14px" }}>Entity</th>
              <th style={{ padding: "10px 14px" }}>Attempts</th>
              <th style={{ padding: "10px 14px" }}>Last error</th>
              <th style={{ padding: "10px 14px" }}>Failed at</th>
              <th style={{ padding: "10px 14px" }} />
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
                <td style={{ padding: "10px 14px" }}>
                  <button className="pa-btn ghost" style={{ padding: "8px 14px", fontSize: "0.85rem" }} disabled>
                    replay
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PanelLabel({ children }: { readonly children: ReactNode }) {
  return (
    <p style={{ fontSize: "0.75rem", color: "var(--ink-faint)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>
      {children}
    </p>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <>
      <dt style={{ color: "var(--ink-faint)" }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 700 }}>{Math.round(value * 100)}%</dd>
    </>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
