import { z } from "zod";
import { POPULATION_TERMS } from "./taxonomy.js";

export const ConfidenceSchema = z.number().min(0).max(1);

export const TaxonomyTagSchema = z
  .object({
    value: z.string().min(1),
    vocab: z.boolean(),
    confidence: ConfidenceSchema
  })
  .strict();

export const PopulationSchema = z.enum(POPULATION_TERMS);

export const LogisticsPreferenceSchema = z.enum([
  "telehealth",
  "insurance",
  "sliding_scale",
  "evenings"
]);

export const LatLngSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  })
  .strict();

export const UnderstoodQuerySchema = z
  .object({
    issues: z.array(TaxonomyTagSchema),
    population: PopulationSchema.optional(),
    kind: z.enum(["therapist", "facility", "either"]),
    preferences: z
      .object({
        style: z.array(z.string().min(1)).optional(),
        modality: z.array(TaxonomyTagSchema).optional(),
        logistics: z.array(LogisticsPreferenceSchema).optional()
      })
      .strict(),
    location: z
      .object({
        text: z.string().min(1),
        geocoded: LatLngSchema.optional()
      })
      .strict()
      .optional(),
    confidence: ConfidenceSchema
  })
  .strict();

export const RecTagTypeSchema = z.enum([
  "issue",
  "population",
  "modality",
  "style",
  "logistics",
  "outcome"
]);

export const RecEnrichmentTagSchema = z
  .object({
    type: RecTagTypeSchema,
    value: z.string().min(1),
    vocab: z.boolean(),
    confidence: ConfidenceSchema
  })
  .strict();

export const SpanSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([start, end]) => end >= start, {
    message: "span end must be greater than or equal to start"
  });

export const RecEnrichmentSchema = z
  .object({
    tags: z.array(RecEnrichmentTagSchema),
    keystone_quote: z
      .object({
        text: z.string().min(1),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative()
      })
      .strict()
      .refine((quote) => quote.end >= quote.start, {
        message: "keystone_quote end must be greater than or equal to start"
      }),
    duration_hint: z.string().min(1).optional(),
    pii_findings: z.array(
      z
        .object({
          span: SpanSchema,
          kind: z.enum(["person", "org", "date", "place"]),
          replacement: z.string().min(1)
        })
        .strict()
    ),
    quality: z
      .object({
        specificity: ConfidenceSchema,
        lived_experience: ConfidenceSchema,
        ad_smell: ConfidenceSchema,
        dup_similarity: ConfidenceSchema
      })
      .strict()
  })
  .strict();

const EntityIdSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const SubmissionReceivedEventSchema = z
  .object({
    type: z.literal("submission.received"),
    payload: z
      .object({
        recommendation_id: EntityIdSchema
      })
      .strict()
  })
  .strict();

export const SubmissionPublishedEventSchema = z
  .object({
    type: z.literal("submission.published"),
    payload: z
      .object({
        recommendation_id: EntityIdSchema
      })
      .strict()
  })
  .strict();

export const SubmissionFlaggedEventSchema = z
  .object({
    type: z.literal("submission.flagged"),
    payload: z
      .object({
        recommendation_id: EntityIdSchema,
        reasons: z.array(z.string().min(1)),
        tier: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const ProviderCreatedEventSchema = z
  .object({
    type: z.literal("provider.created"),
    payload: z
      .object({
        provider_id: EntityIdSchema,
        source: z.enum(["submission", "import"])
      })
      .strict()
  })
  .strict();

export const ProviderVerifiedEventSchema = z
  .object({
    type: z.literal("provider.verified"),
    payload: z
      .object({
        provider_id: EntityIdSchema,
        status: z.enum([
          "verified",
          "not_found",
          "expired",
          "manual_review",
          "error"
        ]),
        source: z.string().min(1),
        checked_at: z.string().datetime()
      })
      .strict()
  })
  .strict();

export const FindPerformedEventSchema = z
  .object({
    type: z.literal("find.performed"),
    payload: z
      .object({
        understood_json: UnderstoodQuerySchema,
        query_hash_sha256: Sha256Schema,
        result_count: z.number().int().nonnegative(),
        latency_ms: z.number().int().nonnegative(),
        degraded: z.boolean().optional(),
        understood_source: z.enum(["model", "fallback"]).optional()
      })
      .strict()
  })
  .strict();

export const FindUnmetEventSchema = z
  .object({
    type: z.literal("find.unmet"),
    payload: z
      .object({
        understood_json: UnderstoodQuerySchema
      })
      .strict()
  })
  .strict();

export const FollowupAnsweredEventSchema = z
  .object({
    type: z.literal("followup.answered"),
    payload: z
      .object({
        rec_id: EntityIdSchema,
        response: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const ModerationDecidedEventSchema = z
  .object({
    type: z.literal("moderation.decided"),
    payload: z
      .object({
        recommendation_id: EntityIdSchema,
        action: z.enum(["approve", "reject", "edit_approve", "remove"]),
        reviewer: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const EventCatalogSchema = z.discriminatedUnion("type", [
  SubmissionReceivedEventSchema,
  SubmissionPublishedEventSchema,
  SubmissionFlaggedEventSchema,
  ProviderCreatedEventSchema,
  ProviderVerifiedEventSchema,
  FindPerformedEventSchema,
  FindUnmetEventSchema,
  FollowupAnsweredEventSchema,
  ModerationDecidedEventSchema
]);

export type TaxonomyTag = z.infer<typeof TaxonomyTagSchema>;
export type Population = z.infer<typeof PopulationSchema>;
export type LogisticsPreference = z.infer<typeof LogisticsPreferenceSchema>;
export type LatLng = z.infer<typeof LatLngSchema>;
export type UnderstoodQuery = z.infer<typeof UnderstoodQuerySchema>;
export type RecTagType = z.infer<typeof RecTagTypeSchema>;
export type RecEnrichmentTag = z.infer<typeof RecEnrichmentTagSchema>;
export type RecEnrichment = z.infer<typeof RecEnrichmentSchema>;
export type EventCatalog = z.infer<typeof EventCatalogSchema>;
