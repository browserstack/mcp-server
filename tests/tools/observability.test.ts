import { getFailuresInLastRun } from '../../src/tools/observability';
import { getLatestO11YBuildInfo } from '../../src/lib/api';
import { beforeEach, it, expect, describe, vi, Mock } from 'vitest'

// Mock the API module
vi.mock('../../src/lib/api', () => ({
  getLatestO11YBuildInfo: vi.fn(),
}));

vi.mock('../../src/lib/instrumentation', () => ({
  trackMCP: vi.fn()
}));

describe('getFailuresInLastRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBuildData = {
    observability_url: 'https://observability.browserstack.com/123',
    unique_errors: {
      overview: {
        insight: 'Test insight message'
      },
      top_unique_errors: [
        { error: 'Error 1' },
        { error: 'Error 2' }
      ]
    }
  };

  it('should successfully retrieve failures for a valid build', async () => {
    (getLatestO11YBuildInfo as Mock).mockResolvedValue(validBuildData);

    const result = await getFailuresInLastRun('test-build', 'test-project');

    expect(getLatestO11YBuildInfo).toHaveBeenCalledWith('test-build', 'test-project');
    expect(result.content[0].text).toContain('https://observability.browserstack.com/123');
    expect(result.content[0].text).toContain('Test insight message');
    expect(result.content[0].text).toContain('Error 1');
    expect(result.content[0].text).toContain('Error 2');
  });

  it('should handle missing observability URL', async () => {
    (getLatestO11YBuildInfo as Mock).mockResolvedValue({
      ...validBuildData,
      observability_url: null
    });

    await expect(getFailuresInLastRun('test-build', 'test-project'))
      .rejects.toThrow('No observability URL found in build data');
  });

  it('should handle missing overview insight', async () => {
    (getLatestO11YBuildInfo as Mock).mockResolvedValue({
      ...validBuildData,
      unique_errors: {
        ...validBuildData.unique_errors,
        overview: {}
      }
    });

    const result = await getFailuresInLastRun('test-build', 'test-project');
    expect(result.content[0].text).toContain('No overview available');
  });

  it('should handle missing error details', async () => {
    (getLatestO11YBuildInfo as Mock).mockResolvedValue({
      ...validBuildData,
      unique_errors: {
        ...validBuildData.unique_errors,
        top_unique_errors: []
      }
    });

    const result = await getFailuresInLastRun('test-build', 'test-project');
    expect(result.content[0].text).toContain('No error details available');
  });

  it('should handle API errors', async () => {
    (getLatestO11YBuildInfo as Mock).mockRejectedValue(new Error('API Error'));

    await expect(getFailuresInLastRun('test-build', 'test-project'))
      .rejects.toThrow('API Error');
  });

  it('should handle empty build data', async () => {
    (getLatestO11YBuildInfo as Mock).mockResolvedValue({});

    await expect(getFailuresInLastRun('test-build', 'test-project'))
      .rejects.toThrow('No observability URL found in build data');
  });

  it('should handle partial build data', async () => {
    (getLatestO11YBuildInfo as Mock).mockResolvedValue({
      observability_url: 'https://observability.browserstack.com/123',
      unique_errors: {}
    });

    const result = await getFailuresInLastRun('test-build', 'test-project');
    expect(result.content[0].text).toContain('No overview available');
    expect(result.content[0].text).toContain('No error details available');
  });
}); 