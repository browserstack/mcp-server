import path from 'path';
import { fetchNetworkLogs } from '../../src/tools/automate';
import { downloadNetworkLogs } from '../../src/lib/api';

// Mock the dependencies
jest.mock('fs');
jest.mock('../../src/lib/api', () => ({
  downloadNetworkLogs: jest.fn()
}));
jest.mock('../../src/logger', () => ({
  error: jest.fn(),
  info: jest.fn()
}));
jest.mock('../../src/config', () => ({
  default: {
    browserstackUsername: 'test',
    browserstackAccessKey: 'test'
  }
}));

describe('fetchNetworkLogs', () => {
  const LOGS_DIR = path.join(process.cwd(), "logs", "network");
  const validSessionId = 'valid-session-123';

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation
    (downloadNetworkLogs as jest.Mock).mockResolvedValue({
      success: true,
      filepath: path.join(LOGS_DIR, `networklogs-${validSessionId}.json`)
    });
  });

  it('should fetch and save network logs successfully', async () => {
    const result = await fetchNetworkLogs({ sessionId: validSessionId });
    
    expect(downloadNetworkLogs).toHaveBeenCalledWith(validSessionId);
    expect(result.content[0].text).toBe(`Network logs saved to: ${path.join(LOGS_DIR, `networklogs-${validSessionId}.json`)}`);
    expect(result.isError).toBeFalsy();
  });

  it('should handle invalid session ID', async () => {
    (downloadNetworkLogs as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Session Id is not valid'
    });

    const result = await fetchNetworkLogs({ sessionId: 'invalid-id' });

    expect(downloadNetworkLogs).toHaveBeenCalledWith('invalid-id');
    expect(result.content[0].text).toBe('Error fetching network logs: Session Id is not valid');
    expect(result.content[0].isError).toBe(true);
    expect(result.isError).toBe(true);
  });

  it('should handle file system errors', async () => {
    (downloadNetworkLogs as jest.Mock).mockResolvedValue({
      success: false,
      error: 'File system error'
    });

    const result = await fetchNetworkLogs({ sessionId: validSessionId });

    expect(downloadNetworkLogs).toHaveBeenCalledWith(validSessionId);
    expect(result.content[0].text).toBe('Error fetching network logs: File system error');
    expect(result.content[0].isError).toBe(true);
    expect(result.isError).toBe(true);
  });

  it('should handle empty session ID', async () => {
    (downloadNetworkLogs as jest.Mock).mockResolvedValue({
      success: false,
      error: 'You must provide a sessionId.'
    });

    const result = await fetchNetworkLogs({ sessionId: '' });

    expect(downloadNetworkLogs).toHaveBeenCalledWith('');
    expect(result.content[0].text).toBe('Error fetching network logs: You must provide a sessionId.');
    expect(result.content[0].isError).toBe(true);
    expect(result.isError).toBe(true);
  });

  it('should handle network errors', async () => {
    (downloadNetworkLogs as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await fetchNetworkLogs({ sessionId: validSessionId });

    expect(downloadNetworkLogs).toHaveBeenCalledWith(validSessionId);
    expect(result.content[0].text).toBe('Error fetching network logs: Network error');
    expect(result.content[0].isError).toBe(true);
    expect(result.isError).toBe(true);
  });
});