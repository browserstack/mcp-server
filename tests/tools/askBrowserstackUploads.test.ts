import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_FILES,
  UploadError,
  readUploadFile,
  uploadFiles,
} from "../../src/tools/ask-browserstack/uploads.js";

const AID = "att_" + "a".repeat(32);
const AGENT = "https://atlas.example.test/agent";
const S3 = "https://bucket.s3.eu-central-1.amazonaws.com/";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-uploads-"));
  fs.writeFileSync(path.join(dir, "checkout-prd.pdf"), "%PDF-1.7 checkout");
  fs.writeFileSync(path.join(dir, "notes.md"), "# notes");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Atlas's slot route and storage; anything else is a call this module must not make. */
function fakeFetch(answers: { slot?: Response; put?: Response } = {}) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === `${AGENT}/attachments`) {
      return (
        answers.slot ??
        json(200, {
          id: AID,
          upload: { url: S3, fields: { key: "raw/x", policy: "p" } },
          expires_in: 900,
        })
      );
    }
    if (u === S3) return answers.put ?? new Response(null, { status: 204 });
    throw new Error(`unexpected request to ${u}`);
  }) as typeof fetch;
  return { impl, calls };
}

function deps(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return {
    agentUrl: AGENT,
    headers: { authorization: "Bearer t" },
    product: "tm",
    baseDir: dir,
    fetchImpl,
    ...over,
  };
}

