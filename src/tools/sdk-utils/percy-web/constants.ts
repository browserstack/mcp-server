import { PERCY_SNAPSHOT_INSTRUCTION } from "../common/constants.js";
export const percyReviewSnapshotsStep = `
---STEP---
Review the snapshots
  - Go to your Percy project on https://percy.io to review snapshots and approve/reject any visual changes.
`;

export const pythonInstructionsSnapshot = `
Example:
\`\`\`python
- Import the Percy snapshot helper:
from selenium import webdriver
from percy import percy_snapshot

driver = webdriver.Chrome()
driver.get('http://localhost:8000')
percy_snapshot(driver, 'Home page')
# ... more test steps ...
percy_snapshot(driver, 'After login')
\`\`\`
`;

export const nodejsInstructionsSnapshot = `
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
`;

export const javaInstructionsSnapshot = `
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
\`\`\``;

export const rubyInstructionsSnapshot = `
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
`;

export const rubyCapybaraInstructionsSnapshot = `
  - In your test setup file, require percy/capybara:
    require 'percy/capybara'
  - In your test, take snapshots like this:
    page.percy_snapshot('Capybara snapshot')

Example:
\`\`\`ruby
require 'percy/capybara'

describe 'my feature', type: :feature do
  it 'renders the page' do
    visit 'https://example.com'
    page.percy_snapshot('Capybara snapshot')
  end
end
\`\`\`

  - The snapshot method arguments are:
    page.percy_snapshot(name[, options])
    name - The snapshot name; must be unique to each snapshot; defaults to the test title
    options - See per-snapshot configuration options
`;

export const csharpInstructionsSnapshot = `
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
`;

export const javaPlaywrightInstructionsSnapshot = `
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
`;

export const nodejsPlaywrightInstructionsSnapshot = `
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
`;

export const nodejsWebdriverioInstructionsSnapshot = `
  - Import the Percy snapshot helper:
    const percySnapshot = require('@percy/selenium-webdriver');
  - In your test, take snapshots like this:
    await percySnapshot(driver, "Your snapshot name");

Example:
\`\`\`javascript
const { remote } = require('webdriverio');
const percySnapshot = require('@percy/selenium-webdriver');

(async () => {
  const browser = await remote({
    logLevel: 'error',
    capabilities: { browserName: 'chrome' }
  });

  await browser.url('https://example.com');
  await percySnapshot(browser, 'WebdriverIO example');
  await browser.deleteSession();
})();
\`\`\`
`;

export const nodejsEmberInstructionsSnapshot = `
  - Import the Percy snapshot helper:
    import percySnapshot from '@percy/ember';
  - In your test, take snapshots like this:
    await percySnapshot('My Snapshot');

Example:
\`\`\`javascript
import percySnapshot from '@percy/ember';
describe('My ppp', () => {
  // ...app setup
  it('about page should look good', async () => {
    await visit('/about');
    await percySnapshot('My Snapshot');
  });
});
\`\`\`

  - The snapshot method arguments are:
    percySnapshot(name[, options])
    name - The snapshot name; must be unique to each snapshot; defaults to the test title
    options - See per-snapshot configuration options
`;

export const nodejsCypressInstructionsSnapshot = `
  - Import the Percy snapshot helper in your cypress/support/e2e.js file:
    import '@percy/cypress';
  - If you’re using TypeScript, include "types": ["cypress", "@percy/cypress"] in your tsconfig.json file.
  - In your test, take snapshots like this:
    cy.percySnapshot();

Example:
\`\`\`javascript
import '@percy/cypress';

describe('Integration test with visual testing', function() {
  it('Loads the homepage', function() {
    // Load the page or perform any other interactions with the app.
    cy.visit('<URL under test>');
    // Take a snapshot for visual diffing
    cy.percySnapshot();
  });
});
\`\`\`

  - The snapshot method arguments are:
    cy.percySnapshot([name][, options])
    name - The snapshot name; must be unique to each snapshot; defaults to the test title
    options - See per-snapshot configuration options

  - For example:
    cy.percySnapshot();
    cy.percySnapshot('Homepage test');
    cy.percySnapshot('Homepage responsive test', { widths: [768, 992, 1200] });
`;

