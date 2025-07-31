/**
 * Centralized error and fallback messages for runTestsOnBrowserStack tool.
 */

export const IMPORTANT_SETUP_WARNING =
  "⚠️ IMPORTANT: DO NOT SKIP ANY STEP\nAll the setup steps described below MUST be executed regardless of any existing configuration or setup.\nThis ensures proper BrowserStack SDK setup.";

export const UNKNOWN_CONFIGURATION_ERROR =
  "Unknown configuration for runTestsOnBrowserStack. Please check your input parameters and try again.";

export const PERCY_WEB_NOT_IMPLEMENTED =
  "Percy Web (direct Percy SDK) support is not yet implemented. Please check back later.";

export const PERCY_AUTOMATE_NOT_IMPLEMENTED =
  "Percy Automate support is not yet implemented for this configuration. Please check back later.";

export enum PercyAutomateNotImplementedType {
  LANGUAGE = "language",
  FRAMEWORK = "framework",
}

export function getPercyAutomateNotImplementedMessage(
  type: PercyAutomateNotImplementedType,
  input: {
    detectedLanguage: string;
    detectedBrowserAutomationFramework: string;
  },
  supported: string[],
): string {
  if (type === PercyAutomateNotImplementedType.LANGUAGE) {
    return `Percy Automate does not support the language: ${input.detectedLanguage}. Supported languages are: ${supported.join(", ")}.`;
  } else {
    return `Percy Automate does not support ${input.detectedBrowserAutomationFramework} for ${input.detectedLanguage}. Supported frameworks for ${input.detectedLanguage} are: ${supported.join(", ")}.`;
  }
}

export const BOOTSTRAP_FAILED = (
  error: unknown,
  context: { config: unknown; percyMode?: string; sdkVersion?: string },
) =>
  `Failed to bootstrap project with BrowserStack SDK.
Error: ${error}
Percy Mode: ${context.percyMode ?? "automate"}
SDK Version: ${context.sdkVersion ?? "N/A"}
Please open an issue on GitHub if the problem persists.`;

export const percyAutomateAggressiveInstruction = `
**MANDATORY: Aggressive, Exhaustive Percy Automate Integration**

You MUST follow these steps with NO EXCEPTIONS:

1. Recursively search the ENTIRE target directory and ALL subdirectories for EVERY file relevant to the language/framework.
2. For EACH relevant file, analyze the code to find EVERY location where a Percy snapshot (or equivalent) should be called (e.g., after each navigation, UI change, or significant state in tests). Insert snapshot calls at ALL such points, not just the first or most obvious one.
3. At the top of EVERY relevant file, ensure the necessary import/setup is present (do NOT duplicate if already present).
4. Insert the snapshot call (with a clear, descriptive, and unique name) at EVERY identified point in EVERY relevant file.
5. Double-check your work. If in doubt, add more snapshot calls rather than fewer. DO NOT stop until you have processed ALL relevant files and ALL important points within them.
`;
