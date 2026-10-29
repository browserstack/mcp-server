import { AsyncLocalStorage } from "node:async_hooks";
import appConfig, { GrrRegion } from "../config.js";

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

/** The account's region when it is known, otherwise BROWSERSTACK_GRR_REGION. */
export function regionOf(
  account: AccountRegion | undefined,
): GrrRegion | undefined {
  if (account && account !== "unknown") return account;
  return appConfig.BROWSERSTACK_GRR_REGION;
}

/** True when telemetry must be limited to usage fields; an unknown account counts. */
export function isRestrictedRegion(
  account: AccountRegion | undefined,
): boolean {
  const region = regionOf(account);
  if (region) return region !== "us";
  return account === "unknown";
}
