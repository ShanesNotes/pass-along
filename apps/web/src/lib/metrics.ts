import type { MetricsEvent, RecommendationTopic } from "../fixtures/metricsEvents";
import type { Metro } from "../fixtures/types";
import type { Recommendation } from "../fixtures/types";

export interface CorpusGrowthPoint {
  date: string;
  cumulative: number;
}

export interface CorpusGrowth {
  series: CorpusGrowthPoint[];
  total: number;
  thisMonth: number;
  medianSpecificity: number;
}

export interface DemandSupplyRow {
  issue: string;
  demandCount: number;
  supplyCount: number;
  unmet: boolean;
}

export interface CoverageCell {
  issue: string;
  metro: Metro;
  searches: number;
  recommendations: number;
  gap: boolean;
}

export interface TrustHealth {
  verifiedPct: number;
  freshnessConfirmedPct: number;
  medianModerationLatencyDays: number | undefined;
}

export interface SearchQuality {
  matchedRate: number;
  clarifyRate: number;
  crisisGateTriggers: number;
  p95LatencyMs: number | undefined;
  understoodSourceRates: SourceRates;
  rerankSourceRates: SourceRates;
}

export interface SourceRates {
  model: number;
  fallback: number;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function corpusGrowth(
  topics: RecommendationTopic[],
  events: MetricsEvent[],
  anchorMonth: string
): CorpusGrowth {
  const publishedDates = events
    .filter((e) => e.event.type === "submission.published")
    .map((e) => e.occurredAt)
    .sort();

  let cumulative = 0;
  const byDate = new Map<string, number>();
  for (const date of publishedDates) {
    cumulative += 1;
    byDate.set(date, cumulative);
  }
  const series = [...byDate.entries()].map(([date, value]) => ({ date, cumulative: value }));

  const thisMonth = publishedDates.filter((date) => monthKey(date) === anchorMonth).length;
  const medianSpecificity = median(topics.map((t) => t.specificity)) ?? 0;

  return {
    series,
    total: publishedDates.length,
    thisMonth,
    medianSpecificity
  };
}

export function demandVsSupply(
  events: MetricsEvent[],
  topics: RecommendationTopic[],
  limit = 8
): DemandSupplyRow[] {
  const demand = new Map<string, number>();
  for (const e of events) {
    if (e.event.type === "find.performed" || e.event.type === "find.unmet") {
      const issue = e.event.payload.understood_json.issues[0]?.value;
      if (issue) demand.set(issue, (demand.get(issue) ?? 0) + 1);
    }
  }

  const supply = new Map<string, number>();
  for (const topic of topics) {
    supply.set(topic.issue, (supply.get(topic.issue) ?? 0) + 1);
  }

  return [...demand.entries()]
    .map(([issue, demandCount]) => {
      const supplyCount = supply.get(issue) ?? 0;
      return { issue, demandCount, supplyCount, unmet: supplyCount === 0 };
    })
    .sort((a, b) => b.demandCount - a.demandCount)
    .slice(0, limit);
}

export function coverageGaps(
  events: MetricsEvent[],
  topics: RecommendationTopic[],
  metros: readonly Metro[],
  searchThreshold = 10,
  recThreshold = 3
): CoverageCell[] {
  const searches = new Map<string, number>();
  for (const e of events) {
    if (e.event.type === "find.performed" || e.event.type === "find.unmet") {
      const issue = e.event.payload.understood_json.issues[0]?.value;
      if (!issue) continue;
      const key = `${issue}|${e.metro}`;
      searches.set(key, (searches.get(key) ?? 0) + 1);
    }
  }

  const recs = new Map<string, number>();
  for (const topic of topics) {
    const key = `${topic.issue}|${topic.metro}`;
    recs.set(key, (recs.get(key) ?? 0) + 1);
  }

  const issues = [...new Set([...searches.keys(), ...recs.keys()].map((key) => key.split("|")[0] as string))];

  const cells: CoverageCell[] = [];
  for (const issue of issues) {
    for (const metro of metros) {
      const key = `${issue}|${metro}`;
      const searchCount = searches.get(key) ?? 0;
      const recCount = recs.get(key) ?? 0;
      cells.push({
        issue,
        metro,
        searches: searchCount,
        recommendations: recCount,
        gap: searchCount > searchThreshold && recCount < recThreshold
      });
    }
  }

  return cells;
}

export function trustHealth(
  events: MetricsEvent[],
  recommendations: Recommendation[],
  anchorDate: string
): TrustHealth {
  const createdProviders = new Set(
    events
      .filter((e) => e.event.type === "provider.created")
      .map((e) => (e.event.type === "provider.created" ? e.event.payload.provider_id : ""))
  );
  const verifiedProviders = new Set(
    events
      .filter((e) => e.event.type === "provider.verified" && e.event.payload.status === "verified")
      .map((e) => (e.event.type === "provider.verified" ? e.event.payload.provider_id : ""))
  );
  const verifiedPct =
    createdProviders.size === 0 ? 0 : (verifiedProviders.size / createdProviders.size) * 100;

  const quarterAgo = new Date(anchorDate);
  quarterAgo.setUTCDate(quarterAgo.getUTCDate() - 90);
  const freshCount = recommendations.filter(
    (rec) => new Date(rec.freshnessConfirmedAt) >= quarterAgo
  ).length;
  const freshnessConfirmedPct =
    recommendations.length === 0 ? 0 : (freshCount / recommendations.length) * 100;

  const flaggedAt = new Map<string, string>();
  const decidedAt = new Map<string, string>();
  for (const e of events) {
    if (e.event.type === "submission.flagged") {
      flaggedAt.set(e.event.payload.recommendation_id, e.occurredAt);
    }
    if (e.event.type === "moderation.decided") {
      decidedAt.set(e.event.payload.recommendation_id, e.occurredAt);
    }
  }
  const latencies: number[] = [];
  for (const [recId, flaggedDate] of flaggedAt) {
    const decidedDate = decidedAt.get(recId);
    if (!decidedDate) continue;
    const days = (new Date(decidedDate).getTime() - new Date(flaggedDate).getTime()) / 86_400_000;
    latencies.push(days);
  }

  return {
    verifiedPct,
    freshnessConfirmedPct,
    medianModerationLatencyDays: median(latencies)
  };
}

const CLARIFY_CONFIDENCE_THRESHOLD = 0.5;

function isFindEvent(
  e: MetricsEvent
): e is MetricsEvent & { event: Extract<MetricsEvent["event"], { type: "find.performed" | "find.unmet" }> } {
  return e.event.type === "find.performed" || e.event.type === "find.unmet";
}

export function searchQuality(events: MetricsEvent[]): SearchQuality {
  const findEvents = events.filter(isFindEvent);
  const performedEvents = events.filter(
    (e): e is MetricsEvent & { event: Extract<MetricsEvent["event"], { type: "find.performed" }> } =>
      e.event.type === "find.performed"
  );
  const matched = findEvents.filter((e) => e.event.type === "find.performed").length;
  const matchedRate = findEvents.length === 0 ? 0 : (matched / findEvents.length) * 100;

  const clarify = findEvents.filter(
    (e) => e.event.payload.understood_json.confidence < CLARIFY_CONFIDENCE_THRESHOLD
  ).length;
  const clarifyRate = findEvents.length === 0 ? 0 : (clarify / findEvents.length) * 100;

  const crisisGateTriggers = events.filter((e) => e.crisisTriggered === true).length;

  const latencies = performedEvents.map((e) => e.event.payload.latency_ms);

  return {
    matchedRate,
    clarifyRate,
    crisisGateTriggers,
    p95LatencyMs: percentile(latencies, 95),
    understoodSourceRates: sourceRates(
      performedEvents.map((e) => e.event.payload.understood_source)
    ),
    rerankSourceRates: sourceRates(
      performedEvents.map((e) => e.event.payload.rerank_source)
    )
  };
}

function sourceRates(
  values: readonly ("model" | "fallback" | undefined)[]
): SourceRates {
  const known = values.filter(
    (value): value is "model" | "fallback" =>
      value === "model" || value === "fallback"
  );

  if (known.length === 0) {
    return { model: 0, fallback: 0 };
  }

  const model = known.filter((value) => value === "model").length;
  const fallback = known.length - model;

  return {
    model: (model / known.length) * 100,
    fallback: (fallback / known.length) * 100
  };
}
