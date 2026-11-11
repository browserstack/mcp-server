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

const ATTACHMENT = {
  name: "upload_generic_attachments",
  method: "POST",
  path: "/api/v1/projects/{project_id}/generic/attachments",
  mode: "write",
  entity: "attachment",
  encoding: "multipart",
  local_only: true,
  path_params: [{ name: "project_id", type: "integer", required: true }],
  body: [
    {
      name: "file",
      type: "file",
      required: true,
      form_name: "attachments[]",
      accept: [".png", ".jpg"],
      max_bytes: 16,
    },
  ],
};

describe("a file parameter that declares its own rules", () => {
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "uploads-"));
  });
  afterEach(() => {
    vi.doUnmock("../../src/config.js");
    rmSync(base, { recursive: true, force: true });
  });

  it("accepts an extension from `accept` that the app-build default would refuse", async () => {
    const png = join(base, "step-3.png");
    writeFileSync(png, "png");
    const { bind } = await bindWith(base);
    const bound = bind(ATTACHMENT as never, {
      path_params: { project_id: 7 },
      body: { file: png },
    });
    expect(String((bound.body as Record<string, unknown>).file)).toContain(
      "step-3.png",
    );
  });

  it("refuses an app build when `accept` does not list it", async () => {
    const apkFile = join(base, "app-release.apk");
    writeFileSync(apkFile, "apk");
    const { bind } = await bindWith(base);
    expect(() =>
      bind(ATTACHMENT as never, {
        path_params: { project_id: 7 },
        body: { file: apkFile },
      }),
    ).toThrow(/extension/);
  });

  it("refuses a file over `max_bytes` before anything is sent", async () => {
    const big = join(base, "big.png");
    writeFileSync(big, "x".repeat(17));
    const { bind } = await bindWith(base);
    expect(() =>
      bind(ATTACHMENT as never, {
        path_params: { project_id: 7 },
        body: { file: big },
      }),
    ).toThrow(/exceeds maximum allowed size/);
  });

  it("sends the file under `form_name`, not the parameter name", async () => {
    const png = join(base, "step-3.png");
    writeFileSync(png, "png-bytes");
    vi.resetModules();
    vi.doMock("../../src/config.js", () => ({
      default: { UPLOAD_BASE_DIR: base, REMOTE_MCP: false },
    }));
    const { invoke } = await import(
      "../../src/tools/capability-registry/resolve.js"
    );
    let sent: { url: string; headers: Record<string, string>; body: unknown } =
      { url: "", headers: {}, body: undefined };
    const transport = async (
      _method: string,
      url: string,
      headers: Record<string, string>,
      _query: Record<string, unknown>,
      body?: unknown,
    ) => {
      sent = { url, headers, body };
      return { status: 200, body: { generic_attachment: [{ id: 42 }] } };
    };
    await invoke(
      ATTACHMENT as never,
      { path_params: { project_id: 7 }, body: { file: png } },
      "https://tm.example",
      { username: "u", accessKey: "k" },
      transport,
    );
    expect(sent.url).toBe(
      "https://tm.example/api/v1/projects/7/generic/attachments",
    );
    expect(sent.headers["Content-Type"]).toBeUndefined();
    const form = sent.body as FormData;
    expect(form.has("file")).toBe(false);
    const part = form.get("attachments[]") as File;
    expect(part.name).toBe("step-3.png");
    expect(await part.text()).toBe("png-bytes");
  });
});

describe("tm's upload_generic_attachments in the shipped index", () => {
  it("is enabled, local-only and multipart, with the attachment rules on its file parameter", async () => {
    const { readFileSync } = await import("node:fs");
    const index = JSON.parse(
      readFileSync(
        join(__dirname, "../../capability/tm.capability-index.json"),
        "utf-8",
      ),
    );
    const capability = index.tm.capabilities.find(
      (c: { name: string }) => c.name === "upload_generic_attachments",
    );
    expect(capability.disabled).toBeUndefined();
    expect(capability.local_only).toBe(true);
    expect(capability.encoding).toBe("multipart");
    const file = capability.body.find(
      (p: { type: string }) => p.type === "file",
    );
    expect(file.form_name).toBe("attachments[]");
    expect(file.accept).toEqual(expect.arrayContaining([".png", ".jpg"]));
    expect(file.max_bytes).toBe(50 * 1024 * 1024);
  });

  it("accepts every generic Test Management attachment extension", async () => {
    const { readFileSync } = await import("node:fs");
    const { TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS } = await import(
      "../../src/lib/upload-validator.js"
    );
    const index = JSON.parse(
      readFileSync(
        join(__dirname, "../../capability/tm.capability-index.json"),
        "utf-8",
      ),
    );
    const file = index.tm.capabilities
      .find((c: { name: string }) => c.name === "upload_generic_attachments")
      .body.find((p: { type: string }) => p.type === "file");
    expect(file.accept).toEqual(
      expect.arrayContaining([...TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS]),
    );
  });
});
