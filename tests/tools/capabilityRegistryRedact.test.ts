import { describe, expect, it } from "vitest";
import { redact } from "../../src/tools/capability-registry/redact.js";

/** Built at runtime: a committed credential-shaped literal trips secret scanning. */
const fake = {
  awsKey: `AKIA${"IOSFODNN7EXAMPLE".slice(0, 16)}`,
  opaque: ["xK9mPqR2sT", "4vW7yZ1aB3"].join(""),
  jwt: [
    "eyJhbGciOiJIUzI1NiJ9",
    "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    "dBjftJeZ4CVPmB92K27uhbUJU1p1r",
  ].join("."),
  urlPassword: ["hun", "ter2"].join(""),
};

describe("redact", () => {
  it.each([
    [
      "assign the failing case to priya.sharma@customer.co.uk",
      "assign the failing case to [email]",
    ],
    [
      `https://admin:${fake.urlPassword}@tm.browserstack.com/api/v1/projects`,
      "https://[redacted]@tm.browserstack.com/api/v1/projects",
    ],
    [
      "the runner at 10.64.56.167 keeps timing out",
      "the runner at [ip] keeps timing out",
    ],
    [
      "escalate to +91 98765 43210 if it fails",
      "escalate to [phone] if it fails",
    ],
    [
      "account 4532015112830366 needs a re-run",
      "account [number] needs a re-run",
    ],
    [`${fake.awsKey} is in the env file`, "[token] is in the env file"],
    [`key ${fake.opaque} for staging`, "key [token] for staging"],
  ])("redacts %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("redacts a JWT", () => {
    expect(redact(`use ${fake.jwt} to auth`)).toBe("use [token] to auth");
  });

  it.each([
    "find the endpoint to add a test case to the Payments regression suite",
    "list all test runs in project PR-4471 that failed yesterday",
    "create a folder called Q3 Regression under the Checkout project",
    "will update 14 test cases in project PR-4471 to failed",
    "search for internationalisation coverage in the mobile suite",
  ])("leaves ordinary intent text untouched: %s", (input) => {
    expect(redact(input)).toBe(input);
  });

  it("redacts regardless of position in a long string", () => {
    const out = redact(`${"padding ".repeat(40)}priya@example.com`)!;
    expect(out).not.toContain("priya@example.com");
    expect(out).toContain("[email]");
  });

  it("collapses whitespace", () => {
    expect(redact("  list   test\n\nruns  ")).toBe("list test runs");
  });

  it("fails closed on anything that is not usable text", () => {
    expect(redact(undefined)).toBeUndefined();
    expect(redact(null)).toBeUndefined();
    expect(redact(42)).toBeUndefined();
    expect(redact("   ")).toBeUndefined();
  });
});
