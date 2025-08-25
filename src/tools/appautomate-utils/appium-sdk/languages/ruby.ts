// Ruby instructions and commands for App SDK utilities
import {
  AppSDKSupportedTestingFramework,
  AppSDKSupportedTestingFrameworkEnum,
  createStep,
  combineInstructions,
  createEnvStep,
  PLATFORM_UTILS,
} from "../index.js";

export function getRubyAppInstructions(
  testingFramework: AppSDKSupportedTestingFramework,
): string {
  if (testingFramework === AppSDKSupportedTestingFrameworkEnum.cucumberRuby) {
    return getCucumberRubyInstructions();
  }

  if (testingFramework === AppSDKSupportedTestingFrameworkEnum.rspec) {
    return getRSpecInstructions();
  }

  return "";
}

function getCucumberRubyInstructions(): string {
  const configStep = createStep(
    "Create/Update the config file (config.yml) as follows:",
    `\`\`\`yaml
server: "hub-cloud.browserstack.com"

common_caps:
  "project": "First Cucumber Android Project"
  "build": "Cucumber Android"
  "browserstack.debug": true

browser_caps:
  -
    "device": "Google Pixel 3"
    "os_version": "9.0"
    "app": "bs://<app-id>"
    "name": "first_test"
\`\`\``,
  );

  const envStep = createStep(
    "Create/Update your support/env.rb file:",
    `\`\`\`ruby
require 'rubygems'
require 'appium_lib'

# Load configuration from config.yml
caps = Appium.load_appium_txt file: File.expand_path('./../config.yml', __FILE__)

# Create desired capabilities
desired_caps = {
  caps: caps,
  appium_lib: {
    server_url: "https://hub-cloud.browserstack.com/wd/hub"
  }
}

# Initialize Appium driver
begin
  $appium_driver = Appium::Driver.new(desired_caps, true)
  $driver = $appium_driver.start_driver
rescue Exception => e
  puts e.message
  Process.exit(0)
end

# Add cleanup hook
at_exit do
  $driver.quit if $driver
end
\`\`\``,
  );

  const runStep = createStep(
    "Run the test:",
    `\`\`\`bash
bundle exec cucumber
\`\`\``,
  );

  return combineInstructions(configStep, envStep, runStep);
}

function getRSpecInstructions(): string {
  const specHelperStep = createStep(
    "Create/Update your spec_helper.rb file:",
    `\`\`\`ruby
require 'rubygems'
require 'appium_lib'

RSpec.configure do |config|
  config.before(:all) do
    # Define desired capabilities
    desired_caps = {
      'platformName' => 'Android',
      'platformVersion' => '9.0',
      'deviceName' => 'Google Pixel 3',
      'app' => 'bs://<app-id>',
      'project' => 'First RSpec Android Project',
      'build' => 'RSpec Android',
      'name' => 'first_test',
      'browserstack.debug' => true
    }

    # Initialize Appium driver
    begin
      $appium_driver = Appium::Driver.new({
        caps: desired_caps,
        appium_lib: {
          server_url: "https://hub-cloud.browserstack.com/wd/hub"
        }
      }, true)
      $driver = $appium_driver.start_driver
    rescue Exception => e
      puts e.message
      Process.exit(0)
    end
  end

  config.after(:all) do
    $driver.quit if $driver
  end
end
\`\`\``,
  );

  const testFileStep = createStep(
    "Create your test file (e.g., spec/app_spec.rb):",
    `\`\`\`ruby
require 'spec_helper'

describe 'App Test' do
  it 'should launch the app successfully' do
    # Your test code here
    expect($driver).not_to be_nil
  end
end
\`\`\``,
  );

  const runStep = createStep(
    "Run the test:",
    `\`\`\`bash
bundle exec rspec
\`\`\``,
  );

  return combineInstructions(specHelperStep, testFileStep, runStep);
}

export function getRubySDKCommand(
  framework: string,
  username: string,
  accessKey: string,
): string {
  const { isWindows, getPlatformLabel } = PLATFORM_UTILS;

  if (framework === "rspec" || framework === "cucumberRuby") {
    const envStep = createEnvStep(
      username,
      accessKey,
      isWindows,
      getPlatformLabel(),
      "Set your BrowserStack credentials as environment variables:",
    );

    const installStep = createStep(
      "Install required Ruby gems:",
      `\`\`\`bash
# Install Bundler if not already installed
gem install bundler

# Install Appium Ruby client library
gem install appium_lib

# For Cucumber projects, also install cucumber
${framework === "cucumberRuby" ? "gem install cucumber" : ""}

# For RSpec projects, also install rspec
${framework === "rspec" ? "gem install rspec" : ""}
\`\`\``,
    );

    const gemfileStep = createStep(
      "Create a Gemfile for dependency management:",
      `\`\`\`ruby
# Gemfile
source 'https://rubygems.org'

gem 'appium_lib'
${framework === "cucumberRuby" ? "gem 'cucumber'" : ""}
${framework === "rspec" ? "gem 'rspec'" : ""}
\`\`\`

Then run:
\`\`\`bash
bundle install
\`\`\``,
    );

    return combineInstructions(envStep, installStep, gemfileStep);
  }

  return "";
}
