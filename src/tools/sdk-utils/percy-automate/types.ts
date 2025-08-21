/**
 * Type for Percy Automate configuration mapping.
 * Structure: language -> driver -> testingFramework -> { instructions: string }
 */
export type ConfigMapping = {
  [language: string]: {
    [driver: string]: {
      [framework: string]: {
        instructions: string;
      };
    };
  };
};
