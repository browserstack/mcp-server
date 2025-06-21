// Utility to get the language-dependent prefix command for BrowserStack SDK setup
import { SDKSupportedLanguage } from "./types.js";

// Framework mapping for Java Maven archetype generation
const JAVA_FRAMEWORK_MAP: Record<string, string> = {
  testng: "testng",
  junit5: "junit5",
  junit4: "junit4",
  cucumber: "cucumber-testng",
};

// Common Gradle setup instructions (platform-independent)
const GRADLE_SETUP_INSTRUCTIONS = `
**For Gradle setup:**
1. Add browserstack-java-sdk to dependencies:
   compileOnly 'com.browserstack:browserstack-java-sdk:latest.release'

2. Add browserstackSDK path variable:
   def browserstackSDKArtifact = configurations.compileClasspath.resolvedConfiguration.resolvedArtifacts.find { it.name == 'browserstack-java-sdk' }

3. Add javaagent to gradle tasks:
   jvmArgs "-javaagent:\${browserstackSDKArtifact.file}"
`;

export function getSDKPrefixCommand(
  language: SDKSupportedLanguage,
  framework: string,
): string {
  switch (language) {
    case "nodejs":
      return `Install BrowserStack Node SDK\nusing command | npm i -D browserstack-node-sdk@latest\n| and then run following command to setup browserstack sdk:\n npx setup --username ${process.env.BROWSERSTACK_USERNAME} --key ${process.env.BROWSERSTACK_ACCESS_KEY}\n\n. This will create browserstack.yml file in the project root. Edit the file to add your desired platforms and browsers. If the file is not created :\n`;

    case "java": {
      const mavenFramework = getJavaFrameworkForMaven(framework);
      const isWindows = process.platform === "win32";

      const mavenCommand = isWindows
        ? `mvn archetype:generate -B -DarchetypeGroupId="com.browserstack" -DarchetypeArtifactId="browserstack-sdk-archetype-integrate" -DarchetypeVersion="1.0" -DgroupId="com.browserstack" -DartifactId="browserstack-sdk-archetype-integrate" -Dversion="1.0" -DBROWSERSTACK_USERNAME="${process.env.BROWSERSTACK_USERNAME}" -DBROWSERSTACK_ACCESS_KEY="${process.env.BROWSERSTACK_ACCESS_KEY}" -DBROWSERSTACK_FRAMEWORK="${mavenFramework}"`
        : `mvn archetype:generate -B -DarchetypeGroupId=com.browserstack \\
-DarchetypeArtifactId=browserstack-sdk-archetype-integrate -DarchetypeVersion=1.0 \\
-DgroupId=com.browserstack -DartifactId=browserstack-sdk-archetype-integrate -Dversion=1.0 \\
-DBROWSERSTACK_USERNAME="${process.env.BROWSERSTACK_USERNAME}" \\
-DBROWSERSTACK_ACCESS_KEY="${process.env.BROWSERSTACK_ACCESS_KEY}" \\
-DBROWSERSTACK_FRAMEWORK="${mavenFramework}"`;

      const platformLabel = isWindows ? "Windows" : "macOS/Linux";

      return `Install BrowserStack Java SDK

**Maven command for ${framework} (${platformLabel}):**
Run the command, it is required to generate the browserstack-sdk-archetype-integrate project:
${mavenCommand}
${GRADLE_SETUP_INSTRUCTIONS}`;
    }

    // Add more languages as needed
    default:
      return "";
  }
}

export function getJavaFrameworkForMaven(framework: string): string {
  return JAVA_FRAMEWORK_MAP[framework] || framework;
}
