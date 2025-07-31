export enum PercyIntegrationTypeEnum {
  WEB = "web",
  AUTOMATE = "automate",
}

export enum SDKSupportedLanguageEnum {
  nodejs = "nodejs",
  javascript = "javascript",
  python = "python",
  java = "java",
  csharp = "csharp",
  ruby = "ruby",
}
export type SDKSupportedLanguage = keyof typeof SDKSupportedLanguageEnum;

export enum SDKSupportedBrowserAutomationFrameworkEnum {
  playwright = "playwright",
  selenium = "selenium",
  cypress = "cypress",
}
export type SDKSupportedBrowserAutomationFramework =
  keyof typeof SDKSupportedBrowserAutomationFrameworkEnum;

export enum SDKSupportedTestingFrameworkEnum {
  jest = "jest",
  codeceptjs = "codeceptjs",
  playwright = "playwright",
  pytest = "pytest",
  robot = "robot",
  behave = "behave",
  cucumber = "cucumber",
  nightwatch = "nightwatch",
  webdriverio = "webdriverio",
  mocha = "mocha",
  junit4 = "junit4",
  junit5 = "junit5",
  testng = "testng",
  cypress = "cypress",
  nunit = "nunit",
  mstest = "mstest",
  xunit = "xunit",
  specflow = "specflow",
  reqnroll = "reqnroll",
  rspec = "rspec",
}
export type SDKSupportedTestingFramework =
  keyof typeof SDKSupportedTestingFrameworkEnum;

export type ConfigMapping = Partial<
  Record<
    SDKSupportedLanguageEnum,
    Partial<
      Record<
        SDKSupportedBrowserAutomationFrameworkEnum,
        Partial<
          Record<
            SDKSupportedTestingFrameworkEnum,
            {
              instructions: (
                username: string,
                accessKey: string,
              ) => { setup: string; run: string };
            }
          >
        >
      >
    >
  >
>;

// Common interfaces for instruction results
export interface RunTestsStep {
  type: "instruction" | "error" | "warning";
  title: string;
  content: string;
  isError?: boolean;
}

export interface RunTestsInstructionResult {
  steps: RunTestsStep[];
  requiresPercy: boolean;
  missingDependencies: string[];
  shouldSkipFormatting?: boolean;
}
