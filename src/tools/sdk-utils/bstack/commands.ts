import { SDKSupportedLanguage } from "../common/types.js";

// Constants
const MAVEN_ARCHETYPE_GROUP_ID = "com.browserstack";
const MAVEN_ARCHETYPE_ARTIFACT_ID = "browserstack-sdk-archetype-integrate";
const MAVEN_ARCHETYPE_VERSION = "1.0";

// Mapping of test frameworks to their corresponding Maven archetype framework names
const JAVA_FRAMEWORK_MAP: Record<string, string> = {
  testng: "testng",
  junit5: "junit5",
  junit4: "junit4",
  cucumber: "cucumber-testng",
} as const;

// Template for Node.js SDK setup instructions
const NODEJS_SDK_INSTRUCTIONS = (
  username: string,
  accessKey: string,
): string => `---STEP---
Install BrowserStack Node SDK using command:
\`\`\`bash
npm i -D browserstack-node-sdk@latest
\`\`\`
---STEP---
Run the following command to setup browserstack sdk:
\`\`\`bash
npx setup --username ${username} --key ${accessKey}
\`\`\``;

// Template for Gradle setup instructions (platform-independent)
const GRADLE_SETUP_INSTRUCTIONS = `
**For Gradle setup:**
1. Add browserstack-java-sdk to dependencies:
   compileOnly 'com.browserstack:browserstack-java-sdk:latest.release'

2. Add browserstackSDK path variable:
   def browserstackSDKArtifact = configurations.compileClasspath.resolvedConfiguration.resolvedArtifacts.find { it.name == 'browserstack-java-sdk' }

3. Add javaagent to gradle tasks:
   jvmArgs "-javaagent:\${browserstackSDKArtifact.file}"
`;

// Generates Maven archetype command for Windows platform
function getMavenCommandForWindows(
  framework: string,
  mavenFramework: string,
): string {
  return (
    `mvn archetype:generate -B ` +
    `-DarchetypeGroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DarchetypeArtifactId="${MAVEN_ARCHETYPE_ARTIFACT_ID}" ` +
    `-DarchetypeVersion="${MAVEN_ARCHETYPE_VERSION}" ` +
    `-DgroupId="${MAVEN_ARCHETYPE_GROUP_ID}" ` +
    `-DartifactId="${MAVEN_ARCHETYPE_ARTIFACT_ID}" ` +
    `-Dversion="${MAVEN_ARCHETYPE_VERSION}" ` +
    `-DBROWSERSTACK_USERNAME="${process.env.BROWSERSTACK_USERNAME}" ` +
    `-DBROWSERSTACK_ACCESS_KEY="${process.env.BROWSERSTACK_ACCESS_KEY}" ` +
    `-DBROWSERSTACK_FRAMEWORK="${mavenFramework}"`
  );
}

// Generates Maven archetype command for Unix-like platforms (macOS/Linux)
function getMavenCommandForUnix(
  username: string,
  accessKey: string,
  mavenFramework: string,
): string {
  return `mvn archetype:generate -B -DarchetypeGroupId=${MAVEN_ARCHETYPE_GROUP_ID} \\
-DarchetypeArtifactId=${MAVEN_ARCHETYPE_ARTIFACT_ID} -DarchetypeVersion=${MAVEN_ARCHETYPE_VERSION} \\
-DgroupId=${MAVEN_ARCHETYPE_GROUP_ID} -DartifactId=${MAVEN_ARCHETYPE_ARTIFACT_ID} -Dversion=${MAVEN_ARCHETYPE_VERSION} \\
-DBROWSERSTACK_USERNAME="${username}" \\
-DBROWSERSTACK_ACCESS_KEY="${accessKey}" \\
-DBROWSERSTACK_FRAMEWORK="${mavenFramework}"`;
}

// Generates Java SDK setup instructions with Maven/Gradle options
function getJavaSDKInstructions(
  framework: string,
  username: string,
  accessKey: string,
): string {
  const mavenFramework = getJavaFrameworkForMaven(framework);
  const isWindows = process.platform === "win32";
  const platformLabel = isWindows ? "Windows" : "macOS/Linux";

  const mavenCommand = isWindows
    ? getMavenCommandForWindows(framework, mavenFramework)
    : getMavenCommandForUnix(username, accessKey, mavenFramework);

  return `---STEP---
Install BrowserStack Java SDK

**Maven command for ${framework} (${platformLabel}):**
Run the command, it is required to generate the browserstack-sdk-archetype-integrate project:
${mavenCommand}

Alternative setup for Gradle users:
${GRADLE_SETUP_INSTRUCTIONS}`;
}

// Main function to get SDK setup commands based on language and framework
export function getSDKPrefixCommand(
  language: SDKSupportedLanguage,
  framework: string,
  username: string,
  accessKey: string,
): string {
  switch (language) {
    case "nodejs":
      return NODEJS_SDK_INSTRUCTIONS(username, accessKey);

    case "java":
      return getJavaSDKInstructions(framework, username, accessKey);

    default:
      return "";
  }
}

export function getJavaFrameworkForMaven(framework: string): string {
  return JAVA_FRAMEWORK_MAP[framework] || framework;
}
