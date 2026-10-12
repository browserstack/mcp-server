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

## ⚡️ One Click MCP Setup  

Click on the buttons below to install MCP in your respective IDE:

<a href="http://mcp.browserstack.com/one-click-setup?client=vscode"><img src="assets/one-click-vs-code.png" alt="Install in VS Code" width="160" height="80"></a>&nbsp;&nbsp;&nbsp;<a href="http://mcp.browserstack.com/one-click-setup?client=cursor"><img src="assets/one-click-cursor.png" alt="Install in Cursor" width="150" height="70"></a>

> **Note:** The hosted Remote MCP server (`mcp.browserstack.com`) is now fully stateless over Streamable HTTP — any Streamable-HTTP client (Claude, Cursor, VS Code, ChatGPT) connects with no configuration change.

#### Prerequisites
- A BrowserStack account. [Sign up](https://www.browserstack.com/users/sign_up) if you don't have one; open-source projects can get a [free plan](https://www.browserstack.com/open-source).
- Your `username` and `access_key` from [Account Settings](https://www.browserstack.com/accounts/profile/details).

For manual setup in any MCP client, see [Install the MCP server locally](https://www.browserstack.com/docs/browserstack-mcp-server/get-started/local-mcp) or [Set up the remote MCP server](https://www.browserstack.com/docs/browserstack-mcp-server/get-started/remote-mcp-server).

#### Note : Ensure you are using Node version >= `20.9` 
- Check your node version using `node --version`. Recommended version: `v22.15.0` (LTS)
- To Upgrade Node :
- 1. On macOS `(Homebrew) - brew update && brew upgrade node  or if using (nvm) - nvm install 22.15.0 && nvm use 22.15.0 && nvm alias default 22.15.0`
- 2. On Windows `(nvm-windows) : nvm install 22.15.0 && nvm use 22.15.0`
- 👉 <a href="https://nodejs.org/en/download" target="_blank">Or directly download the Node.js LTS Installer</a>

.
        
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

> **Note:** When fetching Root Cause Analysis (RCA) for a test, the server returns the suggested fix as a proposal only. It never applies code changes automatically — your assistant must present the suggestion and wait for your explicit approval before editing any files.

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

### ⚡ Load Testing

Run and analyse load tests at scale without leaving your IDE or chat — find tests, start and stop runs, read reports and AI Insights, compare runs, and check your VU-hours. Works with API (JMeter, k6, Gatling, Locust), browser (Playwright, Selenium, WebdriverIO, Nightwatch) and hybrid load tests on BrowserStack's [Load Testing](https://www.browserstack.com/load-testing). These go through the [core tools](#-core-tools).

```bash
# Find a test
"find my load test called checkout-api"

# Run it
"run checkout-api for 5 minutes with 100 virtual users"

# Check on it
"is my checkout-api run finished yet?"

# Read the results
"what was the p95 response time and error rate of the last checkout-api run?"

# Compare two runs of the same test
"did the latest checkout-api run regress compared with the previous one?"

# Check quota before a big run
"how many VU-hours do I have left, and what would a 30-minute run with 500 VUs cost?"
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


## 🧭 Core Tools

Five core tools let your AI assistant find and run any BrowserStack workflow. Your assistant loads every tool an MCP server exposes at the start of each session, so one tool per workflow would fill your context window and slow down the whole session. Instead, your assistant uses the core tools to search a catalog of BrowserStack tools in plain language and run the one it needs.

| Tool | Description |
|------|-------------|
| `listProducts` | Lists the BrowserStack products in the catalog, with a short summary of what each product covers |
| `describeEntity` | Explains one entity: its aliases, ID format, parent and related entities, and the capabilities that act on it |
| `searchCapability` | Finds the capabilities that match a plain-language request, with everything your assistant needs to run each one |
| `describeCapability` | Returns the full details of one capability, such as its parameters, request body and response format |
| `invokeCapability` | Runs one capability and returns the product's response unchanged. Changes to data need your approval |

See [Core tools](https://www.browserstack.com/docs/browserstack-mcp-server/tools/core-tools) for parameters and how changes to data are approved.

**All tools** — See [docs/TOOLS.md](docs/TOOLS.md) for every tool organised by product, or [BrowserStack MCP tools & workflows](https://www.browserstack.com/docs/browserstack-mcp-server/tools) for product workflows.

> **File & app uploads:** tools that upload a local file/app (`uploadProductRequirementFile`, `takeAppScreenshot`, `runAppTestsOnBrowserStack`, `runAppLiveSession`) require the `MCP_UPLOAD_BASE_DIR` env var set to a directory containing those files; uploads are restricted to it.

##  🚀 Remote MCP Server

Remote MCP comes with all the functionalities of an MCP server without the hassles of complex setup or local installation.

### Key benefits:

- ✅ Works seamlessly in enterprise networks without worrying about firewalls or binaries or where local installation is not allowed.

- ✅ Secure OAuth integration – no password sharing or manual credential handling.

### Limitations:

- ❌ No Local Testing support (cannot test apps behind VPNs, firewalls, or localhost). If you have to do Local Testing, you would have to use a BrowserStack Local MCP server.
- ❌ Latency can be slightly higher, but nothing considerable — you generally won’t notice it in normal use.

### Installation

See [Set up the remote MCP server](https://www.browserstack.com/docs/browserstack-mcp-server/get-started/remote-mcp-server).

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
