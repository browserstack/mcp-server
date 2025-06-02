import {
  createProjectOrFolderTool,
  createTestCaseTool,
  createTestRunTool,
  addTestResultTool,
  listTestRunsTool,
  updateTestRunTool,
  uploadProductRequirementFileTool,
  createTestCasesFromFileTool
} from '../../src/tools/testmanagement';
import addTestManagementTools from '../../src/tools/testmanagement';
import { createProjectOrFolder } from '../../src/tools/testmanagement-utils/create-project-folder';
import { createTestCase, sanitizeArgs, TestCaseCreateRequest } from '../../src/tools/testmanagement-utils/create-testcase';
import { listTestCases } from '../../src/tools/testmanagement-utils/list-testcases';
import { createTestRun } from '../../src/tools/testmanagement-utils/create-testrun';
import { addTestResult } from '../../src/tools/testmanagement-utils/add-test-result';
import { listTestRuns } from '../../src/tools/testmanagement-utils/list-testruns';
import { updateTestRun } from '../../src/tools/testmanagement-utils/update-testrun';
import { createTestCasesFromFile } from '../../src/tools/testmanagement-utils/testcase-from-file';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from 'axios';
import { beforeEach, it, expect, describe, Mocked} from 'vitest';
import { vi, Mock } from 'vitest';
import fs from 'fs';
import { signedUrlMap } from '../../src/lib/inmemory-store';

// Mock dependencies
vi.mock('../../src/tools/testmanagement-utils/create-project-folder', () => ({
  createProjectOrFolder: vi.fn(),
  CreateProjFoldSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
vi.mock('../../src/tools/testmanagement-utils/create-testcase', () => ({
  createTestCase: vi.fn(),
  sanitizeArgs: vi.fn((args) => args),
  CreateTestCaseSchema: {
    shape: {},
  },
}));

vi.mock('../../src/tools/testmanagement-utils/testcase-from-file', () => ({
  createTestCasesFromFile: vi.fn(),
}));
vi.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    browserstackUsername: 'fake-user',
    browserstackAccessKey: 'fake-key',
  },
}));
vi.mock('../../src/lib/instrumentation', () => ({
  trackMCP: vi.fn()
}));

