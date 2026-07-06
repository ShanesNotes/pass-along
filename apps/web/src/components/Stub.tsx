import type { ReactNode } from "react";

/** Marks an affordance that is visibly present but not wired up yet. */
export function Stub({ children }: { children: ReactNode }) {
  return (
    <div className="pa-stub">
      {children}
      <span className="label">post-meeting</span>
    </div>
  );
}
