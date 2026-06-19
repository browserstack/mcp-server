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
  listTestCasesTool,
  listTestPlansTool,
  getTestPlanTool,
  listSubTestPlansTool,
  getSubTestPlanTool,
} from '../../src/tools/testmanagement';
import addTestManagementTools from '../../src/tools/testmanagement';
import { createProjectOrFolder } from '../../src/tools/testmanagement-utils/create-project-folder';
import { createTestCase, sanitizeArgs, TestCaseCreateRequest } from '../../src/tools/testmanagement-utils/create-testcase';
import { listTestCases } from '../../src/tools/testmanagement-utils/list-testcases';
import { createTestRun } from '../../src/tools/testmanagement-utils/create-testrun';
import { addTestResult } from '../../src/tools/testmanagement-utils/add-test-result';
import { listTestRuns } from '../../src/tools/testmanagement-utils/list-testruns';
import { updateTestRun } from '../../src/tools/testmanagement-utils/update-testrun';
import { listTestPlans } from '../../src/tools/testmanagement-utils/list-testplans';
import { getTestPlan } from '../../src/tools/testmanagement-utils/get-testplan';
import { listSubTestPlans } from '../../src/tools/testmanagement-utils/list-sub-testplans';
import { getSubTestPlan } from '../../src/tools/testmanagement-utils/get-sub-testplan';
import { createTestCasesFromFile } from '../../src/tools/testmanagement-utils/testcase-from-file';
import { createLCASteps } from '../../src/tools/testmanagement-utils/create-lca-steps';
import axios from 'axios';
import { beforeAll, beforeEach, it, expect, describe, Mocked} from 'vitest';
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
  projectIdentifierToId: vi.fn(() => Promise.resolve('999')),
  fetchFormFields: vi.fn(),
  normalizeDefaultFieldValue: vi.fn(),
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
vi.mock('../../src/tools/testmanagement-utils/list-testplans', () => ({
  listTestPlans: vi.fn(),
  ListTestPlansSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
vi.mock('../../src/tools/testmanagement-utils/get-testplan', () => ({
  getTestPlan: vi.fn(),
  GetTestPlanSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
vi.mock('../../src/tools/testmanagement-utils/list-sub-testplans', () => ({
  listSubTestPlans: vi.fn(),
  ListSubTestPlansSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
vi.mock('../../src/tools/testmanagement-utils/get-sub-testplan', () => ({
  getSubTestPlan: vi.fn(),
  GetSubTestPlanSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
// Mocked for the util-level fail-soft test on getSubTestPlan (which calls
// vi.importActual to reach the real util). Other tests in this file mock their
// utils at the module level, so apiClient and tm-base-url never get reached
// through real code paths today — adding these mocks is safe.
vi.mock('../../src/lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('../../src/lib/tm-base-url', () => ({
  getTMBaseURL: vi.fn(async () => 'https://test-management.browserstack.com'),
}));
vi.mock('../../src/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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

describe('listTestPlansTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const projectId = 'PR-127';
  const mockPlans = [
    { identifier: 'TP-25', name: 'Release 1.0', active_state: 'active' },
    { identifier: 'TP-26', name: 'Release 2.0', active_state: 'active' },
  ];

  it('should return summary and raw JSON on success', async () => {
    (listTestPlans as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: 'Found 2 test plan(s) in project PR-127:\n\n• TP-25: Release 1.0 [active]' },
        { type: 'text', text: JSON.stringify(mockPlans, null, 2) },
      ],
      isError: false,
    });
    const result = await listTestPlansTool({ project_identifier: projectId }, mockConfig, mockServer);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Found 2 test plan(s)');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(mockPlans, null, 2));
  });

  it('should handle errors', async () => {
    (listTestPlans as Mock).mockRejectedValue(new Error('Network Error'));
    const result = await listTestPlansTool({ project_identifier: projectId }, mockConfig, mockServer);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to list test plans: Network Error');
  });
});

describe('getTestPlanTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const args = {
    project_identifier: 'PR-127',
    test_plan_identifier: 'TP-25',
  };

  it('should return plan details, linked runs and status summary on success', async () => {
    const payload = {
      test_plan: {
        identifier: 'TP-25',
        name: 'Release 1.0',
        active_state: 'active',
        description: 'Plan for Release 1.0',
      },
      linked_test_runs: [
        { identifier: 'TR-1', name: 'Run One', run_state: 'new_run', test_cases_count: 10 },
        { identifier: 'TR-2', name: 'Run Two', run_state: 'done', test_cases_count: 5 },
      ],
      status_summary: { new_run: 1, done: 1 },
      total_test_cases: 15,
    };
    (getTestPlan as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: 'Test Plan TP-25: Release 1.0\nStatus: active\nTotal test cases across runs: 15' },
        { type: 'text', text: JSON.stringify(payload, null, 2) },
      ],
      isError: false,
    });
    const result = await getTestPlanTool(args, mockConfig, mockServer);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('TP-25');
    expect(result.content?.[0]?.text).toContain('Total test cases across runs: 15');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(payload, null, 2));
  });

  it('should handle errors', async () => {
    (getTestPlan as Mock).mockRejectedValue(new Error('Not Found'));
    const result = await getTestPlanTool(args, mockConfig, mockServer);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to fetch test plan: Not Found');
  });
});

describe('listSubTestPlansTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const args = {
    project_identifier: 'PR-1',
    parent_test_plan_identifier: 'TP-45',
  };
  const mockSubPlans = [
    { identifier: 'STP-194', name: 'Sprint 1', active_state: 'active', parent_plan_id: 'TP-45', tags: ['sprint'] },
    { identifier: 'STP-195', name: 'Sprint 2', active_state: 'active', parent_plan_id: 'TP-45' },
  ];

  it('should return summary and raw JSON on success', async () => {
    (listSubTestPlans as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: 'Found 2 sub-test-plan(s) under TP-45 in project PR-1:\n\n• STP-194: Sprint 1 [active]' },
        { type: 'text', text: JSON.stringify(mockSubPlans, null, 2) },
      ],
      isError: false,
    });
    const result = await listSubTestPlansTool(args, mockConfig, mockServer);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('Found 2 sub-test-plan(s)');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(mockSubPlans, null, 2));
  });

  it('should handle errors', async () => {
    (listSubTestPlans as Mock).mockRejectedValue(new Error('Network Error'));
    const result = await listSubTestPlansTool(args, mockConfig, mockServer);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to list sub-test-plans: Network Error');
  });
});