export const nodejsPuppeteerInstructionsSnapshot = `
  - Import the Percy snapshot helper:
    const percySnapshot = require('@percy/puppeteer');
  - In your test, take snapshots like this:
    await percySnapshot(page, 'Snapshot name');

Example:
\`\`\`javascript
const puppeteer = require('puppeteer');
const percySnapshot = require('@percy/puppeteer');

describe('Integration test with visual testing', function() {
  it('Loads the homepage', async function() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('https://example.com');
    await percySnapshot(page, this.test.fullTitle());
    await browser.close();
  });
});
\`\`\`

  - The snapshot method arguments are:
    percySnapshot(page, name[, options])
    page (required) - A puppeteer page instance
    name (required) - The snapshot name; must be unique to each snapshot
    options - See per-snapshot configuration options

  - For example:
    percySnapshot(page, 'Homepage test');
    percySnapshot(page, 'Homepage responsive test', { widths: [768, 992, 1200] });
`;

export const nodejsNightmareInstructionsSnapshot = `
  - Import the Percy snapshot helper:
    const Nightmare = require('nightmare');
    const percySnapshot = require('@percy/nightmare');
  - In your test, take snapshots like this:
    .use(percySnapshot('Snapshot name'))

Example:
\`\`\`javascript
const Nightmare = require('nightmare');
const percySnapshot = require('@percy/nightmare');

Nightmare()
  .goto('http://example.com')
  // ... other actions ...
  .use(percySnapshot('Example Snapshot'))
  // ... more actions ...
  .end()
  .then(() => {
    // ...
  });
\`\`\`

  - The snapshot method arguments are:
    percySnapshot(name[, options])
    name (required) - The snapshot name; must be unique to each snapshot
    options - See per-snapshot configuration options
`;

export const nodejsNightwatchInstructionsSnapshot = `
  - Import the Percy library and add the path exported by @percy/nightwatch to your Nightwatch configuration’s custom_commands_path property:
    const percy = require('@percy/nightwatch');
    module.exports = {
      // ...
      custom_commands_path: [percy.path],
      // ...
    };
  - In your test, take snapshots like this:
    browser.percySnapshot('Snapshot name');

Example:
\`\`\`javascript
const percy = require('@percy/nightwatch');
module.exports = {
  // ...
  custom_commands_path: [percy.path],
  // ...
};

// Example test
module.exports = {
  'Snapshots pages': function(browser) {
    browser
      .url('http://example.com')
      .assert.containsText('h1', 'Example Domain')
      .percySnapshot('Example snapshot');
    browser
      .url('http://google.com')
      .assert.elementPresent('img[alt="Google"]')
      .percySnapshot('Google homepage');
    browser.end();
  }
};
\`\`\`

  - The snapshot method arguments are:
    percySnapshot([name][, options])
    name (required) - The snapshot name; must be unique to each snapshot
    options - See per-snapshot configuration options
`;

export const nodejsProtractorInstructionsSnapshot = `
  - Import the Percy snapshot helper:
    import percySnapshot from '@percy/protractor';
  - In your test, take snapshots like this:
    await percySnapshot('Snapshot name');
    // or
    await percySnapshot(browser, 'Snapshot name');

Example:
\`\`\`javascript
import percySnapshot from '@percy/protractor';
describe('angularjs homepage', function() {
  it('should greet the named user', async function() {
    await browser.get('https://www.angularjs.org');
    await percySnapshot('AngularJS homepage');
    await element(by.model('yourName')).sendKeys('Percy');
    var greeting = element(by.binding('yourName'));
    expect(await greeting.getText()).toEqual('Hello Percy!');
    await percySnapshot('AngularJS homepage greeting');
  });
});
\`\`\`

  - The snapshot method arguments are:
    percySnapshot(name[, options])
    Standalone mode:
    percySnapshot(browser, name[, options])
    browser (required) - The Protractor browser object
    name (required) - The snapshot name; must be unique to each snapshot
    options - See per-snapshot configuration options
`;

