import { PERCY_SNAPSHOT_INSTRUCTION } from "../common/constants.js";
export const percyAutomateReviewSnapshotsStep = `
---STEP---
Review the snapshots
  - Go to your Percy project on https://percy.io to review snapshots and approve/reject any visual changes.
`;

export const pythonPytestSeleniumInstructions = `
Install Percy Automate dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy Python SDK for Automate:
    pip install percy-selenium

---STEP---
Update your Pytest test script  
${PERCY_SNAPSHOT_INSTRUCTION}
  - Import the Percy snapshot helper:
    from percy import percy_screenshot
  - In your test, take snapshots at key points:
    percy_screenshot(driver, "Your snapshot name")

Example:
\`\`\`python
import pytest
from selenium import webdriver
from percy import percy_screenshot

@pytest.fixture
def driver():
    driver = webdriver.Chrome()
    yield driver
    driver.quit()

def test_homepage(driver):
    driver.get("http://localhost:8000")
    percy_screenshot(driver, "Home page")
    # ... more test steps ...
    percy_screenshot(driver, "After login")
\`\`\`

---STEP---
Run Percy Automate with your tests
  - Use the following command:
    npx percy exec -- browserstack-sdk pytest

${percyAutomateReviewSnapshotsStep}
`;

export const pythonPytestPlaywrightInstructions = `
Install Percy Automate dependencies
  - Install Percy CLI:
    npm install --save @percy/cli
  - Install Percy Playwright SDK for Automate:
    pip install percy-playwright

---STEP---
Update your Playwright test script
${PERCY_SNAPSHOT_INSTRUCTION}
  - Import the Percy screenshot helper:
    from percy import percy_screenshot
  - In your test, take snapshots at key points:
    percy_screenshot(page, name="Your snapshot name")
    # You can pass \`options\`:
    percy_screenshot(page, name="Your snapshot name", options={ "full_page": True })

Example:
\`\`\`python
from playwright.sync_api import sync_playwright
from percy import percy_screenshot

def test_visual_regression():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://localhost:8000")
        percy_screenshot(page, name="Home page")
        # ... more test steps ...
        percy_screenshot(page, name="After login", options={ "full_page": True })
        browser.close()
\`\`\`

---STEP---
Run Percy Automate with your tests
  - Use the following command:
    npx percy exec -- <command to run the automate script file>

${percyAutomateReviewSnapshotsStep}
`;

export const jsCypressPercyAutomateInstructions = `
Install Percy Automate dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy Cypress SDK:
    npm install --save-dev @percy/cypress

---STEP---
Update your Cypress test script
${PERCY_SNAPSHOT_INSTRUCTION}
  - Import and initialize Percy in your cypress/support/index.js:
    import '@percy/cypress';
  - In your test, take snapshots at key points:
    cy.percySnapshot('Your snapshot name');

Example:
\`\`\`javascript
describe('Percy Automate Cypress Example', () => {
  it('should take Percy snapshots', () => {
    cy.visit('http://localhost:8000');
    cy.percySnapshot('Home page');
    // ... more test steps ...
    cy.percySnapshot('After login');
  });
});
\`\`\`  

---STEP---
Run Percy Automate with your tests
  - Use the following command:
    npx percy exec -- cypress run

${percyAutomateReviewSnapshotsStep}
`;

export const mochaPercyAutomateInstructions = `
Install Percy Automate dependencies
  - Install Percy CLI:
    npm install --save @percy/cli
  - Install Percy Selenium SDK:
    npm install @percy/selenium-webdriver@2.0.1

---STEP---
Update your Mocha Automate test script
  - Import the Percy screenshot helper:
    const { percyScreenshot } = require('@percy/selenium-webdriver');
  - Use the Percy screenshot command to take required screenshots in your Automate session:
    await percyScreenshot(driver, 'Screenshot 1');
    options = { percyCSS: 'h1{color:red;}' };
    await percyScreenshot(driver, 'Screenshot 2', options);

---STEP---
Run Percy Automate with your tests
  - Use the following command:
    npx percy exec -- <command to run the automate script file>

${percyAutomateReviewSnapshotsStep}
`;

// Mocha Percy Playwright Instructions
export const mochaPercyPlaywrightInstructions = `
Install Percy Automate dependencies
  - Install the latest Percy CLI:
    npm install --save @percy/cli
  - Install the Percy Playwright SDK:
    npm install @percy/playwright

---STEP---
Update your Mocha Playwright test script
  - Import the Percy screenshot helper:
    const { percyScreenshot } = require("@percy/playwright");
  - Use the Percy screenshot command to take required screenshots in your Automate session.

Example:
\`\`\`javascript
const { percyScreenshot } = require("@percy/playwright");
await percyScreenshot(page, "Screenshot 1");
// With options
await percyScreenshot(page, "Screenshot 2", { percyCSS: "h1{color:green;}" });
\`\`\`

---STEP---
Run Percy Automate with your tests
  - Use the following command:
    npx percy exec -- <command to run the automate script file>

${percyAutomateReviewSnapshotsStep}
`;

