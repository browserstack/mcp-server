import { afterEach, describe, expect, it, vi } from "vitest";

const CONFIG = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
} as any;

const original = process.env.BROWSERSTACK_GRR_REGION;

async function load(region: string | undefined) {
  vi.resetModules();
  if (region === undefined) delete process.env.BROWSERSTACK_GRR_REGION;
  else process.env.BROWSERSTACK_GRR_REGION = region;
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  const { withFeedbackHint, FEEDBACK_HINT } = await import(
    "../../src/lib/feedback-hint.js"
  );
  const server = new BrowserStackMcpServer(CONFIG);
  const instructions: string =
    (server.getInstance().server as any)._instructions ?? "";
  return { server, instructions, withFeedbackHint, FEEDBACK_HINT };
}

const failure = () => ({
  content: [{ type: "text", text: "Failed: Request failed with status code 502" }],
  isError: true,
});

describe("submitFeedback by BROWSERSTACK_GRR_REGION", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.BROWSERSTACK_GRR_REGION;
    else process.env.BROWSERSTACK_GRR_REGION = original;
  });

  it.each(["eu", "in"])(
    "is not registered, instructed or hinted when the region is %s",
    async (region) => {
      const { server, instructions, withFeedbackHint, FEEDBACK_HINT } =
        await load(region);
      expect(server.getTool("submitFeedback")).toBeUndefined();
      expect(instructions).not.toContain("submitFeedback");
      expect(JSON.stringify(withFeedbackHint("listBuildId", failure()))).not.toContain(
        FEEDBACK_HINT,
      );
    },
  );

  it.each([undefined, "us"])(
    "is registered, instructed and hinted when the region is %s",
    async (region) => {
      const { server, instructions, withFeedbackHint, FEEDBACK_HINT } =
        await load(region);
      expect(server.getTool("submitFeedback")).toBeDefined();
      expect(instructions).toContain("submitFeedback");
      expect(JSON.stringify(withFeedbackHint("listBuildId", failure()))).toContain(
        FEEDBACK_HINT,
      );
    },
  );
});
