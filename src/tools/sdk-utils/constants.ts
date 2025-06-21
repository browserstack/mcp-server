import { ConfigMapping } from "./types.js";
import config from "../../config.js";

/**
 * ---------- PYTHON INSTRUCTIONS ----------
 */

const pythonInstructions = `
Run the following command to install the browserstack-sdk:
\`\`\`bash
python3 -m pip install browserstack-sdk
\`\`\`

Run the following command to setup the browserstack-sdk:
\`\`\`bash
browserstack-sdk setup --username "${config.browserstackUsername}" --key "${config.browserstackAccessKey}"
\`\`\`

In order to run tests on BrowserStack, run the following command:
\`\`\`bash
browserstack-sdk python <path-to-test-file>
\`\`\`
`;

const generatePythonFrameworkInstructions = (framework: string) => `
Run the following command to install the browserstack-sdk:
\`\`\`bash
python3 -m pip install browserstack-sdk
\`\`\`

Run the following command to setup the browserstack-sdk:
\`\`\`bash
browserstack-sdk setup --framework "${framework}" --username "${config.browserstackUsername}" --key "${config.browserstackAccessKey}"
\`\`\`

In order to run tests on BrowserStack, run the following command:
\`\`\`bash
browserstack-sdk ${framework} <path-to-test-files>
\`\`\`
`;

const robotInstructions = generatePythonFrameworkInstructions("robot");
const behaveInstructions = generatePythonFrameworkInstructions("behave");
const pytestInstructions = generatePythonFrameworkInstructions("pytest");

/**
 * ---------- JAVA INSTRUCTIONS ----------
 */

const argsInstruction =
  '<argLine>-javaagent:"${com.browserstack:browserstack-java-sdk:jar}"</argLine>';

const javaInstructions = `
Strictly Add the following dependencies to your \`pom.xml\`:
\`\`\`xml
<dependency>
    <groupId>com.browserstack</groupId>
    <artifactId>browserstack-java-sdk</artifactId>
    <version>LATEST</version>
    <scope>compile</scope>
</dependency>

${argsInstruction}
\`\`\`

For Gradle projects, add to \`build.gradle\`:
\`\`\`groovy
dependencies {
    implementation 'com.browserstack:browserstack-java-sdk:LATEST'
}
\`\`\`

Inform user to export:
\`\`\`bash
export BROWSERSTACK_USERNAME=${config.browserstackUsername}
export BROWSERSTACK_ACCESS_KEY=${config.browserstackAccessKey}
\`\`\`

Run tests using:
\`\`\`bash
mvn clean test 
\`\`\`

Or for Gradle:
\`\`\`bash
gradle clean test
\`\`\`
`;

/**
 * ---------- CSharp INSTRUCTIONS ----------
 */

const csharpCommonInstructions = `
1. Install BrowserStack TestAdapter NuGet package  
   Add the package to your project:
   \`\`\`bash
   dotnet add package BrowserStack.TestAdapter
   \`\`\`

2. Build the project  
   \`\`\`bash
   dotnet build
   \`\`\`

3. Set up BrowserStack SDK  
   Replace the placeholders with your actual BrowserStack credentials:
   \`\`\`bash
   dotnet browserstack-sdk setup --userName ${config.browserstackUsername} --accessKey ${config.browserstackAccessKey}
   \`\`\`

4. Detect if you are running on Apple Silicon (macOS only)  
   Run this check to determine if Apple Silicon-specific setup is required:
   \`\`\`bash
   ARCH="$(uname -m)"
   if [ "$ARCH" = "arm64" ]; then
     echo "Detected arm64 architecture - running Apple-Silicon flow"
   fi
   \`\`\`

5. macOS (Apple Silicon) setup (required only if arm64 detected)  
   Install the x64 version of .NET for BrowserStack compatibility.

   - Check your current .NET version:
     \`\`\`bash
     dotnet --version
     \`\`\`

   - Ensure the path exists strictly; if not, create it first and then run the setup.
     \`\`\`bash
     sudo dotnet browserstack-sdk setup-dotnet --dotnet-path "<your-chosen-path>" --dotnet-version "<your-dotnet-version>"
     \`\`\`
     Common paths: /usr/local/share/dotnet, ~/dotnet-x64, or /opt/dotnet-x64

6. Run the tests  
   - For macOS (Apple Silicon), use the full path:
     \`\`\`bash
     <your-chosen-path>/dotnet browserstack-sdk
     \`\`\`
   - For Windows, Intel Macs, or if dotnet alias is configured:
     \`\`\`bash
     dotnet test
     \`\`\`
`;

