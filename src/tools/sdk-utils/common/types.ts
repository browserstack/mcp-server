export enum PercyIntegrationTypeEnum {
  WEB = "web",
  AUTOMATE = "automate",
}

export enum SDKSupportedLanguageEnum {
  nodejs = "nodejs",
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
  webdriverio = "webdriverio",
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
  serenity = "serenity",
}

export const SDKSupportedLanguages = Object.values(SDKSupportedLanguageEnum);
export type SDKSupportedTestingFramework =
  keyof typeof SDKSupportedTestingFrameworkEnum;
export const SDKSupportedTestingFrameworks = Object.values(
  SDKSupportedTestingFrameworkEnum,
);

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

export enum PercyAutomateNotImplementedType {
  LANGUAGE = "language",
  FRAMEWORK = "framework",
}
