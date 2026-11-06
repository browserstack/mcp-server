import { BrowserStackConfig } from "../../lib/types.js";
import { GroupedArguments } from "./bind.js";
import { indexPaths, isEnabled, resolveBaseUrl } from "./config.js";
import { fetchTransport } from "./egress.js";
import { CapabilityRegistry } from "./index-loader.js";
import { invoke, InvokeResult } from "./resolve.js";

/** The capability registry is switched off or its index is missing. */
export class CapabilityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityUnavailableError";
  }
}

// The index is static product metadata shipped with the package, not user data, so
// one copy per process is safe for the multi-tenant server.
let loaded: CapabilityRegistry | undefined;

function registry(): CapabilityRegistry {
  if (!isEnabled()) {
    throw new CapabilityUnavailableError(
      "the capability registry is disabled on this server",
    );
  }
  if (!loaded) {
    const files = indexPaths();
    if (files.length === 0) {
      throw new CapabilityUnavailableError(
        "the capability index is not installed",
      );
    }
    loaded = CapabilityRegistry.fromFiles(files);
  }
  return loaded;
}

/**
 * Call one named capability from inside a tool, through the same binding, auth and
 * host resolution as invokeCapability, so its endpoint stays defined in the index only.
 */
export async function callCapability(
  product: string,
  name: string,
  args: GroupedArguments,
  config: BrowserStackConfig,
): Promise<InvokeResult> {
  const reg = registry();
  const { capability } = reg.byNameLookup(name, product);
  const productIndex = reg.index.products[product];
  return invoke(
    capability,
    args,
    await resolveBaseUrl(
      product,
      config,
      productIndex,
      undefined,
      capability.host,
    ),
    {
      username: config["browserstack-username"],
      accessKey: config["browserstack-access-key"],
    },
    fetchTransport(),
    productIndex?.auth,
    product,
  );
}

/** Test hook: forget the loaded index. */
export function resetCapabilityRegistryForTests(): void {
  loaded = undefined;
}
