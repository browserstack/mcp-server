# Dynamic Product Management System

The BrowserStack MCP Server now features a dynamic product management system that allows you to enable/disable specific BrowserStack capabilities on demand. This prevents tool overload and provides a cleaner, more focused experience.

## How It Works

### Initial State

When the server starts, only two core tools are available:

- `enable_products` - Enable specific BrowserStack products
- `get_product_status` - View current product status

### Product Queue System

- **Maximum Products**: 2 products can be enabled simultaneously
- **Queue Behavior**: When you enable a 3rd product, the oldest enabled product is automatically disabled
- **Always Available**: The `enable_products` tool is always accessible

## Enabling Dynamic Products

The dynamic product management system is controlled by an environment variable. To enable this feature:

### Environment Variable Configuration

Set the following environment variable when starting the MCP server in MCP configuration file:

```bash
DYNAMIC_SERVER=true
```

### Behavior

- **When `DYNAMIC_SERVER=true`**: The dynamic product management system is enabled, allowing you to selectively enable/disable products
- **When `DYNAMIC_SERVER=false` or not set**: All products and their tools are available by default (legacy behavior)

## Available Products

### 🚀 **SDK** (`sdk`)

**Category**: Test Automation  
**Description**: Set up and run tests using BrowserStack SDK with automatic configuration  
**Tools**: `runTestsOnBrowserStack`

### 📱 **App Live Testing** (`app-live`)

**Category**: Mobile Testing  
**Description**: Test mobile apps on real devices with interactive debugging capabilities  
**Tools**: `runAppLiveSession`

### 🌐 **Browser Live Testing** (`browser-live`)

**Category**: Web Testing  
**Description**: Test web applications on real browsers and devices for cross-browser compatibility  
**Tools**: `runBrowserLiveSession`

### ♿ **Accessibility Testing** (`accessibility`)

**Category**: Quality Assurance  
**Description**: Automated accessibility scanning and reporting for WCAG compliance  
**Tools**: `startAccessibilityScan`

### 📋 **Test Management** (`test-management`)

**Category**: Test Management  
**Description**: Comprehensive test case and test run management with project organization  
**Tools**: `createProjectOrFolder`, `createTestCase`, `listTestCases`, `createTestRun`, `listTestRuns`, `updateTestRun`, `addTestResult`, `uploadProductRequirementFile`, `createTestCasesFromFile`

### 🤖 **App Automation** (`app-automation`)

**Category**: Mobile Automation  
**Description**: Automated mobile app testing with screenshot capture and visual validation  
**Tools**: `takeAppScreenshot`

### 🔍 **Failure Analysis** (`failure-logs`)

**Category**: Debugging  
**Description**: Debug test failures with comprehensive logs, network data, and crash reports  
**Tools**: `getFailureLogs`

### 🖥️ **Web Automation** (`automate`)

**Category**: Web Automation  
**Description**: Automated web testing with screenshot capture and session management  
**Tools**: `fetchAutomationScreenshots`

### 🧠 **Self-Healing Tests** (`self-heal`)

**Category**: AI/ML  
**Description**: AI-powered test maintenance with automatic selector healing for flaky tests  
**Tools**: `fetchSelfHealedSelectors`

### Typical Workflow

1. **Start Server**: Only `enable_products` and `get_product_status` are available
2. **Check Available Products**: Use `get_product_status` to see all options
3. **Enable Needed Products**: Use `enable_products` with the products you need
4. **Use Product Tools**: The enabled product tools are now available
5. **Switch Products**: Enable different products as needed (oldest will be auto-disabled)

### Configuration

The system is configured in `src/lib/product-manager.ts`:

- `MAX_ENABLED_PRODUCTS`: Maximum concurrent products (default: 2)
- `PRODUCT_CONFIGS`: Product definitions and metadata
- `BrowserStackProduct`: Enum of available products
