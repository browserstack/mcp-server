import appConfig, { GrrRegion } from "../config.js";

/**
 * Geo Region Restriction (GRR) routing for the hand-written tools.
 *
 * A GRR account's data lives behind its region's hosts, and the other regions reject it.
 * The region is set per deployment with BROWSERSTACK_GRR_REGION ("us" by default, "eu",
 * "in"); unset or "us" keeps every host exactly as it was before this module existed.
 *
 * Test Management is routed separately in `tm-base-url.ts`, which honours the same flag.
 */

type Hosts = Record<GrrRegion, string>;

const AUTOMATE_API: Hosts = {
  us: "https://api.browserstack.com",
  eu: "https://api-eu-only.browserstack.com",
  in: "https://api-aps-only.browserstack.com",
};

/**
 * Every host the tools call, by region. Automate/App Automate use the `api-<region>-only`
 * and `hub-<region>-only` domains from the internal GRR documentation; the rest were
 * confirmed by DNS and by the regional host rejecting a US account.
 */
const HOSTS = {
  automateApi: AUTOMATE_API,
  appAutomateApi: AUTOMATE_API,
  appAutomateUpload: {
    us: "https://api-cloud.browserstack.com",
    eu: AUTOMATE_API.eu,
    in: AUTOMATE_API.in,
  },
  appAutomateHub: {
    us: "hub.browserstack.com",
    eu: "hub-eu-only.browserstack.com",
    in: "hub-aps-only.browserstack.com",
  },
  accessibilityApi: {
    us: "https://api-accessibility.browserstack.com",
    eu: "https://api-accessibility-eu.browserstack.com",
    in: "https://api-accessibility-in.browserstack.com",
  },
  accessibilityDashboard: {
    us: "https://accessibility.browserstack.com",
    eu: "https://accessibility-eu.browserstack.com",
    in: "https://accessibility-in.browserstack.com",
  },
  observabilityApi: {
    us: "https://api-observability.browserstack.com",
    eu: "https://api-observability-eu.browserstack.com",
    in: "https://api-observability-in.browserstack.com",
  },
  automationApi: {
    us: "https://api-automation.browserstack.com",
    eu: "https://api-automation-eu.browserstack.com",
    in: "https://api-automation-in.browserstack.com",
  },
} as const satisfies Record<string, Hosts>;

export type RegionalHostKind = keyof typeof HOSTS;

/** The host for `kind` in a given region. Pure; exposed for tests. */
export function hostFor(kind: RegionalHostKind, region: GrrRegion): string {
  return HOSTS[kind][region];
}

/** The host for `kind` in this deployment's GRR region. */
export function getRegionalHost(kind: RegionalHostKind): string {
  // An explicit non-prod target (BROWSERSTACK_AUTOMATION_BASE_URL) is used as given.
  if (
    kind === "automationApi" &&
    appConfig.BROWSERSTACK_AUTOMATION_BASE_URL &&
    appConfig.BROWSERSTACK_AUTOMATION_BASE_URL !== HOSTS.automationApi.us
  ) {
    return appConfig.BROWSERSTACK_AUTOMATION_BASE_URL;
  }
  return hostFor(kind, appConfig.BROWSERSTACK_GRR_REGION ?? "us");
}
