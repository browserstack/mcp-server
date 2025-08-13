import {
  SDKSupportedTestingFrameworkEnum,
  SDKSupportedLanguageEnum,
} from "../sdk-utils/common/types.js";

export type ListTestFilesParams = {
  dirs: string[];
  language: SDKSupportedLanguageEnum;
  framework?: SDKSupportedTestingFrameworkEnum;
};

export interface DetectionConfig {
  extensions: string[];
  namePatterns: RegExp[];
  contentRegex: RegExp[];
  uiDriverRegex: RegExp[];
  uiIndicatorRegex: RegExp[];
  backendRegex: RegExp[];
  excludeRegex?: RegExp[];
}
