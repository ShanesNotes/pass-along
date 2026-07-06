/** Demo scrubbed stories for the aggregation slice (L4-S2). These stand in for
 * real published, PII-scrubbed recommendation text — no fs reads, no network,
 * just a static module, consistent with the rest of the prompt/engine layer.
 * Every `keystone` value is hand-verified to be an exact substring of `text`
 * (see fixtures.test.ts) so the deterministic fallback path is grounded by
 * construction; the model path is still checked by grounding.ts. */
export interface ScrubbedStory {
  readonly id: string;
  readonly providerId: string;
  readonly issue: string;
  readonly metro: string;
  readonly cooccurringTags: readonly string[];
  readonly text: string;
  readonly keystone: string;
}

export const SCRUBBED_STORIES: readonly ScrubbedStory[] = [
  {
    id: "story_anx_denver_1",
    providerId: "p1",
    issue: "anxiety",
    metro: "Denver, CO",
    cooccurringTags: ["cbt", "telehealth"],
    text:
      "I'd tried therapy before and always quit after a session or two. Maria gave me a CBT worksheet I actually kept using on the bus during panic spikes, not just in her office. Telehealth sessions meant I never had to find parking downtown before a hard week.",
    keystone: "a CBT worksheet I actually kept using on the bus during panic spikes"
  },
  {
    id: "story_anx_denver_2",
    providerId: "p3",
    issue: "anxiety",
    metro: "Denver, CO",
    cooccurringTags: ["cbt", "evenings"],
    text:
      "James starts every session on time and never once made me feel rushed. We built a CBT plan for the evenings when my anxiety spikes hardest, right after my kids go to bed. It's the first plan that survived past week two.",
    keystone: "a CBT plan for the evenings when my anxiety spikes hardest"
  },
  {
    id: "story_anx_denver_3",
    providerId: "p4",
    issue: "anxiety",
    metro: "Denver, CO",
    cooccurringTags: ["telehealth", "new_parent"],
    text:
      "Aditi saw me over telehealth within four days of my daughter being born, when every in-person office had a two month wait. She never once treated my new-parent anxiety like something to be embarrassed about.",
    keystone: "saw me over telehealth within four days of my daughter being born"
  },
  {
    id: "story_anx_denver_4",
    providerId: "p1",
    issue: "anxiety",
    metro: "Denver, CO",
    cooccurringTags: ["cbt", "new_parent"],
    text:
      "Maria's CBT approach again, but this time for the anxiety that showed up after we brought our son home. She gave us a plan we could actually use at 3am instead of a pamphlet.",
    keystone: "a plan we could actually use at 3am instead of a pamphlet"
  },
  {
    id: "story_grief_austin_1",
    providerId: "p6",
    issue: "grief",
    metro: "Austin, TX",
    cooccurringTags: ["group_support", "spouse_loss"],
    text:
      "Grace let me talk about my husband in the present tense for as long as I needed, no clock-watching. The Tuesday grief group she runs became the only place I didn't have to perform being fine.",
    keystone: "The Tuesday grief group she runs became the only place I didn't have to perform being fine"
  },
  {
    id: "story_grief_austin_2",
    providerId: "p9",
    issue: "grief",
    metro: "Austin, TX",
    cooccurringTags: ["sliding_scale", "group_support"],
    text:
      "Dana's sliding scale meant I could keep coming every week instead of stretching sessions out to once a month like I did with my last two therapists. The grief group she referred me to met on Thursdays.",
    keystone: "Dana's sliding scale meant I could keep coming every week"
  },
  {
    id: "story_grief_austin_3",
    providerId: "p10",
    issue: "grief",
    metro: "Austin, TX",
    cooccurringTags: ["group_support"],
    text:
      "Hill Country's grief group runs every week and nobody there ever tells you it's been long enough. Three different facilitators, all trained the same way, so it never falls apart when one is out.",
    keystone: "nobody there ever tells you it's been long enough"
  },
  {
    id: "story_grief_austin_4",
    providerId: "p6",
    issue: "grief",
    metro: "Austin, TX",
    cooccurringTags: ["telehealth", "spouse_loss"],
    text:
      "Grace again, but over telehealth this time since I moved out of state right after my husband died. She was the only therapist willing to keep seeing me across state lines for grief work specifically.",
    keystone: "the only therapist willing to keep seeing me across state lines"
  }
];

export function storiesForCluster(
  issue: string,
  metro: string
): readonly ScrubbedStory[] {
  return SCRUBBED_STORIES.filter(
    (story) => story.issue === issue && story.metro === metro
  );
}
