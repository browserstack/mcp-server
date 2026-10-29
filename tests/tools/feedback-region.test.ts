import { describe, expect, it, vi } from "vitest";

const CONFIG = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;

async function load(region: string | undefined) {
  vi.resetModules();
  vi.doMock("../../src/lib/account-region.js", () => ({
    accountRegion: () => region,
  }));
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  const { withFeedbackHint, FEEDBACK_HINT } = await import(
    "../../src/lib/feedback-hint.js"
  );
  const { withAccountRegion } = await import("../../src/lib/region-context.js");
  const server = await BrowserStackMcpServer.create(CONFIG);
  const instructions: string =
    (server.getInstance().server as any)._instructions ?? "";
  const hinted = (result: unknown) =>
    JSON.stringify(
      withAccountRegion(region as any, () => withFeedbackHint("listBuildId", result)),
    ).includes(FEEDBACK_HINT);
  return { server, instructions, hinted };
}

const failure = () => ({
  content: [{ type: "text", text: "Failed: Request failed with status code 502" }],
  isError: true,
});

describe("submitFeedback by the account's region", () => {
  it.each(["eu", "in"])(
    "is not registered, instructed or hinted when the region is %s",
    async (region) => {
      const { server, instructions, hinted } = await load(region);
      expect(server.getTool("submitFeedback")).toBeUndefined();
      expect(instructions).not.toContain("submitFeedback");
      expect(hinted(failure())).toBe(false);
    },
  );

  it.each([undefined, "us"])(
    "is registered, instructed and hinted when the region is %s",
    async (region) => {
      const { server, instructions, hinted } = await load(region);
      expect(server.getTool("submitFeedback")).toBeDefined();
      expect(instructions).toContain("submitFeedback");
      expect(hinted(failure())).toBe(true);
    },
  );
});
