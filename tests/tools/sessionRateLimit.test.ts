import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetRateLimitForTests,
  takeSessionStart,
} from "../../src/tools/device-session-utils/rate-limit";

beforeEach(() => __resetRateLimitForTests());

describe("session start limit", () => {
  it("allows up to the limit per user per hour, then refuses", () => {
    const t0 = 1_000_000;
    takeSessionStart("alice", 2, t0);
    takeSessionStart("alice", 2, t0 + 1);
    expect(() => takeSessionStart("alice", 2, t0 + 2)).toThrow(/2 per hour/);
    // Another user has their own budget.
    expect(() => takeSessionStart("bob", 2, t0 + 3)).not.toThrow();
  });

  it("frees budget as starts leave the one-hour window", () => {
    const t0 = 1_000_000;
    takeSessionStart("alice", 1, t0);
    expect(() => takeSessionStart("alice", 1, t0 + 30 * 60_000)).toThrow(/about 30 minute/);
    expect(() => takeSessionStart("alice", 1, t0 + 60 * 60_000 + 1)).not.toThrow();
  });

  it("treats 0 as no limit", () => {
    for (let i = 0; i < 100; i++) takeSessionStart("alice", 0, i);
  });
});
