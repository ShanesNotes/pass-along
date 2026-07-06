export const SUBMISSION_STATES = [
  "received",
  "scrubbing",
  "enriching",
  "scored",
  "published",
  "review_pending",
  "rejected",
  "removed"
] as const;

export const SUBMISSION_ACTIONS = [
  "scrub",
  "extract",
  "score",
  "all_green",
  "any_flag",
  "approve",
  "reject",
  "edit_approve",
  "takedown_report"
] as const;

export type SubmissionState = (typeof SUBMISSION_STATES)[number];
export type SubmissionAction = (typeof SUBMISSION_ACTIONS)[number];

export class TransitionError extends Error {
  constructor(state: SubmissionState, action: SubmissionAction) {
    super(`Illegal submission transition: ${state} --${action}-->`);
    this.name = "TransitionError";
  }
}

export const LEGAL_TRANSITIONS = [
  { from: "received", action: "scrub", to: "scrubbing" },
  { from: "scrubbing", action: "extract", to: "enriching" },
  { from: "enriching", action: "score", to: "scored" },
  { from: "scored", action: "all_green", to: "published" },
  { from: "scored", action: "any_flag", to: "review_pending" },
  { from: "review_pending", action: "approve", to: "published" },
  { from: "review_pending", action: "reject", to: "rejected" },
  { from: "review_pending", action: "edit_approve", to: "published" },
  { from: "published", action: "takedown_report", to: "removed" }
] as const satisfies readonly {
  from: SubmissionState;
  action: SubmissionAction;
  to: SubmissionState;
}[];

export function transition(
  state: SubmissionState,
  action: SubmissionAction
): SubmissionState {
  const legalTransition = LEGAL_TRANSITIONS.find(
    (candidate) => candidate.from === state && candidate.action === action
  );

  if (!legalTransition) {
    throw new TransitionError(state, action);
  }

  return legalTransition.to;
}
