import type {
  ExtractStoryResult,
  PiiFinding,
  ScoreQualityResult,
  ScrubStoryResult
} from "../../intake/index.js";
import type {
  IntakeArtifactStoragePort,
  IntakeRecommendationSource
} from "../../jobs/ports.js";
import type { RecEnrichment } from "../../../../core/src/index.js";
import type { SqlExecutor } from "../../retrieval/pgvector.js";

interface OriginalRow {
  readonly original_story: string;
  readonly provider_name_snapshot: string;
  readonly for_whom: readonly string[];
}

interface ArtifactRow {
  readonly scrub: ScrubJson | null;
  readonly extract: ExtractJson | null;
  readonly quality: ScoreQualityResult | null;
}

interface ScrubJson {
  readonly scrubbedStory: string;
  readonly piiFindings: readonly PiiFinding[];
  readonly flags: readonly string[];
  readonly confidence: number;
  readonly source: ScrubStoryResult["source"];
  readonly promptId: ScrubStoryResult["promptId"];
}

interface ExtractJson {
  readonly enrichment: RecEnrichment;
  readonly source: ExtractStoryResult["source"];
  readonly promptId: ExtractStoryResult["promptId"];
}

// Implements IntakeArtifactStoragePort against recommendation_originals
// (restricted: original_story/for_whom, joined to recommendations for the
// provider name snapshot) and a new rec_intake_artifacts table holding the
// scrub/extract/quality JSON blobs verbatim — those results are already
// plain JSON-serializable shapes, so no relational decomposition needed.
export class PgIntakeArtifactStorage implements IntakeArtifactStoragePort {
  constructor(private readonly sql: SqlExecutor) {}

  async getRestrictedOriginalRecommendation(
    recommendationId: string
  ): Promise<IntakeRecommendationSource | undefined> {
    const result = await this.sql.query<OriginalRow>(
      `
select o.original_story, r.provider_name_snapshot, o.for_whom
from public.recommendation_originals o
join public.recommendations r on r.id = o.recommendation_id
where o.recommendation_id = $1::uuid
`.trim(),
      [recommendationId]
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return {
      story: row.original_story,
      providerName: row.provider_name_snapshot,
      forWhom: row.for_whom
    };
  }

  async saveScrubResult(
    recommendationId: string,
    result: ScrubStoryResult
  ): Promise<void> {
    await this.upsertArtifact(recommendationId, "scrub", result);
  }

  async getScrubResult(
    recommendationId: string
  ): ReturnType<IntakeArtifactStoragePort["getScrubResult"]> {
    const artifact = await this.getArtifact(recommendationId);
    const scrub = artifact?.scrub;

    if (!scrub) {
      return undefined;
    }

    return {
      scrubbedStory: scrub.scrubbedStory,
      piiFindings: scrub.piiFindings,
      flags: scrub.flags,
      source: scrub.source
    };
  }

  async saveExtractResult(
    recommendationId: string,
    result: ExtractStoryResult
  ): Promise<void> {
    await this.upsertArtifact(recommendationId, "extract", result);
  }

  async getExtractResult(
    recommendationId: string
  ): ReturnType<IntakeArtifactStoragePort["getExtractResult"]> {
    const artifact = await this.getArtifact(recommendationId);
    const extract = artifact?.extract;

    if (!extract) {
      return undefined;
    }

    return { enrichment: extract.enrichment, source: extract.source };
  }

  async saveQualityResult(
    recommendationId: string,
    result: ScoreQualityResult
  ): Promise<void> {
    await this.upsertArtifact(recommendationId, "quality", result);
  }

  async getQualityResult(
    recommendationId: string
  ): Promise<ScoreQualityResult | undefined> {
    const artifact = await this.getArtifact(recommendationId);
    return artifact?.quality ?? undefined;
  }

  private async getArtifact(
    recommendationId: string
  ): Promise<ArtifactRow | undefined> {
    const result = await this.sql.query<ArtifactRow>(
      "select scrub, extract, quality from public.rec_intake_artifacts where recommendation_id = $1::uuid",
      [recommendationId]
    );

    return result.rows[0];
  }

  private async upsertArtifact(
    recommendationId: string,
    column: "scrub" | "extract" | "quality",
    value: unknown
  ): Promise<void> {
    await this.sql.query(
      `
insert into public.rec_intake_artifacts (recommendation_id, ${column}, updated_at)
values ($1::uuid, $2::jsonb, now())
on conflict (recommendation_id) do update set
  ${column} = excluded.${column},
  updated_at = now()
`.trim(),
      [recommendationId, JSON.stringify(value)]
    );
  }
}
