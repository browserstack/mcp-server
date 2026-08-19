/**
 * Load the index artifact and expose the two lookups the tools need.
 */

import { readFileSync } from "node:fs";
import { Capability, RegistryIndex, SUPPORTED_SCHEMA_VERSION } from "./types.js";

export class IndexError extends Error {}

/** Thrown to the caller as a tool error, so the wording is caller-facing. */
export class InvocationError extends Error {}

export function endpointKey(method: string, path: string): string {
  return `${(method || "").trim().toUpperCase()} ${(path || "").trim()}`;
}

export class CapabilityRegistry {
  readonly index: RegistryIndex;
  /** product -> "METHOD /path" -> capability */
  private readonly byEndpoint = new Map<string, Map<string, Capability>>();

  constructor(index: RegistryIndex) {
    if (index?.schema_version !== SUPPORTED_SCHEMA_VERSION) {
      // Refuse rather than best-effort read: a shape change the generator announced is
      // exactly the case where guessing produces silently wrong tool output.
      throw new IndexError(
        `unsupported index schema_version ${index?.schema_version}; this build reads ` +
          `${SUPPORTED_SCHEMA_VERSION}. Rebuild the artifact or update the server.`,
      );
    }
    if (!index.products || Object.keys(index.products).length === 0) {
      throw new IndexError("index contains no products");
    }
    this.index = index;
    for (const [product, bundle] of Object.entries(index.products)) {
      const lookup = new Map<string, Capability>();
      for (const capability of bundle.capabilities) {
        lookup.set(endpointKey(capability.method, capability.path), capability);
      }
      this.byEndpoint.set(product, lookup);
    }
  }

  static fromFile(file: string): CapabilityRegistry {
    return new CapabilityRegistry(JSON.parse(readFileSync(file, "utf8")) as RegistryIndex);
  }

  get buildId(): string {
    return this.index.build_id;
  }

  productNames(): string[] {
    return Object.keys(this.index.products).sort();
  }

  /**
   * Find a capability by the endpoint it exposes — the published handle.
   *
   * The endpoint is what searchCapability returns, so it is the only thing a caller can
   * hold. `unknown_endpoint` is a defined outcome rather than a generic failure: a caller
   * working from stale search output needs to know to search again, not to retry.
   */
  byEndpointLookup(method: string, path: string, product?: string): {
    product: string;
    capability: Capability;
  } {
    const key = endpointKey(method, path);
    const matches: { product: string; capability: Capability }[] = [];
    for (const [name, lookup] of this.byEndpoint) {
      if (product && name !== product) continue;
      const capability = lookup.get(key);
      if (capability) matches.push({ product: name, capability });
    }
    if (matches.length === 0) {
      throw new InvocationError(
        `unknown_endpoint: ${key}. Search again — send \`method\` and \`path\` exactly as ` +
          `searchCapability returned them, placeholders included.`,
      );
    }
    if (matches.length > 1 && !product) {
      const owners = matches.map((m) => m.product).sort().join(", ");
      throw new InvocationError(
        `${key} exists in several products (${owners}); pass product`,
      );
    }
    return matches[0];
  }
}
