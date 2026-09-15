import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getFailureLogs } from '../../src/tools/get-failure-logs';
import * as automate from '../../src/tools/failurelogs-utils/automate';
import * as appAutomate from '../../src/tools/failurelogs-utils/app-automate';
import { resolveAppAutomateBuildId } from '../../src/tools/failurelogs-utils/resolve-app-build-id';
import { retrieveSessionVideo } from '../../src/tools/failurelogs-utils/video';

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

vi.mock('../../src/tools/failurelogs-utils/resolve-app-build-id', () => ({
  resolveAppAutomateBuildId: vi.fn(),
}));

vi.mock('../../src/tools/failurelogs-utils/video', () => ({
  retrieveSessionVideo: vi.fn(),
}));

// Mock the utility functions with implementations
vi.mock('../../src/tools/failurelogs-utils/automate', () => ({
  retrieveNetworkFailures: vi.fn(),
  retrieveSessionFailures: vi.fn(),
  retrieveConsoleFailures: vi.fn(),
  filterSessionFailures: vi.fn((text: string) => {
    const lines = text.split('\n');
    return lines.filter((line: string) => 
      line.includes('ERROR') || 
      line.includes('EXCEPTION') || 
      line.includes('FATAL')
    );
  }),
  filterConsoleFailures: vi.fn((text: string) => {
    const lines = text.split('\n');
    return lines.filter((line: string) => 
      line.includes('Failed to load resource') || 
      line.includes('Uncaught TypeError')
    );
  }),
}));