vi.mock('../../src/tools/testmanagement-utils/add-test-result', () => ({
  addTestResult: vi.fn(),
  AddTestResultSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));

vi.mock('fs');
vi.mock('../../src/lib/inmemory-store', () => ({ signedUrlMap: new Map() }));

const mockServer = {
  tool: vi.fn(),
  server: {
    getClientVersion: vi.fn(() => ({
      name: 'vi-client',
      version: '1.0.0',
    })),
  },
} as unknown as McpServer;

addTestManagementTools(mockServer);

vi.mock('../../src/tools/testmanagement-utils/create-testrun', () => ({
  createTestRun: vi.fn(),
  CreateTestRunSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
vi.mock('axios');


vi.mock('../../src/tools/testmanagement-utils/list-testruns', () => ({
  listTestRuns: vi.fn(),
  ListTestRunsSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
vi.mock('../../src/tools/testmanagement-utils/update-testrun', () => ({
  updateTestRun: vi.fn(),
  UpdateTestRunSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));


const mockedAxios = axios as Mocked<typeof axios>;

describe('createTestCaseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validArgs: TestCaseCreateRequest = {
    project_identifier: 'proj-123',
    folder_id: 'fold-456',
    name: 'Sample Test Case',
    description: 'Test case description',
    owner: 'user@example.com',
    preconditions: 'Some precondition',
    test_case_steps: [
      { step: 'Step 1', result: 'Result 1' },
      { step: 'Step 2', result: 'Result 2' },
    ],
    issues: ['JIRA-1'],
    issue_tracker: { name: 'jira', host: 'https://jira.example.com' },
    tags: ['smoke'],
    custom_fields: { priority: 'high' },
  };

  const mockCallToolResult = {
    content: [
      { type: 'text', text: 'Successfully created test case TC-001: Sample Test Case' },
      { type: 'text', text: JSON.stringify({ identifier: 'TC-001', title: 'Sample Test Case' }, null, 2) },
    ],
    isError: false,
  };

  it('should successfully create a test case', async () => {
    (createTestCase as Mock).mockResolvedValue(mockCallToolResult);

    const result = await createTestCaseTool(validArgs);

    expect(sanitizeArgs).toHaveBeenCalledWith(validArgs);
    expect(createTestCase).toHaveBeenCalledWith(validArgs);
    expect(result).toBe(mockCallToolResult);
  });

  it('should handle API errors while creating test case', async () => {
    (createTestCase as Mock).mockRejectedValue(new Error('API Error'));

    const result = await createTestCaseTool(validArgs);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to create test case: API Error');
  });

  it('should handle unknown error while creating test case', async () => {
    (createTestCase as Mock).mockRejectedValue('unexpected');

    const result = await createTestCaseTool(validArgs);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Unknown error');
  });
});

describe('createProjectOrFolderTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validProjectArgs = {
    project_name: 'My New Project',
    project_description: 'This is a test project',
  };

  const validFolderArgs = {
    project_identifier: 'proj-123',
    folder_name: 'My Test Folder',
    folder_description: 'This is a folder under project',
  };

  const mockProjectResponse = {
    content: [{ type: 'text', text: 'Project created with identifier=proj-123' }],
  };

  const mockFolderResponse = {
    content: [{ type: 'text', text: 'Folder created: ID=fold-123, name="My Folder" in project proj-123' }],
  };

  it('should successfully create a project', async () => {
    (createProjectOrFolder as Mock).mockResolvedValue(mockProjectResponse);

    const result = await createProjectOrFolderTool(validProjectArgs);

    expect(createProjectOrFolder).toHaveBeenCalledWith(validProjectArgs);
    expect(result.content?.[0]?.text).toContain('Project created with identifier=proj-123');
  });

  it('should successfully create a folder', async () => {
    (createProjectOrFolder as Mock).mockResolvedValue(mockFolderResponse);

    const result = await createProjectOrFolderTool(validFolderArgs);

    expect(createProjectOrFolder).toHaveBeenCalledWith(validFolderArgs);
    expect(result.content?.[0]?.text).toContain('Folder created: ID=fold-123');
  });

  it('should handle error while creating project or folder', async () => {
    (createProjectOrFolder as Mock).mockRejectedValue(new Error('Failed to create project/folder'));

    const result = await createProjectOrFolderTool(validProjectArgs);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      'Failed to create project/folder: Failed to create project/folder. Please open an issue on GitHub if the problem persists'
    );
  });

  it('should handle unknown error while creating project or folder', async () => {
    (createProjectOrFolder as Mock).mockRejectedValue('some unknown error');

    const result = await createProjectOrFolderTool(validProjectArgs);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      'Failed to create project/folder: Unknown error. Please open an issue on GitHub if the problem persists'
    );
  });
});

describe('listTestCases util', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockCases = [
    { identifier: 'TC-1', title: 'Test One', case_type: 'functional', status: 'active', priority: 'high' },
    { identifier: 'TC-2', title: 'Test Two', case_type: 'regression', status: 'draft', priority: 'medium' },
  ];

  it('should return formatted summary and raw JSON on success', async () => {
    mockedAxios.get.mockResolvedValue({ data: { success: true, test_cases: mockCases, info: { count: 2 } } });

    const args = { project_identifier: 'PR-1', status: 'active', p: 1 };
    const result = await listTestCases(args as any);

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/projects/PR-1/test-cases?'),
      expect.objectContaining({ auth: expect.any(Object) })
    );
    expect(result.content?.[0]?.text).toContain('Found 2 test case(s):');
    expect(result.content?.[0]?.text).toContain('TC-1: Test One [functional | high]');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(mockCases, null, 2));
  });

  it('should handle API errors gracefully', async () => {
    mockedAxios.get.mockRejectedValue(new Error('Failed to list test cases: Network Error'));

    const result = await listTestCases({ project_identifier: 'PR-1' } as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to list test cases: Network Error');
  });
});

