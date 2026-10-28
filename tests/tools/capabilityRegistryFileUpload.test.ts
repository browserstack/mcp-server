import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A `file` parameter carries the bytes of a build rather than a reference to one. The path
// is checked inside `bind`, which register.ts runs dry BEFORE the write-consent gate — so a
// misplaced file or an unconfigured base directory is refused before the user is asked to
// approve an upload that was never going to happen.

const CAPABILITY = {
  name: "upload_app_build_from_file",
  method: "POST",
  path: "/app-automate/upload",
  mode: "write",
  entity: "app_build",
  encoding: "multipart",
  local_only: true,
  body: [
    { name: "file", type: "file", required: true },
    { name: "custom_id", type: "string" },
  ],
};

let base: string;
let apk: string;
let outside: string;

async function bindWith(uploadBaseDir: string | undefined) {
  vi.resetModules();
  vi.doMock("../../src/config.js", () => ({
    default: { UPLOAD_BASE_DIR: uploadBaseDir, REMOTE_MCP: false },
  }));
  return import("../../src/tools/capability-registry/bind.js");
}

describe("a file parameter", () => {
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "uploads-"));
    apk = join(base, "app-release.apk");
    writeFileSync(apk, "not really an apk");
    const other = mkdtempSync(join(tmpdir(), "elsewhere-"));
    outside = join(other, "app-release.apk");
    writeFileSync(outside, "not really an apk");
  });
  afterEach(() => {
    vi.doUnmock("../../src/config.js");
    rmSync(base, { recursive: true, force: true });
  });

  it("resolves a build inside the configured directory to its canonical path", async () => {
    const { bind } = await bindWith(base);
    const bound = bind(CAPABILITY as never, { body: { file: apk } });
    expect(String((bound.body as Record<string, unknown>).file)).toContain(
      "app-release.apk",
    );
  });

  it("refuses when MCP_UPLOAD_BASE_DIR is not set, and says to set it", async () => {
    // The agent has to be able to tell the user what to do, so the refusal names the
    // variable rather than reporting a generic rejection.
    const { bind } = await bindWith(undefined);
    expect(() => bind(CAPABILITY as never, { body: { file: apk } })).toThrow(
      /MCP_UPLOAD_BASE_DIR is not set/,
    );
  });

  it("refuses a build outside the directory, and names the directory it must be in", async () => {
    const { bind } = await bindWith(base);
    expect(() =>
      bind(CAPABILITY as never, { body: { file: outside } }),
    ).toThrow(/must be located inside/);
  });

  it("refuses an extension that is not an app build", async () => {
    const notes = join(base, "notes.txt");
    writeFileSync(notes, "hello");
    const { bind } = await bindWith(base);
    expect(() => bind(CAPABILITY as never, { body: { file: notes } })).toThrow(
      /extension/,
    );
  });

  it("refuses a path that does not exist", async () => {
    const { bind } = await bindWith(base);
    expect(() =>
      bind(CAPABILITY as never, { body: { file: join(base, "gone.apk") } }),
    ).toThrow(/File not found/);
  });

  it("refuses a build under a hidden directory", async () => {
    // Blocks ~/.ssh and friends even after symlink resolution.
    const hidden = join(base, ".secrets");
    mkdirSync(hidden);
    const hiddenApk = join(hidden, "app-release.apk");
    writeFileSync(hiddenApk, "x");
    const { bind } = await bindWith(base);
    expect(() =>
      bind(CAPABILITY as never, { body: { file: hiddenApk } }),
    ).toThrow(/hidden directory/);
  });

  it("refuses an empty path instead of reading the working directory", async () => {
    const { bind } = await bindWith(base);
    expect(() => bind(CAPABILITY as never, { body: { file: "  " } })).toThrow(
      /must be a path to a file/,
    );
  });
});
