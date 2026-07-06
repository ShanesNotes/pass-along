import { describe, expect, it } from "vitest";
import type { EventCatalog } from "@pass-along/core";
import type { MetricsEvent, RecommendationTopic } from "../fixtures/metricsEvents";
import { metricsEvents, recommendationTopics, METRICS_METROS } from "../fixtures/metricsEvents";
import type { Recommendation } from "../fixtures/types";
import {
  corpusGrowth,
  coverageGaps,
  demandVsSupply,
  searchQuality,
  trustHealth
} from "./metrics";

function event(occurredAt: string, metro: MetricsEvent["metro"], e: EventCatalog, crisisTriggered?: boolean): MetricsEvent {
  return crisisTriggered === undefined
    ? { occurredAt, metro, event: e }
    : { occurredAt, metro, event: e, crisisTriggered };
}

function understood(issue: string, confidence: number) {
  return {
    issues: [{ value: issue, vocab: true, confidence: 0.9 }],
    kind: "either" as const,
    preferences: {},
    confidence
  };
}

describe("corpusGrowth", () => {
  it("builds a cumulative series and counts this-month publications", () => {
    const topics: RecommendationTopic[] = [
      { recommendationId: "r1", issue: "anxiety", metro: "Denver, CO", specificity: 0.4 },
      { recommendationId: "r2", issue: "grief", metro: "Austin, TX", specificity: 0.8 }
    ];
    const events: MetricsEvent[] = [
      event("2026-06-01", "Denver, CO", { type: "submission.published", payload: { recommendation_id: "r1" } }),
      event("2026-07-01", "Austin, TX", { type: "submission.published", payload: { recommendation_id: "r2" } })
    ];

    const result = corpusGrowth(topics, events, "2026-07");
    expect(result.total).toBe(2);
    expect(result.thisMonth).toBe(1);
    expect(result.medianSpecificity).toBeCloseTo(0.6);
    expect(result.series).toEqual([
      { date: "2026-06-01", cumulative: 1 },
      { date: "2026-07-01", cumulative: 2 }
    ]);
  });
});

describe("demandVsSupply", () => {
  it("tallies search demand per issue against corpus supply, flagging unmet issues", () => {
    const events: MetricsEvent[] = [
      event("2026-07-01", "Denver, CO", { type: "find.performed", payload: { understood_json: understood("anxiety", 0.9), query_hash_sha256: "a".repeat(64), result_count: 2, latency_ms: 300 } }),
      event("2026-07-01", "Denver, CO", { type: "find.unmet", payload: { understood_json: understood("ocd", 0.9) } }),
      event("2026-07-02", "Denver, CO", { type: "find.unmet", payload: { understood_json: understood("ocd", 0.9) } })
    ];
    const topics: RecommendationTopic[] = [
      { recommendationId: "r1", issue: "anxiety", metro: "Denver, CO", specificity: 0.5 }
    ];

    const rows = demandVsSupply(events, topics);
    const anxiety = rows.find((r) => r.issue === "anxiety");
    const ocd = rows.find((r) => r.issue === "ocd");
    expect(anxiety).toEqual({ issue: "anxiety", demandCount: 1, supplyCount: 1, unmet: false });
    expect(ocd).toEqual({ issue: "ocd", demandCount: 2, supplyCount: 0, unmet: true });
  });
});

describe("coverageGaps", () => {
  it("flags a metro x issue cell as a gap when searches exceed the threshold but recs don't", () => {
    const events: MetricsEvent[] = Array.from({ length: 12 }, (_, i) =>
      event(`2026-07-${String(i + 1).padStart(2, "0")}`, "Denver, CO", {
        type: "find.unmet",
        payload: { understood_json: understood("ptsd", 0.9) }
      })
    );
    const topics: RecommendationTopic[] = [
      { recommendationId: "r1", issue: "ptsd", metro: "Denver, CO", specificity: 0.5 }
    ];

    const cells = coverageGaps(events, topics, ["Denver, CO", "Austin, TX"], 10, 3);
    const gapCell = cells.find((c) => c.issue === "ptsd" && c.metro === "Denver, CO");
    expect(gapCell).toMatchObject({ searches: 12, recommendations: 1, gap: true });
  });
});

