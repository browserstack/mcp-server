import { vi } from "vitest";

// Mock sharp globally — it's a native binary module that may not be available in CI
vi.mock("sharp", () => {
  const pipeline: any = {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("mock-image")),
  };
  pipeline.png = vi.fn().mockReturnValue(pipeline);
  pipeline.resize = vi.fn().mockReturnValue(pipeline);
  const sharp: any = vi.fn().mockReturnValue(pipeline);
  sharp.cache = vi.fn();
  sharp.concurrency = vi.fn();
  return { default: sharp };
});

// No account region lookups against BrowserStack auth; region tests set the region
// with withAccountRegion, and tests/lib/account-region.test.ts unmocks the lookup.
vi.mock("../src/lib/account-region.js", () => ({
  accountRegion: () => undefined,
}));

// No false-positive memory reads while fetching issues; tests/tools/fpMemory.test.ts
// unmocks the module to test it.
vi.mock(
  "../src/tools/accessiblity-utils/fp-memory.js",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    memoryForReport: async () => undefined,
  }),
);
