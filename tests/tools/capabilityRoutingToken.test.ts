import { describe, expect, it } from "vitest";
import {
  signRouting,
  readRouting,
  TOKEN_TTL_SECONDS,
} from "../../src/tools/capability-registry/routing-token.js";

describe("the routing token carries the verdict instead of the server remembering it", () => {
  it("round-trips what the routing step concluded", () => {
    const token = signRouting({ verdict: "settled", product: "tm" });
    expect(readRouting(token)).toMatchObject({ verdict: "settled", product: "tm" });

    const clash = signRouting({ verdict: "clash", terms: ["report", "run"] });
    expect(readRouting(clash)).toMatchObject({
      verdict: "clash",
      terms: ["report", "run"],
    });
  });

  it("is opaque — the caller cannot read a product out and write a different one back", () => {
    const token = signRouting({ verdict: "settled", product: "tm" });
    const [payload] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        verdict: "settled",
        product: "tra",
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toString("base64url");
    // The payload is readable — base64 is not encryption, and it does not need to be.
    // What it cannot be is CHANGED: the signature is over these exact bytes.
    expect(payload).not.toEqual(forged);
    expect(readRouting(`${forged}.${token.split(".")[1]}`)).toBeUndefined();
  });

  it("refuses a token this process did not sign", () => {
    const payload = Buffer.from(
      JSON.stringify({ verdict: "settled", product: "tm", iat: 1 }),
    ).toString("base64url");
    expect(readRouting(`${payload}.not-a-real-signature`)).toBeUndefined();
    expect(readRouting(payload)).toBeUndefined();
    expect(readRouting("")).toBeUndefined();
    expect(readRouting(undefined)).toBeUndefined();
  });

  it("expires, so a verdict cannot be banked and spent much later", () => {
    const issued = 1_000_000;
    const token = signRouting({ verdict: "settled", product: "tm", iat: issued });
    expect(readRouting(token, issued + TOKEN_TTL_SECONDS - 1)).toBeDefined();
    expect(readRouting(token, issued + TOKEN_TTL_SECONDS + 1)).toBeUndefined();
  });

  it("gives one answer to every bad token, whatever is wrong with it", () => {
    // A caller told WHY its token failed is a caller being taught to build a better one.
    for (const bad of ["", ".", "x.y", "....", "a".repeat(400)])
      expect(readRouting(bad)).toBeUndefined();
  });
});
