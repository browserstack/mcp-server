import { describe, it, expect } from "vitest";
import { symbols } from "pino";
import logger, { setLogger } from "../../src/logger";

describe("default logger (non-development)", () => {
  it("is disabled and does not use a file transport", () => {
    expect(process.env.NODE_ENV).not.toBe("development");
    expect(logger.level).toBe("silent");

    const stream = logger[symbols.streamSym];
    expect(stream?.worker).toBeUndefined();
    expect(stream?.constructor?.name).not.toBe("ThreadStream");
  });

  it("keeps log methods and flush callable", () => {
    expect(() => {
      logger.info("info");
      logger.error(new Error("boom"));
      logger.flush();
    }).not.toThrow();
  });

  it("delegates to a logger installed via setLogger", () => {
    const calls: string[] = [];
    setLogger({ info: (msg: string) => calls.push(msg), level: "info" });
    logger.info("hello");
    expect(calls).toEqual(["hello"]);
    expect(logger.level).toBe("info");
  });
});
