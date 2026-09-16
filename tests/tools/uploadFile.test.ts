import { describe, it, expect, vi } from "vitest";

const { cfgMock } = vi.hoisted(() => ({
  cfgMock: { UPLOAD_BASE_DIR: undefined as string | undefined },
}));
vi.mock("../../src/config.js", () => ({ default: cfgMock }));

import { uploadFile } from "../../src/tools/testmanagement-utils/upload-file.js";

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
