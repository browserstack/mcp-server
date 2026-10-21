import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The replay test exercises `invoke`, which builds its own token transport, so the seam is
// `apiClient` — the same one `fetchTokenTransport` posts the grant through.
vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: {
    post: vi.fn(async () => ({
      status: 200,
      data: { access_token: "minted", expires_in: 3600 },
    })),
  },
}));

import {
  mintCentralToken,
  normaliseScopes,
  resetTokenCache,
  type TokenTransport,
} from "../../src/lib/central-oauth.js";
import { authHeaders } from "../../src/tools/capability-registry/egress.js";
import {
  DEFAULT_AUTH_TOKEN_URL,
  DEFAULT_SCOPES,
  REFRESH_SKEW_MS,
  resetOAuthAnnouncements,
  resolveScope,
  resolveTokenUrl,
} from "../../src/tools/capability-registry/oauth.js";

const USER = { username: "u", accessKey: "k" };

/** A transport that hands out a distinct token per call and records the forms it saw. */
function minter(overrides: Record<string, unknown> = {}) {
  const forms: Record<string, string>[] = [];
  let n = 0;
  const transport: TokenTransport = async (_url, form) => {
    forms.push(form);
    return {
      status: 200,
      body: { access_token: `token-${++n}`, expires_in: 3600, ...overrides },
    };
  };
  return { transport: vi.fn(transport) as unknown as TokenTransport, forms };
}

beforeEach(() => {
  resetTokenCache();
  resetOAuthAnnouncements();
  delete process.env.CAPABILITY_REGISTRY_AUTH_TOKEN_URL;
});

afterEach(() => {
  delete process.env.CAPABILITY_REGISTRY_AUTH_TOKEN_URL;
});

describe("scope resolution", () => {
  it("defaults to the pair, because the other half alone is not mintable", () => {
    // Measured against live central auth: `ai_agent` alone answers 400 invalid_request.
    // `oauth_user_profile` is not extra authority, it is what makes the grant obtainable
    // through the username+access_key flow.
    expect(resolveScope(undefined)).toBe("ai_agent oauth_user_profile");
    expect([...DEFAULT_SCOPES]).toContain("oauth_user_profile");
  });

  it("lets a product override it", () => {
    expect(resolveScope({ type: "oauth2", scopes: ["custom_scope"] })).toBe(
      "custom_scope",
    );
  });

  it("normalises order and duplicates, so one grant is one cache key", () => {
    expect(normaliseScopes(["b", "a"])).toBe(normaliseScopes(["a", "b"]));
    expect(normaliseScopes(["a", "a", " b "])).toBe("a b");
    expect(normaliseScopes(["a b"])).toBe("a b");
  });
});

describe("token endpoint resolution", () => {
  it("uses the built-in default when nothing declares one", () => {
    expect(resolveTokenUrl("tra", { type: "oauth2" })).toBe(
      DEFAULT_AUTH_TOKEN_URL,
    );
  });

  it("lets the environment overrule the index, like base_url does", () => {
    process.env.CAPABILITY_REGISTRY_AUTH_TOKEN_URL =
      "https://auth-preprod.bsstag.com/oauth2/v2/token";
    expect(
      resolveTokenUrl("tra", {
        type: "oauth2",
        token_url: "https://auth.browserstack.com/oauth2/v2/token",
      }),
    ).toBe("https://auth-preprod.bsstag.com/oauth2/v2/token");
  });

  // The index ships to public npm and picks where the caller's credentials are POSTed.
  it("refuses an index token_url on an unrecognised host", () => {
    expect(() =>
      resolveTokenUrl("tra", {
        type: "oauth2",
        token_url: "https://auth.evil.example/oauth2/v2/token",
      }),
    ).toThrow(/unrecognised host/);
  });

  it("refuses an index token_url that is not https", () => {
    expect(() =>
      resolveTokenUrl("tra", {
        type: "oauth2",
        token_url: "http://auth.browserstack.com/oauth2/v2/token",
      }),
    ).toThrow(/not https/);
  });
});

