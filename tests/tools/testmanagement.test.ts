import {
  createProjectOrFolderTool,
  createTestCaseTool,
  createTestRunTool,
  addTestResultTool,
  listTestRunsTool,
  updateTestRunTool,
  uploadProductRequirementFileTool,
  createTestCasesFromFileTool,
  createLCAStepsTool,
  listTestCasesTool
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
import { createLCASteps } from '../../src/tools/testmanagement-utils/create-lca-steps';
import axios from 'axios';
import { beforeEach, it, expect, describe, Mocked} from 'vitest';
import { vi, Mock } from 'vitest';
import { signedUrlMap } from '../../src/lib/inmemory-store';
import { uploadFile } from '../../src/tools/testmanagement-utils/upload-file';


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

vi.mock('../../src/tools/testmanagement-utils/TCG-utils/types', () => ({
  CreateTestCasesFromFileSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));

vi.mock('../../src/tools/testmanagement-utils/create-lca-steps', () => ({
  createLCASteps: vi.fn(),
  CreateLCAStepsSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));

vi.mock('../../src/tools/testmanagement-utils/poll-lca-status', () => ({
  pollLCAStatus: vi.fn(),
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
vi.mock('../../src/lib/get-auth', () => ({
  getBrowserStackAuth: vi.fn(() => 'fake-user:fake-key')
}));
vi.mock('../../src/tools/testmanagement-utils/TCG-utils/api', () => ({
  projectIdentifierToId: vi.fn(() => Promise.resolve('999'))
}));
vi.mock('form-data', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      append: vi.fn(),
      getHeaders: vi.fn(() => ({ 'content-type': 'multipart/form-data' }))
    }))
  };
});

const mockConfig = {
  getClientVersion: vi.fn(() => "test-version"),
  authHeaders: {
    username: 'fake-user',
    password: 'fake-key'
  },
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key"
};

// Create a mock server for all tool calls
const mockServer = { server: { getClientVersion: () => "test-version" } } as any;
mockServer.tool = vi.fn();
addTestManagementTools(mockServer, mockConfig);

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
vi.mock('../../src/tools/testmanagement-utils/list-testcases', () => ({
  listTestCases: vi.fn(),
  ListTestCasesSchema: {
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
    automation_status: 'not_automated',
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
    const result = await createTestCaseTool(validArgs, mockConfig, mockServer);
    expect(sanitizeArgs).toHaveBeenCalledWith(validArgs);
    expect(createTestCase).toHaveBeenCalledWith(validArgs, mockConfig);
    expect(result).toBe(mockCallToolResult);
  });

  it('should handle API errors while creating test case', async () => {
    (createTestCase as Mock).mockRejectedValue(new Error('API Error'));
    const result = await createTestCaseTool(validArgs, mockConfig, mockServer);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to create test case: API Error');
  });

  it('should handle unknown error while creating test case', async () => {
    (createTestCase as Mock).mockRejectedValue('unexpected');
    const result = await createTestCaseTool(validArgs, mockConfig, mockServer);
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
    const result = await createProjectOrFolderTool(validProjectArgs, mockConfig, mockServer);
    expect(createProjectOrFolder).toHaveBeenCalledWith(validProjectArgs, mockConfig);
    expect(result.content?.[0]?.text).toContain('Project created with identifier=proj-123');
  });

  it('should successfully create a folder', async () => {
    (createProjectOrFolder as Mock).mockResolvedValue(mockFolderResponse);
    const result = await createProjectOrFolderTool(validFolderArgs, mockConfig, mockServer);
    expect(createProjectOrFolder).toHaveBeenCalledWith(validFolderArgs, mockConfig);
    expect(result.content?.[0]?.text).toContain('Folder created: ID=fold-123');
  });

  it('should handle error while creating project or folder', async () => {
    (createProjectOrFolder as Mock).mockRejectedValue(new Error('Failed to create project/folder'));
    const result = await createProjectOrFolderTool(validProjectArgs, mockConfig, mockServer);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      'Failed to create project/folder: Failed to create project/folder. Please open an issue on GitHub if the problem persists'
    );
  });
  it('should handle unknown error while creating project or folder', async () => {
    (createProjectOrFolder as Mock).mockRejectedValue('some unknown error');
    const result = await createProjectOrFolderTool(validProjectArgs, mockConfig, mockServer);
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
    (listTestCases as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: 'Found 2 test case(s):\n\n• TC-1: Test One [functional | high]\n• TC-2: Test Two [regression | medium]' },
        { type: 'text', text: JSON.stringify(mockCases, null, 2) },
      ],
      isError: false,
    });
    const args = { project_identifier: 'PR-1', status: 'active', p: 1 };
    const result = await listTestCasesTool(args as any, mockConfig, mockServer);
    expect(result.content?.[0]?.text).toContain('Found 2 test case(s):');
    expect(result.content?.[0]?.text).toContain('TC-1: Test One [functional | high]');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(mockCases, null, 2));
  });

  it('should handle API errors gracefully', async () => {
    (listTestCases as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: 'Failed to list test cases: Network Error', isError: true },
      ],
      isError: true,
    });
    const result = await listTestCasesTool({ project_identifier: 'PR-1' } as any, mockConfig, mockServer);
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
    const runArgs = {
      project_identifier: validRunArgs.project_identifier,
      test_run: {
        name: validRunArgs.run_name,
        test_cases: validRunArgs.test_cases,
        environment: validRunArgs.environment,
        metadata: validRunArgs.metadata
      }
    };
    const result = await createTestRunTool(runArgs, mockConfig, mockServer);
    expect(result).toBe(successRunResult);
  });

  it('should handle API errors while creating test run', async () => {
    (createTestRun as Mock).mockRejectedValue(new Error('API Error'));
    const runArgs = {
      project_identifier: validRunArgs.project_identifier,
      test_run: {
        name: validRunArgs.run_name,
        test_cases: validRunArgs.test_cases,
        environment: validRunArgs.environment,
        metadata: validRunArgs.metadata
      }
    };
    const result = await createTestRunTool(runArgs, mockConfig, mockServer);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to create test run: API Error');
  });

  it('should handle unknown error while creating test run', async () => {
    (createTestRun as Mock).mockRejectedValue('unexpected');
    const runArgs = {
      project_identifier: validRunArgs.project_identifier,
      test_run: {
        name: validRunArgs.run_name,
        test_cases: validRunArgs.test_cases,
        environment: validRunArgs.environment,
        metadata: validRunArgs.metadata
      }
    };
    const result = await createTestRunTool(runArgs, mockConfig, mockServer);
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
    const result = await listTestRunsTool({ project_identifier: projectId }, mockConfig, mockServer);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Found 2 test run(s):');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(mockRuns, null, 2));
  });

  it('should handle errors', async () => {
    (listTestRuns as Mock).mockRejectedValue(new Error('Network Error'));
    const result = await listTestRunsTool({ project_identifier: projectId }, mockConfig, mockServer);
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
    const updateArgs = {
      project_identifier: args.project_identifier,
      test_run_id: args.test_run_id,
      test_run: {
        name: args.test_run.name,
        run_state: "in_progress" as const
      }
    };
    const result = await updateTestRunTool(updateArgs, mockConfig, mockServer);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain(`Successfully updated test run ${args.test_run_id}`);
    expect(result.content?.[1]?.text).toBe(JSON.stringify(updated, null, 2));
  });

  it('should handle errors', async () => {
    (updateTestRun as Mock).mockRejectedValue(new Error('API Error'));
    const updateArgs = {
      project_identifier: args.project_identifier,
      test_run_id: args.test_run_id,
      test_run: {
        name: args.test_run.name,
        run_state: "in_progress" as const
      }
    };
    const result = await updateTestRunTool(updateArgs, mockConfig, mockServer);
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
    const result = await addTestResultTool(validArgs, mockConfig, mockServer);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Successfully added test result to test run run-456');
  });

  it('should handle unknown errors gracefully', async () => {
    (addTestResult as Mock).mockRejectedValue('unexpected');
    const result = await addTestResultTool(validArgs, mockConfig, mockServer);
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
    (uploadFile as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: 'File /tmp/sample.pdf does not exist.', isError: true },
      ],
      isError: true,
    });
    const res = await uploadProductRequirementFileTool({ project_identifier: testProjectId, file_path: testFilePath }, mockConfig, mockServer);
    expect(res.isError).toBe(true);
    expect(res.content?.[0]?.text).toContain("does not exist");
  });
  it("uploads file and returns metadata", async () => {
    const mockSuccessResponse = {
      content: [
        { type: 'text', text: 'Successfully uploaded sample.pdf to BrowserStack Test Management.' },
        { 
          type: 'text', 
          text: JSON.stringify([{
            name: "sample.pdf",
            documentID: "mock-doc-id",
            contentType: "application/pdf",
            size: 1024,
            projectReferenceId: "999"
          }], null, 2)
        },
      ],
      isError: false,
    };
    (uploadFile as Mock).mockResolvedValue(mockSuccessResponse);
    const res = await uploadProductRequirementFileTool({ project_identifier: testProjectId, file_path: testFilePath }, mockConfig, mockServer);
    expect(uploadFile).toHaveBeenCalledWith({ project_identifier: testProjectId, file_path: testFilePath }, mockConfig);
    expect(res.isError ?? false).toBe(false);
    expect(res.content?.[1]?.text).toContain("documentID");
  });
});