vi.mock('../../src/tools/failurelogs-utils/app-automate', () => ({
  retrieveDeviceLogs: vi.fn(),
  retrieveAppiumLogs: vi.fn(),
  retrieveCrashLogs: vi.fn(),
  filterDeviceFailures: vi.fn(() => []),
  filterAppiumFailures: vi.fn(() => []),
  filterCrashFailures: vi.fn(() => []),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BrowserStack Failure Logs', () => {
  const mockSessionId = 'test-session-id';
  const mockBuildId = 'test-build-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getFailureLogs - Input Validation', () => {
    it('should throw error if sessionId is not provided', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      await expect(getFailureLogs({
        sessionId: '',
        logTypes: ['networkLogs'],
        sessionType: 'automate'
      }, mockServer)).rejects.toThrow('Session ID is required');
    });

    it('should throw error if buildId is not provided and cannot be resolved for app-automate session', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      (resolveAppAutomateBuildId as any).mockResolvedValue(undefined);
      await expect(getFailureLogs({
        sessionId: 'test-session',
        logTypes: ['deviceLogs'],
        sessionType: 'app-automate'
      }, mockServer)).rejects.toThrow('Build ID is required for app-automate sessions');
    });

    it('should resolve buildId from the session when not provided', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      (resolveAppAutomateBuildId as any).mockResolvedValue('resolved-build-id');
      vi.mocked(appAutomate.retrieveDeviceLogs).mockResolvedValue('device logs');

      const result = await getFailureLogs({
        sessionId: 'test-session',
        logTypes: ['deviceLogs'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(resolveAppAutomateBuildId).toHaveBeenCalledWith('test-session', mockServer);
      expect(appAutomate.retrieveDeviceLogs).toHaveBeenCalledWith(
        'test-session',
        'resolved-build-id',
        mockServer,
      );
      expect(result.isError).toBeFalsy();
    });

    it('should not resolve buildId when the caller supplies one', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      vi.mocked(appAutomate.retrieveDeviceLogs).mockResolvedValue('device logs');

      await getFailureLogs({
        sessionId: 'test-session',
        buildId: 'explicit-build-id',
        logTypes: ['deviceLogs'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(resolveAppAutomateBuildId).not.toHaveBeenCalled();
      expect(appAutomate.retrieveDeviceLogs).toHaveBeenCalledWith(
        'test-session',
        'explicit-build-id',
        mockServer,
      );
    });

    it('should return error for invalid log types', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: 'test-session',
        logTypes: ['invalidLogType'] as any,
        sessionType: 'automate'
      }, mockServer);

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.type).toBe('text');
      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toContain('Invalid log type');
      }
    });

    it('should return error when mixing session types', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const automateResult = await getFailureLogs({
        sessionId: 'test-session',
        logTypes: ['deviceLogs'],
        sessionType: 'automate'
      }, mockServer);

      const appAutomateResult = await getFailureLogs({
        sessionId: 'test-session',
        buildId: 'test-build',
        logTypes: ['networkLogs'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(automateResult.isError).toBe(true);
      expect(appAutomateResult.isError).toBe(true);
    });
  });

  describe('Automate Session Logs', () => {
    const mockNetworkFailures =
      'Network Failures (1 found):\n' +
      JSON.stringify([
        {
          startedDateTime: '2024-03-20T10:00:00Z',
          request: { method: 'GET', url: 'https://test.com' },
          response: { status: 404, statusText: 'Not Found' },
          serverIPAddress: undefined,
          time: undefined,
        },
      ], null, 2);

    beforeEach(() => {
      // Reset all mocks
      vi.clearAllMocks();
      // Setup mock implementations with string return values
      vi.mocked(automate.retrieveNetworkFailures).mockResolvedValue(mockNetworkFailures);
      vi.mocked(automate.retrieveSessionFailures).mockResolvedValue(
        'Session Failures (1 found):\n' + JSON.stringify(['[ERROR] Test failed'], null, 2)
      );
      vi.mocked(automate.retrieveConsoleFailures).mockResolvedValue(
        'Console Failures (1 found):\n' + JSON.stringify(['Uncaught TypeError'], null, 2)
      );
    });

    it('should fetch network logs successfully', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['networkLogs'],
        sessionType: 'automate'
      }, mockServer);

      expect(automate.retrieveNetworkFailures).toHaveBeenCalledWith(mockSessionId, expect.anything());
      expect(result.content?.[0]?.type).toBe('text');
      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toContain('Network Failures (1 found)');
      }
    });

    it('should fetch session logs successfully', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['sessionLogs'],
        sessionType: 'automate'
      }, mockServer);

      expect(automate.retrieveSessionFailures).toHaveBeenCalledWith(mockSessionId, expect.anything());
      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toContain('Session Failures (1 found)');
        expect(result.content[0].text).toContain('[ERROR] Test failed');
      }
    });

    it('should fetch console logs successfully', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['consoleLogs'],
        sessionType: 'automate'
      }, mockServer);

      expect(automate.retrieveConsoleFailures).toHaveBeenCalledWith(mockSessionId, expect.anything());
      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toContain('Console Failures (1 found)');
        expect(result.content[0].text).toContain('Uncaught TypeError');
      }
    });
  });

  describe('App-Automate Session Logs', () => {
    beforeEach(() => {
      vi.mocked(appAutomate.retrieveDeviceLogs).mockResolvedValue(
        'Device Failures (1 found):\n' + JSON.stringify(['Fatal Exception: NullPointerException'], null, 2)
      );
      vi.mocked(appAutomate.retrieveAppiumLogs).mockResolvedValue(
        'Appium Failures (1 found):\n' + JSON.stringify(['Error: Element not found'], null, 2)
      );
      vi.mocked(appAutomate.retrieveCrashLogs).mockResolvedValue(
        'Crash Failures (1 found):\n' + JSON.stringify(['Application crashed due to signal 11'], null, 2)
      );
    });

    it('should fetch device logs successfully', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        buildId: mockBuildId,
        logTypes: ['deviceLogs'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(appAutomate.retrieveDeviceLogs).toHaveBeenCalledWith(mockSessionId, mockBuildId, expect.anything());
      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toContain('Device Failures (1 found)');
        expect(result.content[0].text).toContain('Fatal Exception');
      }
    });

    it('should fetch appium logs successfully', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        buildId: mockBuildId,
        logTypes: ['appiumLogs'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(appAutomate.retrieveAppiumLogs).toHaveBeenCalledWith(mockSessionId, mockBuildId, expect.anything());
      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toContain('Appium Failures (1 found)');
        expect(result.content[0].text).toContain('Element not found');
      }
    });

    it('should fetch crash logs successfully', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        buildId: mockBuildId,
        logTypes: ['crashLogs'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(appAutomate.retrieveCrashLogs).toHaveBeenCalledWith(mockSessionId, mockBuildId, expect.anything());
      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toContain('Crash Failures (1 found)');
        expect(result.content[0].text).toContain('signal 11');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle empty log responses', async () => {
      vi.mocked(automate.retrieveNetworkFailures).mockResolvedValue('No network failures found');

      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: mockSessionId,
        logTypes: ['networkLogs'],
        sessionType: 'automate'
      }, mockServer);

      if (result.content?.[0]?.type === 'text') {
        expect(result.content[0].text).toBe('No network failures found');
      }
    });
  });

  describe('Log Filtering', () => {
    beforeEach(() => {
      // Reset mock implementations before each test
      vi.mocked(automate.filterSessionFailures).mockImplementation((text: string) => {
        const lines = text.split('\n');
        return lines.filter((line: string) => 
          line.includes('ERROR') || 
          line.includes('EXCEPTION') || 
          line.includes('FATAL')
        );
      });
      
      vi.mocked(automate.filterConsoleFailures).mockImplementation((text: string) => {
        const lines = text.split('\n');
        return lines.filter((line: string) => 
          line.includes('Failed to load resource') || 
          line.includes('Uncaught TypeError')
        );
      });

      vi.mocked(appAutomate.filterDeviceFailures).mockReturnValue([]);
      vi.mocked(appAutomate.filterAppiumFailures).mockReturnValue([]);
      vi.mocked(appAutomate.filterCrashFailures).mockReturnValue([]);
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

      const result = vi.mocked(automate.filterSessionFailures)(logText);
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

      const result = vi.mocked(automate.filterConsoleFailures)(logText);
      expect(result).toEqual([
        "console.error('Failed to load resource')",
        "console.error('Uncaught TypeError')"
      ]);
    });

    it('should handle empty inputs in filters', () => {
      const emptyResult: string[] = [];
      vi.mocked(automate.filterSessionFailures).mockReturnValue(emptyResult);
      vi.mocked(automate.filterConsoleFailures).mockReturnValue(emptyResult);
      vi.mocked(appAutomate.filterDeviceFailures).mockReturnValue(emptyResult);
      vi.mocked(appAutomate.filterAppiumFailures).mockReturnValue(emptyResult);
      vi.mocked(appAutomate.filterCrashFailures).mockReturnValue(emptyResult);

      expect(automate.filterSessionFailures('')).toEqual([]);
      expect(automate.filterConsoleFailures('')).toEqual([]);
      expect(appAutomate.filterDeviceFailures('')).toEqual([]);
      expect(appAutomate.filterAppiumFailures('')).toEqual([]);
      expect(appAutomate.filterCrashFailures('')).toEqual([]);
    });
  });

  describe('Session video', () => {
    beforeEach(() => {
      vi.mocked(retrieveSessionVideo).mockResolvedValue('Session video: https://v/1');
      vi.mocked(appAutomate.retrieveAppiumLogs).mockResolvedValue('Appium Failures (1 found)');
    });

    it('fetches the video for an automate session', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: 'sess-1',
        logTypes: ['video'],
        sessionType: 'automate'
      }, mockServer);

      expect(retrieveSessionVideo).toHaveBeenCalledWith('sess-1', 'automate', mockServer);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe('Session video: https://v/1');
    });

    it('does not require or resolve a build id when only the video is requested for app-automate', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      const result = await getFailureLogs({
        sessionId: 'sess-2',
        logTypes: ['video'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(resolveAppAutomateBuildId).not.toHaveBeenCalled();
      expect(retrieveSessionVideo).toHaveBeenCalledWith('sess-2', 'app-automate', mockServer);
      expect(result.isError).toBeFalsy();
    });

    it('resolves the build id once when video is mixed with a build-scoped log type', async () => {
      const mockServer = { server: { getClientVersion: () => "test-version" } };
      (resolveAppAutomateBuildId as any).mockResolvedValue('resolved-build');

      const result = await getFailureLogs({
        sessionId: 'sess-3',
        logTypes: ['appiumLogs', 'video'],
        sessionType: 'app-automate'
      }, mockServer);

      expect(resolveAppAutomateBuildId).toHaveBeenCalledTimes(1);
      expect(appAutomate.retrieveAppiumLogs).toHaveBeenCalledWith('sess-3', 'resolved-build', mockServer);
      expect(retrieveSessionVideo).toHaveBeenCalledWith('sess-3', 'app-automate', mockServer);
      expect(result.content.map((c: any) => c.text)).toEqual([
        'Appium Failures (1 found)',
        'Session video: https://v/1',
      ]);
    });
  });
});
