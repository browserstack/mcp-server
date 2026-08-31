// Java instructions and commands for App SDK utilities
import {
  createStep,
  combineInstructions,
  createEnvStep,
  PLATFORM_UTILS,
  USERNAME_PLACEHOLDER,
  ACCESS_KEY_PLACEHOLDER,
} from "../index.js";

// Java-specific constants and mappings
export const MAVEN_ARCHETYPE_GROUP_ID = "com.browserstack";
export const MAVEN_ARCHETYPE_ARTIFACT_ID = "junit-archetype-integrate";
export const MAVEN_ARCHETYPE_VERSION = "1.0";

// Version mapping for different frameworks
export const JAVA_APP_FRAMEWORK_VERSION_MAP: Record<string, string> = {
  testng: "1.4",
  selenide: "1.4",
  junit5: "1.0",
  junit4: "1.0",
  jbehave: "1.0",
  cucumberTestng: "1.0",
  cucumberJunit4: "1.0",
  cucumberJunit5: "1.0",
  cucumber: "1.0",
  serenity: "1.0",
};

// Framework mapping for Java Maven archetype generation for App Automate
export const JAVA_APP_FRAMEWORK_MAP: Record<string, string> = {
  testng: "testng-archetype-integrate",
  junit5: "browserstack-sdk-archetype-integrate",
  selenide: "selenide-archetype-integrate",
  jbehave: "browserstack-sdk-archetype-integrate",
  junit4: "browserstack-sdk-archetype-integrate",
  cucumberTestng: "browserstack-sdk-archetype-integrate",
  cucumberJunit4: "browserstack-sdk-archetype-integrate",
  cucumberJunit5: "browserstack-sdk-archetype-integrate",
  cucumber: "browserstack-sdk-archetype-integrate",
  serenity: "browserstack-sdk-archetype-integrate",
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

export function getJavaAppFrameworkVersion(framework: string): string {
  return JAVA_APP_FRAMEWORK_VERSION_MAP[framework] || MAVEN_ARCHETYPE_VERSION;
}

function getMavenCommandForWindows(
  framework: string,
  mavenFramework: string,
  version: string,
  appPath?: string,
): string {
  let command =
    `mvn archetype:generate -B ` +
    `-DarchetypeGroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DarchetypeArtifactId="${mavenFramework}" ` +
    `-DarchetypeVersion="${version}" ` +
    `-DgroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DartifactId="${mavenFramework}" ` +
    `-Dversion="${version}" ` +
    `-DBROWSERSTACK_USERNAME="${USERNAME_PLACEHOLDER}" ` +
    `-DBROWSERSTACK_ACCESS_KEY="${ACCESS_KEY_PLACEHOLDER}"`;

  // Add framework parameter for browserstack-sdk-archetype-integrate
  if (mavenFramework === "browserstack-sdk-archetype-integrate") {
    command += ` -DBROWSERSTACK_FRAMEWORK="${framework}"`;
  }

  // Add app path if provided
  if (appPath) {
    command += ` -DBROWSERSTACK_APP="${appPath}"`;
  }

  return command;
}

function getMavenCommandForUnix(
  framework: string,
  mavenFramework: string,
  version: string,
  appPath?: string,
): string {
  let command =
    `mvn archetype:generate -B ` +
    `-DarchetypeGroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DarchetypeArtifactId="${mavenFramework}" ` +
    `-DarchetypeVersion="${version}" ` +
    `-DgroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DartifactId="${mavenFramework}" ` +
    `-Dversion="${version}" ` +
    `-DBROWSERSTACK_USERNAME="${USERNAME_PLACEHOLDER}" ` +
    `-DBROWSERSTACK_ACCESS_KEY="${ACCESS_KEY_PLACEHOLDER}"`;

  // Add framework parameter for browserstack-sdk-archetype-integrate
  if (mavenFramework === "browserstack-sdk-archetype-integrate") {
    command += ` -DBROWSERSTACK_FRAMEWORK="${framework}"`;
  }

  // Add app path if provided
  if (appPath) {
    command += ` -DBROWSERSTACK_APP="${appPath}"`;
  }

  return command;
}

export function getJavaSDKCommand(framework: string, appPath?: string): string {
  const { isWindows = false, getPlatformLabel } = PLATFORM_UTILS || {};

  const mavenFramework = getJavaAppFrameworkForMaven(framework);
  const version = getJavaAppFrameworkVersion(framework);

  let mavenCommand: string;

  if (isWindows) {
    mavenCommand = getMavenCommandForWindows(
      framework,
      mavenFramework,
      version,
      appPath,
    );
  } else {
    mavenCommand = getMavenCommandForUnix(
      framework,
      mavenFramework,
      version,
      appPath,
    );
  }

  const envStep = createEnvStep(isWindows, getPlatformLabel());

  const mavenStep = createStep(
    "Install BrowserStack SDK using Maven Archetype for App Automate",
    `Maven command for ${framework} (${getPlatformLabel()}):
    \`\`\`bash
    ${mavenCommand}
    \`\`\`

    Alternative setup for Gradle users:
    ${GRADLE_APP_SETUP_INSTRUCTIONS}`,
  );

  const argsLineStep = createStep(
    "Verifying dependency and argsLine",
    `Verify browserstack-java-sdk with LATEST is added as dependency and add this line in pom.xml if not added:
    \`\`\`xml
    <argLine>-javaagent:"\${com.browserstack:browserstack-java-sdk:jar}"</argLine>
    \`\`\``,
  );

  return combineInstructions(envStep, mavenStep, argsLineStep);
}
