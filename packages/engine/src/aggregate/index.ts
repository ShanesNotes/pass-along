import { complete, type CompleteOptions } from "../llm/adapter.js";
import { AGGREGATE_1_PROMPT } from "../../../prompts/src/aggregate1.js";
import { storiesForCluster, type ScrubbedStory } from "./fixtures.js";
import {
  validateGrounding,
  type GroundedQuote,
  type ThemeDraft
} from "./grounding.js";

export const AGGREGATE_PROMPT_ID = "aggregate@1";
export const AGGREGATE_MIN_STORIES = 3;

export type AggregateSource = "model" | "fallback";
export type AggregateWarn = (
  event: "aggregate.title_grounding_replaced",
  fields: {
    readonly replaced_headline_count: number;
    readonly replaced_theme_title_count: number;
  }
) => void;

export interface ProviderMention {
  readonly providerId: string;
  readonly storyCount: number;
}

export interface AggregatePageDraft {
  readonly issue: string;
  readonly metro: string;
  readonly headline: string;
  readonly themes: readonly ThemeDraft[];
  readonly providers: readonly ProviderMention[];
  readonly source: AggregateSource;
}

export interface AggregatePageOptions
  extends Pick<
    CompleteOptions,
    | "env"
    | "transport"
    | "timeoutMs"
    | "maxRetries"
    | "backoffBaseMs"
    | "inference_geo"
    | "sleep"
  > {
  readonly warn?: AggregateWarn;
}

/** For an issue x metro cluster with at least AGGREGATE_MIN_STORIES stories,
 * compose a page draft: a headline, 2-3 themes each grounded in verbatim
 * quote spans, and the contributing providers. Returns undefined below the
 * threshold — callers (the what-helped route) should 404 in that case. */
export async function composeAggregatePage(
  issue: string,
  metro: string,
  stories: readonly ScrubbedStory[] = storiesForCluster(issue, metro),
  options: AggregatePageOptions = {}
): Promise<AggregatePageDraft | undefined> {
  const cluster = stories.filter(
    (story) => story.issue === issue && story.metro === metro
  );

  if (cluster.length < AGGREGATE_MIN_STORIES) {
    return undefined;
  }

  const modeled = await modelComposeAggregatePage(
    issue,
    metro,
    cluster,
    options
  ).catch(() => undefined);

  return modeled ?? fallbackComposeAggregatePage(issue, metro, cluster);
}

export function fallbackComposeAggregatePage(
  issue: string,
  metro: string,
  cluster: readonly ScrubbedStory[]
): AggregatePageDraft {
  const storiesByTag = new Map<string, ScrubbedStory[]>();

  for (const story of cluster) {
    for (const tagValue of story.cooccurringTags) {
      const list = storiesByTag.get(tagValue) ?? [];
      list.push(story);
      storiesByTag.set(tagValue, list);
    }
  }

  const rankedTags = [...storiesByTag.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort(([leftTag, leftList], [rightTag, rightList]) => {
      const byCount = rightList.length - leftList.length;
      return byCount === 0 ? leftTag.localeCompare(rightTag) : byCount;
    })
    .slice(0, 3);

  const themeSource: ReadonlyArray<readonly [string, readonly ScrubbedStory[]]> =
    rankedTags.length > 0 ? rankedTags : [["shared experiences", cluster]];

  const themes: ThemeDraft[] = themeSource.map(([tagValue, list]) => ({
    title: themeTitleForTag(tagValue),
    quotes: list.map((story) => ({
      storyId: story.id,
      providerId: story.providerId,
      text: story.keystone
    }))
  }));

  const grounded = validateGrounding(themes, cluster);

  return {
    issue,
    metro,
    headline: aggregateHeadline(issue, metro),
    themes: grounded.themes,
    providers: providerMentions(cluster),
    source: "fallback"
  };
}

async function modelComposeAggregatePage(
  issue: string,
  metro: string,
  cluster: readonly ScrubbedStory[],
  options: AggregatePageOptions
): Promise<AggregatePageDraft | undefined> {
  const completion = await complete(
    AGGREGATE_PROMPT_ID,
    {
      system: AGGREGATE_1_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            issue,
            metro,
            stories: cluster.map((story) => ({ id: story.id, text: story.text }))
          })
        }
      ]
    },
    options
  );

  const parsed = parseAggregateResponse(completion.text);

  if (!parsed) {
    return undefined;
  }

  const storiesById = new Map(cluster.map((story) => [story.id, story] as const));
  const rawThemes: ThemeDraft[] = parsed.themes.map((theme) => ({
    title: theme.title,
    quotes: theme.quotes
      .map((quote): GroundedQuote | undefined => {
        const story = storiesById.get(quote.storyId);
        return story
          ? { storyId: story.id, providerId: story.providerId, text: quote.text }
          : undefined;
      })
      .filter((quote): quote is GroundedQuote => quote !== undefined)
  }));

  const grounded = validateGrounding(rawThemes, cluster);

  if (grounded.themes.length === 0) {
    return undefined;
  }
  const titled = groundedAggregateCopy({
    issue,
    metro,
    parsedHeadline: parsed.headline,
    themes: grounded.themes,
    cluster
  });

  if (
    options.warn &&
    (titled.replacedHeadlineCount > 0 || titled.replacedThemeTitleCount > 0)
  ) {
    options.warn("aggregate.title_grounding_replaced", {
      replaced_headline_count: titled.replacedHeadlineCount,
      replaced_theme_title_count: titled.replacedThemeTitleCount
    });
  }

  return {
    issue,
    metro,
    headline: titled.headline,
    themes: titled.themes,
    providers: providerMentions(cluster),
    source: "model"
  };
}

