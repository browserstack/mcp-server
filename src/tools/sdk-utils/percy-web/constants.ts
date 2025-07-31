import { percyAutomateAggressiveInstruction } from "../common/commonMessages.js";
export const percyReviewSnapshotsStep = `
---STEP---
Review the snapshots
  - Go to your Percy project on https://percy.io to review snapshots and approve/reject any visual changes.
`;

export const pythonInstructions = `
Install Percy dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy Selenium Python package:
    pip install percy-selenium

Update your Python Selenium script
${percyAutomateAggressiveInstruction}
Example:
\`\`\`python
from selenium import webdriver
from percy import percy_snapshot

driver = webdriver.Chrome()
driver.get('http://localhost:8000')
percy_snapshot(driver, 'Home page')
# ... more test steps ...
percy_snapshot(driver, 'After login')
\`\`\`

Run Percy with your tests
  - Use the following command:
    npx percy exec -- <your command to run tests>
  
Example output:
  [percy] Percy has started!
  [percy] Created build #1: https://percy.io/your-project
  [percy] Snapshot taken "Home page"
  [percy] Finalized build #1: https://percy.io/your-project
  [percy] Done!

${percyReviewSnapshotsStep}
`;

export const nodejsInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy SDK for Node.js:
    npm install @percy/selenium-webdriver
---STEP---
Update your Node.js Selenium script
${percyAutomateAggressiveInstruction}
  - Import the Percy snapshot helper:
    const { percySnapshot } = require('@percy/selenium-js');
  - In your test, take snapshots like this:
    await percySnapshot(driver, "Your snapshot name");

Example:
\`\`\`javascript
const { Builder } = require('selenium-webdriver');
const percySnapshot = require('@percy/selenium-webdriver');

const driver = await new Builder().forBrowser('chrome').build();
await driver.get('http://localhost:8000');
await percySnapshot(driver, 'Home page');
\`\`\`

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- node scripts/test.js

${percyReviewSnapshotsStep}
`;

export const javaInstructions = `
---STEP---
Add Percy dependencies to your project
  - For Maven, add to your pom.xml:
    <dependency>
      <groupId>io.percy</groupId>
      <artifactId>percy-java-selenium</artifactId>
      <version>1.0.0</version>
    </dependency>
  - For Gradle, add to your build.gradle:
    implementation 'io.percy:percy-java-selenium:1.0.0'
  - For CLI usage, install Percy CLI:
    npm install --save-dev @percy/cli

---STEP---
Update your Java Selenium test
${percyAutomateAggressiveInstruction}
  - Import the Percy snapshot helper:
    import io.percy.selenium.Percy;
  - In your test, take snapshots like this:
    Percy percy = new Percy(driver);
    percy.snapshot("Your snapshot name");

Example:
\`\`\`java
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import io.percy.selenium.Percy;

public class PercyExample {
  public static void main(String[] args) {
    WebDriver driver = new ChromeDriver();
    driver.get("http://localhost:8000");
    Percy percy = new Percy(driver);
    percy.snapshot("Home page");
    driver.quit();
  }
}
\`\`\`

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- mvn test

${percyReviewSnapshotsStep}
`;

export const rubyInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy Ruby Selenium gem:
    gem install percy-selenium

---STEP---
Update your Ruby Selenium test
${percyAutomateAggressiveInstruction}
  - Require the Percy snapshot helper:
    require 'percy'
  - In your test, take snapshots like this:
    Percy.snapshot(page, 'Your snapshot name')

Example:
\`\`\`ruby
require 'selenium-webdriver'
require 'percy'

driver = Selenium::WebDriver.for :chrome
driver.get('http://localhost:8000')
Percy.snapshot(driver, 'Your snapshot name')
driver.quit
\`\`\`

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- <your command to run tests>

${percyReviewSnapshotsStep}
`;

export const csharpInstructions = `
Install Percy CLI by running the following command:
npm install --save-dev @percy/cli

---STEP---
Add Percy dependencies to your project
  - Add the Percy .NET Selenium NuGet package:
    dotnet add package PercyIO.Selenium

---STEP---
Update your C# Selenium test
${percyAutomateAggressiveInstruction}

  - Import the Percy snapshot helper:
    using PercyIO.Selenium;
  - In your test, take snapshots like this:
    Percy.Snapshot(driver,"Your snapshot name");

Example:
\`\`\`csharp
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using PercyIO.Selenium;

class PercyExample
{
    static void Main()
    {
        IWebDriver driver = new ChromeDriver();
        driver.Navigate().GoToUrl("http://localhost:8000");
        Percy.Snapshot(driver,"Empty Todo State");
        driver.Quit();
    } 
}
\`\`\`

Run Percy with your tests
  - Use the following command:
    npx percy exec -- <your command to run tests>

${percyReviewSnapshotsStep}
`;