describe("trustHealth", () => {
  it("computes verification rate, freshness rate, and moderation latency", () => {
    const events: MetricsEvent[] = [
      event("2026-06-01", "Denver, CO", { type: "provider.created", payload: { provider_id: "p1", source: "submission" } }),
      event("2026-06-05", "Denver, CO", { type: "provider.verified", payload: { provider_id: "p1", status: "verified", source: "state_board", checked_at: "2026-06-05T00:00:00.000Z" } }),
      event("2026-06-01", "Denver, CO", { type: "provider.created", payload: { provider_id: "p2", source: "import" } }),
      event("2026-06-01", "Denver, CO", { type: "submission.flagged", payload: { recommendation_id: "r1", reasons: ["low_specificity"], tier: "tier1" } }),
      event("2026-06-04", "Denver, CO", { type: "moderation.decided", payload: { recommendation_id: "r1", action: "approve", reviewer: "bench" } })
    ];
    const recommendations: Recommendation[] = [
      {
        id: "r1",
        providerId: "p1",
        issues: ["anxiety"],
        population: "adult",
        modality: ["CBT"],
        quote: "quote",
        recommenderContext: "context",
        freshnessConfirmedAt: "2026-06-20"
      },
      {
        id: "r2",
        providerId: "p2",
        issues: ["grief"],
        population: "adult",
        modality: ["CBT"],
        quote: "quote",
        recommenderContext: "context",
        freshnessConfirmedAt: "2025-01-01"
      }
    ];

    const result = trustHealth(events, recommendations, "2026-07-05");
    expect(result.verifiedPct).toBe(50);
    expect(result.freshnessConfirmedPct).toBe(50);
    expect(result.medianModerationLatencyDays).toBe(3);
  });
});

describe("searchQuality", () => {
  it("computes matched rate, clarify rate, and crisis-gate counts without ever touching query text", () => {
    const events: MetricsEvent[] = [
      event("2026-07-01", "Denver, CO", { type: "find.performed", payload: { understood_json: understood("anxiety", 0.9), query_hash_sha256: "a".repeat(64), result_count: 2, latency_ms: 300 } }),
      event("2026-07-01", "Denver, CO", { type: "find.unmet", payload: { understood_json: understood("ocd", 0.2) } }, true)
    ];

    const result = searchQuality(events);
    expect(result.matchedRate).toBe(50);
    expect(result.clarifyRate).toBe(50);
    expect(result.crisisGateTriggers).toBe(1);
    expect(result.p95LatencyMs).toBe(300);
  });

  it("computes understood and rerank model-vs-fallback rates from typed event provenance", () => {
    const events: MetricsEvent[] = [
      event("2026-07-01", "Denver, CO", {
        type: "find.performed",
        payload: {
          understood_json: understood("anxiety", 0.9),
          query_hash_sha256: "a".repeat(64),
          result_count: 2,
          latency_ms: 300,
          understood_source: "model",
          rerank_source: "fallback"
        }
      }),
      event("2026-07-01", "Austin, TX", {
        type: "find.performed",
        payload: {
          understood_json: understood("grief", 0.9),
          query_hash_sha256: "b".repeat(64),
          result_count: 1,
          latency_ms: 350,
          understood_source: "fallback",
          rerank_source: "model"
        }
      }),
      event("2026-07-01", "Denver, CO", {
        type: "find.unmet",
        payload: { understood_json: understood("ocd", 0.9) }
      })
    ];

    const result = searchQuality(events);

    expect(result.understoodSourceRates).toEqual({
      model: 50,
      fallback: 50
    });
    expect(result.rerankSourceRates).toEqual({
      model: 50,
      fallback: 50
    });
  });
});

describe("synthetic fixture generation", () => {
  it("is deterministic and produces no raw query text, only typed event shapes", () => {
    expect(metricsEvents.length).toBeGreaterThan(0);
    expect(recommendationTopics.length).toBeGreaterThan(0);
    expect(METRICS_METROS.length).toBe(2);

    const quality = searchQuality(metricsEvents);
    expect(quality.crisisGateTriggers).toBeGreaterThanOrEqual(0);

    for (const e of metricsEvents) {
      if (e.event.type === "find.performed" || e.event.type === "find.unmet") {
        expect(typeof e.event.payload.understood_json).toBe("object");
        expect((e.event.payload as { queryText?: unknown }).queryText).toBeUndefined();
      }

      if (e.event.type === "find.performed") {
        expect(e.event.payload.understood_source).toMatch(/^(model|fallback)$/u);
        expect(e.event.payload.rerank_source).toMatch(/^(model|fallback)$/u);
      }
    }
  });
});
