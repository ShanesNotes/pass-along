import { describe, expect, it } from "vitest";
import { understandQuery } from "./understandQuery";

describe("understandQuery", () => {
  it("flags crisis language before anything else", () => {
    const result = understandQuery("I don't know what to do, I want to end my life");
    expect(result.kind).toBe("crisis");
  });

  it("asks a clarifying question for vague or short input", () => {
    const result = understandQuery("help");
    expect(result.kind).toBe("low-confidence");
  });

  it("extracts issue, population, and preference facets", () => {
    const result = understandQuery(
      "Looking for someone for my teenager's anxiety, ideally evening appointments"
    );
    expect(result.kind).toBe("understood");
    if (result.kind !== "understood") throw new Error("expected understood");
    expect(result.facets.issues).toContain("anxiety");
    expect(result.facets.population).toBe("teen");
    expect(result.facets.prefers).toContain("evenings");
  });

  it("does not treat crisis keywords as understood facets", () => {
    const result = understandQuery("I've been having panic attacks and thoughts of suicide");
    expect(result.kind).toBe("crisis");
  });
});
