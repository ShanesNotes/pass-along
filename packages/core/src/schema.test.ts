import { describe, expect, test } from "vitest";
import {
  EventCatalogSchema,
  RecEnrichmentSchema,
  UnderstoodQuerySchema
} from "./schema.js";

const understoodQuery = {
  issues: [{ value: "anxiety", vocab: true, confidence: 0.94 }],
  population: "teen",
  kind: "therapist",
  preferences: {
    style: ["warm", "structured"],
    modality: [{ value: "cbt", vocab: true, confidence: 0.86 }],
    logistics: ["telehealth", "evenings"]
  },
  location: {
    text: "Chicago, IL",
    geocoded: { lat: 41.8781, lng: -87.6298 }
  },
  confidence: 0.91
} as const;

describe("UnderstoodQuerySchema", () => {
  test("accepts the §3.1 shape", () => {
    expect(() => UnderstoodQuerySchema.parse(understoodQuery)).not.toThrow();
  });

  test("rejects confidence outside 0-1", () => {
    expect(() =>
      UnderstoodQuerySchema.parse({
        ...understoodQuery,
        confidence: 1.01
      })
    ).toThrow();
  });
});

describe("RecEnrichmentSchema", () => {
  test("accepts the §3.2 shape", () => {
    expect(() =>
      RecEnrichmentSchema.parse({
        tags: [
          {
            type: "issue",
            value: "anxiety",
            vocab: true,
            confidence: 0.92
          },
          {
            type: "style",
            value: "direct",
            vocab: false,
            confidence: 0.62
          }
        ],
        keystone_quote: {
          text: "She gave me practical steps I could use that week.",
          start: 12,
          end: 62
        },
        duration_hint: "about six months",
        pii_findings: [
          {
            span: [80, 91],
            kind: "person",
            replacement: "a friend"
          }
        ],
        quality: {
          specificity: 0.83,
          lived_experience: 0.91,
          ad_smell: 0.05,
          dup_similarity: 0.12
        }
      })
    ).not.toThrow();
  });

  test("rejects invalid spans", () => {
    expect(() =>
      RecEnrichmentSchema.parse({
        tags: [],
        keystone_quote: { text: "short quote", start: 10, end: 4 },
        pii_findings: [],
        quality: {
          specificity: 0.5,
          lived_experience: 0.5,
          ad_smell: 0.5,
          dup_similarity: 0.5
        }
      })
    ).toThrow();
  });
});

describe("EventCatalogSchema", () => {
  test("accepts all nine catalog event types", () => {
    const events = [
      {
        type: "submission.received",
        payload: { recommendation_id: "rec_1" }
      },
      {
        type: "submission.published",
        payload: { recommendation_id: "rec_1" }
      },
      {
        type: "submission.flagged",
        payload: {
          recommendation_id: "rec_1",
          reasons: ["pii_heavy"],
          tier: "moderation"
        }
      },
      {
        type: "provider.created",
        payload: { provider_id: "provider_1", source: "submission" }
      },
      {
        type: "provider.verified",
        payload: {
          provider_id: "provider_1",
          status: "verified",
          source: "state_board",
          checked_at: "2026-07-06T12:00:00.000Z"
        }
      },
      {
        type: "find.performed",
        payload: {
          understood_json: understoodQuery,
          query_hash_sha256:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          result_count: 4,
          latency_ms: 182
        }
      },
      { type: "find.unmet", payload: { understood_json: understoodQuery } },
      {
        type: "followup.answered",
        payload: { rec_id: "rec_1", response: "still accepting clients" }
      },
      {
        type: "moderation.decided",
        payload: {
          recommendation_id: "rec_1",
          action: "approve",
          reviewer: "reviewer_1"
        }
      }
    ];

    for (const event of events) {
      expect(() => EventCatalogSchema.parse(event)).not.toThrow();
    }
  });

  test("rejects extra raw-query-shaped fields on find.performed", () => {
    expect(() =>
      EventCatalogSchema.parse({
        type: "find.performed",
        payload: {
          understood_json: understoodQuery,
          query_hash_sha256:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          result_count: 4,
          latency_ms: 182,
          raw_query: "free-form text must not ride this event"
        }
      })
    ).toThrow();
  });
});
