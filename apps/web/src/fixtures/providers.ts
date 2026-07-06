import type { Provider } from "./types";

export const providers: Provider[] = [
  {
    id: "p1",
    name: "Maria Chen",
    credential: "LCSW",
    kind: "therapist",
    metro: "Denver, CO",
    license: { status: "verified", board: "Colorado DORA", checkedAt: "2026-06-01" }
  },
  {
    id: "p2",
    name: "Silver Pine Counseling",
    credential: "Group Practice",
    kind: "facility",
    metro: "Denver, CO",
    license: { status: "verified", board: "Colorado DORA", checkedAt: "2026-05-15" }
  },
  {
    id: "p3",
    name: "James Okafor",
    credential: "LPC",
    kind: "therapist",
    metro: "Denver, CO",
    license: { status: "verified", board: "Colorado DORA", checkedAt: "2026-04-20" }
  },
  {
    id: "p4",
    name: "Aditi Rao",
    credential: "PhD, Licensed Psychologist",
    kind: "therapist",
    metro: "Denver, CO",
    license: { status: "pending", board: "Colorado DORA", checkedAt: "2026-03-01" }
  },
  {
    id: "p5",
    name: "Rocky Mountain Family Therapy",
    credential: "Group Practice",
    kind: "facility",
    metro: "Denver, CO",
    license: { status: "verified", board: "Colorado DORA", checkedAt: "2026-06-10" }
  },
  {
    id: "p6",
    name: "Grace Whitfield",
    credential: "LMFT",
    kind: "therapist",
    metro: "Austin, TX",
    license: { status: "verified", board: "Texas HHS", checkedAt: "2026-06-20" }
  },
  {
    id: "p7",
    name: "Bluebonnet Behavioral Health",
    credential: "Treatment Center",
    kind: "facility",
    metro: "Austin, TX",
    license: { status: "verified", board: "Texas HHS", checkedAt: "2026-02-14" }
  },
  {
    id: "p8",
    name: "Marcus Webb",
    credential: "Psychiatric NP",
    kind: "therapist",
    metro: "Austin, TX",
    license: { status: "verified", board: "Texas BON", checkedAt: "2026-05-05" }
  },
  {
    id: "p9",
    name: "Dana Kim",
    credential: "LCSW",
    kind: "therapist",
    metro: "Austin, TX",
    license: { status: "pending", board: "Texas HHS", checkedAt: "2026-01-10" }
  },
  {
    id: "p10",
    name: "Hill Country Wellness Collective",
    credential: "Group Practice",
    kind: "facility",
    metro: "Austin, TX",
    license: { status: "verified", board: "Texas HHS", checkedAt: "2026-06-25" }
  }
];
