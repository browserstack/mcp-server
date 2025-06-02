import { startBrowserSession } from '../../src/tools/live-utils/start-session';
import * as local from '../../src/lib/local';
import logger from '../../src/logger';
import addBrowserLiveTools from '../../src/tools/live';
import { beforeEach, it, expect, describe, vi, Mock } from 'vitest'

vi.mock('../../src/tools/live-utils/start-session', () => ({
  startBrowserSession: vi.fn()
}));
vi.mock('../../src/lib/local', () => ({
  isLocalURL: vi.fn(),
  killExistingBrowserStackLocalProcesses: vi.fn(),
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

vi.mock('../../src/lib/instrumentation', () => ({
  trackMCP: vi.fn()
}));

describe('startBrowserLiveSession', () => {
  let serverMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = {
      tool: vi.fn((name, desc, schema, handler) => {
        serverMock.handler = handler;
      }),
      server: {
        getClientVersion: vi.fn().mockReturnValue({ version: '1.0.0' })
      }
    };

    addBrowserLiveTools(serverMock);

    (startBrowserSession as Mock).mockResolvedValue('https://live.browserstack.com/123456');
    (local.isLocalURL as Mock).mockReturnValue(false);
    (local.killExistingBrowserStackLocalProcesses as Mock).mockResolvedValue(undefined);
  });

  const validDesktopArgs = {
    platformType: 'desktop',
    desiredURL: 'https://example.com',
    desiredOS: 'Windows',
    desiredOSVersion: '10',
    desiredBrowser: 'chrome',
    desiredBrowserVersion: 'latest'
  };

  const validMobileArgs = {
    platformType: 'mobile',
    desiredURL: 'https://example.com',
    desiredOS: 'android',
    desiredOSVersion: '12',
    desiredBrowser: 'chrome',
    desiredDevice: 'Pixel 5',
    desiredBrowserVersion: 'latest'
  };

  it('should successfully start a desktop browser session', async () => {
    const result = await serverMock.handler(validDesktopArgs);
    expect(result.content[0].text).toContain('✅ Session started');
    expect(startBrowserSession).toHaveBeenCalled();
  });

  it('should successfully start a mobile browser session', async () => {
    const result = await serverMock.handler(validMobileArgs);
    expect(result.content[0].text).toContain('✅ Session started');
    expect(startBrowserSession).toHaveBeenCalled();
  });

  it('should handle session start failure', async () => {
    (startBrowserSession as Mock).mockRejectedValue(new Error('Session start failed'));
    const result = await serverMock.handler(validDesktopArgs);
    expect(logger.error).toHaveBeenCalled();
    expect(result.content[0].text).toContain('Failed to start a browser live session');
  });

  it('should fail on schema validation error (missing desiredBrowser)', async () => {
    const invalidArgs = { ...validDesktopArgs, desiredBrowser: undefined };
    const result = await serverMock.handler(invalidArgs);
    expect(result.content[0].text).toContain('Failed to start a browser live session');
    expect(result.isError).toBe(true);
  });
});
