import { describe, it, expect } from "vitest";
import { resolveVersion, stripPrereleaseLabel } from "../../src/lib/version-resolver";

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

  it("does not substitute a pre-release channel for an unavailable version while a stable one exists", () => {
    expect(resolveVersion("26", ["27 Beta", "17.0"])).toBe("17.0");
    expect(resolveVersion("26", ["27 Beta", "28.0"])).toBe("28.0");
  });

  it("uses a pre-release channel for an unavailable version when nothing stable is listed", () => {
    expect(resolveVersion("26", ["27 Beta"])).toBe("27 Beta");
  });
});

describe("stripPrereleaseLabel", () => {
  it("turns a labelled bare major into <major>.0", () => {
    expect(stripPrereleaseLabel("27 Beta")).toBe("27.0");
    expect(stripPrereleaseLabel("16 beta")).toBe("16.0");
  });

  it("keeps an existing minor version", () => {
    expect(stripPrereleaseLabel("154.0 beta")).toBe("154.0");
    expect(stripPrereleaseLabel("18.2 Dev")).toBe("18.2");
  });

  it("leaves unlabelled versions unchanged", () => {
    expect(stripPrereleaseLabel("17.0")).toBe("17.0");
    expect(stripPrereleaseLabel("4.3.2")).toBe("4.3.2");
    expect(stripPrereleaseLabel("latest")).toBe("latest");
  });
});
