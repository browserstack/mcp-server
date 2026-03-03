import { ConfigMapping } from "../common/types.js";

/**
 * ---------- PYTHON INSTRUCTIONS ----------
 */

export const pythonInstructions = () => {
  const setup = `
---STEP---

Install the BrowserStack SDK:
\`\`\`bash
python3 -m pip install browserstack-sdk
\`\`\`
`;

  const run = `
---STEP---

Run your tests on BrowserStack:
\`\`\`bash
browserstack-sdk pytest -s tests/<example_test>.py
\`\`\`

Or run all tests in a directory:
\`\`\`bash
browserstack-sdk pytest <path-to-test-directory>
\`\`\`
`;

  return { setup, run };
};

export const generatePythonFrameworkInstructions =
  (framework: string) => (username: string, accessKey: string) => {
    const setup = `
---STEP---

Install the BrowserStack SDK:

\`\`\`bash
python3 -m pip install browserstack-sdk
\`\`\`

---STEP---

Setup the BrowserStack SDK with framework-specific configuration:
\`\`\`bash
browserstack-sdk setup --framework "${framework}" --username "${username}" --key "${accessKey}"
\`\`\`
`;

    const run = `
---STEP---

Run your ${framework} tests on BrowserStack:
\`\`\`bash
browserstack-sdk ${framework} <path-to-test-files>
\`\`\`
`;

    return { setup, run };
  };

export const robotInstructions = generatePythonFrameworkInstructions("robot");
export const behaveInstructions = generatePythonFrameworkInstructions("behave");
export const pytestInstructions = generatePythonFrameworkInstructions("pytest");

/**
 * ---------- JAVA INSTRUCTIONS ----------
 */

const argsInstruction =
  '<argLine>-javaagent:"${com.browserstack:browserstack-java-sdk:jar}"</argLine>';

export const javaInstructions = (username: string, accessKey: string) => {
  const setup = `
---STEP---

Add the BrowserStack Java SDK dependency to your \`pom.xml\`:
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

---STEP---

Export your BrowserStack credentials as environment variables:
\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\`
`;

  const run = `
---STEP---

Run your tests using Maven:
\`\`\`bash
mvn clean test 
\`\`\`

Or for Gradle:
\`\`\`bash
gradle clean test
\`\`\`
`;

  return { setup, run };
};

/**
 * ---------- CSharp INSTRUCTIONS ----------
 */

export const csharpCommonInstructions = (
  username: string,
  accessKey: string,
) => {
  const setup = `
---STEP---

Install BrowserStack TestAdapter NuGet package:
\`\`\`bash
dotnet add package BrowserStack.TestAdapter
\`\`\`

---STEP---

Build the project:
\`\`\`bash
dotnet build
\`\`\`

---STEP---

Set up BrowserStack SDK with your credentials:
\`\`\`bash
dotnet browserstack-sdk setup --userName ${username} --accessKey ${accessKey}
\`\`\`

---STEP---

Detect if you are running on Apple Silicon (macOS only):
Run this check to determine if Apple Silicon-specific setup is required:
\`\`\`bash
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  echo "Detected arm64 architecture - running Apple-Silicon flow"
fi
\`\`\`

---STEP---

macOS (Apple Silicon) setup (Strictly follow if arm64 detected):
Install the x64 version of .NET for BrowserStack compatibility.

- Check your current .NET version:
  \`\`\`bash
  dotnet --version
  \`\`\`

- Ensure the path exists strictly; if not, create it first and then run the setup:
  This automatically installs the x64 version of .NET in the specified path. No need to install it from external sources.
  \`\`\`bash
  sudo dotnet browserstack-sdk setup-dotnet --dotnet-path "<your-chosen-path>" --dotnet-version "<your-dotnet-version>"
  \`\`\`
  Common paths: /usr/local/share/dotnet, ~/dotnet-x64, or /opt/dotnet-x64
`;

  const run = `
---STEP---

Run the tests:
- For macOS (Apple Silicon), use the full path where the x64 version of .NET is installed:
  \`\`\`bash
  <your-chosen-path>/dotnet browserstack-sdk
  \`\`\`
- For Windows, Intel Macs, or if dotnet alias is configured:
  \`\`\`bash
  dotnet test
  \`\`\`
`;

  return { setup, run };
};

