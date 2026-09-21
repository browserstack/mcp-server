import { describe, it, expect, vi } from "vitest";
import { requireWriteConfirmation } from "../../src/tools/testmanagement-utils/confirm-write";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => "fake-user:fake-key"),
}));

const config = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
} as any;

const tokenOf = (r: any): string | undefined =>
  r?.content?.[0]?.text?.match(/confirmToken:"([a-f0-9]+)"/)?.[1];

describe("requireWriteConfirmation", () => {
  it("prompts for confirmation and mints a token when none is supplied", () => {
    const res = requireWriteConfirmation(
      "createTestCase",
      "this creates a test case.",
      { project_identifier: "PR-1", name: "Login" },
      config,
    );
    expect(res).not.toBeNull();
    expect(res!.content[0].text).toMatch(/Confirmation required/i);
    expect(tokenOf(res)).toMatch(/^[a-f0-9]{16}$/);
  });

  it("proceeds (returns null) when the correct token is supplied", () => {
    const args = { project_identifier: "PR-1", name: "Login" };
    const first = requireWriteConfirmation("createTestCase", "x", args, config);
    const token = tokenOf(first)!;
    const second = requireWriteConfirmation("createTestCase", "x", {
      ...args,
      confirmToken: token,
    }, config);
    expect(second).toBeNull();
  });

  it("rejects a token bound to different arguments", () => {
    const first = requireWriteConfirmation("createTestCase", "x", {
      project_identifier: "PR-1",
      name: "Login",
    }, config);
    const token = tokenOf(first)!;
    // Same token, but a different payload → must re-prompt, not proceed.
    const second = requireWriteConfirmation("createTestCase", "x", {
      project_identifier: "PR-1",
      name: "Checkout",
      confirmToken: token,
    }, config);
    expect(second).not.toBeNull();
  });

  it("rejects a token minted for a different operation", () => {
    const args = { project_identifier: "PR-1", name: "Login" };
    const first = requireWriteConfirmation("createTestCase", "x", args, config);
    const token = tokenOf(first)!;
    const second = requireWriteConfirmation("updateTestCase", "x", {
      ...args,
      confirmToken: token,
    }, config);
    expect(second).not.toBeNull();
  });
});
