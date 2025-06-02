export interface DesktopSearchArgs {
  platformType: "desktop";
  url: string;
  os: string;
  osVersion: string;
  browser: string;
  browserVersion: string;
}

export interface DesktopEntry {
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
  notes?: string;
}

export interface MobileSearchArgs {
  platformType: "mobile";
  url: string;
  os: string;
  osVersion: string;
  device: string;
  browser: string;
}

export interface MobileEntry {
  os: string;
  os_version: string;
  display_name: string;
  notes?: string;
}

export enum PlatformType {
  DESKTOP = "desktop",
  MOBILE = "mobile",
}