describe("the token cache", () => {
  const mint = (credentials = USER, scope = "s", now = 0) => ({
    url: "https://auth.example/token",
    scope,
    credentials,
    refreshSkewMs: REFRESH_SKEW_MS,
    cacheEnabled: true,
    now,
  });

  it("mints once and reuses, rather than per call", async () => {
    const { transport } = minter();
    const first = await mintCentralToken({ ...mint(), transport });
    const second = await mintCentralToken({ ...mint(), transport });
    expect(first).toBe(second);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  // The failure this file exists for: one user must never be served another's token.
  it("never serves one account's token to another", async () => {
    const { transport } = minter();
    const mine = await mintCentralToken({ ...mint(USER), transport });
    const theirs = await mintCentralToken({
      ...mint({ username: "other", accessKey: "other-key" }),
      transport,
    });
    expect(theirs).not.toBe(mine);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  // If cacheKey read a module constant instead of the scope argument, these would collide
  // and the second product would run on an authorization it never asked for.
  it("never serves a token minted for a different scope", async () => {
    const { transport } = minter();
    const a = await mintCentralToken({ ...mint(USER, "scope_a"), transport });
    const b = await mintCentralToken({ ...mint(USER, "scope_b"), transport });
    expect(b).not.toBe(a);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("mints again when the access key is rotated, not at expiry", async () => {
    const { transport } = minter();
    const before = await mintCentralToken({ ...mint(USER), transport });
    const after = await mintCentralToken({
      ...mint({ username: "u", accessKey: "rotated" }),
      transport,
    });
    expect(after).not.toBe(before);
  });

  it("refreshes before the token actually expires", async () => {
    const { transport } = minter();
    await mintCentralToken({ ...mint(USER, "s", 0), transport });
    // Inside the skirt: 3600s lifetime, read at 3600s - skew + 1ms.
    await mintCentralToken({
      ...mint(USER, "s", 3_600_000 - REFRESH_SKEW_MS + 1),
      transport,
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("trusts the granted lifetime over the one requested", async () => {
    // The endpoint clamps; caching for the hour we asked for would hand out a dead token.
    const { transport } = minter({ expires_in: 60 });
    await mintCentralToken({ ...mint(USER, "s", 0), transport });
    await mintCentralToken({ ...mint(USER, "s", 61_000), transport });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not hold anything when caching is off", async () => {
    const { transport } = minter();
    const opts = { ...mint(USER), transport, cacheEnabled: false };
    const first = await mintCentralToken(opts);
    const second = await mintCentralToken(opts);
    expect(second).not.toBe(first);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("mints once for concurrent callers", async () => {
    const { transport } = minter();
    const tokens = await Promise.all(
      Array.from({ length: 5 }, () =>
        mintCentralToken({ ...mint(), transport }),
      ),
    );
    expect(new Set(tokens).size).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so one bad mint does not poison the key", async () => {
    let attempt = 0;
    const transport: TokenTransport = async () =>
      ++attempt === 1
        ? { status: 500, body: null }
        : { status: 200, body: { access_token: "good", expires_in: 3600 } };
    await expect(mintCentralToken({ ...mint(), transport })).rejects.toThrow();
    await expect(mintCentralToken({ ...mint(), transport })).resolves.toBe(
      "good",
    );
  });
});

describe("what the invocation actually sends", () => {
  it("presents the JWT as a bearer token", async () => {
    const { transport, forms } = minter();
    const headers = await authHeaders(
      USER,
      { type: "oauth2" },
      "tra",
      transport,
    );
    expect(headers.Authorization).toBe("Bearer token-1");
    expect(headers["request-source"]).toBe("ai-chatbot");
    expect(forms[0]).toMatchObject({
      grant_type: "client_credentials",
      username: "u",
      scope: "ai_agent oauth_user_profile",
    });
  });

  it("still sends Api-Token for a product that declares no auth", async () => {
    const headers = await authHeaders(USER);
    expect(headers["Api-Token"]).toBe("u:k");
    expect(headers.Authorization).toBeUndefined();
  });

  // Silently ignoring these is how someone writes `"name": "X-Auth"`, gets a 401, and has
  // nothing in the message to explain it.
  it.each(["in", "name", "template"] as const)(
    "refuses '%s' on oauth2 rather than ignoring it",
    async (field) => {
      const { transport } = minter();
      await expect(
        authHeaders(
          USER,
          { type: "oauth2", [field]: "header" } as never,
          "tra",
          transport,
        ),
      ).rejects.toThrow(/oauth2 auth does not take/);
    },
  );

  it("names the product and says nothing was sent when the mint is refused", async () => {
    const transport: TokenTransport = async () => ({
      status: 401,
      body: {
        error: "invalid_client",
        error_description: "access_key XYZ is invalid",
      },
    });
    await expect(
      authHeaders(USER, { type: "oauth2" }, "tra", transport),
    ).rejects.toThrow(/token_mint_failed: could not sign in to 'tra'/);
  });

  // A non-200 body can echo the access key straight back; only the status may cross.
  it("never lets the auth response body into the error", async () => {
    const transport: TokenTransport = async () => ({
      status: 401,
      body: {
        error: "invalid_client",
        error_description: "access_key k is invalid",
      },
    });
    await expect(
      authHeaders(USER, { type: "oauth2" }, "tra", transport),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("is invalid"),
      }) as never,
    );
  });

  it("tells a provisioning refusal apart from a wrong password", async () => {
    const transport: TokenTransport = async () => ({
      status: 400,
      body: { error: "invalid_scope" },
    });
    await expect(
      authHeaders(USER, { type: "oauth2" }, "tra", transport),
    ).rejects.toThrow(/provisioning problem/);
  });

  it("does not blame the caller for a 5xx", async () => {
    const transport: TokenTransport = async () => ({ status: 503, body: null });
    await expect(
      authHeaders(USER, { type: "oauth2" }, "tra", transport),
    ).rejects.toThrow(/CREDENTIALS ARE NOT THE PROBLEM/);
  });
});

describe("a token the product rejects", () => {
  const CAP = {
    method: "GET",
    path: "/api/v1/builds",
    mode: "read" as const,
    entity: "build",
  };

  it("replays once with a fresh token, rather than failing the call", async () => {
    const { invoke } =
      await import("../../src/tools/capability-registry/resolve.js");
    const statuses = [401, 200];
    const transport = vi.fn(async () => ({
      status: statuses.shift() ?? 200,
      body: {},
    }));

    const result = await invoke(
      CAP,
      { path_params: {}, query: {}, body: {} },
      "https://tra.example",
      USER,
      transport as never,
      { type: "oauth2" },
      "tra",
    );

    expect(result.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("gives up after one replay, so a wrong password cannot loop", async () => {
    const { invoke } =
      await import("../../src/tools/capability-registry/resolve.js");
    const transport = vi.fn(async () => ({ status: 401, body: {} }));

    const result = await invoke(
      CAP,
      { path_params: {}, query: {}, body: {} },
      "https://tra.example",
      USER,
      transport as never,
      { type: "oauth2" },
      "tra",
    );

    expect(result.ok).toBe(false);
    expect(result.http_response.status).toBe(401);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not replay for a scheme that mints nothing", async () => {
    const { invoke } =
      await import("../../src/tools/capability-registry/resolve.js");
    const transport = vi.fn(async () => ({ status: 401, body: {} }));

    await invoke(
      CAP,
      { path_params: {}, query: {}, body: {} },
      "https://tra.example",
      USER,
      transport as never,
      undefined,
      "tm",
    );

    expect(transport).toHaveBeenCalledTimes(1);
  });
});
