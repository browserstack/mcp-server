import { vi } from "vitest";

// Mock sharp globally — it's a native binary module that may not be available in CI
vi.mock("sharp", () => ({
  default: vi.fn().mockReturnValue({
    png: vi.fn().mockReturnValue({
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("mock-image")),
    }),
  }),
}));
