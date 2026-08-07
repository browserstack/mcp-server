import {
  AppSDKSupportedLanguage,
  AppSDKSupportedTestingFramework,
} from "./index.js";

// Language-specific instruction imports
import { getJavaAppInstructions } from "./languages/java.js";
import { getCSharpAppInstructions } from "./languages/csharp.js";
import { getNodejsAppInstructions } from "./languages/nodejs.js";
import { getPythonAppInstructions } from "./languages/python.js";
import { getRubyAppInstructions } from "./languages/ruby.js";

// Language-specific command imports
import { getCSharpSDKCommand } from "./languages/csharp.js";
import { getJavaSDKCommand } from "./languages/java.js";
import { getNodejsSDKCommand } from "./languages/nodejs.js";
import { getPythonSDKCommand } from "./languages/python.js";
import { getRubySDKCommand } from "./languages/ruby.js";

export function getAppInstructionsForProjectConfiguration(
  framework: string,
  testingFramework: AppSDKSupportedTestingFramework,
  language: AppSDKSupportedLanguage,
): string {
  if (!framework || !testingFramework || !language) {
    return "";
  }

  switch (language) {
    case "java":
      return getJavaAppInstructions();
    case "nodejs":
      return getNodejsAppInstructions(testingFramework);
    case "python":
      return getPythonAppInstructions(testingFramework);
    case "ruby":
      return getRubyAppInstructions();
    case "csharp":
      return getCSharpAppInstructions();
    default:
      return "";
  }
}

export function getAppSDKPrefixCommand(
  language: AppSDKSupportedLanguage,
  testingFramework: string,
  appPath?: string,
): string {
  switch (language) {
    case "csharp":
      return getCSharpSDKCommand();
    case "java":
      return getJavaSDKCommand(testingFramework, appPath);
    case "nodejs":
      return getNodejsSDKCommand(testingFramework);
    case "python":
      return getPythonSDKCommand(testingFramework);
    case "ruby":
      return getRubySDKCommand();
    default:
      return "";
  }
}
