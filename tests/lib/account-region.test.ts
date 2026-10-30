import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  REGION_TTL_MS,
  RETRY_AFTER_MS,
} from "../../src/lib/account-region.js";

const settleLookups = () => new Promise((resolve) => setImmediate(resolve));

const tokenWith = (user: unknown) =>
  `h.${Buffer.from(JSON.stringify({ user })).toString("base64url")}.s`;

// Lookups are kept per account, so each test uses an account of its own.
let accounts = 0;
const config = (username = `user-${++accounts}`) => ({
  "browserstack-username": username,
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

  it("reads a region in any case", () => {
    expect(regionFromToken(tokenWith({ grr: { region: "EU" } }))).toBe("eu");
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
    expect(await accountRegion(config("user"))).toBe("eu");
    expect(mintCalls).toEqual([
      expect.objectContaining({
        url: "https://auth.browserstack.com/oauth2/v2/token",
        scope: "oauth_user_profile",
        credentials: { username: "user", accessKey: "key" },
        cacheEnabled: false,
      }),
    ]);
  });

  it("looks up once per account and answers directly once known", async () => {
    mintImpl = async () => tokenWith({ grr: { region: "in" } });
    const cfg = config();
    const first = accountRegion(cfg);
    expect(first).toBeInstanceOf(Promise);
    expect(await first).toBe("in");
    expect(accountRegion(cfg)).toBe("in");
    expect(mintCalls).toHaveLength(1);
  });

  it("shares one lookup between configs for the same account", async () => {
    mintImpl = async () => tokenWith({ grr: { region: "eu" } });
    const [a, b] = [config("shared"), config("shared")];
    const [first, second] = await Promise.all([
      accountRegion(a),
      accountRegion(b),
    ]);
    expect([first, second, accountRegion(config("shared"))]).toEqual([
      "eu",
      "eu",
      "eu",
    ]);
    expect(mintCalls).toHaveLength(1);
  });

  it("looks up each account on its own", async () => {
    const tokens = [tokenWith({ grr: { region: "eu" } }), tokenWith({})];
    mintImpl = async () => tokens.shift()!;
    expect(await accountRegion(config())).toBe("eu");
    expect(await accountRegion(config())).toBe("us");
    expect(mintCalls).toHaveLength(2);
  });

  it("keeps an unrecognised region as an answer", async () => {
    mintImpl = async () => tokenWith({ grr: { region: "apac" } });
    const cfg = config();
    expect(await accountRegion(cfg)).toBe("unknown");
    expect(accountRegion(cfg)).toBe("unknown");
    expect(mintCalls).toHaveLength(1);
  });

  it("answers unknown when the lookup fails", async () => {
    mintImpl = async () => {
      throw new Error("auth could not be reached");
    };
    expect(await accountRegion(config())).toBe("unknown");
  });

  describe("after a failed lookup", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("answers unknown without looking up again until the retry delay", async () => {
      mintImpl = async () => {
        throw new Error("auth could not be reached");
      };
      const cfg = config();
      expect(await accountRegion(cfg)).toBe("unknown");
      vi.advanceTimersByTime(RETRY_AFTER_MS - 1);
      expect(accountRegion(cfg)).toBe("unknown");
      expect(mintCalls).toHaveLength(1);
    });

    it("keeps the last known region when a refresh fails", async () => {
      mintImpl = async () => tokenWith({ grr: { region: "eu" } });
      const cfg = config();
      expect(await accountRegion(cfg)).toBe("eu");

      mintImpl = async () => {
        throw new Error("auth could not be reached");
      };
      vi.advanceTimersByTime(REGION_TTL_MS);
      expect(accountRegion(cfg)).toBe("eu");
      await settleLookups();
      expect(accountRegion(cfg)).toBe("eu");
      expect(mintCalls).toHaveLength(2);

      mintImpl = async () => tokenWith({});
      vi.advanceTimersByTime(RETRY_AFTER_MS);
      expect(accountRegion(cfg)).toBe("eu");
      await settleLookups();
      expect(accountRegion(cfg)).toBe("us");
      expect(mintCalls).toHaveLength(3);
    });

    it("looks up a known region again once it expires", async () => {
      mintImpl = async () => tokenWith({ grr: { region: "eu" } });
      const cfg = config();
      expect(await accountRegion(cfg)).toBe("eu");
      vi.advanceTimersByTime(REGION_TTL_MS - 1);
      expect(accountRegion(cfg)).toBe("eu");
      expect(mintCalls).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(accountRegion(cfg)).toBe("eu");
      expect(mintCalls).toHaveLength(2);
    });

    it("looks up again after the retry delay and keeps the answer", async () => {
      mintImpl = async () => {
        throw new Error("auth could not be reached");
      };
      const cfg = config();
      expect(await accountRegion(cfg)).toBe("unknown");

      mintImpl = async () => tokenWith({ grr: { region: "eu" } });
      vi.advanceTimersByTime(RETRY_AFTER_MS);
      expect(await accountRegion(cfg)).toBe("eu");
      expect(accountRegion(cfg)).toBe("eu");
      expect(mintCalls).toHaveLength(2);
    });
  });
});
