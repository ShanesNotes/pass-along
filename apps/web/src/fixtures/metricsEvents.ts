// Deterministic synthetic event-stream fixtures for the founder metrics dashboard
// (/admin/metrics). Shapes come from the typed event catalog in @pass-along/core —
// this file only adds a timestamp/metro envelope + a couple of companion lookup
// tables that the real event log doesn't carry yet, so wiring live events later
// is a drop-in for `event`/`understood_json` while the envelope stays the same.
//
// Never derives from real query text: `understood_json` here is synthesized
// directly from taxonomy terms, and `crisisTriggered` is a boolean flag only —
// no reason text, matching the rule that crisis panels are counts, never text.
import { ISSUE_TERMS, type EventCatalog, type UnderstoodQuery } from "@pass-along/core";
import type { Metro } from "./types";

export interface MetricsEvent {
  occurredAt: string; // YYYY-MM-DD
  metro: Metro;
  event: EventCatalog;
  crisisTriggered?: boolean;
}

export interface RecommendationTopic {
  recommendationId: string;
  issue: string;
  metro: Metro;
  specificity: number; // 0-1, stands in for RecEnrichment.quality.specificity
}

const METROS: Metro[] = ["Denver, CO", "Austin, TX"];
const SEED = 424242;
const WINDOW_DAYS = 120;
const ANCHOR = Date.UTC(2026, 6, 5); // 2026-07-05, inside the repo's existing fixture window
const MS_PER_DAY = 86_400_000;

// mulberry32: small deterministic PRNG so the fixture is stable across runs/CI.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeHex(rand: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(rand() * 16).toString(16);
  }
  return out;
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function dateKey(dayIndex: number): string {
  return new Date(ANCHOR - (WINDOW_DAYS - dayIndex) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function makeUnderstoodQuery(rand: () => number, issue: string): UnderstoodQuery {
  return {
    issues: [{ value: issue, vocab: true, confidence: 0.6 + rand() * 0.4 }],
    kind: pick(rand, ["therapist", "facility", "either"] as const),
    preferences: {},
    confidence: 0.3 + rand() * 0.7
  };
}

function generate(): { events: MetricsEvent[]; topics: RecommendationTopic[] } {
  const rand = mulberry32(SEED);
  const events: MetricsEvent[] = [];
  const topics: RecommendationTopic[] = [];
  let recSeq = 0;
  let providerSeq = 0;

  for (let day = 0; day < WINDOW_DAYS; day += 1) {
    const date = dateKey(day);

    // Corpus growth: 0-3 new recommendation submissions per day.
    const submissionCount = Math.floor(rand() * 4);
    for (let i = 0; i < submissionCount; i += 1) {
      recSeq += 1;
      const recommendationId = `rec-${recSeq}`;
      const issue = pick(rand, ISSUE_TERMS);
      const metro = pick(rand, METROS);
      const specificity = Math.round(rand() * 100) / 100;

      events.push({
        occurredAt: date,
        metro,
        event: { type: "submission.received", payload: { recommendation_id: recommendationId } }
      });

      const flagged = rand() < 0.18;
      if (flagged) {
        events.push({
          occurredAt: date,
          metro,
          event: {
            type: "submission.flagged",
            payload: {
              recommendation_id: recommendationId,
              reasons: ["low_specificity"],
              tier: "tier1"
            }
          }
        });

        const decidedDay = Math.min(day + 1 + Math.floor(rand() * 5), WINDOW_DAYS - 1);
        events.push({
          occurredAt: dateKey(decidedDay),
          metro,
          event: {
            type: "moderation.decided",
            payload: {
              recommendation_id: recommendationId,
              action: rand() < 0.7 ? "approve" : "edit_approve",
              reviewer: "reviewer_bench"
            }
          }
        });
      }

      const published = !flagged || rand() < 0.6;
      if (published) {
        events.push({
          occurredAt: date,
          metro,
          event: { type: "submission.published", payload: { recommendation_id: recommendationId } }
        });
        topics.push({ recommendationId, issue, metro, specificity });
      }
    }

    // Provider onboarding: 0-1 new providers per day, most eventually verified.
    if (rand() < 0.5) {
      providerSeq += 1;
      const providerId = `provider-${providerSeq}`;
      const metro = pick(rand, METROS);
      events.push({
        occurredAt: date,
        metro,
        event: {
          type: "provider.created",
          payload: { provider_id: providerId, source: rand() < 0.7 ? "submission" : "import" }
        }
      });

      if (rand() < 0.82) {
        const verifiedDay = Math.min(day + 1 + Math.floor(rand() * 10), WINDOW_DAYS - 1);
        events.push({
          occurredAt: dateKey(verifiedDay),
          metro,
          event: {
            type: "provider.verified",
            payload: {
              provider_id: providerId,
              status: rand() < 0.9 ? "verified" : "manual_review",
              source: "state_board_lookup",
              checked_at: new Date(ANCHOR - (WINDOW_DAYS - verifiedDay) * MS_PER_DAY).toISOString()
            }
          }
        });
      }
    }

    // Find flow: 3-12 searches per day.
    const searchCount = 3 + Math.floor(rand() * 10);
    for (let i = 0; i < searchCount; i += 1) {
      const metro = pick(rand, METROS);
      const issue = pick(rand, ISSUE_TERMS);
      const understood = makeUnderstoodQuery(rand, issue);
      const crisisTriggered = rand() < 0.015;
      const resultCount = crisisTriggered ? 0 : Math.floor(rand() * 6);
      const understoodSource = rand() < 0.78 ? "model" : "fallback";
      const rerankSource = rand() < 0.72 ? "model" : "fallback";

      if (resultCount === 0) {
        events.push({
          occurredAt: date,
          metro,
          event: { type: "find.unmet", payload: { understood_json: understood } },
          crisisTriggered
        });
      } else {
        events.push({
          occurredAt: date,
          metro,
          event: {
            type: "find.performed",
            payload: {
              understood_json: understood,
              query_hash_sha256: fakeHex(rand, 64),
              result_count: resultCount,
              latency_ms: 250 + Math.floor(rand() * 900),
              understood_source: understoodSource,
              rerank_source: rerankSource,
              degraded: rand() < 0.03
            }
          },
          crisisTriggered
        });
      }
    }
  }

  return { events, topics };
}

const generated = generate();
export const metricsEvents: MetricsEvent[] = generated.events;
export const recommendationTopics: RecommendationTopic[] = generated.topics;
export const METRICS_METROS = METROS;
