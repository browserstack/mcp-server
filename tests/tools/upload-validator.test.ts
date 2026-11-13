import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  validateUploadPath,
  APP_BINARY_EXTENSIONS,
  TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
  MAX_APP_UPLOAD_BYTES,
  MAX_ATTACHMENT_UPLOAD_BYTES,
} from "../../src/lib/upload-validator";

describe("validateUploadPath", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-validator-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const write = (name: string, contents = "hello") => {
    const p = path.join(workDir, name);
    fs.writeFileSync(p, contents);
    return p;
  };

  // Base dir pointing at workDir, so files written by `write` are inside it.
  const inWorkDir = (overrides: Record<string, unknown> = {}) => ({
    allowedExtensions: APP_BINARY_EXTENSIONS,
    maxSizeBytes: MAX_APP_UPLOAD_BYTES,
    allowedBaseDir: workDir,
    ...overrides,
  });

  it("accepts a regular file with an allowed extension", () => {
    const file = write("app.apk");
    const resolved = validateUploadPath(file, inWorkDir());
    expect(resolved).toBe(fs.realpathSync(file));
  });

  it("refuses when no base directory is configured (MCP_UPLOAD_BASE_DIR unset)", () => {
    const file = write("app.apk");
    expect(() =>
      validateUploadPath(file, {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      }),
    ).toThrow(/MCP_UPLOAD_BASE_DIR is not set/);
  });

  it("refuses when the configured base directory does not exist", () => {
    const file = write("app.apk");
    expect(() =>
      validateUploadPath(file, {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
        allowedBaseDir: path.join(os.tmpdir(), "no-such-base-dir-xyz"),
      }),
    ).toThrow(/does not exist/);
  });

  it("rejects an empty path", () => {
    expect(() =>
      validateUploadPath("   ", {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      }),
    ).toThrow(/file path is empty/);
  });

  it("rejects a missing file with the same message as an outside path", () => {
    expect(() =>
      validateUploadPath(path.join(workDir, "does-not-exist.apk"), inWorkDir()),
    ).toThrow(/must be an existing file inside/);
  });

  it("rejects a directory", () => {
    const dir = fs.mkdtempSync(path.join(workDir, "subdir-"));
    expect(() => validateUploadPath(dir, inWorkDir())).toThrow(/regular file/);
  });

  it("rejects a disallowed extension", () => {
    const file = write("secrets.pem");
    expect(() => validateUploadPath(file, inWorkDir())).toThrow(
      /extension ".pem" is not in the allowed list/,
    );
  });

  it("rejects a file with no extension (e.g. /etc/passwd)", () => {
    const file = write("passwd");
    expect(() =>
      validateUploadPath(
        file,
        inWorkDir({
          allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
          maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
        }),
      ),
    ).toThrow(/extension "\(none\)" is not in the allowed list/);
  });

  it("rejects a file inside a hidden directory (e.g. ~/.ssh/key.txt)", () => {
    const hidden = path.join(workDir, ".ssh");
    fs.mkdirSync(hidden);
    const file = path.join(hidden, "id_rsa.txt");
    fs.writeFileSync(file, "secret");
    expect(() =>
      validateUploadPath(
        file,
        inWorkDir({
          allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
          maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
        }),
      ),
    ).toThrow(/hidden directory or file \(".ssh"\)/);
  });

  it("rejects a hidden file (e.g. .env)", () => {
    const file = path.join(workDir, ".env.txt");
    fs.writeFileSync(file, "secret");
    expect(() =>
      validateUploadPath(
        file,
        inWorkDir({
          allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
          maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
        }),
      ),
    ).toThrow(/hidden directory or file/);
  });

  it("rejects a symlink that points into a hidden directory", () => {
    const hidden = path.join(workDir, ".aws");
    fs.mkdirSync(hidden);
    const target = path.join(hidden, "credentials.json");
    fs.writeFileSync(target, "{}");
    const link = path.join(workDir, "harmless.json");
    fs.symlinkSync(target, link);
    expect(() =>
      validateUploadPath(
        link,
        inWorkDir({
          allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
          maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
        }),
      ),
    ).toThrow(/hidden directory or file \(".aws"\)/);
  });

  it("rejects a file that exceeds the size limit", () => {
    const file = write("app.apk", "x".repeat(10));
    expect(() =>
      validateUploadPath(file, inWorkDir({ maxSizeBytes: 5 })),
    ).toThrow(/exceeds maximum allowed size/);
  });

  it("enforces allowedBaseDir containment when configured", () => {
    const outside = write("app.apk");
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "allowed-base-"));
    try {
      expect(() =>
        validateUploadPath(outside, {
          allowedExtensions: APP_BINARY_EXTENSIONS,
          maxSizeBytes: MAX_APP_UPLOAD_BYTES,
          allowedBaseDir: baseDir,
        }),
      ).toThrow(/must be an existing file inside/);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("gives the same error for a path outside the base dir and a missing one", () => {
    // The oracle fix: existence/type/size/extension of anything outside the
    // allowed directory must not be distinguishable from a path that does not
    // exist. Both must throw the identical message.
    const realOutside = write("real.apk"); // exists, but outside baseDir
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "allowed-base-"));
    try {
      const opts = {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: 1, // would trip the size check if it were reachable
        allowedBaseDir: baseDir,
      };
      let outsideMsg = "";
      let missingMsg = "";
      try {
        validateUploadPath(realOutside, opts);
      } catch (e) {
        outsideMsg = (e as Error).message;
      }
      try {
        validateUploadPath(path.join(baseDir, "nope.apk"), opts);
      } catch (e) {
        missingMsg = (e as Error).message;
      }
      expect(outsideMsg).toMatch(/must be an existing file inside/);
      expect(outsideMsg).toBe(missingMsg);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("allows files inside allowedBaseDir", () => {
    const inside = path.join(workDir, "nested", "app.apk");
    fs.mkdirSync(path.dirname(inside));
    fs.writeFileSync(inside, "data");
    const resolved = validateUploadPath(inside, inWorkDir());
    expect(resolved).toBe(fs.realpathSync(inside));
  });

  it("rejects a path that escapes allowedBaseDir via symlink", () => {
    const outsideTarget = path.join(workDir, "real.apk");
    fs.writeFileSync(outsideTarget, "data");
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "allowed-base-"));
    try {
      const link = path.join(baseDir, "inside.apk");
      fs.symlinkSync(outsideTarget, link);
      expect(() =>
        validateUploadPath(link, {
          allowedExtensions: APP_BINARY_EXTENSIONS,
          maxSizeBytes: MAX_APP_UPLOAD_BYTES,
          allowedBaseDir: baseDir,
        }),
      ).toThrow(/must be an existing file inside/);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("is case-insensitive on extensions", () => {
    const file = write("APP.APK");
    const resolved = validateUploadPath(file, inWorkDir());
    expect(resolved).toBe(fs.realpathSync(file));
  });
});
