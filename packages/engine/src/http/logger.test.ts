import { describe, expect, test } from "vitest";
import { createLogger, runWithRequestContext } from "./logger.js";

describe("createLogger allowlist", () => {
  test("drops unknown fields, including raw query text, and never emits them", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    logger.log("find.performed", { query: "raw text about a specific person" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("raw text");
    expect(lines[0]).not.toContain("query");
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(parsed.dropped_field_count).toBe(1);
  });

  test("passes through allowlisted fields unchanged", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    logger.log("find.safety_gate_degraded", { reason: "tier2_timeout" });

    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(parsed.reason).toBe("tier2_timeout");
    expect(parsed.event).toBe("find.safety_gate_degraded");
    expect(parsed.dropped_field_count).toBeUndefined();
  });

  test("caps long string values at 200 chars", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    const longReason = "x".repeat(500);

    logger.log("find.rerank_degraded", { reason: longReason });

    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect((parsed.reason as string).length).toBeLessThanOrEqual(203);
  });

  test("merges request context onto every log line within the run", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    runWithRequestContext(
      { request_id: "req-1", route: "find" },
      () => {
        logger.log("find.performed", { status: 200 });
      }
    );

    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(parsed.request_id).toBe("req-1");
    expect(parsed.route).toBe("find");
  });
});
