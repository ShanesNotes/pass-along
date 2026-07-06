import coloradoDoraCassette from "./cassettes/colorado-dora.json" with { type: "json" };
import michiganManualReviewCassette from "./cassettes/michigan-manual-review.json" with { type: "json" };
import texasBehavioralHealthCassette from "./cassettes/texas-behavioral-health.json" with { type: "json" };

export type LicenseVerificationStatus =
  | "verified"
  | "not_found"
  | "expired"
  | "manual_review";

export interface LicenseCheckRecord {
  readonly status: LicenseVerificationStatus;
  readonly source: string;
  readonly evidence_url?: string;
  readonly checked_at: string;
}

export interface LicenseVerificationProvider {
  readonly id: string;
  readonly name: string;
  readonly credential: string;
  readonly state: string;
  readonly licenseNumber?: string;
}

export interface LicenseVerificationClock {
  now(): Date;
}

/**
 * Adapter seam for state-board license checks.
 *
 * This packet intentionally performs no live scraping or board API calls. Live
 * adapters that replace the cassettes must be polite by construction: bounded
 * concurrency, board-specific rate limits, read-through caching keyed by
 * license number/provider identity, and durable `checked_at` timestamps so the
 * future cron can recheck oldest records first instead of hammering boards.
 */
export interface LicenseVerificationAdapter {
  readonly name: string;
  verifyLicense(
    provider: LicenseVerificationProvider
  ): Promise<LicenseCheckRecord | undefined>;
}

export interface VerifyLicenseOptions {
  readonly adapters?: readonly LicenseVerificationAdapter[];
  readonly now?: () => Date;
}

export interface RecordedCassetteAdapterOptions {
  readonly cassettes?: readonly RecordedBoardCassette[];
  readonly now?: () => Date;
}

export interface ManualQueueAdapterOptions {
  readonly now?: () => Date;
}

export interface LicenseRecheckCandidate {
  readonly providerId: string;
  readonly check?: LicenseCheckRecord;
}

type RecordedBoardCassette = {
  readonly state: string;
  readonly source: string;
  readonly responses: readonly RecordedHttpResponse[];
};

type RecordedHttpResponse = {
  readonly provider_id: string;
  readonly license_number?: string;
  readonly status_code: number;
  readonly body: {
    readonly result: "active" | "not_found" | "expired" | "manual_review";
    readonly evidence_url?: string;
    readonly checked_at?: string;
  };
};

const DEFAULT_CASSETTES: readonly RecordedBoardCassette[] = [
  assertCassette(coloradoDoraCassette),
  assertCassette(texasBehavioralHealthCassette),
  assertCassette(michiganManualReviewCassette)
];