describe("readUploadFile", () => {
  it("resolves a bare name against the upload folder", () => {
    const f = readUploadFile("checkout-prd.pdf", dir);
    expect(f.name).toBe("checkout-prd.pdf");
    expect(f.mime).toBe("application/pdf");
    expect(f.bytes.toString()).toBe("%PDF-1.7 checkout");
  });

  it("accepts an absolute path inside the folder", () => {
    expect(readUploadFile(path.join(dir, "notes.md"), dir).mime).toBe(
      "text/markdown",
    );
  });

  it("refuses everything when no upload folder is configured", () => {
    expect(() => readUploadFile("checkout-prd.pdf", undefined)).toThrow(
      /MCP_UPLOAD_BASE_DIR/,
    );
  });

  it("names the files that are there when the name is wrong", () => {
    fs.writeFileSync(path.join(dir, ".secret.pdf"), "x");
    fs.writeFileSync(path.join(dir, "run.sh"), "x");
    const err = (() => {
      try {
        readUploadFile("checkout.pdf", dir);
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(UploadError);
    expect(err!.message).toBe(
      'No file named "checkout.pdf" in the upload folder. Files there: checkout-prd.pdf, notes.md.',
    );
  });

  it("caps the listing", () => {
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(
        path.join(dir, `doc-${String(i).padStart(2, "0")}.txt`),
        "x",
      );
    }
    expect(() => readUploadFile("missing.pdf", dir)).toThrow(
      /\(and 7 more\)\.$/,
    );
  });

  it("says so when nothing in the folder can be attached", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ask-uploads-empty-"));
    try {
      expect(() => readUploadFile("x.pdf", empty)).toThrow(
        /which has no files that can be attached/,
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("keeps the folder rule for a path that climbs out of it", () => {
    const outside = path.join(
      os.tmpdir(),
      `ask-uploads-out-${process.pid}.pdf`,
    );
    fs.writeFileSync(outside, "%PDF");
    try {
      expect(() => readUploadFile(outside, dir)).toThrow(
        /must be located inside/,
      );
      expect(() =>
        readUploadFile(path.join("..", path.basename(outside)), dir),
      ).toThrow(/must be located inside/);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("refuses a type Atlas would not read", () => {
    fs.writeFileSync(path.join(dir, "run.sh"), "echo");
    expect(() => readUploadFile("run.sh", dir)).toThrow(
      /not in the allowed list/,
    );
  });

  it("refuses an empty file and an oversized image", () => {
    fs.writeFileSync(path.join(dir, "blank.txt"), "");
    expect(() => readUploadFile("blank.txt", dir)).toThrow(/is empty/);
    fs.writeFileSync(
      path.join(dir, "big.png"),
      Buffer.alloc(5 * 1024 * 1024 + 1),
    );
    expect(() => readUploadFile("big.png", dir)).toThrow(
      /images are limited to 5 MB/,
    );
  });
});

describe("uploadFiles", () => {
  it("reserves a slot and sends the bytes to storage, nothing else", async () => {
    const { impl, calls } = fakeFetch();
    const progress: string[] = [];
    const got = await uploadFiles(
      ["checkout-prd.pdf"],
      deps(impl, { progress: (m: string) => progress.push(m) }),
    );
    expect(got).toEqual([{ id: AID, name: "checkout-prd.pdf" }]);
    expect(progress).toEqual(["Uploading checkout-prd.pdf"]);
    expect(calls.map((c) => c.url)).toEqual([`${AGENT}/attachments`, S3]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      product: "tm",
      name: "checkout-prd.pdf",
      bytes: 17,
      mime: "application/pdf",
    });
    // Only the slot request carries the auth header.
    expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer t" });
    expect(calls[1].init.headers).toBeUndefined();
    const form = calls[1].init.body as FormData;
    expect(form.get("key")).toBe("raw/x");
    expect((form.get("file") as File).size).toBe(17);
  });

  it("checks every file before uploading any", async () => {
    const { impl, calls } = fakeFetch();
    await expect(
      uploadFiles(["checkout-prd.pdf", "missing.pdf"], deps(impl)),
    ).rejects.toThrow(/No file named "missing.pdf"/);
    expect(calls).toEqual([]);
  });

  it("refuses more files than one message carries", async () => {
    const { impl } = fakeFetch();
    const names = Array.from({ length: MAX_FILES + 1 }, () => "notes.md");
    await expect(uploadFiles(names, deps(impl))).rejects.toThrow(
      /At most 10 files/,
    );
  });

  it("passes Atlas's refusal on", async () => {
    const { impl } = fakeFetch({
      slot: json(429, {
        detail: "your attachment quota is used up",
        error: "over_quota",
      }),
    });
    await expect(uploadFiles(["notes.md"], deps(impl))).rejects.toThrow(
      "BrowserStack AI refused the upload (429): your attachment quota is used up.",
    );
  });

  it("does not follow a slot that points anywhere but S3 over https", async () => {
    for (const url of [
      "http://bucket.s3.amazonaws.com/",
      "https://evil.example.com/",
      "https://amazonaws.com.evil.example/",
      "not a url",
    ]) {
      const { impl, calls } = fakeFetch({
        slot: json(200, { id: AID, upload: { url, fields: {} } }),
      });
      await expect(uploadFiles(["notes.md"], deps(impl))).rejects.toThrow(
        /unexpected upload location/,
      );
      expect(calls.map((c) => c.url)).toEqual([`${AGENT}/attachments`]);
    }
  });

  it("refuses an id it did not expect before using it in a path", async () => {
    const { impl } = fakeFetch({
      slot: json(200, { id: "../admin", upload: { url: S3, fields: {} } }),
    });
    await expect(uploadFiles(["notes.md"], deps(impl))).rejects.toThrow(
      /unusable upload slot/,
    );
  });

  it("reports a failed storage upload", async () => {
    const { impl } = fakeFetch({
      put: new Response("denied", { status: 403 }),
    });
    await expect(uploadFiles(["notes.md"], deps(impl))).rejects.toThrow(
      "Uploading notes.md failed (storage answered 403).",
    );
  });

  it("treats a slot without an upload location as unusable", async () => {
    const { impl } = fakeFetch({ slot: json(200, { id: AID }) });
    await expect(uploadFiles(["notes.md"], deps(impl))).rejects.toThrow(
      /unexpected upload location/,
    );
  });

  it("reads an error body that is not JSON", async () => {
    const { impl } = fakeFetch({
      slot: new Response("gateway down", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    });
    await expect(uploadFiles(["notes.md"], deps(impl))).rejects.toThrow(
      "BrowserStack AI refused the upload (502): Bad Gateway.",
    );
  });
});
