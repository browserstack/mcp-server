import { AsyncLocalStorage } from "node:async_hooks";

export const GRR_REGIONS = ["us", "eu", "in"] as const;
export type GrrRegion = (typeof GRR_REGIONS)[number];

/** The account's region from BrowserStack auth, or "unknown" when the lookup failed. */
export type AccountRegion = GrrRegion | "unknown";

interface RegionScope {
  account: AccountRegion | undefined;
}

// Per call, not per process: concurrent calls for different accounts each see their own.
const scope = new AsyncLocalStorage<RegionScope>();

export function withAccountRegion<T>(
  account: AccountRegion | undefined,
  fn: () => T,
): T {
  return scope.run({ account }, fn);
}

/** The scope set for the current call, or undefined outside one. */
export function currentRegionScope(): RegionScope | undefined {
  return scope.getStore();
}

/** The account's region, or undefined when it is not known. */
export function regionOf(
  account: AccountRegion | undefined,
): GrrRegion | undefined {
  return account && account !== "unknown" ? account : undefined;
}

/** True for an EU or IN account: no telemetry is sent for it. */
export function isTelemetryOff(account: AccountRegion | undefined): boolean {
  const region = regionOf(account);
  return region !== undefined && region !== "us";
}

/** True when telemetry must be limited to usage fields; an unknown account counts. */
export function isRestrictedRegion(
  account: AccountRegion | undefined,
): boolean {
  return account === "unknown" || (account !== undefined && account !== "us");
}