describe("createTestCasesFromFileTool", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns error when document is not in signedUrlMap", async () => {
    signedUrlMap.clear();
    (createTestCasesFromFile as Mock).mockRejectedValue(new Error("Re-Upload the file"));
    const args = { documentId: testDocumentId, folderId: testFolderId, projectReferenceId: testProjectId };
    const res = await createTestCasesFromFileTool(args as any, mockContext, mockConfig, mockServer);
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
    const res = await createTestCasesFromFileTool(args as any, mockContext, mockConfig, mockServer);
    expect(res.isError ?? false).toBe(false);
    expect(res.content?.[0]?.text).toContain("test cases created");
  });
});

describe("createLCAStepsTool", () => {
  beforeEach(() => vi.resetAllMocks());

  const mockContext = { 
    sendNotification: vi.fn(), 
    _meta: { progressToken: "test-lca-progress-token" } 
  };

  const validArgs = {
    project_identifier: "PR-123",
    test_case_identifier: "TC-456",
    base_url: "google.com",
    credentials: {
      username: "test@example.com",
      password: "password123",
    },
    local_enabled: false,
    test_name: "Sample LCA Test",
    test_case_details: {
      name: "Test Case Name",
      description: "Test case description",
      preconditions: "Test preconditions",
      test_case_steps: [
        { step: "Step 1", result: "Expected result 1" },
        { step: "Step 2", result: "Expected result 2" },
      ],
    },
    version: "v2",
  };

  it("creates LCA steps successfully", async () => {
    const mockResponse = {
      content: [
        { type: "text", text: "Successfully created LCA steps for test case TC-456" },
        { type: "text", text: JSON.stringify({ success: true }, null, 2) },
      ],
      isError: false,
    };

    (createLCASteps as Mock).mockResolvedValue(mockResponse);

    const result = await createLCAStepsTool(validArgs as any, mockContext, mockConfig, mockServer);

    expect(createLCASteps).toHaveBeenCalledWith(validArgs, mockContext, mockConfig);
    expect(result).toBe(mockResponse);
    expect(result.isError).toBe(false);
  });

  it("handles errors when creating LCA steps", async () => {
    (createLCASteps as Mock).mockRejectedValue(new Error("API Error"));

    const result = await createLCAStepsTool(validArgs as any, mockContext, mockConfig, mockServer);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Failed to create LCA steps: API Error");
  });

  it("handles unknown errors when creating LCA steps", async () => {
    (createLCASteps as Mock).mockRejectedValue("unexpected error");

    const result = await createLCAStepsTool(validArgs as any, mockContext, mockConfig, mockServer);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Failed to create LCA steps: Unknown error");
  });

  it("creates LCA steps with wait_for_completion disabled", async () => {
    const argsWithoutWait = { ...validArgs, wait_for_completion: false };
    const mockResponse = {
      content: [
        { type: "text", text: "LCA steps creation initiated for test case TC-456" },
        { type: "text", text: "LCA build started. Check the BrowserStack Test Management UI for completion status." },
      ],
      isError: false,
    };

    (createLCASteps as Mock).mockResolvedValue(mockResponse);

    const result = await createLCAStepsTool(argsWithoutWait as any, mockContext, mockConfig, mockServer);

    expect(result.content?.[1]?.text).toContain("Check the BrowserStack Test Management UI");
  });

  it("creates LCA steps with custom max wait time", async () => {
    const argsWithCustomWait = { ...validArgs, max_wait_minutes: 5 };
    const mockResponse = {
      content: [
        { type: "text", text: "LCA steps creation initiated for test case TC-456" },
        { type: "text", text: "Warning: LCA build did not complete within 5 minutes." },
      ],
      isError: false,
    };

    (createLCASteps as Mock).mockResolvedValue(mockResponse);

    const result = await createLCAStepsTool(argsWithCustomWait as any, mockContext, mockConfig, mockServer);

    expect(result.content?.[1]?.text).toContain("within 5 minutes");
  });
});

vi.mock('../../src/tools/testmanagement-utils/upload-file', () => {
  const uploadFile = vi.fn();
  return {
    uploadFile,
    UploadFileSchema: {
      parse: (args: any) => args,
      shape: {},
    },
    __esModule: true,
    default: { uploadFile },
  };
});

// Get the mocked uploadFile
