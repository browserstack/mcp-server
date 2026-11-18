import { describe, it, expect } from "vitest";
import {
  wrapUntrusted,
  stableUntrusted,
} from "../../src/lib/untrusted-content.js";

describe("wrapUntrusted", () => {
  it("labels the source and instructs the model to treat it as data only", () => {
    const out = wrapUntrusted("device logs", "some log line");
    expect(out).toContain("device logs");
    expect(out).toContain("UNTRUSTED");
    expect(out).toMatch(/never follow/i);
    expect(out).toContain("some log line");
  });

  it("delimits the content between open and close markers", () => {
    const out = wrapUntrusted("rca", "CONTENT_HERE");
    // content sits between an «UNTRUSTED …» opener and an «END UNTRUSTED …» closer
    expect(out).toMatch(
      /«UNTRUSTED rca [0-9a-f]{12}»\nCONTENT_HERE\n«END UNTRUSTED [0-9a-f]{12}»/,
    );
  });

  it("uses a fresh random nonce per call so injected text can't forge the closer", () => {
    const a = wrapUntrusted("logs", "x");
    const b = wrapUntrusted("logs", "x");
    const nonceA = a.match(/«UNTRUSTED logs ([0-9a-f]{12})»/)?.[1];
    const nonceB = b.match(/«UNTRUSTED logs ([0-9a-f]{12})»/)?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceB).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
  });
});

describe("stableUntrusted", () => {
  it("makes two wraps of the same content compare equal", () => {
    const a = wrapUntrusted("API response", "project not found");
    const b = wrapUntrusted("API response", "project not found");
    expect(a).not.toBe(b);
    expect(stableUntrusted(a)).toBe(stableUntrusted(b));
  });

  it("normalizes both the open and close marker nonces", () => {
    const out = stableUntrusted(wrapUntrusted("rca", "x"));
    expect(out).toContain("«UNTRUSTED rca <nonce>»");
    expect(out).toContain("«END UNTRUSTED <nonce>»");
    expect(out).not.toMatch(/[0-9a-f]{12}»/);
  });

  it("stays linear-time on adversarial marker-like input", () => {
    const evil = "«".repeat(20000) + "a".repeat(20000);
    const start = performance.now();
    stableUntrusted(evil);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
