import { describe, expect, it } from "vitest";
import { highlightSpans } from "./highlightSpans";

describe("highlightSpans", () => {
  it("splits text around labeled spans", () => {
    const segments = highlightSpans("Hello Danielle, welcome", [{ start: 6, end: 14, label: "name" }]);
    expect(segments).toEqual([
      { text: "Hello ", label: undefined },
      { text: "Danielle", label: "name" },
      { text: ", welcome", label: undefined }
    ]);
  });

  it("returns the whole text as one unlabeled segment when there are no spans", () => {
    expect(highlightSpans("no PII here", [])).toEqual([{ text: "no PII here", label: undefined }]);
  });
});
