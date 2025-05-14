import {
  findMatchingDevice,
  getDeviceVersions,
  resolveVersion,
  validateArgs,
} from '../../src/tools/appautomate-utils/appautomate';
import { beforeEach, it, expect, describe, vi } from 'vitest'


// Mock only the external dependencies
vi.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    browserstackUsername: 'fake-user',
    browserstackAccessKey: 'fake-key',
  },
}));

vi.mock('fs');
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
  trackMCP: vi.fn(),
}));

describe('appautomate utils', () => {
  const validAndroidArgs = {
    desiredPlatform: 'android',
    desiredPlatformVersion: '12.0',
    appPath: '/path/to/app.apk',
    desiredPhone: 'Samsung Galaxy S20',
  };

  const validIOSArgs = {
    desiredPlatform: 'ios',
    desiredPlatformVersion: '16.0',
    appPath: '/path/to/app.ipa',
    desiredPhone: 'iPhone 12 Pro',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateArgs', () => {
    it('should validate Android args successfully', () => {
      expect(() => validateArgs(validAndroidArgs)).not.toThrow();
    });

    it('should validate iOS args successfully', () => {
      expect(() => validateArgs(validIOSArgs)).not.toThrow();
    });

    it('should fail if platform is not provided', () => {
      const args = { ...validAndroidArgs, desiredPlatform: '' };
      expect(() => validateArgs(args)).toThrow('Missing required arguments');
    });

    it('should fail if app path is not provided', () => {
      const args = { ...validAndroidArgs, appPath: '' };
      expect(() => validateArgs(args)).toThrow('You must provide an appPath');
    });

    it('should fail if phone is not provided', () => {
      const args = { ...validAndroidArgs, desiredPhone: '' };
      expect(() => validateArgs(args)).toThrow('Missing required arguments');
    });

    it('should fail if Android app path does not end with .apk', () => {
      const args = { ...validAndroidArgs, appPath: '/path/to/app.ipa' };
      expect(() => validateArgs(args)).toThrow('You must provide a valid Android app path');
    });

    it('should fail if iOS app path does not end with .ipa', () => {
      const args = { ...validIOSArgs, appPath: '/path/to/app.apk' };
      expect(() => validateArgs(args)).toThrow('You must provide a valid iOS app path');
    });
  });

  describe('findMatchingDevice', () => {
    const devices = [
      { device: 'Samsung Galaxy S20', display_name: 'Samsung Galaxy S20', os_version: '12.0', real_mobile: true },
      { device: 'iPhone 12 Pro', display_name: 'iPhone 12 Pro', os_version: '16.0', real_mobile: true },
      { device: 'Samsung Galaxy S21', display_name: 'Samsung Galaxy S21', os_version: '12.0', real_mobile: true },
    ];

    it('should find exact matching device', () => {
      const result = findMatchingDevice(devices, 'Samsung Galaxy S20');
      expect(result).toHaveLength(1);
      expect(result[0].display_name).toBe('Samsung Galaxy S20');
    });

    it('should throw error if no device found', () => {
      expect(() => findMatchingDevice(devices, 'Invalid Device')).toThrow('No devices found');
    });

    it('should throw error with suggestions for similar devices', () => {
      expect(() => findMatchingDevice(devices, 'Galaxy')).toThrow('Alternative devices found');
    });
  });

  describe('getDeviceVersions', () => {
    const devices = [
      { device: 'Device1', display_name: 'Device1', os_version: '11.0', real_mobile: true },
      { device: 'Device2', display_name: 'Device2', os_version: '12.0', real_mobile: true },
      { device: 'Device3', display_name: 'Device3', os_version: '11.0', real_mobile: true },
      { device: 'Device4', display_name: 'Device4', os_version: '13.0', real_mobile: true },
    ];

    it('should return unique sorted versions', () => {
      const versions = getDeviceVersions(devices);
      expect(versions).toEqual(['11.0', '12.0', '13.0']);
    });
  });

  describe('resolveVersion', () => {
    const versions = ['11.0', '12.0', '13.0'];

    it('should resolve latest version', () => {
      expect(resolveVersion(versions, 'latest')).toBe('13.0');
    });

    it('should resolve oldest version', () => {
      expect(resolveVersion(versions, 'oldest')).toBe('11.0');
    });

    it('should resolve specific version', () => {
      expect(resolveVersion(versions, '12.0')).toBe('12.0');
    });

    it('should throw error for invalid version', () => {
      expect(() => resolveVersion(versions, '10.0')).toThrow('Version "10.0" not found');
    });
  });
}); 