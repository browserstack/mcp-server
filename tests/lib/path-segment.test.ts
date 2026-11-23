import { describe, expect, it } from "vitest";

import { encodePathSegment } from "../../src/lib/path-segment.js";

describe("encodePathSegment", () => {
  it("passes a plain id through unchanged", () => {
    expect(encodePathSegment("abc123")).toBe("abc123");
    expect(encodePathSegment(42)).toBe("42");
  });

  it("percent-encodes characters that would leave the segment", () => {
    expect(encodePathSegment("a/b")).toBe("a%2Fb");
    expect(encodePathSegment("a?b#c")).toBe("a%3Fb%23c");
    expect(encodePathSegment("a b")).toBe("a%20b");
  });

  it("refuses values that would collapse or walk up a segment", () => {
    for (const bad of ["", "   ", ".", "..", "  ..  "]) {
      expect(() => encodePathSegment(bad, "sessionId")).toThrow(/sessionId/);
    }
  });

  it("keeps a dot inside an otherwise valid id", () => {
    expect(encodePathSegment("v1.2.3")).toBe("v1.2.3");
  });
});
