import { describe, it, expect, vi, beforeEach } from "vitest";
import { elicitCredentialsIfSupported } from "../../src/lib/elicit-credentials";

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const FIELDS = [
  { key: "username", title: "Username", description: "The username" },
  { key: "password", title: "Password", description: "The password" },
];

function makeServer(opts: {
  elicitationSupported?: boolean;
  elicitResult?: any;
  elicitThrows?: boolean;
}) {
  const elicitInput = vi.fn();
  if (opts.elicitThrows) {
    elicitInput.mockRejectedValue(new Error("client error"));
  } else {
    elicitInput.mockResolvedValue(opts.elicitResult);
  }
  return {
    server: {
      getClientCapabilities: vi
        .fn()
        .mockReturnValue(opts.elicitationSupported ? { elicitation: {} } : {}),
      elicitInput,
    },
  } as any;
}

describe("elicitCredentialsIfSupported", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns provided values unchanged when nothing is missing (no elicitation)", async () => {
    const server = makeServer({ elicitationSupported: true });
    const out = await elicitCredentialsIfSupported(
      server,
      { username: "u", password: "p" },
      FIELDS,
      "msg",
    );
    expect(out).toEqual({ username: "u", password: "p" });
    expect(server.server.elicitInput).not.toHaveBeenCalled();
  });

  it("falls back to provided values when the client does not support elicitation", async () => {
    const server = makeServer({ elicitationSupported: false });
    const out = await elicitCredentialsIfSupported(
      server,
      { username: undefined, password: undefined },
      FIELDS,
      "msg",
    );
    expect(out).toEqual({ username: undefined, password: undefined });
    expect(server.server.elicitInput).not.toHaveBeenCalled();
  });

  it("elicits missing values when supported and the user accepts", async () => {
    const server = makeServer({
      elicitationSupported: true,
      elicitResult: { action: "accept", content: { username: "eu", password: "ep" } },
    });
    const out = await elicitCredentialsIfSupported(
      server,
      { username: undefined, password: undefined },
      FIELDS,
      "msg",
    );
    expect(out).toEqual({ username: "eu", password: "ep" });
    // Only missing fields are requested and marked required.
    const req = server.server.elicitInput.mock.calls[0][0].requestedSchema;
    expect(req.required).toEqual(["username", "password"]);
  });

  it("only elicits the field that is missing", async () => {
    const server = makeServer({
      elicitationSupported: true,
      elicitResult: { action: "accept", content: { password: "ep" } },
    });
    const out = await elicitCredentialsIfSupported(
      server,
      { username: "u", password: undefined },
      FIELDS,
      "msg",
    );
    expect(out).toEqual({ username: "u", password: "ep" });
    const req = server.server.elicitInput.mock.calls[0][0].requestedSchema;
    expect(req.required).toEqual(["password"]);
  });

  it("falls back to provided values when the user declines", async () => {
    const server = makeServer({
      elicitationSupported: true,
      elicitResult: { action: "decline" },
    });
    const out = await elicitCredentialsIfSupported(
      server,
      { username: undefined, password: undefined },
      FIELDS,
      "msg",
    );
    expect(out).toEqual({ username: undefined, password: undefined });
  });

  it("falls back to provided values when elicitation throws", async () => {
    const server = makeServer({ elicitationSupported: true, elicitThrows: true });
    const out = await elicitCredentialsIfSupported(
      server,
      { username: "u", password: undefined },
      FIELDS,
      "msg",
    );
    expect(out).toEqual({ username: "u", password: undefined });
  });
});
