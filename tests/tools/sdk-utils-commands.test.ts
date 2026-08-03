import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { getSDKPrefixCommand } from "../../src/tools/sdk-utils/bstack/commands";

const USERNAME_PLACEHOLDER = "<your_browserstack_username>";
const ACCESS_KEY_PLACEHOLDER = "<your_browserstack_access_key>";
const DECOY_USER = "real-user-should-not-appear";
const DECOY_KEY = "real-key-should-not-appear";

describe("getSDKPrefixCommand", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalUser = process.env.BROWSERSTACK_USERNAME;
  const originalKey = process.env.BROWSERSTACK_ACCESS_KEY;

  beforeEach(() => {
    // If a real credential ever leaked into a rendered command, these env vars
    // are where it would come from. Plant decoys so any accidental read surfaces.
    process.env.BROWSERSTACK_USERNAME = DECOY_USER;
    process.env.BROWSERSTACK_ACCESS_KEY = DECOY_KEY;
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    process.env.BROWSERSTACK_USERNAME = originalUser;
    process.env.BROWSERSTACK_ACCESS_KEY = originalKey;
  });

  it("nodejs: emits quoted placeholders, never literal credentials", () => {
    const out = getSDKPrefixCommand("nodejs", "testng");
    expect(out).toContain(`--username "${USERNAME_PLACEHOLDER}"`);
    expect(out).toContain(`--key "${ACCESS_KEY_PLACEHOLDER}"`);
    expect(out).not.toContain(DECOY_USER);
    expect(out).not.toContain(DECOY_KEY);
    expect(out).not.toContain("undefined");
  });

  it("java/unix: Maven command uses quoted placeholders", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const out = getSDKPrefixCommand("java", "testng");
    expect(out).toContain(`-DBROWSERSTACK_USERNAME="${USERNAME_PLACEHOLDER}"`);
    expect(out).toContain(`-DBROWSERSTACK_ACCESS_KEY="${ACCESS_KEY_PLACEHOLDER}"`);
    expect(out).not.toContain(DECOY_USER);
    expect(out).not.toContain(DECOY_KEY);
    expect(out).not.toContain("undefined");
  });

  it("java/windows: Maven command uses quoted placeholders", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const out = getSDKPrefixCommand("java", "testng");
    expect(out).toContain(`-DBROWSERSTACK_USERNAME="${USERNAME_PLACEHOLDER}"`);
    expect(out).toContain(`-DBROWSERSTACK_ACCESS_KEY="${ACCESS_KEY_PLACEHOLDER}"`);
    expect(out).not.toContain(DECOY_USER);
    expect(out).not.toContain(DECOY_KEY);
    expect(out).not.toContain("undefined");
  });
});