export const csharpPlaywrightCommonInstructions = (
  username: string,
  accessKey: string,
) => {
  const setup = `
---STEP---

Install BrowserStack TestAdapter NuGet package:
\`\`\`bash
dotnet add package BrowserStack.TestAdapter
\`\`\`

---STEP---

Build the project:
\`\`\`bash
dotnet build
\`\`\`

---STEP---

Set up BrowserStack SDK with your credentials:
\`\`\`bash
dotnet browserstack-sdk setup --userName ${username} --accessKey ${accessKey}
\`\`\`

---STEP---

Choose supported browser:
Use exactly one of the following (case-sensitive):  
\`chrome\`, \`edge\`, \`playwright-chromium\`, \`playwright-webkit\`, \`playwright-firefox\`

---STEP---

Detect if you are running on Apple Silicon (macOS only):
Run this check to determine if Apple Silicon-specific setup is required:
\`\`\`bash
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  echo "Detected arm64 architecture - running Apple-Silicon flow"
fi
\`\`\`

---STEP---

macOS (Apple Silicon) setup (required only if arm64 detected):
Install the x64 version of .NET for compatibility with BrowserStack.

- Check your .NET version:
  \`\`\`bash
  dotnet --version
  \`\`\`

- Ensure the path exists strictly; if not, create it first and then run the setup:
  This automatically installs the x64 version of .NET in the specified path. No need to install it from external sources.
  \`\`\`bash
  sudo dotnet browserstack-sdk setup-dotnet --dotnet-path "<your-chosen-path>" --dotnet-version "<your-dotnet-version>"
  \`\`\`
  Common paths: /usr/local/share/dotnet, ~/dotnet-x64, or /opt/dotnet-x64

---STEP---

Fix for Playwright architecture (macOS only):
If the folder exists:  
\`<project-folder>/bin/Debug/net8.0/.playwright/node/darwin-arm64\`  
Rename \`darwin-arm64\` to \`darwin-x64\`
`;

  const run = `
---STEP---

Run the tests:
- For macOS (Apple Silicon), use the full path:
  \`\`\`bash
  <your-chosen-path>/dotnet browserstack-sdk
  \`\`\`
- For Windows, Intel Macs, or if dotnet alias is configured:
  \`\`\`bash
  dotnet test
  \`\`\`
`;

  return { setup, run };
};

/**
 * ---------- NODEJS INSTRUCTIONS ----------
 */

export const nodejsInstructions = (username: string, accessKey: string) => {
  const setup = `
---STEP---

Ensure \`browserstack-node-sdk\` is present in package.json with the latest version:
\`\`\`json
"browserstack-node-sdk": "latest"
\`\`\`

---STEP---

Add new scripts to package.json for running tests on BrowserStack:
\`\`\`json
"scripts": {
  "test:browserstack": "npx browserstack-node-sdk <framework-specific-test-execution-command>"
}
\`\`\`

Example : 
\`\`\`json
"scripts": {
  "test:browserstack": "npx browserstack-node-sdk playwright test"
}
\`\`\`
---STEP---

Export BrowserStack credentials as environment variables:
Set the following environment variables before running tests.
\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\`

---STEP---
Run your tests:
You can now run your tests on BrowserStack using your standard command or Use the commands defined in your package.json file to run the tests.
`;

  const run = `
---STEP---

Run your tests on BrowserStack:
\`\`\`bash
npm run test:browserstack
\`\`\`
`;

  return { setup, run };
};

/**
 * ---------- EXPORT CONFIG ----------
 */

