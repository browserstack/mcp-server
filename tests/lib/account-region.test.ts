import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../../src/lib/account-region.js");

// A plain function rather than vi.fn: vitest fails a test whose cleared vi.fn returned a
// rejected promise, even when the code under test handles it.
let mintImpl: () => Promise<string> = async () => "";
const mintCalls: unknown[] = [];
vi.mock("../../src/lib/central-oauth.js", () => ({
  mintCentralToken: (options: unknown) => {
    mintCalls.push(options);
    return mintImpl();
  },
  fetchTokenTransport: () => "transport",
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  accountRegion,
  regionFromToken,
} from "../../src/lib/account-region.js";

const tokenWith = (user: unknown) =>
  `h.${Buffer.from(JSON.stringify({ user })).toString("base64url")}.s`;

const config = () => ({
  "browserstack-username": "user",
  "browserstack-access-key": "key",
});

describe("regionFromToken", () => {
  it.each(["eu", "in", "us"])("reads the %s region", (region) => {
    expect(
      regionFromToken(tokenWith({ grr: { region, to_be_ignored: {} } })),
    ).toBe(region);
  });

  it.each([
    ["no grr claim", {}],
    ["a null grr claim", { grr: null }],
    ["an empty region", { grr: { region: "" } }],
  ])("treats %s as a US account", (_, user) => {
    expect(regionFromToken(tokenWith(user))).toBe("us");
  });

  it("does not guess at a region it does not know", () => {
    expect(regionFromToken(tokenWith({ grr: { region: "apac" } }))).toBe(
      "unknown",
    );
  });
});

describe("accountRegion", () => {
  beforeEach(() => {
    mintCalls.length = 0;
  });

  it("looks up nothing without credentials", () => {
    expect(accountRegion(undefined)).toBeUndefined();
    expect(
      accountRegion({
        "browserstack-username": "",
        "browserstack-access-key": "",
      }),
    ).toBeUndefined();
    expect(mintCalls).toHaveLength(0);
  });

  it("mints a user profile token with the config's credentials", async () => {
    mintImpl = async () => tokenWith({ grr: { region: "eu" } });
    expect(await accountRegion(config())).toBe("eu");
    expect(mintCalls).toEqual([
      expect.objectContaining({
        url: "https://auth.browserstack.com/oauth2/v2/token",
        scope: "oauth_user_profile",
        credentials: { username: "user", accessKey: "key" },
        cacheEnabled: false,
      }),
    ]);
  });

  it("looks up once per config and answers directly once known", async () => {
    mintImpl = async () => tokenWith({ grr: { region: "in" } });
    const cfg = config();
    const first = accountRegion(cfg);
    expect(first).toBeInstanceOf(Promise);
    expect(await first).toBe("in");
    expect(accountRegion(cfg)).toBe("in");
    expect(mintCalls).toHaveLength(1);
  });

  it("looks up each config on its own", async () => {
    const tokens = [tokenWith({ grr: { region: "eu" } }), tokenWith({})];
    mintImpl = async () => tokens.shift()!;
    expect(await accountRegion(config())).toBe("eu");
    expect(await accountRegion(config())).toBe("us");
    expect(mintCalls).toHaveLength(2);
  });

  it("answers unknown when the lookup fails", async () => {
    mintImpl = async () => {
      throw new Error("auth could not be reached");
    };
    expect(await accountRegion(config())).toBe("unknown");
  });
});