export const nodejsTestcafeInstructionsSnapshot = `
  - Import the Percy snapshot helper:
    import percySnapshot from '@percy/testcafe';
  - In your test, take snapshots like this:
    await percySnapshot(t, 'Snapshot name');

Example:
\`\`\`javascript
import percySnapshot from '@percy/testcafe';
fixture('MyFixture')
  .page('https://devexpress.github.io/testcafe/example');
test('Test1', async t => {
  await t.typeText('#developer-name', 'John Doe');
  await percySnapshot(t, 'TestCafe Example');
});
\`\`\`

  - The snapshot method arguments are:
    percySnapshot(t, name[, options])
    t (required) - The test controller instance passed from test
    name (required) - The snapshot name; must be unique to each snapshot
    options - See per-snapshot configuration options
`;

export const nodejsGatsbyInstructionsSnapshot = `
  - Add the Percy plugin to your gatsby-config.js file:
    module.exports = {
      plugins: [\`gatsby-plugin-percy\`]
    }

  - The plugin will take snapshots of discovered pages during the build process.

  - Example gatsby-config.js with options:
\`\`\`javascript
module.exports = {
  plugins: [{
    resolve: \`gatsby-plugin-percy\`,
    options: {
      // gatsby specific options
      query: \`{
        allSitePage { nodes { path } }
        allOtherPage { nodes { path } }
      }\`,
      resolvePages: ({
        allSitePage: { nodes: allPages },
        allOtherPage: { nodes: otherPages }
      }) => {
        return [...allPages, ...otherPages]
          .map(({ path }) => path);
      },
      // percy static snapshot options
      exclude: [
        '/dev-404-page/',
        '/offline-plugin-app-shell-fallback/'
      ],
      overrides: [{
        include: '/foobar/',
        waitForSelector: '.done-loading',
        additionalSnapshots: [{
          suffix: ' - after btn click',
          execute: () => document.querySelector('.btn').click()
        }]
      }]
    }
  }]
}
\`\`\`
`;

export const nodejsStorybookInstructionsSnapshot = `
  - Add Percy parameters to your stories to customize snapshots:
\`\`\`js
MyStory.parameters = {
  percy: {
    name: 'My snapshot',
    additionalSnapshots: [
      { prefix: '[Dark mode] ', args: { colorScheme: 'dark' } },
      { suffix: ' with globals', globals: { textDirection: 'rtl' } },
      { name: 'Search snapshot', queryParams: { search: 'foobar' } }
    ]
  }
};
\`\`\`
  - Use argument names and values defined in your codebase.
`;

export const pythonPlaywrightInstructionsSnapshot = `
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
`;

export const csharpPlaywrightInstructionsSnapshot = `
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
`;

export const pythonInstructions = `
Install Percy dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy Selenium Python package:
    pip install percy-selenium

Update your Python Selenium script
${PERCY_SNAPSHOT_INSTRUCTION}
${pythonInstructionsSnapshot}

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
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsInstructionsSnapshot}

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
${PERCY_SNAPSHOT_INSTRUCTION}
${javaInstructionsSnapshot}

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
${PERCY_SNAPSHOT_INSTRUCTION}
${rubyInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- <your command to run tests>

${percyReviewSnapshotsStep}
`;

// Percy Capybara instructions for Ruby
export const rubyCapybaraInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy Capybara gem:
    gem install percy-capybara

