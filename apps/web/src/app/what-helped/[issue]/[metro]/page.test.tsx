import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import WhatHelpedPage from "./page";

describe("what-helped aggregation page", () => {
  test("renders verified badges only from dated successful license checks", async () => {
    const html = renderToStaticMarkup(
      await WhatHelpedPage({
        params: Promise.resolve({ issue: "anxiety", metro: "denver" })
      })
    );

    expect(html).toContain("Maria Chen");
    expect(html).toContain("✓ Verified · checked June 2026");
    expect(html).not.toContain("verification pending");
  });
});
