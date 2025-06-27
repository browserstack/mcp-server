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
 * USE_OWN_LOCAL_BINARY_PROCESS:
 *   If true, the system will not start a new local binary process, but will use the user's own process.
 */
export class Config {
  constructor(
    public readonly browserstackUsername: string,
    public readonly browserstackAccessKey: string,
    public readonly DEV_MODE: boolean,
    public readonly browserstackLocalOptions: Record<string, any>,
    public readonly USE_OWN_LOCAL_BINARY_PROCESS: boolean,
  ) {}
}

const config = new Config(
  process.env.BROWSERSTACK_USERNAME!,
  process.env.BROWSERSTACK_ACCESS_KEY!,
  process.env.DEV_MODE === "true",
  browserstackLocalOptions,
  process.env.USE_OWN_LOCAL_BINARY_PROCESS === "true",
);

export default config;
