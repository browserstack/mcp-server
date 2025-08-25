export enum AppTestPlatform {
  ESPRESSO = "espresso",
  XCUITEST = "xcuitest",
}

export interface Device {
  device: string;
  display_name: string;
  os_version: string;
  real_mobile: boolean;
}

export interface PlatformDevices {
  os: string;
  os_display_name: string;
  devices: Device[];
}

export enum Platform {
  ANDROID = "android",
  IOS = "ios",
}