const csharpPlaywrightCommonInstructions = `
1. Install BrowserStack TestAdapter NuGet package  
   Run the following command:
   \`\`\`bash
   dotnet add package BrowserStack.TestAdapter
   \`\`\`

2. Build the project  
   \`\`\`bash
   dotnet build
   \`\`\`

3. Set up BrowserStack SDK  
   Replace the placeholders with your actual credentials:
   \`\`\`bash
   dotnet browserstack-sdk setup --userName ${config.browserstackUsername} --accessKey ${config.browserstackAccessKey}
   \`\`\`

4. Supported browsers  
   Use exactly one of the following (case-sensitive):  
   \`chrome\`, \`edge\`, \`playwright-chromium\`, \`playwright-webkit\`, \`playwright-firefox\`

5. Detect if you are running on Apple Silicon (macOS only)  
   Run this check to determine if Apple Silicon-specific setup is required:
   \`\`\`bash
   ARCH="$(uname -m)"
   if [ "$ARCH" = "arm64" ]; then
     echo "Detected arm64 architecture - running Apple-Silicon flow"
   fi
   \`\`\`

6. macOS (Apple Silicon) setup (required only if arm64 detected)  
   Install the x64 version of .NET for compatibility with BrowserStack.

   - Check your .NET version:
     \`\`\`bash
     dotnet --version
     \`\`\`

   - Ensure the path exists strictly; if not, create it first and then run the setup.
     \`\`\`bash
     sudo dotnet browserstack-sdk setup-dotnet --dotnet-path "<your-chosen-path>" --dotnet-version "<your-dotnet-version>"
     \`\`\`
     Common paths: /usr/local/share/dotnet, ~/dotnet-x64, or /opt/dotnet-x64

7. Fix for Playwright architecture (macOS only)  
   If the folder exists:  
   \`<project-folder>/bin/Debug/net8.0/.playwright/node/darwin-arm64\`  
   Rename \`darwin-arm64\` to \`darwin-x64\`

8. Run the tests  
   - For macOS (Apple Silicon), use the full path:
     \`\`\`bash
     <your-chosen-path>/dotnet browserstack-sdk
     \`\`\`
   - For Windows, Intel Macs, or if dotnet alias is configured:
     \`\`\`bash
     dotnet test
     \`\`\`
`;

/**
 * ---------- NODEJS INSTRUCTIONS ----------
 */

const nodejsInstructions = `
- Ensure that \`browserstack-node-sdk\` is present in package.json, use the latest version.
- Add new scripts to package.json for running tests on BrowserStack (use \`npx\` to trigger the sdk):
  \`\`\`json
  "scripts": {
    "test:browserstack": "npx browserstack-node-sdk <framework-specific-test-execution-command>"
  }
  \`\`\`
- Add to dependencies:
  \`\`\`json
  "browserstack-node-sdk": "latest"
  \`\`\`
- Inform user to export BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY as environment variables.
`;

/**
 * ---------- EXPORT CONFIG ----------
 */

const webdriverioInstructions = `
To integrate your WebdriverIO test suite with BrowserStack, follow these steps. This process uses the @wdio/browserstack-service and does not require a browserstack.yml file.

**1. Set BrowserStack Credentials**

Export your BrowserStack username and access key as environment variables.

For macOS/Linux:
\`\`\`bash
export BROWSERSTACK_USERNAME= ${config.browserstackUsername}
export BROWSERSTACK_ACCESS_KEY= ${config.browserstackAccessKey}
\`\`\`

For Windows PowerShell:
\`\`\`powershell
$env:BROWSERSTACK_USERNAME=${config.browserstackUsername}
$env:BROWSERSTACK_ACCESS_KEY=${config.browserstackAccessKey}
\`\`\`

**2. Install the BrowserStack WDIO Service**

Add the service to your project's dev dependencies.
\`\`\`bash
npm install @wdio/browserstack-service --save-dev
\`\`\`

**3. Update your WebdriverIO Config File (e.g., wdio.conf.js)**

Modify your configuration file to use the BrowserStack service and define the platforms you want to test on.

Here is an example configuration:

\`\`\`javascript
exports.config = {
  // Set your BrowserStack credentials
  user: process.env.BROWSERSTACK_USERNAME,
  key: process.env.BROWSERSTACK_ACCESS_KEY,

  // Set BrowserStack hostname
  hostname: 'hub.browserstack.com',

  // Add browserstack service
  services: [
    [
      'browserstack',
      {
        // Set to true to test local websites
        browserstackLocal: false, 
        // Other service options...
      },
    ],
  ],

  // Define platforms to test on
  capabilities: [
    {
      browserName: 'Chrome',
      'bstack:options': {
        browserVersion: 'latest',
        os: 'Windows',
        osVersion: '11'
      }
    },
    {
      browserName: 'Safari',
      'bstack:options': {
        browserVersion: 'latest',
        os: 'OS X',
        osVersion: 'Sonoma'
      }
    },
  ],
  
  // Set common capabilities for all test environments
  commonCapabilities: {
    'bstack:options': {
      buildName: "my-webdriverio-build",
      buildIdentifier: "#\${BUILD_NUMBER}", // Example for CI
      projectName: "My WebdriverIO Project",
      testObservability: true,
      debug: true, // Enables visual logs
      networkLogs: true, // Enables network logs
      consoleLogs: "info" // Sets console log level
    }
  },

  // The number of parallel tests running at the same time
  maxInstances: 5,

  // ... other wdio configurations
};

// This loop merges commonCapabilities into each capability
exports.config.capabilities.forEach(function (caps) {
  for (let i in exports.config.commonCapabilities)
    caps[i] = { ...caps[i], ...exports.config.commonCapabilities[i]};
});
\`\`\`

**4. Run your tests**

You can now run your tests on BrowserStack using your standard WebdriverIO command.
`;

