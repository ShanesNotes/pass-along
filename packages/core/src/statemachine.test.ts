import { describe, expect, test } from "vitest";
import {
  LEGAL_TRANSITIONS,
  SUBMISSION_ACTIONS,
  SUBMISSION_STATES,
  TransitionError,
  transition,
  type SubmissionAction,
  type SubmissionState
} from "./statemachine.js";

describe("submission state machine", () => {
  test.each(LEGAL_TRANSITIONS)(
    "allows $from --$action--> $to",
    ({ from, action, to }) => {
      expect(transition(from, action)).toBe(to);
    }
  );

  test.each([
    ["received", "extract"],
    ["scrubbing", "score"],
    ["enriching", "all_green"],
    ["scored", "approve"],
    ["review_pending", "score"],
    ["published", "approve"],
    ["rejected", "approve"],
    ["removed", "takedown_report"]
  ] satisfies [SubmissionState, SubmissionAction][])(
    "throws on illegal %s --%s",
    (state, action) => {
      expect(() => transition(state, action)).toThrow(TransitionError);
    }
  );

  test("no action returns a state outside the state set", () => {
    const stateSet = new Set<SubmissionState>(SUBMISSION_STATES);

    for (const state of SUBMISSION_STATES) {
      for (const action of SUBMISSION_ACTIONS) {
        try {
          expect(stateSet.has(transition(state, action))).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(TransitionError);
        }
      }
    }
  });

  test("the legal transition catalog is exhaustive for the spec graph", () => {
    const legalTransitionKeys = new Set(
      LEGAL_TRANSITIONS.map(
        ({ from, action, to }) => `${from}:${action}:${to}`
      )
    );

    expect(legalTransitionKeys).toEqual(
      new Set([
        "received:scrub:scrubbing",
        "scrubbing:extract:enriching",
        "enriching:score:scored",
        "scored:all_green:published",
        "scored:any_flag:review_pending",
        "review_pending:approve:published",
        "review_pending:reject:rejected",
        "review_pending:edit_approve:published",
        "published:takedown_report:removed"
      ])
    );
  });
});
