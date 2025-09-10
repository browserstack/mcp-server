import { PERCY_SNAPSHOT_INSTRUCTION } from "../common/constants.js";

export const javaSeleniumInstructions = `
Import the BrowserStack Percy SDK in your test script:
Add the Percy import to your test file.

${PERCY_SNAPSHOT_INSTRUCTION}

Add screenshot capture method at required points:
Use the \`PercySDK.screenshot(driver, name)\` method at points in your test script where you want to capture screenshots.

Here's an example:

\`\`\`java
// ...imports
import com.browserstack.PercySDK;

public class YourTestClass extends YourBaseTest {
    @Test
    public void test() throws Exception {
         // your test logic
         // ...
         
         // Capture a Percy screenshot
         PercySDK.screenshot(driver, "My Screenshot Name");
         
         // ...
         // more test logic
    }
}
\`\`\`
`;

export const nodejsSeleniumInstructions = `
Import the BrowserStack Percy SDK in your test script:
Add the Percy import to your test file.

${PERCY_SNAPSHOT_INSTRUCTION}

---STEP---

Add screenshot capture method at required points:
Use the \`percy.snapshot(driver, name)\` method at points in your test script where you want to capture screenshots.

\`\`\`javascript
const { percy } = require('browserstack-node-sdk');
describe("sample Test", () => {
  // ... other imports and setup
  
  test("my test", async () => {
    // ....
    await percy.screenshot(driver, "My Snapshot")
    // ....
  });
})
\`\`\`
`;

export const webdriverioPercyInstructions = `
Enable Percy in \`wdio.conf.js\`:
In your WebdriverIO configuration file, modify the 'browserstack' service options to enable Percy.

- Set \`percy: true\`.
- Set a \`projectName\`. This is required and will be used for both your Automate and Percy projects.
- Set \`percyCaptureMode\`. The default \`manual\` as we are adding screenshot commands manually.

Here's how to modify the service configuration:
\`\`\`javascript
// in wdio.conf.js

exports.config = {
  // ... other configs
  services: [
    [
      'browserstack',
      { 
        // ... other service options
        percy: true,
        percyCaptureMode: 'manual' // or 'auto', etc.
      },
    ],
  ],

  commonCapabilities: {
    'bstack:options': {
      projectName: "My Percy Project", // This is required for Percy
      // ... other common capabilities
    }
  },
  // ... rest of your config
};
\`\`\`

${PERCY_SNAPSHOT_INSTRUCTION}

---STEP---

Manually Capturing Screenshots (Optional):
If you set \`percyCaptureMode: 'manual'\` or want to take extra screenshots in \`auto\` mode, you need to add screenshot commands to your tests.

First, install \`browserstack-node-sdk\`:
\`\`\`bash
npm install browserstack-node-sdk
\`\`\`

Then, in your test script, import \`percy\` and use it to take a snapshot:
\`\`\`javascript
// your_test_file.js
const { percy } = require('browserstack-node-sdk');

describe("My WebdriverIO Test", () => {
  it("should take a percy snapshot", async () => {
    // ... your test logic (e.g., browser.url('https://example.com'))
    
    // Capture a Percy screenshot
    await percy.screenshot(driver, "My Snapshot Name");
    
    // ... more test logic
  });
});
\`\`\`
`;

export const csharpSeleniumInstructions = `
Import the BrowserStack Percy SDK in your test script:
Add the Percy import to your test file.

${PERCY_SNAPSHOT_INSTRUCTION}

Add screenshot capture method at required points:
Use the \`PercySDK.Screenshot(driver, name)\` method at points in your test script where you want to capture screenshots.

Here's an example:

\`\`\`csharp
using BrowserStackSDK.Percy;
namespace Tests;

public class MyTest
{
    [Test]
    public void SampleTest()
    {
        // your test logic
        // ...
        
        // Capture a Percy screenshot
        PercySDK.Screenshot(driver, "Screenshot name");
        
        // ...
        // more test logic
    }
}
\`\`\`
`;
