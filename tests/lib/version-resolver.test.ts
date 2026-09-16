import { describe, it, expect } from "vitest";
import { resolveVersion } from "../../src/lib/version-resolver";

describe("resolveVersion", () => {
  const versions = ["152.0", "153.0", "154.0 beta", "155.0 dev"];

  it("resolves 'latest' to the newest stable version, skipping beta/dev channels", () => {
    expect(resolveVersion("latest", versions)).toBe("153.0");
  });

  it("resolves 'oldest' to the oldest stable version", () => {
    expect(resolveVersion("oldest", versions)).toBe("152.0");
  });

  it("falls back to pre-release channels when no stable version exists", () => {
    expect(resolveVersion("latest", ["154.0 beta", "155.0 dev"])).toBe(
      "155.0 dev",
    );
  });

  it("still returns exact matches, including pre-release channels", () => {
    expect(resolveVersion("154.0 beta", versions)).toBe("154.0 beta");
  });

  it("matches by major version", () => {
    expect(resolveVersion("152", versions)).toBe("152.0");
  });
});
