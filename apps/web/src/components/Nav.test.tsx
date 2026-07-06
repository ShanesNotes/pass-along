import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Nav } from "./Nav";

describe("Nav", () => {
  test("does not link the admin bench from public navigation", () => {
    const html = renderToStaticMarkup(<Nav />);

    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain("Admin");
  });
});
