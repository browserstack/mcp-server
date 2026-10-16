import { vi } from "vitest";

// Mock sharp globally — it's a native binary module that may not be available in CI
vi.mock("sharp", () => {
  const sharp: any = vi.fn().mockReturnValue({
    png: vi.fn().mockReturnValue({
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("mock-image")),
    }),
  });
  sharp.cache = vi.fn();
  sharp.concurrency = vi.fn();
  return { default: sharp };
});

// Region routing probes BrowserStack before each call; most suites mock apiClient with
// ordered responses, so resolve every host to its US default here. The resolver's own
// behaviour is covered by tests/lib/regional-host.test.ts, which unmocks it.
vi.mock("../src/lib/regional-host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/regional-host")>();
  return {
    ...actual,
    getRegionalHost: vi.fn(async (kind: Parameters<typeof actual.hostFor>[0]) =>
      actual.hostFor(kind, "us"),
    ),
  };
});
