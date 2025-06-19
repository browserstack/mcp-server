export const SessionType = {
  Automate: "automate",
  AppAutomate: "app-automate",
} as const;

export const AutomateLogType = {
  NetworkLogs: "networkLogs",
  SessionLogs: "sessionLogs",
  ConsoleLogs: "consoleLogs",
} as const;

export const AppAutomateLogType = {
  DeviceLogs: "deviceLogs",
  AppiumLogs: "appiumLogs",
  CrashLogs: "crashLogs",
} as const;

export const BrowserstackLogTypes = {
  Network: "network",
  Session: "session",
  Text: "text",
  Console: "console",
  Selenium: "selenium",
  Appium: "appium",
  Device: "device",
  Crash: "crash",
  Playwright: "playwright",
  Telemetry: "telemetry",
  Performance: "performance",
  Terminal: "terminal",
  BrowserProfiling: "browserProfiling",
} as const;

export type SessionType = (typeof SessionType)[keyof typeof SessionType];
export type AutomateLogType =
  (typeof AutomateLogType)[keyof typeof AutomateLogType];
export type AppAutomateLogType =
  (typeof AppAutomateLogType)[keyof typeof AppAutomateLogType];