const DEFAULT_NOW = () => new Date();
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const FIXTURE_LICENSE_CHECKS: Readonly<Record<string, LicenseCheckRecord>> = {
  provider_teen_denver: {
    status: "verified",
    source: "Colorado DORA cassette",
    evidence_url: "https://cassette.example.test/co/dora/licenses/CO-LPC-0001",
    checked_at: "2026-06-18T10:00:00.000Z"
  },
  provider_postpartum_austin: {
    status: "verified",
    source: "Texas Behavioral Health cassette",
    evidence_url: "https://cassette.example.test/tx/bhec/licenses/TX-LCSW-0200",
    checked_at: "2026-06-20T12:00:00.000Z"
  },
  provider_emdr_austin: {
    status: "verified",
    source: "Texas Behavioral Health cassette",
    evidence_url: "https://cassette.example.test/tx/hhs/facilities/TX-FAC-0300",
    checked_at: "2026-06-16T12:00:00.000Z"
  },
  provider_family_denver: {
    status: "verified",
    source: "Colorado DORA cassette",
    evidence_url: "https://cassette.example.test/co/dora/licenses/CO-LMFT-0010",
    checked_at: "2026-06-12T10:00:00.000Z"
  },
  provider_ocd_denver: {
    status: "verified",
    source: "Colorado DORA cassette",
    evidence_url: "https://cassette.example.test/co/dora/licenses/CO-PSY-0080",
    checked_at: "2026-06-09T10:00:00.000Z"
  },
  p1: {
    status: "verified",
    source: "Colorado DORA cassette",
    evidence_url: "https://cassette.example.test/co/dora/licenses/CO-LPC-0001",
    checked_at: "2026-06-18T10:00:00.000Z"
  },
  p2: {
    status: "verified",
    source: "Colorado DORA cassette",
    evidence_url: "https://cassette.example.test/co/dora/licenses/CO-FAC-0002",
    checked_at: "2026-06-14T10:00:00.000Z"
  },
  p3: {
    status: "expired",
    source: "Colorado DORA cassette",
    evidence_url: "https://cassette.example.test/co/dora/licenses/CO-LPC-0003",
    checked_at: "2026-05-01T10:00:00.000Z"
  },
  p5: {
    status: "verified",
    source: "Colorado DORA cassette",
    evidence_url: "https://cassette.example.test/co/dora/licenses/CO-FAC-0005",
    checked_at: "2026-06-10T10:00:00.000Z"
  },
  p6: {
    status: "verified",
    source: "Texas Behavioral Health cassette",
    evidence_url: "https://cassette.example.test/tx/bhec/licenses/TX-LMFT-0006",
    checked_at: "2026-06-20T12:00:00.000Z"
  },
  p7: {
    status: "verified",
    source: "Texas Behavioral Health cassette",
    evidence_url: "https://cassette.example.test/tx/hhs/facilities/TX-FAC-0007",
    checked_at: "2026-06-16T12:00:00.000Z"
  },
  p8: {
    status: "manual_review",
    source: "manual_queue",
    checked_at: "2026-05-05T12:00:00.000Z"
  },
  p10: {
    status: "verified",
    source: "Texas Behavioral Health cassette",
    evidence_url: "https://cassette.example.test/tx/hhs/facilities/TX-FAC-0010",
    checked_at: "2026-06-25T12:00:00.000Z"
  }
};

export async function verifyLicense(
  provider: LicenseVerificationProvider,
  options: VerifyLicenseOptions = {}
): Promise<LicenseCheckRecord> {
  const now = options.now ?? DEFAULT_NOW;
  const adapters = options.adapters ?? [
    createRecordedCassetteLicenseAdapter({ now }),
    createManualQueueLicenseAdapter({ now })
  ];

  for (const adapter of adapters) {
    const result = await adapter.verifyLicense(provider);

    if (result) {
      return result;
    }
  }

  return createManualQueueLicenseAdapter({ now }).verifyLicense(provider).then(
    (result) => {
      if (!result) {
        throw new Error("Manual queue adapter must always return a check record");
      }

      return result;
    }
  );
}

export function createRecordedCassetteLicenseAdapter(
  options: RecordedCassetteAdapterOptions = {}
): LicenseVerificationAdapter {
  const now = options.now ?? DEFAULT_NOW;
  const cassettes = options.cassettes ?? DEFAULT_CASSETTES;

  return {
    name: "recorded-cassette",
    async verifyLicense(provider) {
      const cassette = cassettes.find(
        (candidate) => normalizeState(candidate.state) === normalizeState(provider.state)
      );

      if (!cassette) {
        return undefined;
      }

      const response = cassette.responses.find((candidate) =>
        responseMatchesProvider(candidate, provider)
      );

      if (!response) {
        return {
          status: "not_found",
          source: cassette.source,
          checked_at: now().toISOString()
        };
      }

      return checkRecordFromResponse(cassette, response, now);
    }
  };
}

export function createManualQueueLicenseAdapter(
  options: ManualQueueAdapterOptions = {}
): LicenseVerificationAdapter {
  const now = options.now ?? DEFAULT_NOW;

  return {
    name: "manual-queue",
    async verifyLicense() {
      return {
        status: "manual_review",
        source: "manual_queue",
        checked_at: now().toISOString()
      };
    }
  };
}

export function fixtureLicenseCheckForProviderId(
  providerId: string
): LicenseCheckRecord | undefined {
  return FIXTURE_LICENSE_CHECKS[providerId];
}

