import type { SqlExecutor } from "../retrieval/pgvector.js";
import type { DeletionTombstoneInput, LifecycleStoragePort } from "./ports.js";

interface StatusRow {
  readonly status: string;
}

// Implements LifecycleStoragePort against the existing recommendations /
// recommendation_originals / rec_tags / rec_embeddings /
// rec_intake_artifacts / moderation_events / events tables — no schema
// changes needed beyond 0004_data_rights_requests.sql, so this is filled in
// for real rather than left as a TODO (mirrors PgJobStorage /
// PgIntakeArtifactStorage's SqlExecutor-over-existing-tables shape).
export class PgLifecycleStorage implements LifecycleStoragePort {
  constructor(private readonly sql: SqlExecutor) {}

  async getRecommendationStatus(
    recommendationId: string
  ): Promise<string | undefined> {
    const result = await this.sql.query<StatusRow>(
      "select status from public.recommendations where id = $1::uuid",
      [recommendationId]
    );

    return result.rows[0]?.status;
  }

  async redactRecommendation(recommendationId: string, now: Date): Promise<void> {
    await this.sql.query(
      `
update public.recommendations
set status = 'removed',
    removed_at = $2,
    scrubbed_story = null,
    recommender_contact_hash = null,
    updated_at = now()
where id = $1::uuid
`.trim(),
      [recommendationId, now]
    );
  }

  async deleteOriginalStory(recommendationId: string): Promise<void> {
    await this.sql.query(
      "delete from public.recommendation_originals where recommendation_id = $1::uuid",
      [recommendationId]
    );
  }

  async deleteRecTags(recommendationId: string): Promise<void> {
    await this.sql.query(
      "delete from public.rec_tags where recommendation_id = $1::uuid",
      [recommendationId]
    );
  }

  async deleteEmbedding(recommendationId: string): Promise<void> {
    await this.sql.query(
      "delete from public.rec_embeddings where recommendation_id = $1::uuid",
      [recommendationId]
    );
  }

  async deleteIntakeArtifacts(recommendationId: string): Promise<void> {
    await this.sql.query(
      "delete from public.rec_intake_artifacts where recommendation_id = $1::uuid",
      [recommendationId]
    );
  }

  async redactModerationEventsForRecommendation(
    recommendationId: string
  ): Promise<void> {
    await this.sql.query(
      `
update public.moderation_events
set reason = null, metadata = '{}'::jsonb
where recommendation_id = $1::uuid
`.trim(),
      [recommendationId]
    );
  }

  async redactOutboxEventsForRecommendation(
    recommendationId: string
  ): Promise<void> {
    await this.sql.query(
      `
update public.events
set payload = jsonb_build_object('recommendation_id', $1::text, 'redacted', true)
where (payload ->> 'recommendation_id') = $1
   or (payload ->> 'rec_id') = $1
`.trim(),
      [recommendationId]
    );
  }

  async writeDeletionTombstone(input: DeletionTombstoneInput): Promise<void> {
    await this.sql.query(
      `
insert into public.moderation_events
  (recommendation_id, from_state, action, to_state, actor, reason, metadata, created_at, idempotency_key)
values ($1::uuid, $2, 'deleted', 'removed', 'data_rights', null, '{}'::jsonb, $3, $4)
on conflict (idempotency_key) do nothing
`.trim(),
      [
        input.recommendationId,
        input.fromState,
        input.now,
        `deletion:${input.recommendationId}`
      ]
    );
  }
}
