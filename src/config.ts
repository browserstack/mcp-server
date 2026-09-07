// List of supported BrowserStack Local option names (as per SDK)
const BROWSERSTACK_LOCAL_OPTION_KEYS = [
  "proxyHost",
  "proxyPort",
  "proxyUser",
  "proxyPass",
  "useCaCertificate",
  "localProxyHost",
  "localProxyPort",
  "localProxyUser",
  "localProxyPass",
  "pacFile",
  "force",
  "forceLocal",
  "onlyAutomate",
  "verbose",
  "logFile",
  "binarypath",
  "f",
  "excludeHosts",
];

// Build browserstackLocalOptions from individual env vars
const browserstackLocalOptions: Record<string, any> = {};
for (const key of BROWSERSTACK_LOCAL_OPTION_KEYS) {
  // Env var name: BROWSERSTACK_LOCAL_OPTION_<UPPERCASE_KEY>
  const envVar = process.env[`BROWSERSTACK_LOCAL_OPTION_${key.toUpperCase()}`];
  if (envVar !== undefined) {
    browserstackLocalOptions[key] = envVar;
  }
}

// Overridable via O11Y_TFA_RCA_BASE_URL to target a staging tenant.
const DEFAULT_O11Y_TFA_RCA_BASE_URL = "https://api-automation.browserstack.com";

// Overridable via BROWSERSTACK_AUTOMATION_BASE_URL to target a non-prod env.
const DEFAULT_BROWSERSTACK_AUTOMATION_BASE_URL =
  "https://api-automation.browserstack.com";

// Overridable via BROWSERSTACK_O11Y_UI_BASE_URL to point at a staging UI.
const DEFAULT_BROWSERSTACK_O11Y_UI_BASE_URL =
  "https://automation.browserstack.com";

/**
 * USE_OWN_LOCAL_BINARY_PROCESS:
 *   If true, the system will not start a new local binary process, but will use the user's own process.
 */
export class Config {
  constructor(
    public readonly DEV_MODE: boolean,
    public readonly browserstackLocalOptions: Record<string, any>,
    public readonly USE_OWN_LOCAL_BINARY_PROCESS: boolean,
    public readonly REMOTE_MCP: boolean,
    public readonly UPLOAD_BASE_DIR: string | undefined,
    public readonly O11Y_TFA_RCA_BASE_URL: string,
    public readonly BROWSERSTACK_AUTOMATION_BASE_URL: string,
    public readonly BROWSERSTACK_O11Y_UI_BASE_URL: string,
  ) {}
}

const config = new Config(
  process.env.DEV_MODE === "true",
  browserstackLocalOptions,
  process.env.USE_OWN_LOCAL_BINARY_PROCESS === "true",
  process.env.REMOTE_MCP === "true",
  process.env.MCP_UPLOAD_BASE_DIR && process.env.MCP_UPLOAD_BASE_DIR.length > 0
    ? process.env.MCP_UPLOAD_BASE_DIR
    : undefined,
  process.env.O11Y_TFA_RCA_BASE_URL &&
    process.env.O11Y_TFA_RCA_BASE_URL.length > 0
    ? process.env.O11Y_TFA_RCA_BASE_URL
    : DEFAULT_O11Y_TFA_RCA_BASE_URL,
  process.env.BROWSERSTACK_AUTOMATION_BASE_URL &&
    process.env.BROWSERSTACK_AUTOMATION_BASE_URL.length > 0
    ? process.env.BROWSERSTACK_AUTOMATION_BASE_URL
    : DEFAULT_BROWSERSTACK_AUTOMATION_BASE_URL,
  process.env.BROWSERSTACK_O11Y_UI_BASE_URL &&
    process.env.BROWSERSTACK_O11Y_UI_BASE_URL.length > 0
    ? process.env.BROWSERSTACK_O11Y_UI_BASE_URL
    : DEFAULT_BROWSERSTACK_O11Y_UI_BASE_URL,
);

export default config;