export const javaPlaywrightInstructions = `
Install Percy dependencies
  - For Maven, add to your pom.xml:
    <dependency>
      <groupId>io.percy</groupId>
      <artifactId>percy-playwright-java</artifactId>
      <version>1.0.0</version>
    </dependency>

---STEP---
Update your Java Playwright test
${percyAutomateAggressiveInstruction}
  - Import the Percy library and use the snapshot method:
    percy.snapshot("snapshot_1");
  - You can also pass options:
    Map<String, Object> options = new HashMap<>();
    options.put("testCase", "Should add product to cart");
    percy.snapshot("snapshot_2", options);

Example:
\`\`\`java
import com.microsoft.playwright.*;
import io.percy.playwright.*;

public class PercyPlaywrightExample {
  public static void main(String[] args) {
    try (Playwright playwright = Playwright.create()) {
      Browser browser = playwright.chromium().launch();
      Page page = browser.newPage();
      Percy percy = new Percy(page);

      page.navigate("http://localhost:8000");
      percy.snapshot("Home page");

      // ... more test steps ...
      percy.snapshot("After login");

      browser.close();
    }
  }
}
\`\`\`

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- <command to run the test script file>

${percyReviewSnapshotsStep}
`;

export const jsPlaywrightInstructions = `
Install Percy dependencies
  - Install Percy Playwright SDK:
    npm install @percy/playwright

---STEP---
Update your Playwright JavaScript test
${percyAutomateAggressiveInstruction}
  - Import the Percy snapshot helper:
    const percySnapshot = require('@percy/playwright');
  - In your test, take snapshots like this:
    await percySnapshot(page, "Your snapshot name");

Example:
\`\`\`javascript
const { chromium } = require('playwright');
const percySnapshot = require('@percy/playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://example.com/', { waitUntil: 'networkidle' });
  await percySnapshot(page, 'Example Site');
  await browser.close();
})();
\`\`\`

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- <command to run the test script file>
${percyReviewSnapshotsStep}
`;

export const pythonPlaywrightInstructions = `
---STEP---
Create a Percy project
  - Sign in to Percy and create a project of type "Web". Name the project and note the generated token.

---STEP---
Set the project token as an environment variable
  - On macOS/Linux:
    export PERCY_TOKEN="<your token here>"
  - On Windows PowerShell:
    $env:PERCY_TOKEN="<your token here>"
  - On Windows CMD:
    set PERCY_TOKEN=<your token here>

---STEP---
Install Percy dependencies
  - Install Percy Playwright SDK:
    pip install percy-playwright

---STEP---
Update your Playwright Python test
${percyAutomateAggressiveInstruction}
  - Import the Percy snapshot helper and use the snapshot method:
    percy_snapshot(page, name="Your snapshot name")
  - You can also use:
    percy_screenshot(page, name="Your snapshot name", options={})

Example:
\`\`\`python
from playwright.sync_api import sync_playwright
from percy import percy_snapshot

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:8000")
    percy_snapshot(page, name="Home page")

    # ... more test steps ...
    percy_snapshot(page, name="After login")

    browser.close()
\`\`\`

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- python your_test_script.py

${percyReviewSnapshotsStep}
`;

export const csharpPlaywrightInstructions = `
Install Percy dependencies
  - Add the Percy Playwright NuGet package:
    <PackageReference Include="PercyIO.Playwright" Version="1.0.0" />

---STEP---
Update your Playwright .NET test
${percyAutomateAggressiveInstruction}
  - Import the Percy snapshot helper and use the snapshot method:
    Percy.Snapshot(page, "Your snapshot name");
  - You can also pass options:
    Percy.Snapshot(page, "Your snapshot name", options);

Example:
\`\`\`csharp
using Microsoft.Playwright;
using PercyIO.Playwright;

class PercyPlaywrightExample
{
    public static async Task Main()
    {
        using var playwright = await Playwright.CreateAsync();
        var browser = await playwright.Chromium.LaunchAsync();
        var page = await browser.NewPageAsync();

        await page.GotoAsync("http://localhost:8000");
        Percy.Snapshot(page, "Home page");

        // ... more test steps ...
        Percy.Snapshot(page, "After login");

        await browser.CloseAsync();
    }
}
\`\`\`

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- dotnet test

${percyReviewSnapshotsStep}
`;
