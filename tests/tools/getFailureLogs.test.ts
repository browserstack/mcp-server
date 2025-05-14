import { getFailureLogs } from '../../src/tools/getFailureLogs';
import * as automate from '../../src/tools/failurelogs-utils/automate';
import * as appAutomate from '../../src/tools/failurelogs-utils/app-automate';

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    browserstackUsername: 'fake-user',
    browserstackAccessKey: 'fake-key',
  },
}));

jest.mock('../../src/lib/instrumentation', () => ({
  trackMCP: jest.fn()
}));

// Mock the utility functions with implementations
jest.mock('../../src/tools/failurelogs-utils/automate', () => ({
  retrieveNetworkFailures: jest.fn(),
  retrieveSessionFailures: jest.fn(),
  retrieveConsoleFailures: jest.fn(),
  filterSessionFailures: jest.fn((text: string) => {
    const lines = text.split('\n');
    return lines.filter((line: string) => 
      line.includes('ERROR') || 
      line.includes('EXCEPTION') || 
      line.includes('FATAL')
    );
  }),
  filterConsoleFailures: jest.fn((text: string) => {
    const lines = text.split('\n');
    return lines.filter((line: string) => 
      line.includes('Failed to load resource') || 
      line.includes('Uncaught TypeError')
    );
  }),
}));

