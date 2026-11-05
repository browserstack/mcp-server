import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Some capabilities only mean anything when the person and the process share a computer —
// one that reads a file the caller names is the clear case. On a remote server that path
// resolves against the operator's disk, so the capability is not merely unreliable there,
// it is wrong. `local_only` withholds it on that surface while the same artifact keeps
// publishing it locally.

const LOCAL = {
  name: "read_local_thing",
  method: "POST",
  path: "/x",
  mode: "write",
  entity: "e",
  local_only: true,
};
const SHARED = {
  name: "read_remote_thing",
  method: "GET",
  path: "/y",
  mode: "read",
  entity: "e",
};
const OFF = {
  name: "never_available",
  method: "GET",
  path: "/z",
  mode: "read",
  entity: "e",
  disabled: true,
};

async function loader(remote: boolean) {
  vi.resetModules();
  vi.doMock("../../src/config.js", () => ({ default: { REMOTE_MCP: remote } }));
  return import("../../src/tools/capability-registry/index-loader.js");
}

describe("local_only", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../../src/config.js"));

  it("is published on a local server", async () => {
    const { isDisabled } = await loader(false);
    expect(isDisabled(LOCAL as never)).toBe(false);
  });

  it("is withheld on a remote server", async () => {
    const { isDisabled } = await loader(true);
    expect(isDisabled(LOCAL as never)).toBe(true);
  });

  it("leaves every other capability alone on both surfaces", async () => {
    for (const remote of [false, true]) {
      const { isDisabled } = await loader(remote);
      expect(isDisabled(SHARED as never)).toBe(false);
    }
  });

  it("keeps `disabled` withholding everywhere, local included", async () => {
    // The two flags are independent: one is about where it can run, the other about
    // whether it runs at all.
    for (const remote of [false, true]) {
      const { isDisabled } = await loader(remote);
      expect(isDisabled(OFF as never)).toBe(true);
    }
  });

  it("fails closed on a truthy value that is not a boolean", async () => {
    // A flag whose only job is suppression must not be ignored for arriving oddly shaped.
    const { isDisabled } = await loader(true);
    expect(isDisabled({ ...LOCAL, local_only: "yes" } as never)).toBe(true);
  });

  it("does not withhold when the flag is absent, whatever the surface", async () => {
    const { isDisabled } = await loader(true);
    expect(isDisabled({ ...LOCAL, local_only: undefined } as never)).toBe(
      false,
    );
  });
});
