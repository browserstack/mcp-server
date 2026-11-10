import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { cfgMock, postMock } = vi.hoisted(() => ({
  cfgMock: { UPLOAD_BASE_DIR: undefined as string | undefined },
  postMock: vi.fn(),
}));
vi.mock("../../src/config.js", () => ({ default: cfgMock }));
vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: postMock },
}));
vi.mock("../../src/lib/tm-base-url.js", () => ({
  getTMBaseURL: async () => "https://tm.example",
}));
vi.mock("../../src/tools/testmanagement-utils/TCG-utils/api.js", () => ({
  projectIdentifierToId: async () => "123",
}));

import { uploadFile } from "../../src/tools/testmanagement-utils/upload-file.js";
import { signedUrlMap } from "../../src/lib/inmemory-store.js";

const bsConfig: any = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
};

describe("uploadFile — MCP_UPLOAD_BASE_DIR requirement", () => {
  it("refuses the upload when MCP_UPLOAD_BASE_DIR is not set", async () => {
    cfgMock.UPLOAD_BASE_DIR = undefined;
    const res = await uploadFile(
      { project_identifier: "P1", file_path: "/tmp/whatever.pdf" },
      bsConfig,
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("File upload is disabled");
    expect(res.content[0].text).toContain("MCP_UPLOAD_BASE_DIR");
  });

  it("passes the gate when set (any later failure is not the gate)", async () => {
    cfgMock.UPLOAD_BASE_DIR = "/tmp";
    const res = await uploadFile(
      { project_identifier: "P1", file_path: "/etc/hostname" }, // outside/ext-invalid
      bsConfig,
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).not.toContain("File upload is disabled");
  });
});

describe("uploadFile — file types", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "upload-")));
    cfgMock.UPLOAD_BASE_DIR = dir;
    postMock.mockReset();
    signedUrlMap.clear();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(["spec.doc", "notes.md", "data.json", "page.html", "bundle.zip"])(
    "rejects %s, which test case generation cannot read",
    async (name) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, "x");
      const res = await uploadFile(
        { project_identifier: "P1", file_path: file },
        bsConfig,
      );
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("is not in the allowed list");
      expect(postMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["prd.pdf", "application/pdf"],
    ["prd.txt", "text/plain"],
    ["flow.png", "image/png"],
    ["flow.JPG", "image/jpeg"],
    ["flow.jpeg", "image/jpeg"],
    [
      "spec.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "sheet.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["data.csv", "text/csv"],
    ["spec.rtf", "application/rtf"],
  ])("stores the mimeType for %s", async (name, mimeType) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "x");
    postMock.mockResolvedValue({
      status: 200,
      data: {
        generic_attachment: [
          { id: 42, name, download_url: "https://dl", content_type: mimeType },
        ],
      },
    });

    const res = await uploadFile(
      { project_identifier: "P1", file_path: file },
      bsConfig,
    );

    expect(res.isError ?? false).toBe(false);
    const [{ documentID }] = JSON.parse(res.content[1].text as string);
    expect(signedUrlMap.get(documentID)).toEqual({
      fileId: 42,
      downloadUrl: "https://dl",
      mimeType,
    });
  });
});
