import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("accepts a regular file with an allowed extension", () => {
    const file = write("app.apk");
    const resolved = validateUploadPath(file, {
      allowedExtensions: APP_BINARY_EXTENSIONS,
      maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      allowedBaseDir: workDir,
    });
    expect(resolved).toBe(fs.realpathSync(file));
  });

  it("defaults containment to the process working directory (fail-closed)", () => {
    const outside = write("app.apk");
    expect(() =>
      validateUploadPath(outside, {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      }),
    ).toThrow(/must be located inside/);
  });

  it("allows files inside the working directory when no base dir is set", () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workDir);
    try {
      const file = write("app.apk");
      const resolved = validateUploadPath(file, {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      });
      expect(resolved).toBe(fs.realpathSync(file));
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("rejects an empty path", () => {
    expect(() =>
      validateUploadPath("   ", {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      }),
    ).toThrow(/file path is empty/);
  });

  it("rejects a missing file", () => {
    expect(() =>
      validateUploadPath(path.join(workDir, "does-not-exist.apk"), {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      }),
    ).toThrow(/File not found/);
  });

  it("rejects a directory", () => {
    const dir = fs.mkdtempSync(path.join(workDir, "subdir-"));
    expect(() =>
      validateUploadPath(dir, {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      }),
    ).toThrow(/regular file/);
  });

  it("rejects a disallowed extension", () => {
    const file = write("secrets.pem");
    expect(() =>
      validateUploadPath(file, {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      }),
    ).toThrow(/extension ".pem" is not in the allowed list/);
  });

  it("rejects a file with no extension (e.g. /etc/passwd)", () => {
    const file = write("passwd");
    expect(() =>
      validateUploadPath(file, {
        allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
        maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
      }),
    ).toThrow(/extension "\(none\)" is not in the allowed list/);
  });

  it("rejects a file inside a hidden directory (e.g. ~/.ssh/key.txt)", () => {
    const hidden = path.join(workDir, ".ssh");
    fs.mkdirSync(hidden);
    const file = path.join(hidden, "id_rsa.txt");
    fs.writeFileSync(file, "secret");
    expect(() =>
      validateUploadPath(file, {
        allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
        maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
      }),
    ).toThrow(/hidden directory or file \(".ssh"\)/);
  });

  it("rejects a hidden file (e.g. .env)", () => {
    const file = path.join(workDir, ".env.txt");
    fs.writeFileSync(file, "secret");
    expect(() =>
      validateUploadPath(file, {
        allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
        maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
      }),
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
      validateUploadPath(link, {
        allowedExtensions: TEST_MANAGEMENT_ATTACHMENT_EXTENSIONS,
        maxSizeBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
      }),
    ).toThrow(/hidden directory or file \(".aws"\)/);
  });

  it("rejects a file that exceeds the size limit", () => {
    const file = write("app.apk", "x".repeat(10));
    expect(() =>
      validateUploadPath(file, {
        allowedExtensions: APP_BINARY_EXTENSIONS,
        maxSizeBytes: 5,
      }),
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
      ).toThrow(/must be located inside/);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("allows files inside allowedBaseDir", () => {
    const inside = path.join(workDir, "nested", "app.apk");
    fs.mkdirSync(path.dirname(inside));
    fs.writeFileSync(inside, "data");
    const resolved = validateUploadPath(inside, {
      allowedExtensions: APP_BINARY_EXTENSIONS,
      maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      allowedBaseDir: workDir,
    });
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
      ).toThrow(/must be located inside/);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("is case-insensitive on extensions", () => {
    const file = write("APP.APK");
    const resolved = validateUploadPath(file, {
      allowedExtensions: APP_BINARY_EXTENSIONS,
      maxSizeBytes: MAX_APP_UPLOAD_BYTES,
      allowedBaseDir: workDir,
    });
    expect(resolved).toBe(fs.realpathSync(file));
  });
});
