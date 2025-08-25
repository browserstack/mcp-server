// Java instructions and commands for App SDK utilities
import {
  createStep,
  combineInstructions,
  createEnvStep,
  PLATFORM_UTILS,
} from "../index.js";

// Java-specific constants and mappings
export const MAVEN_ARCHETYPE_GROUP_ID = "com.browserstack";
export const MAVEN_ARCHETYPE_ARTIFACT_ID = "junit-archetype-integrate";
export const MAVEN_ARCHETYPE_VERSION = "1.0";

// Framework mapping for Java Maven archetype generation for App Automate
export const JAVA_APP_FRAMEWORK_MAP: Record<string, string> = {
  testng: "browserstack-sdk-archetype-integrate",
  junit5: "browserstack-sdk-archetype-integrate",
  selenide: "selenide-archetype-integrate",
  jbehave: "browserstack-sdk-archetype-integrate",
  cucumberTestng: "browserstack-sdk-archetype-integrate",
  cucumberJunit4: "browserstack-sdk-archetype-integrate",
  cucumberJunit5: "browserstack-sdk-archetype-integrate",
};

// Common Gradle setup instructions for App Automate (platform-independent)
export const GRADLE_APP_SETUP_INSTRUCTIONS = `
**For Gradle setup:**
1. Add browserstack-java-sdk to dependencies:
   compileOnly 'com.browserstack:browserstack-java-sdk:latest.release'

2. Add browserstackSDK path variable:
   def browserstackSDKArtifact = configurations.compileClasspath.resolvedConfiguration.resolvedArtifacts.find { it.name == 'browserstack-java-sdk' }

3. Add javaagent to gradle tasks:
   jvmArgs "-javaagent:\${browserstackSDKArtifact.file}"
`;

export function getJavaAppInstructions(): string {
  const baseRunStep = createStep(
    "Run your App Automate test suite:",
    `\`\`\`bash
mvn test
\`\`\``,
  );
  return baseRunStep;
}

export function getJavaAppFrameworkForMaven(framework: string): string {
  return JAVA_APP_FRAMEWORK_MAP[framework] || framework;
}

function getMavenCommandForWindows(
  framework: string,
  mavenFramework: string,
): string {
  return (
    `mvn archetype:generate -B ` +
    `-DarchetypeGroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DarchetypeArtifactId="${mavenFramework}" ` +
    `-DarchetypeVersion="${MAVEN_ARCHETYPE_VERSION}" ` +
    `-DgroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DartifactId="${MAVEN_ARCHETYPE_ARTIFACT_ID}" ` +
    `-Dversion="${MAVEN_ARCHETYPE_VERSION}" ` +
    `-DBROWSERSTACK_USERNAME="${process.env.BROWSERSTACK_USERNAME}" ` +
    `-DBROWSERSTACK_ACCESS_KEY="${process.env.BROWSERSTACK_ACCESS_KEY}" ` +
    `-DBROWSERSTACK_FRAMEWORK="${framework}"`
  );
}

function getMavenCommandForUnix(
  framework: string,
  mavenFramework: string,
): string {
  return (
    `mvn archetype:generate -B ` +
    `-DarchetypeGroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DarchetypeArtifactId="${mavenFramework}" ` +
    `-DarchetypeVersion="${MAVEN_ARCHETYPE_VERSION}" ` +
    `-DgroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DartifactId="${MAVEN_ARCHETYPE_ARTIFACT_ID}" ` +
    `-Dversion="${MAVEN_ARCHETYPE_VERSION}" ` +
    `-DBROWSERSTACK_USERNAME="${process.env.BROWSERSTACK_USERNAME}" ` +
    `-DBROWSERSTACK_ACCESS_KEY="${process.env.BROWSERSTACK_ACCESS_KEY}" ` +
    `-DBROWSERSTACK_FRAMEWORK="${framework}"`
  );
}

export function getJavaSDKCommand(
  framework: string,
  username: string,
  accessKey: string,
  appPath?: string,
): string {
  const { isWindows = false, getPlatformLabel } = PLATFORM_UTILS || {};

  const mavenFramework = getJavaAppFrameworkForMaven(framework);

  let mavenCommand: string;

  if (isWindows) {
    mavenCommand = getMavenCommandForWindows(framework, mavenFramework);
    if (appPath) {
      mavenCommand += ` -DBROWSERSTACK_APP="${appPath}"`;
    }
  } else {
    mavenCommand = getMavenCommandForUnix(framework, mavenFramework);
    if (appPath) {
      mavenCommand += ` -DBROWSERSTACK_APP="${appPath}"`;
    }
  }

  const envStep = createEnvStep(
    username,
    accessKey,
    isWindows,
    getPlatformLabel(),
  );

  const mavenStep = createStep(
    "Install BrowserStack SDK using Maven Archetype for App Automate",
    `Maven command for ${framework} (${getPlatformLabel()}):
\`\`\`bash
${mavenCommand}
\`\`\`

Alternative setup for Gradle users:
${GRADLE_APP_SETUP_INSTRUCTIONS}`,
  );

  return combineInstructions(envStep, mavenStep);
}
