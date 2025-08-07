# BrowserStack MCP Server

<div align="center">
<img src="assets/browserstack-logo.png" alt="BrowserStack Logo" height="100"> <img src="assets/mcp-logo.png" alt="MCP Server Logo" width="100">
</div>


<div align="center">
<a href="https://www.npmjs.com/package/@browserstack/mcp-server">
<img alt="NPM Version" src="https://img.shields.io/npm/v/%40browserstack%2Fmcp-server">
</a>

</div>

<p align="center">Comprehensive Test Platform</p>

<div align="center">
<a href="https://glama.ai/mcp/servers/@browserstack/mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@browserstack/mcp-server/badge" alt="BrowserStack server MCP server" />
</a>
</div>

<div>
    <a href="https://www.youtube.com/watch?v=sLA7K9v7qZc&list=PL1vH6dHT3H7oy8w9CY6L_nxGxCc89VXMX&index=5">
      <img src="assets/thumbnail.webp">
    </a>
  </div>

  
Manage test cases, execute manual or automated tests, debug issues, and even fix code—directly within tools like Cursor, Claude, or any MCP-enabled client, using plain English.
#### Test from anywhere:
Easily connect the BrowserStack Test Platform to your favourite AI tools, such as IDEs, LLMs, or agentic workflows.
#### Test with natural language:
Manage, execute, debug tests, and even fix code using plain English prompts.
#### Reduced context switching:
Stay in flow—keep all project context in one place and trigger actions directly from your IDE or LLM.

## 💡 Usage Examples

### 📱 Manual App Testing

Test mobile apps on real devices across the latest OS versions. Reproduce bugs and debug crashes without setup hassles.
Below are some sample prompts to use your mobile apps on BrowserStack's extensive cloud of real devices
```bash
# Open app on specific device
"open my app on a iPhone 15 Pro Max"

# Debug app crashes
"My app crashed on Android 14 device, can you help me debug?"
```

