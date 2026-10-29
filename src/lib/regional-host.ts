import appConfig from "../config.js";
import { SessionType } from "./constants.js";
import { currentRegionScope, GrrRegion, regionOf } from "./region-context.js";

type Hosts = Record<GrrRegion, string>;

const AUTOMATE_API: Hosts = {
  us: "https://api.browserstack.com",
  eu: "https://api-eu-only.browserstack.com",
  in: "https://api-aps-only.browserstack.com",
};

const HOSTS = {
  testManagement: {
    us: "https://test-management.browserstack.com",
    eu: "https://test-management-eu.browserstack.com",
    in: "https://test-management-in.browserstack.com",
  },
  automateApi: AUTOMATE_API,
  appAutomateApi: AUTOMATE_API,
  appAutomateCloud: {
    us: "https://api-cloud.browserstack.com",
    eu: AUTOMATE_API.eu,
    in: AUTOMATE_API.in,
  },
  appAutomateHub: {
    us: "hub.browserstack.com",
    eu: "hub-eu-only.browserstack.com",
    in: "hub-aps-only.browserstack.com",
  },
  automateHubUrl: {
    us: "https://hub.browserstack.com",
    eu: "https://hub-eu-only.browserstack.com",
    in: "https://hub-aps-only.browserstack.com",
  },
  appAutomateHubUrl: {
    us: "https://hub-cloud.browserstack.com",
    eu: "https://hub-eu-only.browserstack.com",
    in: "https://hub-aps-only.browserstack.com",
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
  appAccessibilityApi: {
    us: "https://api-app-accessibility.browserstack.com",
    eu: "https://api-app-accessibility-eu.browserstack.com",
    in: "https://api-app-accessibility-in.browserstack.com",
  },
  appAccessibilityDashboard: {
    us: "https://app-accessibility.browserstack.com",
    eu: "https://app-accessibility-eu.browserstack.com",
    in: "https://app-accessibility-in.browserstack.com",
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

export function hostFor(kind: RegionalHostKind, region: GrrRegion): string {
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

export function isNonUsRegion(): boolean {
  const region = currentRegion();
  return region !== undefined && region !== "us";
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
  return hostFor(kind, currentRegion() ?? "us");
}
