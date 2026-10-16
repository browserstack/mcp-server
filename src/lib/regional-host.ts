import { apiClient } from "./apiClient.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "./types.js";
import { getBrowserStackAuth } from "./get-auth.js";
import appConfig from "../config.js";

/**
 * Geo Region Restriction (GRR) routing for the hand-written tools.
 *
 * A GRR group's data lives in one region, and that region's hosts are the only ones that
 * serve it: the others reject its credentials. So, like `tm-base-url.ts`, we PROBE each
 * product's regional hosts in order (US first) and keep the first that answers. A
 * non-GRR account is served by the US host and never reaches the regional ones.
 *
 * The probe is per product, not per account, because GRR is enabled per product.
 *
 * If every region refuses (bad credentials, no access to the product, a network failure),
 * we fall back to the US host, which is what the tools called before this existed, so the
 * product's own error reaches the user. The fallback is not cached, so the next call
 * probes again.
 */

export type GrrRegion = "us" | "eu" | "in";

const REGIONS: readonly GrrRegion[] = ["us", "eu", "in"];

type Hosts = Record<GrrRegion, string>;

const AUTOMATE_API: Hosts = {
  us: "https://api.browserstack.com",
  eu: "https://api-eu-only.browserstack.com",
  in: "https://api-aps-only.browserstack.com",
};

/**
 * Every host the tools call, by region. Automate/App Automate use the `api-<region>-only`
 * domains from the internal GRR documentation; the rest were confirmed by DNS and by the
 * regional host rejecting a US account.
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

type RegionalProduct =
  | "automate"
  | "app-automate"
  | "accessibility"
  | "observability"
  | "automation";

/** The product whose region decides each host, and the host + read used to probe it. */
const PRODUCT_OF: Record<RegionalHostKind, RegionalProduct> = {
  automateApi: "automate",
  appAutomateApi: "app-automate",
  appAutomateUpload: "app-automate",
  appAutomateHub: "app-automate",
  accessibilityApi: "accessibility",
  accessibilityDashboard: "accessibility",
  observabilityApi: "observability",
  automationApi: "automation",
};

const PROBES: Record<RegionalProduct, { hosts: Hosts; path: string }> = {
  automate: { hosts: AUTOMATE_API, path: "/automate/plan.json" },
  "app-automate": { hosts: AUTOMATE_API, path: "/app-automate/plan.json" },
  accessibility: {
    hosts: HOSTS.accessibilityApi,
    path: "/api/website-scanner/v1/scans",
  },
  observability: { hosts: HOSTS.observabilityApi, path: "/ext/v1/projects" },
  automation: { hosts: HOSTS.automationApi, path: "/ext/v1/projects" },
};

// Stdio mode only: one user per process, so a region found once holds for the session.
// Remote mode re-probes on every call — a process-wide cache there would serve the first
// user's region to everyone (rules/multi-tenant-safety.md).
const cachedRegion = new Map<RegionalProduct, GrrRegion>();

/** Exposed for tests. */
export function clearRegionCache(): void {
  cachedRegion.clear();
}

async function probeRegion(
  product: RegionalProduct,
  config: BrowserStackConfig,
): Promise<GrrRegion> {
  if (!appConfig.REMOTE_MCP) {
    const cached = cachedRegion.get(product);
    if (cached) return cached;
  }

  const { hosts, path } = PROBES[product];
  const authHeader =
    "Basic " + Buffer.from(getBrowserStackAuth(config)).toString("base64");
  const failures: string[] = [];

  for (const region of REGIONS) {
    const url = `${hosts[region]}${path}`;
    try {
      const res = await apiClient.get({
        url,
        headers: { Authorization: authHeader },
        raise_error: false,
      });
      if (res.ok) {
        if (!appConfig.REMOTE_MCP) cachedRegion.set(product, region);
        logger.info(`Selected ${product} region: ${region}`);
        return region;
      }
      failures.push(`${region}: HTTP ${res.status}`);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? (err as Error)?.message;
      failures.push(`${region}: ${code}`);
    }
  }

  logger.warn(
    `No region accepted this account for ${product}; falling back to the US host. ` +
      `Details: ${failures.join("; ")}`,
  );
  return "us";
}

/** The host for `kind` in a given region. Pure; exposed for tests. */
export function hostFor(kind: RegionalHostKind, region: GrrRegion): string {
  return HOSTS[kind][region];
}

/** The host to use for `kind`, in the region that serves this account. */
export async function getRegionalHost(
  kind: RegionalHostKind,
  config: BrowserStackConfig,
): Promise<string> {
  // An explicit non-prod target (BROWSERSTACK_AUTOMATION_BASE_URL) is used as given.
  if (
    kind === "automationApi" &&
    appConfig.BROWSERSTACK_AUTOMATION_BASE_URL !== HOSTS.automationApi.us
  ) {
    return appConfig.BROWSERSTACK_AUTOMATION_BASE_URL;
  }
  return hostFor(kind, await probeRegion(PRODUCT_OF[kind], config));
}
