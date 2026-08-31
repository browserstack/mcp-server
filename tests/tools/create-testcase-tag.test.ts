import { beforeEach, describe, it, expect, vi, Mock } from 'vitest';
import { apiClient } from '../../src/lib/apiClient';
import {
  createTestCase,
  TestCaseCreateRequest,
} from '../../src/tools/testmanagement-utils/create-testcase';

// Reach the real createTestCase implementation; stub only its external deps so
// we can assert on the payload it builds (PMAA-166: MCP-origin tag stamping).
vi.mock('../../src/lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../src/lib/tm-base-url', () => ({
  getTMBaseURL: vi.fn(async () => 'https://test-management.browserstack.com'),
}));
vi.mock('../../src/lib/get-auth', () => ({
  getBrowserStackAuth: vi.fn(() => 'fake-user:fake-key'),
}));
vi.mock('../../src/tools/testmanagement-utils/TCG-utils/api', () => ({
  projectIdentifierToId: vi.fn(async () => '999'),
  fetchFormFields: vi.fn(),
  normalizeDefaultFieldValue: vi.fn(),
}));
vi.mock('../../src/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockConfig = {
  'browserstack-username': 'fake-user',
  'browserstack-access-key': 'fake-key',
} as any;

const baseArgs: TestCaseCreateRequest = {
  project_identifier: 'proj-123',
  folder_id: 'fold-456',
  name: 'Sample Test Case',
  test_case_steps: [{ step: 'Step 1', result: 'Result 1' }],
};

function mockCreateSuccess() {
  (apiClient.post as Mock).mockResolvedValue({
    data: {
      data: {
        success: true,
        test_case: {
          identifier: 'TC-001',
          title: 'Sample Test Case',
          template: undefined,
        },
      },
    },
  });
}

function sentTags(): string[] {
  const req = (apiClient.post as Mock).mock.calls[0][0];
  return req.body.test_case.tags;
}

describe('createTestCase MCP-origin tag (PMAA-166)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSuccess();
  });

  it('stamps "MCP Generated" when the caller passes no tags', async () => {
    await createTestCase({ ...baseArgs }, mockConfig);
    expect(sentTags()).toEqual(['MCP Generated']);
  });

  it('preserves user tags and appends "MCP Generated"', async () => {
    await createTestCase({ ...baseArgs, tags: ['smoke', 'regression'] }, mockConfig);
    expect(sentTags()).toEqual(['smoke', 'regression', 'MCP Generated']);
  });

  it('does not duplicate "MCP Generated" if already present', async () => {
    await createTestCase({ ...baseArgs, tags: ['MCP Generated'] }, mockConfig);
    expect(sentTags()).toEqual(['MCP Generated']);
  });
});