---STEP---
Update your Capybara or Rails test script
${PERCY_SNAPSHOT_INSTRUCTION}
${rubyCapybaraInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- bundle exec rspec

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
${PERCY_SNAPSHOT_INSTRUCTION}
${csharpInstructionsSnapshot}

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
${PERCY_SNAPSHOT_INSTRUCTION}
${javaPlaywrightInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- <command to run the test script file>

${percyReviewSnapshotsStep}
`;

export const nodejsPlaywrightInstructions = `
Install Percy dependencies
  - Install Percy Playwright SDK:
    npm install @percy/playwright

---STEP---
Update your Playwright JavaScript test
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsPlaywrightInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- <command to run the test script file>
${percyReviewSnapshotsStep}
`;

// Percy WebdriverIO instructions for JavaScript
export const nodejsWebdriverioInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI:
    npm install --save-dev @percy/cli
  - Install Percy Selenium Webdriver package:
    npm install --save-dev @percy/selenium-webdriver

---STEP---
Update your WebdriverIO test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsWebdriverioInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- wdio run wdio.conf.js

${percyReviewSnapshotsStep}
`;

// Percy Ember instructions for JavaScript
export const nodejsEmberInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Ember SDK:
    npm install --save-dev @percy/cli @percy/ember

---STEP---
Update your Ember test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsEmberInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- ember test

${percyReviewSnapshotsStep}
`;

// Percy Cypress instructions for JavaScript
export const nodejsCypressInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Cypress SDK:
    npm install --save-dev @percy/cli @percy/cypress

---STEP---
Update your Cypress test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsCypressInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- cypress run

${percyReviewSnapshotsStep}
`;

// Percy Puppeteer instructions for JavaScript
export const nodejsPuppeteerInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Puppeteer SDK:
    npm install --save-dev @percy/cli @percy/puppeteer

---STEP---
Update your Puppeteer test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsPuppeteerInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- mocha

${percyReviewSnapshotsStep}
`;

// Percy Nightmare instructions for JavaScript
export const nodejsNightmareInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Nightmare SDK:
    npm install --save-dev @percy/cli @percy/nightmare

---STEP---
Update your Nightmare test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsNightmareInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- node script.js

${percyReviewSnapshotsStep}
`;

// Percy Nightwatch instructions for JavaScript
export const nodejsNightwatchInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Nightwatch SDK:
    npm install --save-dev @percy/cli @percy/nightwatch

---STEP---
Update your Nightwatch configuration and test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsNightwatchInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- nightwatch

${percyReviewSnapshotsStep}
`;

// Percy Protractor instructions for JavaScript
export const nodejsProtractorInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Protractor SDK:
    npm install --save-dev @percy/cli @percy/protractor

---STEP---
Update your Protractor test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsProtractorInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- protractor conf.js

${percyReviewSnapshotsStep}
`;

// Percy TestCafe instructions for JavaScript
export const nodejsTestcafeInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and TestCafe SDK:
    npm install --save-dev @percy/cli @percy/testcafe

---STEP---
Update your TestCafe test script
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsTestcafeInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- testcafe chrome:headless tests

${percyReviewSnapshotsStep}
`;

// Percy Gatsby instructions for JavaScript
export const nodejsGatsbyInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Gatsby plugin:
    npm install --save @percy/cli gatsby-plugin-percy

---STEP---
Update your Gatsby configuration
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsGatsbyInstructionsSnapshot}

---STEP---
Run Percy with your Gatsby build
  - Use the following command:
    npx percy exec -- gatsby build

${percyReviewSnapshotsStep}
`;

// Percy Storybook instructions for JavaScript
export const nodejsStorybookInstructions = `
---STEP---
Install Percy dependencies
  - Install Percy CLI and Storybook SDK:
    npm install --save-dev @percy/cli @percy/storybook

---STEP---
Update your Storybook stories
${PERCY_SNAPSHOT_INSTRUCTION}
${nodejsStorybookInstructionsSnapshot}

---STEP---
Run Percy with your Storybook
  - With a static Storybook build:
    percy storybook ./storybook-build
  - With a local or live Storybook URL:
    percy storybook http://localhost:9009
    percy storybook https://storybook.foobar.com
  - Automatically run start-storybook:
    percy storybook:start --port=9009 --static-dir=./public

  - Example output:
    [percy] Snapshot found: My snapshot
    [percy] - url: [...]?id=component--my-story
    [percy] Snapshot found: [Dark mode] My snapshot
    [percy] - url: [...]?id=component--my-story&args=colorScheme:dark
    [percy] Snapshot found: My snapshot with globals
    [percy] - url: [...]?id=component--my-story&globals=textDirection:rtl
    [percy] Snapshot found: Search snapshot
    [percy] - url: [...]?id=component--my-story&search=foobar

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
${PERCY_SNAPSHOT_INSTRUCTION}
${pythonPlaywrightInstructionsSnapshot}

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
${PERCY_SNAPSHOT_INSTRUCTION}
${csharpPlaywrightInstructionsSnapshot}

---STEP---
Run Percy with your tests
  - Use the following command:
    npx percy exec -- dotnet test

${percyReviewSnapshotsStep}
`;