describe('getSubTestPlanTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const args = {
    project_identifier: 'PR-1',
    parent_test_plan_identifier: 'TP-45',
    sub_test_plan_identifier: 'STP-194',
  };

  it('should return sub-plan details, linked runs and status summary on success', async () => {
    const payload = {
      sub_test_plan: {
        identifier: 'STP-194',
        name: 'Sprint 1',
        active_state: 'active',
        parent_plan_id: 'TP-45',
        tags: ['sprint', 'regression'],
      },
      linked_test_runs: [
        { identifier: 'TR-1', name: 'Run One', run_state: 'new_run', test_cases_count: 8 },
      ],
      status_summary: { new_run: 1 },
      total_test_cases: 8,
    };
    (getSubTestPlan as Mock).mockResolvedValue({
      content: [
        { type: 'text', text: 'Sub-Test-Plan STP-194: Sprint 1\nParent plan: TP-45\nStatus: active\nTotal test cases across runs: 8' },
        { type: 'text', text: JSON.stringify(payload, null, 2) },
      ],
      isError: false,
    });
    const result = await getSubTestPlanTool(args, mockConfig, mockServer);
    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain('STP-194');
    expect(result.content?.[0]?.text).toContain('Parent plan: TP-45');
    expect(result.content?.[1]?.text).toBe(JSON.stringify(payload, null, 2));
  });

  it('should handle errors', async () => {
    (getSubTestPlan as Mock).mockRejectedValue(new Error('Not Found'));
    const result = await getSubTestPlanTool(args, mockConfig, mockServer);
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to fetch sub-test-plan: Not Found');
  });
});

