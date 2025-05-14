import { getNetworkFailures } from '../../src/tools/automate';
import { retrieveNetworkFailures } from '../../src/lib/api';
import addAutomateTools from '../../src/tools/automate';
import { beforeEach, it, expect, describe, vi, Mock } from 'vitest'

vi.mock('../../src/lib/api', () => ({
  retrieveNetworkFailures: vi.fn()
}));
vi.mock('../../src/lib/instrumentation', () => ({
  trackMCP: vi.fn()
}));

vi.mock('../../src/logger', () => {
  return {
    default: {
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    }
  }
});
describe('getNetworkFailures', () => {
  const validSessionId = 'valid-session-123';
  const mockFailures = {
    failures: [
      {
        startedDateTime: '2024-01-01T00:00:00Z',
        request: { method: 'GET', url: 'https://example.com' },
        response: { status: 404, statusText: 'Not Found' },
        serverIPAddress: '1.2.3.4',
        time: 123
      }
    ],
    totalFailures: 1
  };
  
  let serverMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (retrieveNetworkFailures as Mock).mockResolvedValue(mockFailures);
    
    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => {
      serverMock.handler = handler;
      }),
      server: {
      getClientVersion: vi.fn().mockReturnValue({ name: 'test-client', version: '1.0.0' })
      }
    };
    
    addAutomateTools(serverMock);
  });

  it('should return failure logs when present', async () => {
    const result = await getNetworkFailures({ sessionId: validSessionId });
    expect(retrieveNetworkFailures).toHaveBeenCalledWith(validSessionId);
    expect(result.content[0].text).toContain('network failure(s) found for session');
    expect(result.content[0].text).toContain('"status": 404');
    expect(result.isError).toBeFalsy();
  });

  it('should return message when no failure logs are found', async () => {
    (retrieveNetworkFailures as Mock).mockResolvedValue({ failures: [], totalFailures: 0 });
    const result = await getNetworkFailures({ sessionId: validSessionId });
    expect(retrieveNetworkFailures).toHaveBeenCalledWith(validSessionId);
    expect(result.content[0].text).toContain('No network failures found for session');
    expect(result.isError).toBeFalsy();
  });

  it('should handle errors from the API', async () => {
    (retrieveNetworkFailures as Mock).mockRejectedValue(new Error('Invalid session ID'));
    const result = await serverMock.handler({ sessionId: 'invalid-id' });
    expect(retrieveNetworkFailures).toHaveBeenCalledWith('invalid-id');
    expect(result.content[0].text).toBe('Failed to fetch network logs: Invalid session ID');
    expect(result.content[0].isError).toBe(true);
    expect(result.isError).toBe(true);
  });

  it('should handle empty session ID', async () => {
    (retrieveNetworkFailures as Mock).mockRejectedValue(new Error('Session ID is required'));
    const result = await serverMock.handler({ sessionId: '' });
    expect(retrieveNetworkFailures).toHaveBeenCalledWith('');
    expect(result.content[0].text).toBe('Failed to fetch network logs: Session ID is required');
    expect(result.content[0].isError).toBe(true);
    expect(result.isError).toBe(true);
  });
});