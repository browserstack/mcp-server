/**
 * Where the index comes from, and where each product lives.
 *
 * `base_url` is deliberately NOT in the artifact — it is environment-specific, so the same
 * artifact ships everywhere and the host is resolved here instead.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const PROD_HOSTS: Record<string, string> = {
  tm: "https://test-management.browserstack.com",
  a11y: "https://accessibility.browserstack.com",
  tra: "https://test-reporting.browserstack.com",
};

/** Per-product override, e.g. CAPABILITY_REGISTRY_BASE_URL_TM=https://…-preprod.bsstag.com */
export function baseUrlFor(product: string): string {
  const override = process.env[`CAPABILITY_REGISTRY_BASE_URL_${product.toUpperCase()}`];
  return (override || PROD_HOSTS[product] || "").replace(/\/$/, "");
}

/**
 * Locate the artifact. Explicit env wins; otherwise look beside the compiled module and
 * then at the package root, because `tsc` compiles TS and does not copy JSON into `dist`.
 */
export function indexPath(): string | undefined {
  const configured = process.env.CAPABILITY_REGISTRY_INDEX;
  if (configured) return existsSync(configured) ? resolve(configured) : undefined;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "registry-index.json"),
    join(here, "..", "..", "..", "capability-index.json"),      // dist/ -> package root
    join(here, "..", "..", "..", "..", "capability-index.json"), // src/  -> package root
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Off by default is wrong for a shipped feature, but a kill switch is not. */
export function isEnabled(): boolean {
  return (process.env.CAPABILITY_REGISTRY_DISABLED || "").toLowerCase() !== "true";
}
