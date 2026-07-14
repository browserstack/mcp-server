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

/**
 * Default o11y base URL for the `tfaRcaTurn` collaborative-RCA tool. Same value
 * for every user served by the process; overridable at startup via
 * `O11Y_TFA_RCA_BASE_URL` so the tool can target the o11y env where a build's
 * representatives actually live. Per-process config, never a per-call arg.
 */
const DEFAULT_O11Y_TFA_RCA_BASE_URL =
  "https://api-observability-rengg-tfa.bsstag.com";

/**
 * Base URL for the Automate test-runs API (`/ext/v1/builds/{id}/testRuns`) that
 * `listTestIds` calls. Overridable at startup via `BROWSERSTACK_AUTOMATION_BASE_URL`
 * so the tool can target a non-prod env (e.g. rengg-tfa staging) where a build
 * actually lives, instead of the prod default. Per-process config, never a
 * per-call arg.
 */
const DEFAULT_BROWSERSTACK_AUTOMATION_BASE_URL =
  "https://api-automation.browserstack.com";

/**
 * Base URL of the Test Observability (TRA) web UI used to build the
 * human-facing "view the full report" links returned by the RCA tools.
 * Same value for every user served by the process; overridable at startup via
 * `BROWSERSTACK_O11Y_UI_BASE_URL` (e.g. to point at a staging UI). Per-process
 * config, never a per-call arg.
 */
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