describe('createTestRunTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validRunArgs = {
    project_identifier: 'proj-123',
    run_name: 'Nightly Regression',
    test_cases: ['TC-001', 'TC-002'],
    environment: 'chrome',
    metadata: { os: 'macOS' },
  };

  const successRunResult = {
    content: [{ type: 'text', text: 'Successfully created test run: Run-001' }],
    isError: false,
  };

  it('should successfully create a test run', async () => {
    (createTestRun as Mock).mockResolvedValue(successRunResult);

    const result = await createTestRunTool(validRunArgs as any);

    expect(createTestRun).toHaveBeenCalledWith(validRunArgs);
    expect(result).toBe(successRunResult);
  });

  it('should handle API errors while creating test run', async () => {
    (createTestRun as Mock).mockRejectedValue(new Error('API Error'));

    const result = await createTestRunTool(validRunArgs as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to create test run: API Error');
  });

  it('should handle unknown error while creating test run', async () => {
    (createTestRun as Mock).mockRejectedValue('unexpected');

    const result = await createTestRunTool(validRunArgs as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Unknown error');
  });
});


describe('listTestRunsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRuns = [
    { identifier: 'TR-1', name: 'Run One', run_state: 'new_run' },
    { identifier: 'TR-2', name: 'Run Two', run_state: 'done' },
  ];
  const projectId = 'PR-123';

  it('should return summary and raw JSON on success', async () => {
    (listTestRuns as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: `Found 2 test run(s):\n\n• TR-1: Run One [new_run]\n• TR-2: Run Two [done]` },
        { type: 'text', text: JSON.stringify(mockRuns, null, 2) },
      ],
      isError: false,
    });

    const result = await listTestRunsTool({ project_identifier: projectId } as any);
    expect(listTestRuns).toHaveBeenCalledWith({ project_identifier: projectId });
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Found 2 test run(s):');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(mockRuns, null, 2));
  });

  it('should handle errors', async () => {
    (listTestRuns as Mock).mockRejectedValue(new Error('Network Error'));
    const result = await listTestRunsTool({ project_identifier: projectId } as any);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to list test runs: Network Error');
  });
});

describe('updateTestRunTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const args = {
    project_identifier: 'PR-123',
    test_run_id: 'TR-1',
    test_run: { name: 'Updated Name', run_state: 'in_progress' },
  };

  it('should return success message and updated run JSON on success', async () => {
    const updated = { name: 'Updated Name', run_state: 'in_progress', tags: [] };
    (updateTestRun as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: `Successfully updated test run ${args.test_run_id}` },
        { type: 'text', text: JSON.stringify(updated, null, 2) },
      ],
      isError: false,
    });

    const result = await updateTestRunTool(args as any);
    expect(updateTestRun).toHaveBeenCalledWith(args);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain(`Successfully updated test run ${args.test_run_id}`);
    expect(result.content?.[1]?.text).toBe(JSON.stringify(updated, null, 2));
  });

  it('should handle errors', async () => {
    (updateTestRun as Mock).mockRejectedValue(new Error('API Error'));
    const result = await updateTestRunTool(args as any);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to update test run: API Error');
  });
});



describe('addTestResultTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validArgs = {
    project_identifier: 'proj-123',
    test_run_id: 'run-456',
    test_result: {
      status: 'passed',
      description: 'All good',
      issues: ['ISSUE-1'],
      issue_tracker: { name: 'jira', host: 'https://jira.example.com' },
      custom_fields: { priority: 'high' },
    },
    test_case_id: 'TC-1',
  };

  const successAddResult = {
    content: [{ type: 'text', text: 'Successfully added test result to test run run-456' }],
    isError: false,
  };

  it('should successfully add a test result', async () => {
    (addTestResult as Mock).mockResolvedValue(successAddResult);

    const result = await addTestResultTool(validArgs as any);

    expect(addTestResult).toHaveBeenCalledWith(validArgs);
    expect(result).toBe(successAddResult);
  });

  it('should handle API errors gracefully', async () => {
    (addTestResult as Mock).mockRejectedValue(new Error('Network Error'));

    const result = await addTestResultTool(validArgs as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to add test result: Network Error');
  });

  it('should handle unknown errors gracefully', async () => {
    (addTestResult as Mock).mockRejectedValue('unexpected');

    const result = await addTestResultTool(validArgs as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Unknown error');
  });
});