- Unlike emulators, test your app's real-world performance on actual devices. With advanced [App-Profiling features](https://www.browserstack.com/docs/app-live/app-performance-testing), you can debug crashes and performance issues in real-time.
- Access all major devices and OS versions from our [device grid](https://www.browserstack.com/list-of-browsers-and-platforms/app_live), We have strict SLAs to provision our global datacenters with newly released devices on [launch day](https://www.browserstack.com/blog/browserstack-launches-iphone-15-on-day-0-behind-the-scenes/).

### 🌐 Manual Web Testing

Similar to the app testing, you can use the following prompts to test your **websites** on BrowserStack's extensive cloud of real browsers and devices. Don't have Edge browser installed on your machine ? We've got you covered!

```bash
# Test your websites
"open my website hosted on localhost:3001 on Edge"
"open browserstack.com on latest version of Chrome"
```

- Test websites across different browsers and devices. We support [every major browser](https://www.browserstack.com/list-of-browsers-and-platforms/live) across every major OS.
- Seamlessly test websites hosted locally on your machine, no need to deploy to a remote server!

### 🧪 Automated Testing (Playwright, Selenium, A11y and more..)

Auto-analyze, diagnose, and even fix broken test scripts right in your IDE or LLM. Instantly fetch logs, identify root causes, and apply context-aware fixes. No more debugging loops.
Below are few example prompts to run/debug/fix your automated tests on BrowserStack's [Test Platform](https://www.browserstack.com/test-platform).

```bash
#Port test suite to BrowserStack
"Setup test suite to run on BrowserStack infra"

#Run tests on BrowserStack
“Run my tests on BrowserStack”

#AI powered debugging of test failures
"My App Automate tests have failed, can you help me fix the new failures?"

```
- Fix test failures reported by your CI/CD pipeline by utilising our industry leading [Test Observability](https://www.browserstack.com/docs/test-observability) features. Find more info [here](https://www.browserstack.com/docs/test-observability/features/smart-tags).
- Run tests written in Jest, Playwright, Selenium, and more on BrowserStack's [Test Platform](https://www.browserstack.com/test-platform)

### 🌐 Accessibility

Catch accessibility issues early with automated, local a11y scans. Get one-click, AI-suggested fixes. No docs hunting, no CI surprises. Ensure WCAG and ADA compliance with our Accessibility Testing tool

```bash
#Scan accessibility issues while development
"Scan & help fix accessibility issues for my website running locally on localhost:3000"

#Scan accessibility issues on production site
“Run accessibility scan & identify issues on my website - www.bstackdemo.com”

```

### 📋 Test Management 

Create and manage test cases, create test plans and trigger test runs using natural language. Below are a few example prompts to utilise capabilities of BrowserStack's [Test Management](https://www.browserstack.com/test-management) with MCP server.

```bash
# Create project & folder structure
"create new Test management project named My Demo Project with two sub folders - Login & Checkout"

# Add test cases
"add invalid login test case in Test Management project named My Demo Project"

# List added test cases 
"list high priority Login test cases from Test Management project - My Demo Project"

# Create test run
"create a test run for Login tests from Test Management project - My Demo Project"

# Update test results
"update test results as passed for Login tests test run from My Demo Project"
```

### 🧪 Access BrowserStack AI agents 

Generate test cases from PRDs, convert manual tests to low-code automation, and auto-heal flaky scripts powered by BrowserStack’s AI agents, seamlessly integrated into your workflow.  Below are few example prompts to access Browserstack AI agents

```bash
#Test case generator agent
"With Browserstack AI, create relevant test cases for my PRD located at /usr/file/location"


#Low code authoring agent
“With Browserstack AI, automate my manual test case X, added in Test Management”


#Self healing agent
“Help fix flaky tests in my test script with Browserstack AI self healing”
```


## 🛠️ Installation

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](http://mcp.browserstack.com/one-click-setup?client=vscode) &nbsp; [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-24bfa5?style=flat-square&color=000000&logo=visualstudiocode&logoColor=white)](http://mcp.browserstack.com/one-click-setup?client=cursor)

1. **Create a BrowserStack Account**

   - Sign up for [BrowserStack](https://www.browserstack.com/users/sign_up) if you don't have an account already.

   - ℹ️ If you have an open-source project, we'll be able to provide you with a [free plan](https://www.browserstack.com/open-source).
   

   - Once you have an account (and purchased appropriate plan), note down your `username` and `access_key` from [Account Settings](https://www.browserstack.com/accounts/profile/details).

2. Ensure you are using Node version >= `18.0`. Check your node version using `node --version`. Recommended version: `v22.15.0` (LTS)
3. **Install the MCP Server**

   - VSCode (Copilot - Agent Mode): `.vscode/mcp.json`:

   ```json
   {
     "servers": {
       "browserstack": {
         "command": "npx",
         "args": ["-y", "@browserstack/mcp-server@latest"],
         "env": {
           "BROWSERSTACK_USERNAME": "<username>",
           "BROWSERSTACK_ACCESS_KEY": "<access_key>"
         }
       }
     }
   }
   ```

   - In VSCode, make sure to click on `Start` button in the MCP Server to start the server.
     ![Start MCP Server](assets/vscode_install.png)

   * For Cursor: `.cursor/mcp.json`:

   ```json
   {
     "mcpServers": {
       "browserstack": {
         "command": "npx",
         "args": ["-y", "@browserstack/mcp-server@latest"],
         "env": {
           "BROWSERSTACK_USERNAME": "<username>",
           "BROWSERSTACK_ACCESS_KEY": "<access_key>"
         }
       }
     }
   }
   ```

   - Claude Desktop: `~/claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "browserstack": {
         "command": "npx",
         "args": ["-y", "@browserstack/mcp-server@latest"],
         "env": {
           "BROWSERSTACK_USERNAME": "<username>",
           "BROWSERSTACK_ACCESS_KEY": "<access_key>"
         }
       }
     }
   }
   ```
   - Cline
     
Click the “MCP Servers” icon in the navigation bar
Select the “Installed” tab. Click the “Configure MCP Servers” button at the bottom of the pane.

   ```json
   {
     "mcpServers": {
       "browserstack": {
         "command": "npx",
         "args": ["-y", "@browserstack/mcp-server@latest"],
         "env": {
           "BROWSERSTACK_USERNAME": "<username>",
           "BROWSERSTACK_ACCESS_KEY": "<access_key>"
         }
       }
     }
   }
   ```

### Installing via Smithery

To install BrowserStack Test Platform Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@browserstack/mcp-server):

```bash
npx -y @smithery/cli install @browserstack/mcp-server --client claude
```

## 🤝 Recommended MCP Clients

- We recommend using **Github Copilot or Cursor** for automated testing + debugging use cases.
- For manual testing use cases (Live Testing), we recommend using **Claude Desktop**.

## ⚠️ Important Notes

- The BrowserStack MCP Server is under active development and currently supports a subset of the MCP spec. More features will be added soon.
- Tool invocations rely on the MCP Client which in turn relies on an LLM, hence there can be some non-deterministic behaviour that can lead to unexpected results. If you have any suggestions or feedback, please open an issue to discuss.

## 📝 Contributing

We welcome contributions! Please open an issue to discuss any changes you'd like to make.
👉 [**Click here to view our Contributing Guidelines**](https://github.com/browserstack/mcp-server/blob/main/CONTRIBUTING.md)

## 📞 Support

For support, please:

- Open an issue in our [GitHub repository](https://github.com/browserstack/mcp-server) if you face any issues related to the MCP Server.
- Contact our [support team](https://www.browserstack.com/contact) for any other queries.

## 🚀 More Features Coming Soon

Stay tuned for exciting updates! Have any suggestions? Please open an issue to discuss.
