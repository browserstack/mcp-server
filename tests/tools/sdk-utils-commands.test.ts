import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { getSDKPrefixCommand } from "../../src/tools/sdk-utils/bstack/commands";

describe("getSDKPrefixCommand", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  beforeEach(() => {
    // If a real credential ever leaks into a rendered command, these env vars
    // are where it would come from. Set decoy values so any accidental
    // interpolation would be caught by the assertions below.
    process.env.BROWSERSTACK_USERNAME = "real-user-should-not-appear";
    process.env.BROWSERSTACK_ACCESS_KEY = "real-key-should-not-appear";
  });

  it("nodejs: emits env-var references, never literal credentials", () => {
    const out = getSDKPrefixCommand("nodejs", "testng");
    expect(out).toContain("--username ${BROWSERSTACK_USERNAME}");
    expect(out).toContain("--key ${BROWSERSTACK_ACCESS_KEY}");
    expect(out).not.toContain("real-user-should-not-appear");
    expect(out).not.toContain("real-key-should-not-appear");
    expect(out).not.toContain("undefined");
  });

  it("java/unix: Maven command uses env-var references", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const out = getSDKPrefixCommand("java", "testng");
    expect(out).toContain('-DBROWSERSTACK_USERNAME="${BROWSERSTACK_USERNAME}"');
    expect(out).toContain(
      '-DBROWSERSTACK_ACCESS_KEY="${BROWSERSTACK_ACCESS_KEY}"',
    );
    expect(out).not.toContain("real-user-should-not-appear");
    expect(out).not.toContain("real-key-should-not-appear");
    expect(out).not.toContain("undefined");
  });

  it("java/windows: Maven command uses env-var references", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const out = getSDKPrefixCommand("java", "testng");
    expect(out).toContain('-DBROWSERSTACK_USERNAME="${BROWSERSTACK_USERNAME}"');
    expect(out).toContain(
      '-DBROWSERSTACK_ACCESS_KEY="${BROWSERSTACK_ACCESS_KEY}"',
    );
    expect(out).not.toContain("real-user-should-not-appear");
    expect(out).not.toContain("real-key-should-not-appear");
    expect(out).not.toContain("undefined");
  });
});