function groundedAggregateCopy(input: {
  readonly issue: string;
  readonly metro: string;
  readonly parsedHeadline: string;
  readonly themes: readonly ThemeDraft[];
  readonly cluster: readonly ScrubbedStory[];
}): {
  readonly headline: string;
  readonly themes: readonly ThemeDraft[];
  readonly replacedHeadlineCount: number;
  readonly replacedThemeTitleCount: number;
} {
  const storiesById = new Map(input.cluster.map((story) => [story.id, story]));
  const headline = aggregateHeadline(input.issue, input.metro);
  let replacedThemeTitleCount = 0;
  const themes = input.themes.map((theme) => {
    const tags = [
      ...uniqueStrings(
        theme.quotes.flatMap(
          (quote) => storiesById.get(quote.storyId)?.cooccurringTags ?? []
        )
      )
    ].sort();
    const allowedTitles = tags.map(themeTitleForTag);
    const title = allowedTitles.includes(theme.title)
      ? theme.title
      : allowedTitles[0] ?? themeTitleForTag("shared experiences");

    if (title !== theme.title) {
      replacedThemeTitleCount += 1;
    }

    return { ...theme, title };
  });

  return {
    headline,
    themes,
    replacedHeadlineCount: input.parsedHeadline === headline ? 0 : 1,
    replacedThemeTitleCount
  };
}

function providerMentions(
  cluster: readonly ScrubbedStory[]
): readonly ProviderMention[] {
  const counts = new Map<string, number>();

  for (const story of cluster) {
    counts.set(story.providerId, (counts.get(story.providerId) ?? 0) + 1);
  }

  return [...counts.entries()].map(([providerId, storyCount]) => ({
    providerId,
    storyCount
  }));
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function aggregateHeadline(issue: string, metro: string): string {
  return `What helped people with ${humanize(issue)} in ${metro}`;
}

function themeTitleForTag(tag: string): string {
  return `What people said about ${humanize(tag)}`;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

interface ParsedAggregateResponse {
  readonly headline: string;
  readonly themes: ReadonlyArray<{
    readonly title: string;
    readonly quotes: ReadonlyArray<{ readonly storyId: string; readonly text: string }>;
  }>;
}

function parseAggregateResponse(text: string): ParsedAggregateResponse | undefined {
  const parsed = parseJsonObject(text);
  const record = asRecord(parsed);

  if (!record) {
    return undefined;
  }

  const headline = record.headline;
  const themes = record.themes;

  if (typeof headline !== "string" || headline.length === 0 || !Array.isArray(themes)) {
    return undefined;
  }

  const parsedThemes = themes
    .map(parseThemeEntry)
    .filter((theme): theme is ParsedAggregateResponse["themes"][number] => theme !== undefined);

  if (parsedThemes.length === 0) {
    return undefined;
  }

  return { headline, themes: parsedThemes };
}

function parseThemeEntry(
  value: unknown
): ParsedAggregateResponse["themes"][number] | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const title = record.title;
  const quotes = record.quotes;

  if (typeof title !== "string" || title.length === 0 || !Array.isArray(quotes)) {
    return undefined;
  }

  const parsedQuotes = quotes
    .map(parseQuoteEntry)
    .filter(
      (quote): quote is { readonly storyId: string; readonly text: string } =>
        quote !== undefined
    );

  return parsedQuotes.length > 0 ? { title, quotes: parsedQuotes } : undefined;
}

function parseQuoteEntry(
  value: unknown
): { readonly storyId: string; readonly text: string } | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const storyId = record.story_id;
  const text = record.text;

  if (typeof storyId !== "string" || storyId.length === 0) {
    return undefined;
  }

  if (typeof text !== "string" || text.length === 0) {
    return undefined;
  }

  return { storyId, text };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

export type { ScrubbedStory } from "./fixtures.js";
export { storiesForCluster } from "./fixtures.js";
export type { GroundedQuote, ThemeDraft } from "./grounding.js";
