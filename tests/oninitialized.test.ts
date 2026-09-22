import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import logger from "../src/logger";
import { setupOnInitialized } from "../src/oninitialized";

vi.mock("../src/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));
vi.mock("../src/lib/device-cache", () => ({ shouldSendStartedEvent: () => false }));

// Minimal McpServer stub — setupOnInitialized only sets server.server.oninitialized.
const makeServer = () =>
  ({ server: { oninitialized: undefined, getClientVersion: () => ({}) } }) as any;

// process.versions.node is read-only; override it per-case then restore.
const realNode = process.versions.node;
const setNode = (v: string) =>
  Object.defineProperty(process.versions, "node", { value: v, configurable: true });

describe("setupOnInitialized – Node version nudge", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setNode(realNode));

  it.each(["18.19.0", "20.9.0", "21.7.3", "16.20.0"])(
    "warns on Node < 22 (%s) without throwing",
    (v) => {
      setNode(v);
      expect(() => setupOnInitialized(makeServer())).not.toThrow();
      expect(logger.warn as Mock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["22.0.0", "22.11.0", "24.3.0", "26.1.0"])(
    "does not warn on Node >= 22 (%s)",
    (v) => {
      setNode(v);
      setupOnInitialized(makeServer());
      expect(logger.warn as Mock).not.toHaveBeenCalled();
    },
  );
});