export const jestPercyAutomateInstructions = `
Install or upgrade the BrowserStack SDK:
  - Install the SDK:
    npm i -D browserstack-node-sdk@latest
  - Run the setup:
    npx setup --username "YOUR_USERNAME" --key "YOUR_ACCESS_KEY"

---STEP---
Manually capture screenshots:
  1. Import the BrowserStack Percy SDK in your test script:
     const { percy } = require('browserstack-node-sdk');
  2. Use \`percy.screenshot(driver, name)\` at desired points in your test.

Example:
\`\`\`javascript
const { percy } = require('browserstack-node-sdk');
describe("JestJS test", () => {
  let driver;
  const caps = require("../" + conf_file).capabilities;

  beforeAll(() => {
    driver = new Builder()
      .usingServer("http://example-servername/hub")
      .withCapabilities(caps)
      .build();
  });

  test("my test", async () => {
    // ...
    await percy.screenshot(driver, "My Screenshot");
    // ...
  });
});
\`\`\`

---STEP---
Run your test script:
  - Use the following command:
    npm run [your-test-script-name]-browserstack

${percyAutomateReviewSnapshotsStep}
`;

export const webdriverioPercyAutomateInstructions = `
Install or upgrade BrowserStack SDK
  - Install the BrowserStack SDK:
    npm i -D @wdio/browserstack-service

---STEP---
Update your WebdriverIO config file
  1. Set \`percy: true\`
  2. Set a \`projectName\`
  3. Set \`percyCaptureMode: auto\` (or another mode as needed)

Example WebdriverIO config:
\`\`\`js
exports.config = {
  user: process.env.BROWSERSTACK_USERNAME || 'YOUR_USERNAME',
  key: process.env.BROWSERSTACK_ACCESS_KEY || 'YOUR_ACCESS_KEY',
  hostname: 'hub.browserstack.com',
  services: [
    [
      'browserstack',
      { browserstackLocal: true, opts: { forcelocal: false }, percy: true, percyCaptureMode: 'auto' }
    ],
  ],
  // add path to the test file
}
\`\`\`

---STEP---
(Optional) Manually capture screenshots
  1. Import the BrowserStack Percy SDK in your test script:
    const { percy } = require('browserstack-node-sdk');
  2. Add the \`await percy.screenshot(driver, name)\` method at required points in your test script.

Example:
\`\`\`javascript
    const { percy } = require('browserstack-node-sdk');
  2. Add the \`await percy.screenshot(driver, name)\` method at required points in your test script.

Example:
\`\`\`javascript
const { percy } = require('browserstack-node-sdk');
describe("WebdriverIO Test", () => {
  it("my test", async () => {
    // ....
    await percy.screenshot(driver, "My Screenshot")
    // ....
  });
});
\`\`\`

---STEP---
Run your test script
  - Use the commands defined in your package.json file to run the tests on BrowserStack.

${percyAutomateReviewSnapshotsStep}
`;

export const testcafePercyAutomateInstructions = `
Install Percy dependencies
  - Install the required dependencies:
    npm install --save-dev @percy/cli @percy/testcafe

---STEP---
Update your test script
${PERCY_SNAPSHOT_INSTRUCTION}
  - Import the Percy library and use the percySnapshot function to take screenshots.

Example:
\`\`\`javascript
import percySnapshot from '@percy/testcafe';
fixture('MyFixture')
  .page('https://devexpress.github.io/testcafe/example/');
test('Test1', async t => {
  await t.typeText('#developer-name', 'John Doe');
  await percySnapshot(t, 'TestCafe Example');
});
\`\`\`

---STEP---
Run Percy
  - Use the following command to run your tests with Percy:
    npx percy exec -- testcafe chrome:headless tests

${percyAutomateReviewSnapshotsStep}
`;

// Java Playwright Percy Automate Instructions
export const javaPlaywrightJunitInstructions = `
Install Percy Automate dependencies
  - Install the latest Percy CLI:
    npm install --save @percy/cli
  - Add the Percy Playwright Java SDK to your pom.xml:
\`\`\`xml
<dependency>
  <groupId>io.percy</groupId>
  <artifactId>percy-playwright-java</artifactId>
  <version>1.0.0</version>
</dependency>
\`\`\`

---STEP---
Update your Automate test script
  - Import the Percy library:
    import io.percy.playwright.Percy;
  - Use the Percy screenshot command to take required screenshots in your Automate session.

Example:
\`\`\`java
Percy percy = new Percy(page);
percy.screenshot("screenshot_1");
// With options
percy.screenshot("screenshot_2", options);
\`\`\`

---STEP---
Run Percy Automate with your tests
  - Use the following command:
    npx percy exec -- <command to run the automate script file>

${percyAutomateReviewSnapshotsStep}
`;

// C# Playwright NUnit Percy Automate Instructions
export const csharpPlaywrightNunitInstructions = `
Install Percy Automate dependencies
  - Install the latest Percy CLI:
    npm install --save @percy/cli
  - Add the Percy Playwright SDK to your .csproj file:
\`\`\`xml
<PackageReference Include="PercyIO.Playwright" Version="1.0.0" />
\`\`\`

---STEP---
Update your NUnit Playwright test script
  - Import the Percy library:
    using PercyIO.Playwright;
  - Use the Percy screenshot command to take required screenshots in your Automate session.

Example:
\`\`\`csharp
using PercyIO.Playwright;
Percy.Screenshot(page, "example_screenshot_1");
// With options
Percy.Screenshot(page, "example_screenshot_2", options);
\`\`\`

---STEP---
Run Percy Automate with your tests
  - Use the following command:
    npx percy exec -- <command to run the automate script file>

${percyAutomateReviewSnapshotsStep}
`;
