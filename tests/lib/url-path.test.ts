import { describe, it, expect } from "vitest";
import { encodePathSegment } from "../../src/lib/url-path";

describe("encodePathSegment", () => {
  it("throws on empty / '.' / '..' segments", () => {
    for (const bad of ["", ".", ".."]) {
      expect(() => encodePathSegment(bad)).toThrow();
    }
  });

  it("passes normal identifiers through unchanged", () => {
    expect(encodePathSegment("PR-148108")).toBe("PR-148108");
    expect(encodePathSegment("TP-4458")).toBe("TP-4458");
    expect(encodePathSegment("2f1a9c4e-0b7d-4c3a-9e21-abc123def456")).toBe(
      "2f1a9c4e-0b7d-4c3a-9e21-abc123def456",
    );
    expect(encodePathSegment(12345)).toBe("12345");
  });

  it("encodes separators so a crafted id cannot climb the path", () => {
    expect(encodePathSegment("a/b")).toBe("a%2Fb");
    // the advisory's payload: all separators are encoded, so no segment climb
    const encoded = encodePathSegment("../../ext/v1/other?x=");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("?");
  });
});
