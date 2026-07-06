import { describe, expect, test } from "vitest";
import {
  createManualQueueLicenseAdapter,
  createRecordedCassetteLicenseAdapter,
  orderLicenseRecheckCandidates,
  verifyLicense,
  type LicenseVerificationProvider
} from "./index.js";

const checkedNow = "2026-07-06T00:00:00.000Z";
const now = () => new Date(checkedNow);

describe("license verification adapters", () => {
  test("replays a Colorado board cassette into a dated verified check", async () => {
    const result = await verifyLicense(coloradoProvider, {
      adapters: [createRecordedCassetteLicenseAdapter({ now })],
      now
    });

    expect(result).toEqual({
      status: "verified",
      source: "Colorado DORA cassette",
      evidence_url:
        "https://cassette.example.test/co/dora/licenses/CO-LPC-0001",
      checked_at: "2026-06-18T10:00:00.000Z"
    });
  });

  test("replays Texas not-found and expired cassette responses honestly", async () => {
    const adapter = createRecordedCassetteLicenseAdapter({ now });

    await expect(
      adapter.verifyLicense({
        id: "provider_missing_texas",
        name: "No Match Counseling",
        credential: "LCSW",
        state: "TX",
        licenseNumber: "TX-LCSW-4040"
      })
    ).resolves.toMatchObject({
      status: "not_found",
      source: "Texas Behavioral Health cassette",
      checked_at: checkedNow
    });

    await expect(
      adapter.verifyLicense({
        id: "provider_expired_texas",
        name: "Expired Austin Therapy",
        credential: "LPC",
        state: "TX",
        licenseNumber: "TX-LPC-1999"
      })
    ).resolves.toMatchObject({
      status: "expired",
      source: "Texas Behavioral Health cassette",
      checked_at: "2026-05-02T12:00:00.000Z"
    });
  });

  test("replays the manual-queue state cassette without inventing verification", async () => {
    const result = await verifyLicense(
      {
        id: "provider_pain_detroit",
        name: "Lakeside Chronic Pain Counseling",
        credential: "LMSW",
        state: "MI",
        licenseNumber: "MI-LMSW-7777"
      },
      {
        adapters: [createRecordedCassetteLicenseAdapter({ now })],
        now
      }
    );

    expect(result).toEqual({
      status: "manual_review",
      source: "Michigan LARA cassette",
      checked_at: "2026-06-03T09:30:00.000Z"
    });
  });

  test("falls through to the manual queue adapter when no cassette can check the provider", async () => {
    const result = await verifyLicense(
      {
        id: "provider_manual_wyoming",
        name: "High Plains Counseling",
        credential: "LPC",
        state: "WY",
        licenseNumber: "WY-LPC-7777"
      },
      {
        adapters: [
          createRecordedCassetteLicenseAdapter({ now }),
          createManualQueueLicenseAdapter({ now })
        ],
        now
      }
    );

    expect(result).toEqual({
      status: "manual_review",
      source: "manual_queue",
      checked_at: checkedNow
    });
  });
});

describe("license recheck ordering", () => {
  test("targets never-checked providers first, then oldest checked_at first", () => {
    const ordered = orderLicenseRecheckCandidates([
      {
        providerId: "fresh",
        check: {
          status: "verified",
          source: "Colorado DORA cassette",
          checked_at: "2026-06-01T00:00:00.000Z"
        }
      },
      { providerId: "never" },
      {
        providerId: "oldest",
        check: {
          status: "manual_review",
          source: "manual_queue",
          checked_at: "2025-01-01T00:00:00.000Z"
        }
      },
      {
        providerId: "middle",
        check: {
          status: "expired",
          source: "Texas Behavioral Health cassette",
          checked_at: "2025-09-15T00:00:00.000Z"
        }
      }
    ]);

    expect(ordered.map((entry) => entry.providerId)).toEqual([
      "never",
      "oldest",
      "middle",
      "fresh"
    ]);
  });
});

const coloradoProvider: LicenseVerificationProvider = {
  id: "provider_teen_denver",
  name: "North Star Teen Therapy",
  credential: "LPC",
  state: "CO",
  licenseNumber: "CO-LPC-0001"
};