export const webdriverioInstructions = (
  username: string,
  accessKey: string,
) => {
  const setup = `
---STEP---

Set BrowserStack Credentials:
Export your BrowserStack username and access key as environment variables.

For macOS/Linux:
\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\`

For Windows PowerShell:
\`\`\`powershell
$env:BROWSERSTACK_USERNAME=${username}
$env:BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\`

---STEP---

Install the BrowserStack WDIO Service:
Add the service to your project's dev dependencies.
\`\`\`bash
npm install @wdio/browserstack-service --save-dev
\`\`\`

---STEP---

Update your WebdriverIO Config File (e.g., wdio.conf.js):
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
`;

  const run = `
---STEP---

Run your tests:
You can now run your tests on BrowserStack using your standard WebdriverIO command or Use the commands defined in your package.json file to run the tests.
`;

  return { setup, run };
};

export const cypressInstructions = (username: string, accessKey: string) => {
  const setup = `
---STEP---

Install the BrowserStack Cypress CLI:
Install the CLI as a dev dependency in your project.
\`\`\`bash
npm install browserstack-cypress-cli --save-dev
\`\`\`

---STEP---

Create the Configuration File:
Generate the \`browserstack.json\` configuration file in your project's root directory by running the following command:
\`\`\`bash
npx browserstack-cypress init
\`\`\`

---STEP---

Configure \`browserstack.json\`:
Open the generated \`browserstack.json\` file and update it with your BrowserStack credentials and desired capabilities. Below is an example configuration.

* **auth**: Your BrowserStack username and access key.
* **browsers**: The list of browser and OS combinations you want to test on.
* **run_settings**: Project-level settings, including the path to your Cypress config file, build name, and parallels.

\`\`\`json
{
  "auth": {
    "username": "${username}",
    "access_key": "${accessKey}"
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
`;

  const run = `
---STEP---

Run Your Tests on BrowserStack:
Execute your tests on BrowserStack using the following command:
\`\`\`bash
npx browserstack-cypress run --sync
\`\`\`

After the tests complete, you can view the results on your [BrowserStack Automate Dashboard](https://automate.browserstack.com/dashboard/).`;

  return { setup, run };
};

const serenityInstructions = (username: string, accessKey: string) => {
  const setup = `
---STEP---

Set BrowserStack credentials as environment variables:
For macOS/Linux:
\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\`

For Windows Command Prompt:
\`\`\`cmd
set BROWSERSTACK_USERNAME=${username}
set BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\`

---STEP---

Add serenity-browserstack dependency in pom.xml:
Add the following dependency to your pom.xml file and save it:
\`\`\`xml
<dependency>
  <groupId>net.serenity-bdd</groupId>
  <artifactId>serenity-browserstack</artifactId>
  <version>3.3.4</version>
</dependency>
\`\`\`

---STEP---

Set up serenity.conf file:
Create or update your serenity.conf file in the project root with the following configuration:
\`\`\`
webdriver {
  driver = remote
  remote.url = "https://hub.browserstack.com/wd/hub"
}
browserstack.user="${username}"
browserstack.key="${accessKey}"
\`\`\`
`;

  const run = `
---STEP---

Run your Serenity tests:
You can continue running your tests as you normally would. For example:

Using Maven:
\`\`\`bash
mvn clean verify
\`\`\`

Using Gradle:
\`\`\`bash
gradle clean test
\`\`\`
`;

  return { setup, run };
};

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
    playwright: {
      junit4: { instructions: javaInstructions },
      junit5: { instructions: javaInstructions },
      testng: { instructions: javaInstructions },
    },
    selenium: {
      testng: { instructions: javaInstructions },
      cucumber: { instructions: javaInstructions },
      junit4: { instructions: javaInstructions },
      junit5: { instructions: javaInstructions },
      serenity: { instructions: serenityInstructions },
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
      specflow: { instructions: csharpCommonInstructions },
      reqnroll: { instructions: csharpCommonInstructions },
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
      mocha: { instructions: nodejsInstructions },
      cucumber: { instructions: nodejsInstructions },
      nightwatch: { instructions: nodejsInstructions },
      codeceptjs: { instructions: nodejsInstructions },
    },
    cypress: {
      cypress: { instructions: cypressInstructions },
    },
    webdriverio: {
      mocha: { instructions: webdriverioInstructions },
      cucumber: { instructions: webdriverioInstructions },
    },
  },
};
