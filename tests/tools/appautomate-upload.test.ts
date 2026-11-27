import { describe, it, expect, vi, beforeEach } from 'vitest';
import addAppAutomationTools from '../../src/tools/appautomate';
import { uploadApp } from '../../src/tools/appautomate-utils/native-execution/appautomate';
import { getBrowserStackAuth } from '../../src/lib/get-auth';
import { trackMCP } from '../../src/lib/instrumentation';

vi.mock('../../src/tools/appautomate-utils/native-execution/appautomate', () => ({
  uploadApp: vi.fn(),
  uploadEspressoApp: vi.fn(),
  uploadEspressoTestSuite: vi.fn(),
  triggerEspressoBuild: vi.fn(),
  uploadXcuiApp: vi.fn(),
  uploadXcuiTestSuite: vi.fn(),
  triggerXcuiBuild: vi.fn(),
  findMatchingDevice: vi.fn(),
  getDeviceVersions: vi.fn(),
  resolveVersion: vi.fn(),
  validateArgs: vi.fn(),
}));
vi.mock('../../src/lib/get-auth', () => ({ getBrowserStackAuth: vi.fn() }));
vi.mock('../../src/lib/instrumentation', () => ({ trackMCP: vi.fn() }));
vi.mock('../../src/lib/device-cache', () => ({
  getDevicesAndBrowsers: vi.fn(),
  BrowserStackProducts: { APP_AUTOMATE: 'app-automate' },
}));
vi.mock('../../src/sdk-utils/common/device-validator', () => ({
  validateAppAutomateDevices: vi.fn(),
}));
vi.mock('webdriverio', () => ({ remote: vi.fn() }));
vi.mock('../../src/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockConfig = {
  'browserstack-username': 'fake-user',
  'browserstack-access-key': 'fake-key',
};
const clientVersion = { name: 'test-client', version: '1.0' };

describe('uploadAppToBrowserStack MCP tool', () => {
  let serverMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    serverMock = {
      tool: vi.fn((...toolArgs: any[]) => {
        const name = toolArgs[0];
        const handler = toolArgs[toolArgs.length - 1];
        serverMock.handlers = serverMock.handlers || {};
        serverMock.handlers[name] = handler;
      }),
      server: { getClientVersion: vi.fn().mockReturnValue(clientVersion) },
    };
    (getBrowserStackAuth as any).mockReturnValue('fake-user:fake-key');
    addAppAutomationTools(serverMock, mockConfig as any);
  });

  it('is registered as a tool', () => {
    expect(serverMock.handlers['uploadAppToBrowserStack']).toBeDefined();
  });

  it('returns the bs:// URL on success', async () => {
    (uploadApp as any).mockResolvedValue('bs://abc123');

    const result = await serverMock.handlers['uploadAppToBrowserStack']({
      appPath: '/uploads/app.apk',
    });

    expect(uploadApp).toHaveBeenCalledWith('/uploads/app.apk', 'fake-user', 'fake-key');
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('bs://abc123');
    expect(result.isError).toBeFalsy();
  });

  it('records a success telemetry event', async () => {
    (uploadApp as any).mockResolvedValue('bs://abc123');

    await serverMock.handlers['uploadAppToBrowserStack']({ appPath: '/uploads/app.apk' });

    expect(trackMCP).toHaveBeenCalledWith(
      'uploadAppToBrowserStack',
      clientVersion,
      undefined,
      mockConfig,
    );
  });

  it('returns isError and records failure telemetry on upload error', async () => {
    const err = new Error('upload failed');
    (uploadApp as any).mockRejectedValue(err);

    const result = await serverMock.handlers['uploadAppToBrowserStack']({
      appPath: '/uploads/app.apk',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('upload failed');
    expect(trackMCP).toHaveBeenCalledWith(
      'uploadAppToBrowserStack',
      clientVersion,
      err,
      mockConfig,
    );
  });
});
