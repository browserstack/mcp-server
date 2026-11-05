import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A Live session is for a person. In the evals, an agent asked to tap, type or click chose
// runAppLiveSession / runBrowserLiveSession over a capability session and then reported
// that Live cannot be driven. The description now says so up front, and names the surface
// that can — but only while that surface is registered, so a server with the registry off
// never advertises tools it does not have.

function captureDescriptions() {
  const described: Record<string, string> = {};
  const server = {
    tool: (name: string, description: string) => {
      described[name] = description;
      return { name };
    },
    server: { getClientVersion: () => ({ name: "t", version: "0" }) },
  };
  return { server, described };
}

describe("the Live tools say what they are for", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_DISABLED;
  });

  it("call themselves manual and say the agent cannot drive them", async () => {
    const { server, described } = captureDescriptions();
    (await import("../../src/tools/applive.js")).default(
      server as never,
      {} as never,
    );
    (await import("../../src/tools/live.js")).default(
      server as never,
      {} as never,
    );
    for (const name of ["runAppLiveSession", "runBrowserLiveSession"]) {
      expect(described[name]).toMatch(/manual/);
      expect(described[name]).toMatch(/cannot drive it/);
    }
  });

  it("point at the capability session while the registry is on", async () => {
    const { server, described } = captureDescriptions();
    (await import("../../src/tools/applive.js")).default(
      server as never,
      {} as never,
    );
    (await import("../../src/tools/live.js")).default(
      server as never,
      {} as never,
    );
    expect(described.runAppLiveSession).toMatch(/mobiledevicecontrol/);
    expect(described.runBrowserLiveSession).toMatch(/devicecontrol session/);
    expect(described.runAppLiveSession).toMatch(/invokeCapability/);
  });

  it("do not name a surface that is not registered", async () => {
    process.env.CAPABILITY_REGISTRY_DISABLED = "true";
    const { server, described } = captureDescriptions();
    (await import("../../src/tools/applive.js")).default(
      server as never,
      {} as never,
    );
    (await import("../../src/tools/live.js")).default(
      server as never,
      {} as never,
    );
    expect(described.runAppLiveSession).not.toMatch(/invokeCapability/);
    expect(described.runBrowserLiveSession).not.toMatch(/invokeCapability/);
    // the manual warning stays regardless
    expect(described.runAppLiveSession).toMatch(/cannot drive it/);
  });
});
