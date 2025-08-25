// Node.js instructions and commands for App SDK utilities
import {
  AppSDKSupportedTestingFramework,
  AppSDKSupportedTestingFrameworkEnum,
  createStep,
  combineInstructions,
} from "../index.js";

export function getNodejsSDKCommand(
  testingFramework: string,
  username: string,
  accessKey: string,
): string {
  switch (testingFramework) {
    case "webdriverio":
      return getWebDriverIOCommand(username, accessKey);
    case "nightwatch":
      return getNightwatchCommand(username, accessKey);
    case "jest":
      return getJestCommand(username, accessKey);
    case "mocha":
      return getMochaCommand(username, accessKey);
    case "cucumberJs":
      return getCucumberJSCommand(username, accessKey);
    default:
      return "";
  }
}

export function getNodejsAppInstructions(
  testingFramework: AppSDKSupportedTestingFramework,
): string {
  switch (testingFramework) {
    case AppSDKSupportedTestingFrameworkEnum.webdriverio:
      return createStep(
        "Run your WebdriverIO test suite:",
        "Your test suite is now ready to run on BrowserStack. Use the commands defined in your package.json file to run the tests",
      );
    case AppSDKSupportedTestingFrameworkEnum.nightwatch:
      return createStep(
        "Run your App Automate test suite:",
        `For Android:
          \`\`\`bash
            npx nightwatch <path to tests> --env browserstack.android 
          \`\`\`
          For iOS:
          \`\`\`bash
            npx nightwatch <path to tests> --env browserstack.ios
          \`\`\``,
      );
    case AppSDKSupportedTestingFrameworkEnum.jest:
      return createStep(
        "Run your Jest test suite with BrowserStack SDK:",
        `Use the npm script defined in your package.json. For example:\n\n\`\`\`bash\nnpx run browserstack-node-sdk jest specs/single_test.js\n\`\`\``,
      );
    case AppSDKSupportedTestingFrameworkEnum.mocha:
      return createStep(
        "Run your Mocha test suite with BrowserStack SDK:",
        `Use the npm script defined in your package.json. For example:\n\n\`\`\`bash\nnpx run browserstack-node-sdk mocha specs/single_test.js\n\`\`\``,
      );

    case AppSDKSupportedTestingFrameworkEnum.cucumberJs:
      return createStep(
        "Run your Cucumber JS test suite with BrowserStack SDK:",
        `Use the npm script defined in your package.json. For example:\n\n\`\`\`bash\nnpx run browserstack-node-sdk cucumber-js specs/single_test.js\n\`\`\``,
      );
    default:
      return "";
  }
}

function getWebDriverIOCommand(username: string, accessKey: string): string {
  const prerequisiteStep = createStep(
    "Prerequisite Setup:",
    `a. Ensure you do not modify or replace any existing local driver code, 
    as it will be automatically managed and overwritten by the BrowserStack SDK/Driver.
    b. Do not create any YML file in this integration as it is not required.
    c. Ensure you create the WDIO config file as per the instructions below.`,
  );

  const envStep = createStep(
    "Set your BrowserStack credentials as environment variables:",
    `\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\``,
  );

  const installStep = createStep(
    "Install BrowserStack WDIO service:",
    `\`\`\`bash
npm install @wdio/browserstack-service@^7 --save-dev
\`\`\``,
  );

  const configStep = createStep(
    "Update your WebdriverIO config file (e.g., \\`wdio.conf.js\\`) to add the BrowserStack service and capabilities:",
    `\`\`\`js
exports.config = {
  user: process.env.BROWSERSTACK_USERNAME || '${username}',
  key: process.env.BROWSERSTACK_ACCESS_KEY || '${accessKey}',
  hostname: 'hub.browserstack.com',
  services: [
    [
      'browserstack',
      {
        app: 'bs://sample.app',
        browserstackLocal: true,
        accessibility: false,
        testObservabilityOptions: {
          buildName: "bstack-demo",
          projectName: "BrowserStack Sample",
          buildTag: 'Any build tag goes here. For e.g. ["Tag1","Tag2"]'
        },
      },
    ]
  ],
  capabilities: [{
    'bstack:options': {
      deviceName: 'Samsung Galaxy S22 Ultra',
      platformVersion: '12.0',
      platformName: 'android',
    }
  }],
  commonCapabilities: {
    'bstack:options': {
      debug: true,
      networkLogs: true,
      percy: false,
      percyCaptureMode: 'auto'
    }
  },
  maxInstances: 10,
  // ...other config
};
\`\`\``,
  );

  return combineInstructions(
    prerequisiteStep,
    envStep,
    installStep,
    configStep,
  );
}

