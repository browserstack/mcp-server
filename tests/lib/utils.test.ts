import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import sharp from "sharp";
import logger from "../../src/logger";
import { maybeCompressBase64 } from "../../src/lib/utils";

// utils.ts imports trackMCP from the entry module; stub it so importing the
// real utils under test does not pull in the server bootstrap.
vi.mock("../../src/index", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// sharp itself is globally mocked in tests/setup.ts (native module).
const ONE_MB = 1048576;
const overSized = () => Buffer.alloc(ONE_MB + 1, 7).toString("base64");

describe("maybeCompressBase64", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the input unchanged when already <= 1 MB (never touches sharp)", async () => {
    const small = Buffer.from("small-image").toString("base64");
    expect(await maybeCompressBase64(small)).toBe(small);
    expect(sharp as unknown as Mock).not.toHaveBeenCalled();
  });

  it("lazily loads sharp and returns the compressed image when > 1 MB", async () => {
    const out = await maybeCompressBase64(overSized());
    // setup.ts mock returns Buffer.from("mock-image")
    expect(out).toBe(Buffer.from("mock-image").toString("base64"));
    expect(sharp as unknown as Mock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the uncompressed image (and warns) when sharp fails to load", async () => {
    (sharp as unknown as Mock).mockImplementationOnce(() => {
      throw new Error("Could not load the sharp module (Node < 20.9)");
    });
    const input = overSized();
    expect(await maybeCompressBase64(input)).toBe(input); // unchanged fallback
    expect(logger.warn as Mock).toHaveBeenCalledTimes(1);
  });
});
