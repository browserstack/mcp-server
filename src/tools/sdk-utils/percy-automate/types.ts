/**
 * Type for Percy Automate configuration mapping.
 * Structure: language -> testingFramework -> { instructions: (projectName: string) => string }
 */
export type ConfigMapping = {
  [language: string]: {
    [testingFramework: string]: {
      instructions: string;
    };
  };
};