// Util-level test for the riskier fail-soft enrichment branch in getSubTestPlan.
// Uses vi.importActual to reach the real util (the top-level vi.mock above
// otherwise replaces it). vi.mock is statically hoisted, so a top-level import
// is unusable — importActual inside beforeAll is the only viable path.
describe('getSubTestPlan util — fail-soft enrichment', () => {
  let getSubTestPlanReal: typeof import('../../src/tools/testmanagement-utils/get-sub-testplan').getSubTestPlan;
  let apiClientMock: typeof import('../../src/lib/apiClient').apiClient;

  beforeAll(async () => {
    const actual = await vi.importActual<typeof import('../../src/tools/testmanagement-utils/get-sub-testplan')>(
      '../../src/tools/testmanagement-utils/get-sub-testplan'
    );
    getSubTestPlanReal = actual.getSubTestPlan;
    const apiClientModule = await import('../../src/lib/apiClient');
    apiClientMock = apiClientModule.apiClient;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseSubPlan = {
    identifier: 'STP-194',
    name: 'Sprint 1',
    active_state: 'active',
    parent_plan_id: 'TP-45',
    test_runs_count: { active: 0, closed: 0 },
    tags: [],
  };

  it('returns sub-plan metadata + "No test runs linked" when enrichment rejects (does NOT flip isError); calls the link URL verbatim', async () => {
    const subPlan = {
      ...baseSubPlan,
      links: { test_runs: '/api/v2/projects/PR-1/test-plans/STP-194/test-runs' },
    };
    (apiClientMock.get as Mock)
      .mockResolvedValueOnce({ data: { success: true, sub_test_plan: subPlan } })
      .mockRejectedValueOnce(new Error('Network Error'));

    const result = await getSubTestPlanReal(
      {
        project_identifier: 'PR-1',
        parent_test_plan_identifier: 'TP-45',
        sub_test_plan_identifier: 'STP-194',
      },
      mockConfig as any,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain('STP-194');
    expect(result.content?.[0]?.text).toContain('Parent plan: TP-45');
    expect(result.content?.[0]?.text).toContain('No test runs linked to this sub-plan');

    // Verify the enrichment call hit the link URL verbatim (joined under tmBaseUrl),
    // not a re-constructed path. This protects the URL composition contract.
    const enrichmentCall = (apiClientMock.get as Mock).mock.calls[1][0];
    expect(enrichmentCall.url).toBe(
      'https://test-management.browserstack.com/api/v2/projects/PR-1/test-plans/STP-194/test-runs',
    );
  });

  it('returns sub-plan metadata + "No test runs linked" when enrichment returns success:false (non-throwing degradation)', async () => {
    const subPlan = {
      ...baseSubPlan,
      links: { test_runs: '/api/v2/projects/PR-1/test-plans/STP-194/test-runs' },
    };
    (apiClientMock.get as Mock)
      .mockResolvedValueOnce({ data: { success: true, sub_test_plan: subPlan } })
      .mockResolvedValueOnce({ data: { success: false, error: 'rate limited' } });

    const result = await getSubTestPlanReal(
      {
        project_identifier: 'PR-1',
        parent_test_plan_identifier: 'TP-45',
        sub_test_plan_identifier: 'STP-194',
      },
      mockConfig as any,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain('STP-194');
    expect(result.content?.[0]?.text).toContain('No test runs linked to this sub-plan');
  });

  it('falls back to constructed URL when links.test_runs is an absolute URL with a mismatched host (SSRF guard)', async () => {
    const subPlan = {
      ...baseSubPlan,
      links: { test_runs: 'http://169.254.169.254/latest/meta-data/' },
    };
    (apiClientMock.get as Mock)
      .mockResolvedValueOnce({ data: { success: true, sub_test_plan: subPlan } })
      .mockRejectedValueOnce(new Error('Network Error'));

    await getSubTestPlanReal(
      {
        project_identifier: 'PR-1',
        parent_test_plan_identifier: 'TP-45',
        sub_test_plan_identifier: 'STP-194',
      },
      mockConfig as any,
    );

    // The off-host link must NOT be called; the constructed fallback must be used instead.
    const enrichmentCall = (apiClientMock.get as Mock).mock.calls[1][0];
    expect(enrichmentCall.url).not.toContain('169.254.169.254');
    expect(enrichmentCall.url).toBe(
      'https://test-management.browserstack.com/api/v2/projects/PR-1/test-plans/STP-194/test-runs',
    );
  });

  it('returns isError on primary fetch failure', async () => {
    (apiClientMock.get as Mock).mockResolvedValueOnce({
      data: { success: false, message: 'Sub-plan not found' },
    });

    const result = await getSubTestPlanReal(
      {
        project_identifier: 'PR-1',
        parent_test_plan_identifier: 'TP-45',
        sub_test_plan_identifier: 'STP-999',
      },
      mockConfig as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Failed to fetch sub-test-plan');
  });
});

// Real function via importActual (the module is mocked at the top).
describe('normalizeDefaultFieldValue', () => {
  let normalize: typeof import('../../src/tools/testmanagement-utils/TCG-utils/api').normalizeDefaultFieldValue;

  beforeAll(async () => {
    const actual = await vi.importActual<
      typeof import('../../src/tools/testmanagement-utils/TCG-utils/api')
    >('../../src/tools/testmanagement-utils/TCG-utils/api');
    normalize = actual.normalizeDefaultFieldValue;
  });

  const values = [
    { name: 'Critical', internal_name: 'critical', value: 1 },
    { name: 'Medium', internal_name: 'medium', value: 2 },
  ];

  it('resolves a lowercase internal name to the Title-Case display name', () => {
    expect(normalize(values, 'critical', 'name')).toBe('Critical');
  });

  it('matches case-insensitively regardless of input casing', () => {
    expect(normalize(values, 'CRITICAL', 'name')).toBe('Critical');
    expect(normalize(values, '  Critical  ', 'name')).toBe('Critical');
  });

  it('resolves a display name to the internal name when emit is internal_name', () => {
    expect(normalize(values, 'Critical', 'internal_name')).toBe('critical');
  });

  it('returns undefined when no option matches (caller passes raw value through)', () => {
    expect(normalize(values, 'urgent', 'name')).toBeUndefined();
    expect(normalize([], 'critical', 'name')).toBeUndefined();
  });
});

// Real createTestCase via importActual; collaborators are mocked at module scope.
describe('createTestCase — priority normalization', () => {
  let createTestCaseReal: typeof import('../../src/tools/testmanagement-utils/create-testcase').createTestCase;
  let apiClientMock: typeof import('../../src/lib/apiClient').apiClient;
  let fetchFormFieldsMock: Mock;
  let normalizeMock: Mock;

  beforeAll(async () => {
    const actual = await vi.importActual<
      typeof import('../../src/tools/testmanagement-utils/create-testcase')
    >('../../src/tools/testmanagement-utils/create-testcase');
    createTestCaseReal = actual.createTestCase;
    apiClientMock = (await import('../../src/lib/apiClient')).apiClient;
    const api = await import('../../src/tools/testmanagement-utils/TCG-utils/api');
    fetchFormFieldsMock = api.fetchFormFields as unknown as Mock;
    normalizeMock = api.normalizeDefaultFieldValue as unknown as Mock;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Priority options as returned by fetchFormFields.
  const priorityValues = [
    { name: 'Critical', internal_name: 'critical', value: 1 },
    { name: 'Medium', internal_name: 'medium', value: 2 },
  ];
  const formFields = {
    default_fields: { priority: { values: priorityValues } },
    custom_fields: {},
  };
  const createSuccess = {
    data: {
      data: {
        success: true,
        test_case: {
          identifier: 'TC-1',
          title: 'Sample',
          priority: 'Critical',
          folder_id: 1,
        },
      },
    },
  };

  const baseArgs = {
    project_identifier: 'PR-1',
    folder_id: 'F-1',
    name: 'Sample',
    test_case_steps: [{ step: 'a', result: 'b' }],
  };

  it('looks up the project form fields and sends the normalized priority in the request body', async () => {
    fetchFormFieldsMock.mockResolvedValue(formFields);
    normalizeMock.mockReturnValue('Critical');
    (apiClientMock.post as Mock).mockResolvedValueOnce(createSuccess);

    const result = await createTestCaseReal(
      { ...baseArgs, priority: 'critical' },
      mockConfig as any,
    );

    expect(result.isError).toBeFalsy();
    expect(normalizeMock).toHaveBeenCalledWith(priorityValues, 'critical', 'name');
    const body = (apiClientMock.post as Mock).mock.calls[0][0].body;
    expect(body.test_case.priority).toBe('Critical');
  });

  it('omits priority from the request body when not provided (preserves project default)', async () => {
    (apiClientMock.post as Mock).mockResolvedValueOnce(createSuccess);

    await createTestCaseReal({ ...baseArgs }, mockConfig as any);

    expect(fetchFormFieldsMock).not.toHaveBeenCalled();
    const body = (apiClientMock.post as Mock).mock.calls[0][0].body;
    expect(body.test_case).not.toHaveProperty('priority');
  });

  it('passes the raw priority through when the form-fields lookup fails (graceful fallback)', async () => {
    fetchFormFieldsMock.mockRejectedValue(new Error('Network Error'));
    (apiClientMock.post as Mock).mockResolvedValueOnce(createSuccess);

    await createTestCaseReal(
      { ...baseArgs, priority: 'critical' },
      mockConfig as any,
    );

    const body = (apiClientMock.post as Mock).mock.calls[0][0].body;
    expect(body.test_case.priority).toBe('critical');
  });
});

// PMAA-131: template slug pass-through + multi-select custom fields.
// Behaviour verified against the live TM v2 API: the create endpoint keys on
// the template's internal slug and silently falls back to the default for
// unrecognized values; multi-select custom fields accept arrays keyed by name.
describe('createTestCase — template & multi-select custom_fields', () => {
  let createTestCaseReal: typeof import('../../src/tools/testmanagement-utils/create-testcase').createTestCase;
  let apiClientMock: typeof import('../../src/lib/apiClient').apiClient;

  beforeAll(async () => {
    const actual = await vi.importActual<
      typeof import('../../src/tools/testmanagement-utils/create-testcase')
    >('../../src/tools/testmanagement-utils/create-testcase');
    createTestCaseReal = actual.createTestCase;
    apiClientMock = (await import('../../src/lib/apiClient')).apiClient;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseArgs = {
    project_identifier: 'PR-1',
    folder_id: 'F-1',
    name: 'Sample',
    test_case_steps: [{ step: 'a', result: 'b' }],
  };

  const resp = (template: string) => ({
    data: {
      data: {
        success: true,
        test_case: { identifier: 'TC-1', title: 'Sample', folder_id: 1, template },
      },
    },
  });

  it('passes the template slug through to the request body and does not warn when applied', async () => {
    (apiClientMock.post as Mock).mockResolvedValueOnce(resp('test_case_bdd'));

    const result = await createTestCaseReal(
      { ...baseArgs, template: 'test_case_bdd' },
      mockConfig as any,
    );

    const body = (apiClientMock.post as Mock).mock.calls[0][0].body;
    expect(body.test_case.template).toBe('test_case_bdd');
    const text = (result.content ?? []).map((c: any) => c.text).join('\n');
    expect(text).not.toContain('was not applied');
  });

  it('warns when the API silently falls back to a different template', async () => {
    (apiClientMock.post as Mock).mockResolvedValueOnce(resp('test_case_steps'));

    const result = await createTestCaseReal(
      { ...baseArgs, template: 'test_case_sec' },
      mockConfig as any,
    );

    const text = (result.content ?? []).map((c: any) => c.text).join('\n');
    expect(text).toContain('was not applied');
    expect(text).toContain('test_case_sec');
  });

  it('passes array (multi-select) custom_fields through to the request body', async () => {
    (apiClientMock.post as Mock).mockResolvedValueOnce(resp('test_case_steps'));

    await createTestCaseReal(
      { ...baseArgs, custom_fields: { aaas: ['m40', 'm48'] } },
      mockConfig as any,
    );

    const body = (apiClientMock.post as Mock).mock.calls[0][0].body;
    expect(body.test_case.custom_fields).toEqual({ aaas: ['m40', 'm48'] });
  });
});

// PMAA-131: multi-select custom fields on the update (PATCH) path.
describe('updateTestCase — multi-select custom_fields', () => {
  let updateTestCaseReal: typeof import('../../src/tools/testmanagement-utils/update-testcase').updateTestCase;
  let apiClientMock: typeof import('../../src/lib/apiClient').apiClient;

  beforeAll(async () => {
    const actual = await vi.importActual<
      typeof import('../../src/tools/testmanagement-utils/update-testcase')
    >('../../src/tools/testmanagement-utils/update-testcase');
    updateTestCaseReal = actual.updateTestCase;
    apiClientMock = (await import('../../src/lib/apiClient')).apiClient;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes array (multi-select) custom_fields through to the PATCH body', async () => {
    (apiClientMock.patch as Mock).mockResolvedValueOnce({
      data: {
        data: {
          success: true,
          test_case: {
            identifier: 'TC-1',
            title: 'Sample',
            case_type: 'functional',
            priority: 'Medium',
            status: 'active',
            folder_id: 1,
          },
        },
      },
    });

    const result = await updateTestCaseReal(
      {
        project_identifier: 'PR-1',
        test_case_identifier: 'TC-1',
        custom_fields: { aaas: ['m40', 'm48'] },
      },
      mockConfig as any,
    );

    expect(result.isError).toBeFalsy();
    const body = (apiClientMock.patch as Mock).mock.calls[0][0].body;
    expect(body.test_case.custom_fields).toEqual({ aaas: ['m40', 'm48'] });
  });
});
