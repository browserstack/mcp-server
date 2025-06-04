export const DOMAINS = {
  API: process.env.BROWSERSTACK_API_DOMAIN || "https://api.browserstack.com",
  API_CLOUD:
    process.env.BROWSERSTACK_API_CLOUD_DOMAIN || "https://api-cloud.browserstack.com",
  TEST_MANAGEMENT:
    process.env.BROWSERSTACK_TEST_MGMT_DOMAIN || "https://test-management.browserstack.com",
  API_OBSERVABILITY:
    process.env.BROWSERSTACK_API_OBSERVABILITY_DOMAIN ||
    "https://api-observability.browserstack.com",
  LIVE: process.env.BROWSERSTACK_LIVE_DOMAIN || "https://live.browserstack.com",
  WWW: process.env.BROWSERSTACK_WWW_DOMAIN || "https://www.browserstack.com",
  APP_LIVE: process.env.BROWSERSTACK_APP_LIVE_DOMAIN || "https://app-live.browserstack.com",
  API_ACCESSIBILITY:
    process.env.BROWSERSTACK_API_ACCESSIBILITY_DOMAIN ||
    "https://api-accessibility.browserstack.com",
  SCANNER: process.env.BROWSERSTACK_SCANNER_DOMAIN || "https://scanner.browserstack.com",
} as const;
