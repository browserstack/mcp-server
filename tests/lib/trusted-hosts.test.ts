import { describe, it, expect } from "vitest";
import {
  isTrustedAssetUrl,
  trustedRedirectGuard,
  isRedirectRefused,
  RedirectRefusedError,
} from "../../src/lib/trusted-hosts";

describe("isTrustedAssetUrl", () => {
  it("accepts BrowserStack, S3 (incl. regional) and Backblaze over https", () => {
    for (const url of [
      "https://automate.browserstack.com/x.png",
      "https://bucket.s3.amazonaws.com/x.png",
      "https://bucket.s3-us-west-2.amazonaws.com/x.png",
      "https://bucket.s3.dualstack.us-east-1.amazonaws.com/x.png",
      "https://f000.backblazeb2.com/x.png",
    ]) {
      expect(isTrustedAssetUrl(url)).toBe(true);
    }
  });

  it("rejects http, look-alike and unrelated hosts", () => {
    for (const url of [
      "http://bucket.s3.amazonaws.com/x.png",
      "https://browserstack.com.evil.io/x.png",
      "https://sts.amazonaws.com/x.png",
      "https://169.254.169.254/latest/meta-data/",
      "not a url",
    ]) {
      expect(isTrustedAssetUrl(url)).toBe(false);
    }
  });

  it("stays linear-time on a pathological S3-like host (no catastrophic backtracking)", () => {
    const host = `a.s3${"-".repeat(60)}x.not-amazonaws.evil`;
    const start = performance.now();
    const result = isTrustedAssetUrl(`https://${host}/x.png`);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("trustedRedirectGuard", () => {
  const guard = trustedRedirectGuard("screenshot");
  const call = (options: Record<string, unknown>) =>
    (guard as (o: unknown, r: unknown) => void)(options, {});

  it("allows a redirect to a trusted host (href form)", () => {
    expect(() =>
      call({ href: "https://bucket.s3.amazonaws.com/x.png" }),
    ).not.toThrow();
  });

  it("allows a redirect assembled from protocol/host/path when href is absent", () => {
    expect(() =>
      call({
        protocol: "https:",
        host: "automate.browserstack.com",
        path: "/x.png",
      }),
    ).not.toThrow();
  });

  it("refuses a redirect to an untrusted host with RedirectRefusedError", () => {
    let thrown: unknown;
    try {
      call({ href: "https://evil.example.com/x.png" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RedirectRefusedError);
    expect(isRedirectRefused(thrown)).toBe(true);
  });

  it("refuses an http downgrade even on a trusted host", () => {
    expect(() =>
      call({ href: "http://bucket.s3.amazonaws.com/x.png" }),
    ).toThrow(RedirectRefusedError);
  });
});

describe("isRedirectRefused", () => {
  it("detects the error directly, via cause, and by name", () => {
    expect(isRedirectRefused(new RedirectRefusedError("x"))).toBe(true);
    expect(isRedirectRefused({ cause: new RedirectRefusedError("x") })).toBe(
      true,
    );
    expect(isRedirectRefused({ name: "RedirectRefusedError" })).toBe(true);
    expect(isRedirectRefused(new Error("other"))).toBe(false);
  });

  it("unwraps the axios + redirect-library wrapping (cause nested two levels deep)", () => {
    const refusal = new RedirectRefusedError("nope");
    const frFailure = Object.assign(new Error("redirect failed"), {
      code: "ERR_FR_REDIRECTION_FAILURE",
      cause: refusal,
    });
    const axiosError = Object.assign(new Error("Request failed"), {
      name: "AxiosError",
      cause: frFailure,
    });
    expect(isRedirectRefused(axiosError)).toBe(true);
  });

  it("does not loop forever on a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isRedirectRefused(a)).toBe(false);
  });
});