export function currentDatedVerifiedCheck(
  check: LicenseCheckRecord | undefined,
  now: Date = new Date()
): LicenseCheckRecord | undefined {
  if (!check || check.status !== "verified") {
    return undefined;
  }

  const checkedAtMs = Date.parse(check.checked_at);

  if (!Number.isFinite(checkedAtMs)) {
    return undefined;
  }

  if (now.getTime() - checkedAtMs > ONE_YEAR_MS) {
    return undefined;
  }

  return check;
}

export function checkedMonthYear(check: LicenseCheckRecord): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(check.checked_at));
}

export function orderLicenseRecheckCandidates(
  candidates: readonly LicenseRecheckCandidate[]
): readonly LicenseRecheckCandidate[] {
  return [...candidates].sort((left, right) => {
    const byCheckedAt = checkedAtSortValue(left) - checkedAtSortValue(right);

    if (byCheckedAt !== 0) {
      return byCheckedAt;
    }

    return left.providerId.localeCompare(right.providerId);
  });
}

function checkRecordFromResponse(
  cassette: RecordedBoardCassette,
  response: RecordedHttpResponse,
  now: () => Date
): LicenseCheckRecord {
  const status = statusFromResponse(response);
  const checkedAt = response.body.checked_at ?? now().toISOString();
  const base = {
    status,
    source: cassette.source,
    checked_at: checkedAt
  };

  if (response.body.evidence_url) {
    return {
      ...base,
      evidence_url: response.body.evidence_url
    };
  }

  return base;
}

function statusFromResponse(
  response: RecordedHttpResponse
): LicenseVerificationStatus {
  if (response.status_code === 404 || response.body.result === "not_found") {
    return "not_found";
  }

  if (response.body.result === "active") {
    return "verified";
  }

  return response.body.result;
}

function responseMatchesProvider(
  response: RecordedHttpResponse,
  provider: LicenseVerificationProvider
): boolean {
  if (response.provider_id === provider.id) {
    return true;
  }

  return (
    provider.licenseNumber !== undefined &&
    response.license_number === provider.licenseNumber
  );
}

function checkedAtSortValue(candidate: LicenseRecheckCandidate): number {
  if (!candidate.check) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(candidate.check.checked_at);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function normalizeState(state: string): string {
  return state.trim().toUpperCase();
}

function assertCassette(value: unknown): RecordedBoardCassette {
  if (!isRecord(value)) {
    throw new Error("Verification cassette must be an object");
  }

  const state = stringField(value, "state");
  const source = stringField(value, "source");
  const responses = value.responses;

  if (!Array.isArray(responses)) {
    throw new Error("Verification cassette responses must be an array");
  }

  return {
    state,
    source,
    responses: responses.map(assertResponse)
  };
}

function assertResponse(value: unknown): RecordedHttpResponse {
  if (!isRecord(value)) {
    throw new Error("Verification cassette response must be an object");
  }

  const providerId = stringField(value, "provider_id");
  const licenseNumber = optionalStringField(value, "license_number");
  const statusCode = numberField(value, "status_code");
  const body = value.body;

  if (!isRecord(body)) {
    throw new Error("Verification cassette response body must be an object");
  }

  const result = resultField(body, "result");
  const evidenceUrl = optionalStringField(body, "evidence_url");
  const checkedAt = optionalStringField(body, "checked_at");

  return {
    provider_id: providerId,
    ...(licenseNumber ? { license_number: licenseNumber } : {}),
    status_code: statusCode,
    body: {
      result,
      ...(evidenceUrl ? { evidence_url: evidenceUrl } : {}),
      ...(checkedAt ? { checked_at: checkedAt } : {})
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected string field ${field}`);
  }

  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  field: string
): string | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected optional string field ${field}`);
  }

  return value;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];

  if (typeof value !== "number") {
    throw new Error(`Expected number field ${field}`);
  }

  return value;
}

function resultField(
  record: Record<string, unknown>,
  field: string
): RecordedHttpResponse["body"]["result"] {
  const value = stringField(record, field);

  if (
    value === "active" ||
    value === "not_found" ||
    value === "expired" ||
    value === "manual_review"
  ) {
    return value;
  }

  throw new Error(`Expected license result field ${field}`);
}
