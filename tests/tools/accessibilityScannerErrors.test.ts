import { beforeEach, describe, expect, it, vi } from "vitest";

let nextResponse: any;
vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: vi.fn(async () => nextResponse) },
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

async function start(body: unknown) {
  nextResponse = { data: body };
  const { AccessibilityScanner } =
    await import("../../src/tools/accessiblity-utils/scanner.js");
  const scanner = new AccessibilityScanner();
  scanner.setAuth({ username: "u", password: "p" });
  return scanner.startScan("scan", ["https://example.com"]);
}

describe("startScan surfaces the API's reason when success is false", () => {
  beforeEach(() => vi.resetModules());

  it("reports the errors array when the API sends one", async () => {
    await expect(
      start({ success: false, errors: ["Bad URL"] }),
    ).rejects.toThrow("Unable to start scan: Bad URL");
  });

  it("falls back to the raw body when errors is absent, never 'undefined'", async () => {
    const err = await start({ success: false }).catch((e: Error) => e);
    expect(err.message).toContain('Unable to start scan: {"success":false}');
    expect(err.message).not.toContain("undefined");
  });

  it("falls back when errors is an empty array", async () => {
    const err = await start({ success: false, errors: [] }).catch(
      (e: Error) => e,
    );
    expect(err.message).toContain('{"success":false,"errors":[]}');
  });
});
