import {
  SDKSupportedBrowserAutomationFramework,
  SDKSupportedLanguage,
  SDKSupportedTestingFramework,
} from "../types.js";

export interface PercyInstructions {
  script_updates: string;
}

export type PercyConfigMapping = Partial<
  Record<
    SDKSupportedLanguage,
    Partial<
      Record<
        SDKSupportedBrowserAutomationFramework,
        Partial<Record<SDKSupportedTestingFramework, PercyInstructions>>
      >
    >
  >
>;