const testFilePath = "/tmp/sample.pdf";
const testProjectId = "PR-DEMO";
const testDocumentId = "mock-doc-id";
const testFolderId = "mock-folder-id";
const mockFileId = 12345;
const mockDownloadUrl = "https://cdn.browserstack.com/mock.pdf";
const mockContext = { sendNotification: vi.fn(), _meta: { progressToken: "test-progress-token" } };

describe("uploadProductRequirementFileTool", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns error when file does not exist", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);
    const res = await uploadProductRequirementFileTool({ project_identifier: testProjectId, file_path: testFilePath });
    expect(res.isError).toBe(true);
    expect(res.content?.[0]?.text).toContain("does not exist");
  });

  it("uploads file and returns metadata", async () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.createReadStream as Mock).mockReturnValue("STREAM");
    const mockUpload = {
      status: 200,
      data: {
        generic_attachment: [
          {
            id: mockFileId,
            name: "sample.pdf",
            download_url: mockDownloadUrl,
            content_type: "application/pdf",
            size: 1024
          }
        ]
      }
    };
    mockedAxios.get.mockResolvedValue({ data: { success: true, projects: [{ identifier: testProjectId, id: "999" }] } });
    mockedAxios.post.mockResolvedValue(mockUpload);
    const res = await uploadProductRequirementFileTool({ project_identifier: testProjectId, file_path: testFilePath });
    expect(res.isError ?? false).toBe(false);
    expect(res.content?.[1]?.text).toContain("documentID");
  });
});

// Tests for createTestCasesFromFileTool
describe("createTestCasesFromFileTool", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns error when document is not in signedUrlMap", async () => {
    signedUrlMap.clear();
    (createTestCasesFromFile as Mock).mockRejectedValue(new Error("Re-Upload the file"));
    
    const args = { documentId: testDocumentId, folderId: testFolderId, projectReferenceId: testProjectId };
    const res = await createTestCasesFromFileTool(args as any, mockContext);
    expect(res.isError).toBe(true);
    expect(res.content?.[0]?.text).toContain("Re-Upload the file");
  });

  it("creates test cases from a file successfully", async () => {
    signedUrlMap.set(testDocumentId, { fileId: mockFileId, downloadUrl: mockDownloadUrl });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        default_fields: {
          priority: { values: [{ name: "Medium", value: 2 }] },
          status: { values: [{ internal_name: "active", value: 1 }] },
          case_type: { values: [{ internal_name: "functional", value: 3 }] }
        },
        custom_fields: []
      }
    });
    mockedAxios.post.mockImplementation((url: string) => {
      if (url.includes("suggest-test-cases")) {
        return Promise.resolve({ status: 200, data: { "x-bstack-traceRequestId": "trace" } });
      }
      if (url.includes("test-cases-polling")) {
        return Promise.resolve({ status: 200, data: { data: { success: true, message: [{ type: "termination" }] } } });
      }
      if (url.includes("bulk-test-cases")) {
        return Promise.resolve({ status: 200, data: {} });
      }
      return Promise.resolve({ status: 404, data: {} });
    });
    const args = { documentId: testDocumentId, folderId: testFolderId, projectReferenceId: testProjectId };
    (createTestCasesFromFile as Mock).mockReturnValue({
      content: [{ type: "text", text: "Total of 5 test cases created in 2 scenarios." }],
      isError: false
    });
    
    const res = await createTestCasesFromFileTool(args as any, mockContext);
    expect(res.isError ?? false).toBe(false);
    expect(res.content?.[0]?.text).toContain("test cases created");
  });
});
