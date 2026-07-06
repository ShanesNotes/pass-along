import type { ReactNode } from "react";

/** Marks an affordance that is visibly present but not wired up yet. */
export function Stub({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed #999",
        borderRadius: 4,
        padding: "8px 12px",
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        color: "#777"
      }}
    >
      {children}
      <span style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        post-meeting
      </span>
    </div>
  );
}
