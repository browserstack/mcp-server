/**
 * Type for Percy Web configuration mapping.
 * Structure: language -> automationFramework -> { instructions: string }
 */
export type ConfigMapping = {
  [language: string]: {
    [automationFramework: string]: {
      instructions: string;
    };
  };
};
