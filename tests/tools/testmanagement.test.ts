import { createProjectOrFolderTool } from '../../src/tools/testmanagement';
import { createProjectOrFolder } from '../../src/tools/testmanagement-utils/create-project-folder';
import { createTestCaseTool } from '../../src/tools/testmanagement';
import { createTestCase, sanitizeArgs, TestCaseCreateRequest } from '../../src/tools/testmanagement-utils/create-testcase';

// Mock dependencies
jest.mock('../../src/tools/testmanagement-utils/create-project-folder', () => ({
  createProjectOrFolder: jest.fn(),
  CreateProjFoldSchema: {
    parse: (args: any) => args,
    shape: {},
  },
}));
jest.mock('../../src/tools/testmanagement-utils/create-testcase', () => ({
  createTestCase: jest.fn(),
  sanitizeArgs: jest.fn((args) => args),
}));
jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    browserstackUsername: 'fake-user',
    browserstackAccessKey: 'fake-key',
  },
}));

describe('createTestCaseTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    (createTestCase as jest.Mock).mockResolvedValue(mockCallToolResult);

    const result = await createTestCaseTool(validArgs);

    expect(sanitizeArgs).toHaveBeenCalledWith(validArgs);
    expect(createTestCase).toHaveBeenCalledWith(validArgs);
    expect(result).toBe(mockCallToolResult);
  });

  it('should handle API errors while creating test case', async () => {
    (createTestCase as jest.Mock).mockRejectedValue(new Error('API Error'));

    const result = await createTestCaseTool(validArgs);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to create test case: API Error');
  });

  it('should handle unknown error while creating test case', async () => {
    (createTestCase as jest.Mock).mockRejectedValue('unexpected');

    const result = await createTestCaseTool(validArgs);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown error');
  });
});

describe('createProjectOrFolderTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    (createProjectOrFolder as jest.Mock).mockResolvedValue(mockProjectResponse);

    const result = await createProjectOrFolderTool(validProjectArgs);

    expect(createProjectOrFolder).toHaveBeenCalledWith(validProjectArgs);
    expect(result.content[0].text).toContain('Project created with identifier=proj-123');
  });

  it('should successfully create a folder', async () => {
    (createProjectOrFolder as jest.Mock).mockResolvedValue(mockFolderResponse);

    const result = await createProjectOrFolderTool(validFolderArgs);

    expect(createProjectOrFolder).toHaveBeenCalledWith(validFolderArgs);
    expect(result.content[0].text).toContain('Folder created: ID=fold-123');
  });

  it('should handle error while creating project or folder', async () => {
    (createProjectOrFolder as jest.Mock).mockRejectedValue(new Error('Failed to create project/folder'));

    const result = await createProjectOrFolderTool(validProjectArgs);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to create project/folder: Failed to create project/folder. Please open an issue on GitHub if the problem persists');
  });

  it('should handle unknown error while creating project or folder', async () => {
    (createProjectOrFolder as jest.Mock).mockRejectedValue('some unknown error');

    const result = await createProjectOrFolderTool(validProjectArgs);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to create project/folder: Unknown error. Please open an issue on GitHub if the problem persists');
  });
});
