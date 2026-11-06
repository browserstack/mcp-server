import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/tm-base-url", () => ({
  getTMBaseURL: vi.fn().mockResolvedValue("https://tm.example.com"),
}));

const postMock = vi.fn();
vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { post: (...a: any[]) => postMock(...a) },
}));

import { createTestRun } from "../../src/tools/testmanagement-utils/create-testrun";
import { createProjectOrFolder } from "../../src/tools/testmanagement-utils/create-project-folder";

const config: any = {
  "browserstack-username": "u",
  "browserstack-access-key": "k",
};

// Long enough that a 500-character cap would cut off the closing marker.
const LONG = "x".repeat(800);
const CLOSED = /«UNTRUSTED API response ([0-9a-f]{12})»\n[\s\S]*\n«END UNTRUSTED \1»$/;

function expectWholeBodyWrapped(res: any, prefix: RegExp) {
  expect(res.isError).toBe(true);
  const text: string = res.content[0].text;
  expect(text).toMatch(prefix);
  expect(text).toContain(LONG);
  expect(text).toMatch(CLOSED);
}

beforeEach(() => postMock.mockReset());

describe("an unsuccessful TM body echoed in an error is wrapped whole", () => {
  it("createTestRun", async () => {
    postMock.mockResolvedValue({ data: { success: false, message: LONG } });
    const res = await createTestRun(
      {
        project_identifier: "PR-1",
        test_run: { name: "Run", test_cases: ["TC-1"] },
      } as any,
      config,
    );
    expectWholeBodyWrapped(res, /^API returned unsuccessful response: /);
  });

  it("createProjectOrFolder, creating a project", async () => {
    postMock.mockResolvedValue({ data: { success: false, message: LONG } });
    const res = await createProjectOrFolder(
      { project_name: "P" } as any,
      config,
    );
    expectWholeBodyWrapped(res, /^Failed to create project: /);
  });

  it("createProjectOrFolder, creating a folder", async () => {
    postMock.mockResolvedValue({ data: { success: false, message: LONG } });
    const res = await createProjectOrFolder(
      { project_identifier: "PR-1", folder_name: "F" } as any,
      config,
    );
    expectWholeBodyWrapped(res, /^Failed to create folder: /);
  });
});
