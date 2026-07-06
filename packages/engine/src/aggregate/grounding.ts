import type { ScrubbedStory } from "./fixtures.js";

export interface GroundedQuote {
  readonly storyId: string;
  readonly providerId: string;
  readonly text: string;
}

export interface ThemeDraft {
  readonly title: string;
  readonly quotes: readonly GroundedQuote[];
}

export interface GroundingViolation {
  readonly storyId: string;
  readonly theme: string;
  readonly reason: string;
}

export interface GroundingResult {
  readonly themes: readonly ThemeDraft[];
  readonly dropped: readonly GroundingViolation[];
}

/** GROUNDING LAW: every rendered quote must be an exact span of a real
 * scrubbed fixture story. This is the enforcement point — it runs on both
 * the deterministic fallback (defense in depth; those quotes are already
 * exact by construction) and every model-composed draft (the real risk:
 * a model can paraphrase or invent a quote). Anything that isn't a verbatim
 * substring of its claimed story is dropped, never rendered. */
export function validateGrounding(
  themes: readonly ThemeDraft[],
  stories: readonly ScrubbedStory[]
): GroundingResult {
  const storiesById = new Map(stories.map((story) => [story.id, story] as const));
  const dropped: GroundingViolation[] = [];

  const groundedThemes = themes
    .map((theme) => {
      const quotes = theme.quotes.filter((quote) => {
        const story = storiesById.get(quote.storyId);
        const isGrounded =
          story !== undefined &&
          quote.text.trim().length > 0 &&
          story.text.includes(quote.text);

        if (!isGrounded) {
          dropped.push({
            storyId: quote.storyId,
            theme: theme.title,
            reason: story
              ? "quote is not a verbatim span of the scrubbed story"
              : "quote references a story id outside this cluster"
          });
        }

        return isGrounded;
      });

      return { ...theme, quotes };
    })
    .filter((theme) => theme.quotes.length > 0);

  return { themes: groundedThemes, dropped };
}