jest.mock('../../src/tools/failurelogs-utils/app-automate', () => ({
  retrieveDeviceLogs: jest.fn(),
  retrieveAppiumLogs: jest.fn(),
  retrieveCrashLogs: jest.fn(),
  filterDeviceFailures: jest.fn(() => []),
  filterAppiumFailures: jest.fn(() => []),
  filterCrashFailures: jest.fn(() => []),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('BrowserStack Failure Logs', () => {
  const mockSessionId = 'test-session-id';
  const mockBuildId = 'test-build-id';
  const auth = Buffer.from('fake-user:fake-key').toString('base64');

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getFailureLogs - Input Validation', () => {
    it('should throw error if sessionId is not provided', async () => {
      await expect(getFailureLogs({
        sessionId: '',
        logTypes: ['networkLogs'],
        sessionType: 'automate'
      })).rejects.toThrow('Session ID is required');
    });

    it('should throw error if buildId is not provided for app-automate session', async () => {
      await expect(getFailureLogs({
        sessionId: 'test-session',
        logTypes: ['deviceLogs'],
        sessionType: 'app-automate'
      })).rejects.toThrow('Build ID is required for app-automate sessions');
    });

    it('should return error for invalid log types', async () => {
      const result = await getFailureLogs({
        sessionId: 'test-session',
        logTypes: ['invalidLogType'] as any,
        sessionType: 'automate'
      });

      expect(result.content[0].isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid log type');
    });

    it('should return error when mixing session types', async () => {
      const automateResult = await getFailureLogs({
        sessionId: 'test-session',
        logTypes: ['deviceLogs'],
        sessionType: 'automate'
      });

      const appAutomateResult = await getFailureLogs({
        sessionId: 'test-session',
        buildId: 'test-build',
        logTypes: ['networkLogs'],
        sessionType: 'app-automate'
      });

      expect(automateResult.content[0].isError).toBe(true);
      expect(appAutomateResult.content[0].isError).toBe(true);
    });
  });

  describe('Automate Session Logs', () => {
    const mockNetworkFailures = {
      failures: [
        {
          startedDateTime: '2024-03-20T10:00:00Z',
          request: { method: 'GET', url: 'https://test.com' },
          response: { status: 404, statusText: 'Not Found' }
        }
      ],
      totalFailures: 1
    };

    beforeEach(() => {
      // Reset all mocks
      jest.clearAllMocks();
      
      // Setup mock implementations with resolved values
      jest.mocked(automate.retrieveNetworkFailures).mockResolvedValue(mockNetworkFailures);
      jest.mocked(automate.retrieveSessionFailures).mockResolvedValue(['[ERROR] Test failed']);
      jest.mocked(automate.retrieveConsoleFailures).mockResolvedValue(['Uncaught TypeError']);
    });

    it('should fetch network logs successfully', async () => {
      // Mock successful response with failures
      const mockFailures = [
        {
          startedDateTime: '2024-03-20T10:00:00Z',
          request: { method: 'GET', url: 'https://test.com' },
          response: { status: 404, statusText: 'Not Found' }
        }
      ];
      jest.mocked(automate.retrieveNetworkFailures).mockResolvedValue(mockFailures);

      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['networkLogs'],
        sessionType: 'automate'
      });

      expect(automate.retrieveNetworkFailures).toHaveBeenCalledWith(mockSessionId);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Network Failures (1 found)');
    });

    it('should fetch session logs successfully', async () => {
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['sessionLogs'],
        sessionType: 'automate'
      });

      expect(automate.retrieveSessionFailures).toHaveBeenCalledWith(mockSessionId);
      expect(result.content[0].text).toContain('Session Failures (1 found)');
      expect(result.content[0].text).toContain('[ERROR] Test failed');
    });

    it('should fetch console logs successfully', async () => {
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['consoleLogs'],
        sessionType: 'automate'
      });

      expect(automate.retrieveConsoleFailures).toHaveBeenCalledWith(mockSessionId);
      expect(result.content[0].text).toContain('Console Failures (1 found)');
      expect(result.content[0].text).toContain('Uncaught TypeError');
    });
  });

  describe('App-Automate Session Logs', () => {
    const mockDeviceLogs = ['Fatal Exception: NullPointerException'];
    const mockAppiumLogs = ['Error: Element not found'];
    const mockCrashLogs = ['Application crashed due to signal 11'];

    beforeEach(() => {
      jest.mocked(appAutomate.retrieveDeviceLogs).mockResolvedValue(mockDeviceLogs);
      jest.mocked(appAutomate.retrieveAppiumLogs).mockResolvedValue(mockAppiumLogs);
      jest.mocked(appAutomate.retrieveCrashLogs).mockResolvedValue(mockCrashLogs);
    });

    it('should fetch device logs successfully', async () => {
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        buildId: mockBuildId,
        logTypes: ['deviceLogs'],
        sessionType: 'app-automate'
      });

      expect(appAutomate.retrieveDeviceLogs).toHaveBeenCalledWith(mockSessionId, mockBuildId);
      expect(result.content[0].text).toContain('Device Failures (1 found)');
      expect(result.content[0].text).toContain('Fatal Exception');
    });

    it('should fetch appium logs successfully', async () => {
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        buildId: mockBuildId,
        logTypes: ['appiumLogs'],
        sessionType: 'app-automate'
      });

      expect(appAutomate.retrieveAppiumLogs).toHaveBeenCalledWith(mockSessionId, mockBuildId);
      expect(result.content[0].text).toContain('Appium Failures (1 found)');
      expect(result.content[0].text).toContain('Element not found');
    });

    it('should fetch crash logs successfully', async () => {
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        buildId: mockBuildId,
        logTypes: ['crashLogs'],
        sessionType: 'app-automate'
      });

      expect(appAutomate.retrieveCrashLogs).toHaveBeenCalledWith(mockSessionId, mockBuildId);
      expect(result.content[0].text).toContain('Crash Failures (1 found)');
      expect(result.content[0].text).toContain('signal 11');
    });
  });

  describe('Error Handling', () => {
    it('should handle empty log responses', async () => {
      jest.mocked(automate.retrieveNetworkFailures).mockResolvedValue([]);

      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['networkLogs'],
        sessionType: 'automate'
      });

      expect(result.content[0].text).toBe('No network failures found');
    });
  });

  describe('Log Filtering', () => {
    beforeEach(() => {
      // Reset mock implementations before each test
      jest.mocked(automate.filterSessionFailures).mockImplementation((text: string) => {
        const lines = text.split('\n');
        return lines.filter((line: string) => 
          line.includes('ERROR') || 
          line.includes('EXCEPTION') || 
          line.includes('FATAL')
        );
      });
      
      jest.mocked(automate.filterConsoleFailures).mockImplementation((text: string) => {
        const lines = text.split('\n');
        return lines.filter((line: string) => 
          line.includes('Failed to load resource') || 
          line.includes('Uncaught TypeError')
        );
      });

      jest.mocked(appAutomate.filterDeviceFailures).mockReturnValue([]);
      jest.mocked(appAutomate.filterAppiumFailures).mockReturnValue([]);
      jest.mocked(appAutomate.filterCrashFailures).mockReturnValue([]);
    });

    it('should filter session logs correctly', () => {
      const logText = `
[INFO] Starting test
[ERROR] Test failed
[INFO] Continuing
[EXCEPTION] NullPointerException
[FATAL] Process crashed
[INFO] Test completed
`;

      const result = jest.mocked(automate.filterSessionFailures)(logText);
      expect(result).toEqual([
        '[ERROR] Test failed',
        '[EXCEPTION] NullPointerException',
        '[FATAL] Process crashed'
      ]);
    });

    it('should filter console logs correctly', () => {
      const logText = `
console.log('Starting test')
console.error('Failed to load resource')
console.info('Test progress')
console.error('Uncaught TypeError')
`;

      const result = jest.mocked(automate.filterConsoleFailures)(logText);
      expect(result).toEqual([
        "console.error('Failed to load resource')",
        "console.error('Uncaught TypeError')"
      ]);
    });

    it('should handle empty inputs in filters', () => {
      const emptyResult: string[] = [];
      jest.mocked(automate.filterSessionFailures).mockReturnValue(emptyResult);
      jest.mocked(automate.filterConsoleFailures).mockReturnValue(emptyResult);
      jest.mocked(appAutomate.filterDeviceFailures).mockReturnValue(emptyResult);
      jest.mocked(appAutomate.filterAppiumFailures).mockReturnValue(emptyResult);
      jest.mocked(appAutomate.filterCrashFailures).mockReturnValue(emptyResult);

      expect(automate.filterSessionFailures('')).toEqual([]);
      expect(automate.filterConsoleFailures('')).toEqual([]);
      expect(appAutomate.filterDeviceFailures('')).toEqual([]);
      expect(appAutomate.filterAppiumFailures('')).toEqual([]);
      expect(appAutomate.filterCrashFailures('')).toEqual([]);
    });
  });
}); 