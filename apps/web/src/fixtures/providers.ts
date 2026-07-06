import type { Provider } from "./types";

export const providers: Provider[] = [
  {
    id: "p1",
    name: "Maria Chen",
    credential: "LCSW",
    kind: "therapist",
    metro: "Denver, CO",
    license: {
      status: "pending",
      board: "Colorado DORA",
      check: {
        status: "verified",
        source: "Colorado DORA cassette",
        evidence_url: "https://cassette.example.test/co/dora/licenses/CO-LPC-0001",
        checked_at: "2026-06-18T10:00:00.000Z"
      }
    }
  },
  {
    id: "p2",
    name: "Silver Pine Counseling",
    credential: "Group Practice",
    kind: "facility",
    metro: "Denver, CO",
    license: {
      status: "pending",
      board: "Colorado DORA",
      check: {
        status: "verified",
        source: "Colorado DORA cassette",
        evidence_url: "https://cassette.example.test/co/dora/licenses/CO-FAC-0002",
        checked_at: "2026-06-14T10:00:00.000Z"
      }
    }
  },
  {
    id: "p3",
    name: "James Okafor",
    credential: "LPC",
    kind: "therapist",
    metro: "Denver, CO",
    license: {
      status: "pending",
      board: "Colorado DORA",
      check: {
        status: "expired",
        source: "Colorado DORA cassette",
        evidence_url: "https://cassette.example.test/co/dora/licenses/CO-LPC-0003",
        checked_at: "2026-05-01T10:00:00.000Z"
      }
    }
  },
  {
    id: "p4",
    name: "Aditi Rao",
    credential: "PhD, Licensed Psychologist",
    kind: "therapist",
    metro: "Denver, CO",
    license: { status: "pending", board: "Colorado DORA" }
  },
  {
    id: "p5",
    name: "Rocky Mountain Family Therapy",
    credential: "Group Practice",
    kind: "facility",
    metro: "Denver, CO",
    license: {
      status: "pending",
      board: "Colorado DORA",
      check: {
        status: "verified",
        source: "Colorado DORA cassette",
        evidence_url: "https://cassette.example.test/co/dora/licenses/CO-FAC-0005",
        checked_at: "2026-06-10T10:00:00.000Z"
      }
    }
  },
  {
    id: "p6",
    name: "Grace Whitfield",
    credential: "LMFT",
    kind: "therapist",
    metro: "Austin, TX",
    license: {
      status: "pending",
      board: "Texas Behavioral Health",
      check: {
        status: "verified",
        source: "Texas Behavioral Health cassette",
        evidence_url: "https://cassette.example.test/tx/bhec/licenses/TX-LMFT-0006",
        checked_at: "2026-06-20T12:00:00.000Z"
      }
    }
  },
  {
    id: "p7",
    name: "Bluebonnet Behavioral Health",
    credential: "Treatment Center",
    kind: "facility",
    metro: "Austin, TX",
    license: {
      status: "pending",
      board: "Texas HHS",
      check: {
        status: "verified",
        source: "Texas Behavioral Health cassette",
        evidence_url: "https://cassette.example.test/tx/hhs/facilities/TX-FAC-0007",
        checked_at: "2026-06-16T12:00:00.000Z"
      }
    }
  },
  {
    id: "p8",
    name: "Marcus Webb",
    credential: "Psychiatric NP",
    kind: "therapist",
    metro: "Austin, TX",
    license: {
      status: "pending",
      board: "Texas BON",
      check: {
        status: "manual_review",
        source: "manual_queue",
        checked_at: "2026-05-05T12:00:00.000Z"
      }
    }
  },
  {
    id: "p9",
    name: "Dana Kim",
    credential: "LCSW",
    kind: "therapist",
    metro: "Austin, TX",
    license: { status: "pending", board: "Texas Behavioral Health" }
  },
  {
    id: "p10",
    name: "Hill Country Wellness Collective",
    credential: "Group Practice",
    kind: "facility",
    metro: "Austin, TX",
    license: {
      status: "pending",
      board: "Texas HHS",
      check: {
        status: "verified",
        source: "Texas Behavioral Health cassette",
        evidence_url: "https://cassette.example.test/tx/hhs/facilities/TX-FAC-0010",
        checked_at: "2026-06-25T12:00:00.000Z"
      }
    }
  }
];