const cypressInstructions = `
To integrate your Cypress test suite with BrowserStack, follow these steps. This process uses the BrowserStack Cypress CLI and a \`browserstack.json\` file for configuration.

**1. Install the BrowserStack Cypress CLI**

Install the CLI as a dev dependency in your project.
\`\`\`bash
npm install browserstack-cypress-cli --save-dev
\`\`\`

**2. Create the Configuration File**

Generate the \`browserstack.json\` configuration file in your project's root directory by running the following command:
\`\`\`bash
npx browserstack-cypress init
\`\`\`

**3. Configure \`browserstack.json\`**

Open the generated \`browserstack.json\` file and update it with your BrowserStack credentials and desired capabilities. Below is an example configuration.

* **auth**: Your BrowserStack username and access key.
* **browsers**: The list of browser and OS combinations you want to test on.
* **run_settings**: Project-level settings, including the path to your Cypress config file, build name, and parallels.

\`\`\`json
{
  "auth": {
    "username": "${config.browserstackUsername}",
    "access_key": "${config.browserstackAccessKey}"
  },
  "browsers": [
    {
      "browser": "chrome",
      "os": "Windows 10",
      "versions": ["latest", "latest - 1"]
    },
    {
      "browser": "firefox",
      "os": "OS X Mojave",
      "versions": ["latest", "latest - 1"]
    },
    {
      "browser": "edge",
      "os": "OS X Catalina",
      "versions": ["latest"]
    }
  ],
  "run_settings": {
    "cypress_config_file": "./cypress.config.js",
    "cypress_version": "12",
    "project_name": "My Cypress Project",
    "build_name": "Build #1",
    "parallels": 5,
    "testObservability": true
  }
}
\`\`\`
**Note:** For Cypress v9 or lower, use \`"cypress_config_file": "./cypress.json"\`. The \`testObservability: true\` flag enables the [Test Reporting & Analytics dashboard](https://www.browserstack.com/docs/test-management/test-reporting-and-analytics) for deeper insights into your test runs.

**4. Run Your Tests on BrowserStack**

Execute your tests on BrowserStack using the following command:
\`\`\`bash
npx browserstack-cypress run --sync
\`\`\`

After the tests complete, you can view the results on your [BrowserStack Automate Dashboard](https://automate.browserstack.com/dashboard/).
`;

export const SUPPORTED_CONFIGURATIONS: ConfigMapping = {
  python: {
    playwright: {
      pytest: { instructions: pythonInstructions },
    },
    selenium: {
      pytest: { instructions: pytestInstructions },
      robot: { instructions: robotInstructions },
      behave: { instructions: behaveInstructions },
    },
  },
  java: {
    playwright: {},
    selenium: {
      testng: { instructions: javaInstructions },
      cucumber: { instructions: javaInstructions },
      junit4: { instructions: javaInstructions },
      junit5: { instructions: javaInstructions },
    },
  },
  csharp: {
    playwright: {
      nunit: { instructions: csharpPlaywrightCommonInstructions },
      mstest: { instructions: csharpPlaywrightCommonInstructions },
    },
    selenium: {
      xunit: { instructions: csharpCommonInstructions },
      nunit: { instructions: csharpCommonInstructions },
      mstest: { instructions: csharpCommonInstructions },
    },
  },
  nodejs: {
    playwright: {
      jest: { instructions: nodejsInstructions },
      codeceptjs: { instructions: nodejsInstructions },
      playwright: { instructions: nodejsInstructions },
    },
    selenium: {
      jest: { instructions: nodejsInstructions },
      webdriverio: { instructions: webdriverioInstructions },
      mocha: { instructions: nodejsInstructions },
      cucumber: { instructions: nodejsInstructions },
      nightwatch: { instructions: nodejsInstructions },
      codeceptjs: { instructions: nodejsInstructions },
    },
    cypress: {
      cypress: { instructions: cypressInstructions },
    },
  },
};
