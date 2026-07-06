import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import ProviderProfilePage from "../app/provider/[id]/page";

describe("provider profile license badge", () => {
  test("renders checked month copy for a fresh successful check", async () => {
    const html = renderToStaticMarkup(
      await ProviderProfilePage({ params: providerParams("p1") })
    );

    expect(html).toContain("✓ Verified · checked June 2026");
    expect(html).toContain("Colorado DORA cassette");
  });

  test("does not render a badge or pending placeholder without a check row", async () => {
    const html = renderToStaticMarkup(
      await ProviderProfilePage({ params: providerParams("p4") })
    );

    expect(html).toContain("Aditi Rao");
    expect(html).not.toContain("License verification pending");
    expect(html).not.toContain("✓ Verified");
  });
});

function providerParams(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}
