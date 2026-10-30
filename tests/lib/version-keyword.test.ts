import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  normalizeVersionKeyword,
  versionString,
} from "../../src/lib/version-keyword";

// The Live, App Live and takeAppScreenshot version fields used to tell the model, in prose,
// to turn "newest" into "latest" and "earliest" into "oldest". The trimmed descriptions no
// longer say so, and the code downstream only matches the exact strings, so the schema
// does the mapping.
describe("normalizeVersionKeyword", () => {
  it.each([
    ["latest", "latest"],
    ["Latest", "latest"],
    ["newest", "latest"],
    ["most recent", "latest"],
    ["  Most   Recent ", "latest"],
    ["most-recent", "latest"],
    ["oldest", "oldest"],
    ["earliest", "oldest"],
    ["First", "oldest"],
  ])("maps %j to %j", (input, expected) => {
    expect(normalizeVersionKeyword(input)).toBe(expected);
  });

  it.each(["14", "14.0", "133.2", "Sequoia", "11"])(
    "passes the version %j through unchanged",
    (input) => {
      expect(normalizeVersionKeyword(input)).toBe(input);
    },
  );

  it("trims surrounding whitespace from a version number", () => {
    expect(normalizeVersionKeyword(" 17 ")).toBe("17");
  });
});

describe("versionString schema", () => {
  it("normalises when parsed as part of a tool's argument object", () => {
    const shape = z.object({
      desiredOSVersion: versionString(),
      desiredBrowserVersion: versionString().optional(),
    });
    expect(
      shape.parse({
        desiredOSVersion: "newest",
        desiredBrowserVersion: "earliest",
      }),
    ).toEqual({ desiredOSVersion: "latest", desiredBrowserVersion: "oldest" });
    expect(shape.parse({ desiredOSVersion: "Sequoia" })).toEqual({
      desiredOSVersion: "Sequoia",
    });
  });

  it("still rejects a non-string", () => {
    expect(() => versionString().parse(14)).toThrow();
  });
});
