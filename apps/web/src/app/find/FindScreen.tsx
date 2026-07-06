import * as React from "react";
import { FindBox, type FindBoxProps, type FindView } from "./FindBox";

export type { FindView };
export type FindScreenProps = FindBoxProps;

export function FindScreen(props: FindScreenProps) {
  return (
    <main>
      <div className="pa-eyebrow">Find</div>
      <h1>Find help</h1>
      <LivePipelineLine />
      <FindBox {...props} />
    </main>
  );
}

function LivePipelineLine() {
  return (
    <p
      style={{
        margin: "0 0 1rem",
        color: "var(--ink-faint)",
        fontSize: "0.85rem",
        letterSpacing: "0.02em"
      }}
    >
      real route · safety gate active · dev embeddings · nothing stored
    </p>
  );
}