function getNightwatchCommand(username: string, accessKey: string): string {
    const prerequisiteStep = createStep(
    "Prerequisite Setup:",
    ` a. Ensure you do not modify or replace any existing local driver code, 
      as it will be automatically managed and overwritten by the BrowserStack SDK/Driver.
      b. Do not create any YML file in this integration as it is not required.
      c. Ensure you create the WDIO config file as per the instructions below.`,
  );

  const envStep = createStep(
    "Set your BrowserStack credentials as environment variables:",
`\`\`\`bash 
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\``,
  );

  const installStep = createStep(
    "Install Nightwatch and BrowserStack integration:",
`\`\`\`bash
npm install --save-dev @nightwatch/browserstack
\`\`\``,
  );

  const configStep = createStep(
    "Update your Nightwatch config file (e.g., \\`nightwatch.conf.js\\`) to add the BrowserStack settings and capabilities:",
    `\`\`\`js

    test_settings:{
    ...
    browserstack: {
      selenium: {
        host: 'hub.browserstack.com',
        port: 443
      },
      desiredCapabilities: {
       'bstack:options': {
          userName: '',
          accessKey: '',
          appiumVersion: '2.0.0'
        }
      },
      disable_error_log: false,
      webdriver: {
        timeout_options: {
          timeout: 60000,
          retry_attempts: 3
        },
        keep_alive: true,
        start_process: false
      }
    },
    'browserstack.android': {
      extends: 'browserstack',
      'desiredCapabilities': {
        browserName: null,
        'appium:options': {
          automationName: 'UiAutomator2',
          app: 'wikipedia-sample-app',// custom-id of the uploaded app
          appPackage: 'org.wikipedia',
          appActivity: 'org.wikipedia.main.MainActivity',
          appWaitActivity: 'org.wikipedia.onboarding.InitialOnboardingActivity',
          platformVersion: '11.0',
          deviceName: 'Google Pixel 5'
        },
        appUploadUrl: 'https://raw.githubusercontent.com/priyansh3133/wikipedia/main/wikipedia.apk',// URL of the app to be uploaded to BrowserStack before starting the test
        // appUploadPath: '/path/to/app_name.apk' // if the app needs to be uploaded to BrowserStack from a local system
      }
    },
    'browserstack.ios': {
      extends: 'browserstack',
      'desiredCapabilities': {
        browserName: null,
        platformName: 'ios',
        'appium:options': {
          automationName: 'XCUITest',
          app: 'BStackSampleApp',
          platformVersion: '16',
          deviceName: 'iPhone 14'
        },
        appUploadUrl: 'https://www.browserstack.com/app-automate/sample-apps/ios/BStackSampleApp.ipa',
        // appUploadPath: '/path/to/app_name.ipa'
      }
    ...
  }
\`\`\``,
  );

  return combineInstructions(prerequisiteStep, envStep, installStep, configStep);
}

function getJestCommand(username: string, accessKey: string): string {
  const envStep = createStep(
    "Set your BrowserStack credentials as environment variables:",
    `\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\``,
  );

  const installStep = createStep(
    "Install Jest and BrowserStack SDK:",
    `\`\`\`bash
npm install --save-dev browserstack-node-sdk
\`\`\``,
  );

  return combineInstructions(envStep, installStep);
}

function getMochaCommand(username: string, accessKey: string): string {
  const envStep = createStep(
    "Set your BrowserStack credentials as environment variables:",
    `\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\``,
  );

  const installStep = createStep(
    "Install Mocha and BrowserStack SDK:",
    `\`\`\`bash
npm install --save-dev browserstack-node-sdk
\`\`\``,
  );

  return combineInstructions(envStep, installStep);
}

function getCucumberJSCommand(username: string, accessKey: string): string {
  return createStep(
    "Set your BrowserStack credentials as environment variables:",
    `\`\`\`bash
export BROWSERSTACK_USERNAME=${username}
export BROWSERSTACK_ACCESS_KEY=${accessKey}
\`\`\``,
  );
}
