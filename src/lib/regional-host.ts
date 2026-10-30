import appConfig from "../config.js";
import { SessionType } from "./constants.js";
import { currentRegionScope, GrrRegion, regionOf } from "./region-context.js";

/** Regions with their own hosts here. Other regions use the default (US) hosts. */
type RoutedRegion = "us" | "eu";

type Hosts = Record<RoutedRegion, string>;

const AUTOMATE_API: Hosts = {
  us: "https://api.browserstack.com",
  eu: "https://api-eu-only.browserstack.com",
};

const HOSTS = {
  testManagement: {
    us: "https://test-management.browserstack.com",
    eu: "https://test-management-eu.browserstack.com",
  },
  automateApi: AUTOMATE_API,
  appAutomateApi: AUTOMATE_API,
  appAutomateCloud: {
    us: "https://api-cloud.browserstack.com",
    eu: AUTOMATE_API.eu,
  },
  appAutomateHub: {
    us: "hub.browserstack.com",
    eu: "hub-eu-only.browserstack.com",
  },
  automateHubUrl: {
    us: "https://hub.browserstack.com",
    eu: "https://hub-eu-only.browserstack.com",
  },
  appAutomateHubUrl: {
    us: "https://hub-cloud.browserstack.com",
    eu: "https://hub-eu-only.browserstack.com",
  },
  accessibilityApi: {
    us: "https://api-accessibility.browserstack.com",
    eu: "https://api-accessibility-eu.browserstack.com",
  },
  accessibilityDashboard: {
    us: "https://accessibility.browserstack.com",
    eu: "https://accessibility-eu.browserstack.com",
  },
  appAccessibilityApi: {
    us: "https://api-app-accessibility.browserstack.com",
    eu: "https://api-app-accessibility-eu.browserstack.com",
  },
  appAccessibilityDashboard: {
    us: "https://app-accessibility.browserstack.com",
    eu: "https://app-accessibility-eu.browserstack.com",
  },
  observabilityApi: {
    us: "https://api-observability.browserstack.com",
    eu: "https://api-observability-eu.browserstack.com",
  },
  automationApi: {
    us: "https://api-automation.browserstack.com",
    eu: "https://api-automation-eu.browserstack.com",
  },
} as const satisfies Record<string, Hosts>;

export type RegionalHostKind = keyof typeof HOSTS;

export function hostFor(kind: RegionalHostKind, region: RoutedRegion): string {
  return HOSTS[kind][region];
}

/** True when `hostname` is `kind`'s host in any region, so a link from any region resolves. */
export function isRegionalHostname(
  kind: RegionalHostKind,
  hostname: string,
): boolean {
  return Object.values(HOSTS[kind]).some(
    (host) => new URL(host).hostname === hostname,
  );
}

/** This call's account region; undefined outside a call or when the lookup failed. */
export function currentRegion(): GrrRegion | undefined {
  return regionOf(currentRegionScope()?.account);
}

export const REGION_UNKNOWN_MESSAGE =
  "Could not confirm your BrowserStack account's region. Please retry in a few seconds.";

/** Thrown instead of guessing a host when the account's region could not be looked up. */
export class AccountRegionUnknownError extends Error {
  constructor() {
    super(REGION_UNKNOWN_MESSAGE);
    this.name = "AccountRegionUnknownError";
  }
}

/** Throws when this call's account region could not be looked up. */
export function assertRegionKnown(): void {
  if (currentRegionScope()?.account === "unknown") {
    throw new AccountRegionUnknownError();
  }
}

/** The region whose hosts this call uses; throws when the region is unknown. */
export function routedRegion(): RoutedRegion {
  assertRegionKnown();
  return currentRegion() === "eu" ? "eu" : "us";
}

/** True when this call goes to regional hosts rather than the defaults. */
export function usesRegionalHosts(): boolean {
  return currentRegion() === "eu";
}

/** REST host for a session's product: App Automate or Automate. */
export function sessionApiHost(sessionType: string): string {
  return getRegionalHost(
    sessionType === SessionType.AppAutomate ? "appAutomateApi" : "automateApi",
  );
}

/**
 * An env var's host when it points somewhere other than `kind`'s US default, without a
 * trailing slash; undefined when it is unset or names the default in any spelling.
 */
export function hostOverride(
  url: string | undefined,
  kind: RegionalHostKind,
): string | undefined {
  const value = url?.trim().replace(/\/+$/, "");
  if (!value) return undefined;
  try {
    if (new URL(value).origin === new URL(HOSTS[kind].us).origin) {
      return undefined;
    }
  } catch {
    // Not a URL: pass it through as given.
  }
  return value;
}

export function getRegionalHost(kind: RegionalHostKind): string {
  if (kind === "automationApi") {
    const override = hostOverride(
      appConfig.BROWSERSTACK_AUTOMATION_BASE_URL,
      kind,
    );
    if (override) return override;
  }
  return hostFor(kind, routedRegion());
}
