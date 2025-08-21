/**
 * Type for Percy + BrowserStack SDK configuration mapping.
 * Structure: language -> automationFramework -> testingFramework -> { instructions: (bsdkToken: string) => string }
 */

export type ConfigMapping = {
  [language: string]: {
    [automationFramework: string]: {
      [testingFramework: string]: {
        instructions: string;
      };
    };
  };
};
