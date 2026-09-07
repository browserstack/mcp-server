/**
 * Load the index artifact(s) and expose the lookups the tools need.
 *
 * ONE FILE PER PRODUCT is the released contract, so loading is a merge across files. The
 * merged model keeps the products map the rest of the server already reads, which is what
 * lets searchCapability rank across products from N single-product files.
 */

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  Capability,
  ComponentRef,
  ENVELOPE_KEYS,
  ProductIndex,
  Provenance,
  RegistryIndex,
  ResponseDoc,
  SchemaNode,
  SUPPORTED_SCHEMA_VERSION,
} from "./types.js";

export class IndexError extends Error {}

/** Thrown to the caller as a tool error, so the wording is caller-facing. */
export class InvocationError extends Error {}

/** The file inside a product subdirectory, for the earlier nested layout. */
export const INDEX_FILE = "index.json";
/** The stored layout, and the name the export publishes: `<product>.capability-index.json`. */
export const FLAT_SUFFIX = ".capability-index.json";

/**
 * The product a file's LOCATION claims to describe, if its layout says so.
 *
 * `capability/tm.capability-index.json` and `capability/tm/index.json` both name their
 * product, and
 * `fromFiles` cross-checks that against the product key inside. A file in the wrong place
 * would otherwise register its product under the directory's name and answer for endpoints
 * it does not have.
 */
export function productFromPath(file: string): string | undefined {
  const base = basename(file);
  if (base.endsWith(FLAT_SUFFIX)) return base.slice(0, -FLAT_SUFFIX.length);
  if (base === INDEX_FILE) return basename(dirname(file));
  return undefined;
}

export function endpointKey(method: string, path: string): string {
  return `${(method || "").trim().toUpperCase()} ${(path || "").trim()}`;
}

export interface LoadedProduct {
  name: string;
  product: ProductIndex;
  provenance: Provenance;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read one artifact file into the product it carries.
 *
 * SHAPE DETECTION, NOT VERSION DETECTION. The released envelope and the pre-release one
 * both declare `schema_version: 1`, so the number cannot tell them apart; the `products`
 * wrapper can, and is the documented discriminator. The pre-release branch is defensive
 * only — that shape was never deployed.
 */
export function readIndexFile(raw: unknown, source = "index"): LoadedProduct {
  if (!isPlainObject(raw)) {
    throw new IndexError(`${source}: expected a JSON object`);
  }
  if (raw.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    // Refuse rather than best-effort read: a shape change the generator announced is
    // exactly the case where guessing produces silently wrong tool output.
    throw new IndexError(
      `${source}: unsupported index schema_version ${raw.schema_version}; this build reads ` +
        `${SUPPORTED_SCHEMA_VERSION}. Rebuild the artifact or update the server.`,
    );
  }

  const provenance: Provenance = {
    build_id: typeof raw.build_id === "string" ? raw.build_id : "",
    ...(typeof raw.version === "string" ? { version: raw.version } : {}),
  };

  if (isPlainObject(raw.products)) {
    // Pre-release shape. Never deployed; recognised so a stray file reads rather than
    // failing in a way that looks like a corrupt artifact.
    const entries = Object.entries(raw.products);
    if (entries.length === 0)
      throw new IndexError(`${source}: contains no products`);
    if (entries.length > 1) {
      throw new IndexError(
        `${source}: carries ${entries.length} products; one file describes one product`,
      );
    }
    const [name, product] = entries[0];
    return {
      name,
      product: asProduct(product, `${source}:${name}`),
      provenance,
    };
  }

  // Released shape: exactly one key that is not part of the envelope.
  const envelope = new Set<string>(ENVELOPE_KEYS);
  const entries = Object.entries(raw).filter(
    ([key, value]) => !envelope.has(key) && isPlainObject(value),
  );
  if (entries.length === 0) {
    throw new IndexError(
      `${source}: no product object found; expected one top-level key besides ` +
        `${[...envelope].join(", ")}`,
    );
  }
  if (entries.length > 1) {
    throw new IndexError(
      `${source}: found ${entries.length} candidate product keys ` +
        `(${entries
          .map(([key]) => key)
          .sort()
          .join(", ")}); one file describes one product`,
    );
  }
  const [name, product] = entries[0];
  return { name, product: asProduct(product, `${source}:${name}`), provenance };
}

function asProduct(value: unknown, source: string): ProductIndex {
  if (!isPlainObject(value) || !Array.isArray(value.capabilities)) {
    throw new IndexError(`${source}: product object has no capabilities[]`);
  }
  return value as unknown as ProductIndex;
}

export class CapabilityRegistry {
  readonly index: RegistryIndex;
  /** product -> provenance of the file it came from. */
  readonly provenance: Record<string, Provenance>;
  /** product -> "METHOD /path" -> capability */
  private readonly byEndpoint = new Map<string, Map<string, Capability>>();

  constructor(
    index: RegistryIndex,
    provenance: Record<string, Provenance> = {},
  ) {
    if (index?.schema_version !== SUPPORTED_SCHEMA_VERSION) {
      throw new IndexError(
        `unsupported index schema_version ${index?.schema_version}; this build reads ` +
          `${SUPPORTED_SCHEMA_VERSION}. Rebuild the artifact or update the server.`,
      );
    }
    if (!index.products || Object.keys(index.products).length === 0) {
      throw new IndexError("index contains no products");
    }
    this.index = index;
    this.provenance = provenance;
    for (const [product, bundle] of Object.entries(index.products)) {
      const lookup = new Map<string, Capability>();
      for (const capability of bundle.capabilities) {
        lookup.set(endpointKey(capability.method, capability.path), capability);
      }
      this.byEndpoint.set(product, lookup);
    }
  }

  static fromFile(file: string): CapabilityRegistry {
    return CapabilityRegistry.fromFiles([file]);
  }

  /**
   * Merge every discovered artifact into one registry.
   *
   * ANY unreadable file fails the whole load, deliberately. Skipping one and carrying on
   * would leave a registry that answers "no such capability" for a product that exists —
   * a confident wrong answer, which is worse than the caller-visible absence of the whole
   * surface (which `register.ts` logs a reason for).
   */
  static fromFiles(files: string[]): CapabilityRegistry {
    if (files.length === 0) throw new IndexError("no index files to load");
    const products: Record<string, ProductIndex> = {};
    const provenance: Record<string, Provenance> = {};
    for (const file of files) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        throw new IndexError(
          `${file}: could not be read as JSON (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      const loaded = readIndexFile(parsed, file);
      const claimed = productFromPath(file);
      if (claimed && claimed !== loaded.name) {
        // The name is stated twice — by the path and by the key inside — and they must
        // agree. Trusting either one alone would serve a product's endpoints under the
        // other's name, and every search result would then point at the wrong host.
        throw new IndexError(
          `${file}: is stored as product '${claimed}' but declares '${loaded.name}'`,
        );
      }
      if (products[loaded.name]) {
        // Two files claiming one product cannot both be right, and picking one silently
        // decides which endpoints exist.
        throw new IndexError(
          `product '${loaded.name}' is declared by more than one index file; ${file} is a duplicate`,
        );
      }
      products[loaded.name] = loaded.product;
      provenance[loaded.name] = loaded.provenance;
    }
    return new CapabilityRegistry(
      {
        schema_version: SUPPORTED_SCHEMA_VERSION,
        build_id: compositeBuildId(provenance),
        products,
      },
      provenance,
    );
  }

  /** The single product's build id, or `name:id` pairs when several are loaded. */
  get buildId(): string {
    return this.index.build_id;
  }

  productNames(): string[] {
    return Object.keys(this.index.products).sort();
  }

  /** Per-product `{build_id, version}`, for logging and cache-busting only. */
  buildInfo(): Record<string, Provenance> {
    return this.provenance;
  }

  /**
   * Find a capability by the endpoint it exposes — the published handle.
   *
   * The endpoint is what searchCapability returns, so it is the only thing a caller can
   * hold. `unknown_endpoint` is a defined outcome rather than a generic failure: a caller
   * working from stale search output needs to know to search again, not to retry.
   */
  byEndpointLookup(
    method: string,
    path: string,
    product?: string,
  ): {
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
      const owners = matches
        .map((m) => m.product)
        .sort()
        .join(", ");
      throw new InvocationError(
        `${key} exists in several products (${owners}); pass product`,
      );
    }
    return matches[0];
  }
}

function compositeBuildId(provenance: Record<string, Provenance>): string {
  const names = Object.keys(provenance).sort();
  if (names.length === 1) return provenance[names[0]].build_id;
  return names.map((name) => `${name}:${provenance[name].build_id}`).join(" ");
}

/**
 * Resolve a `{$response|$schema: "Name"}` reference against the product's lookup tables.
 *
 * ONE HOP. The named component it returns may itself contain references — 39 of tm's 53
 * named responses do — so this is the primitive, not the whole job. Use `resolveResponses`
 * to get a tree with nothing left to look up.
 *
 * A node that is not a reference is returned as-is, and an unresolvable name yields
 * `undefined` rather than throwing: the tables are additive and their absence means "no
 * response schema available".
 */
export function resolveComponent<T extends ResponseDoc | SchemaNode>(
  product: ProductIndex,
  node: T | undefined,
): T | undefined {
  if (!node || typeof node !== "object") return node;
  const ref = node as ComponentRef;
  if (typeof ref.$response === "string") {
    return product.responses?.[ref.$response] as T | undefined;
  }
  if (typeof ref.$schema === "string") {
    return product.schemas?.[ref.$schema] as T | undefined;
  }
  return node;
}

/**
 * Resolve every reference in a tree, however deep.
 *
 * REFERENCES ARE NESTED, which is the part a one-hop reader gets wrong. They appear at the
 * top of a response (`{"$response": "BadRequest"}`), on its schema
 * (`.../schema/{"$schema": "TestCaseListResponse"}`), and inside the schema's own
 * properties (`.../schema/properties/data/properties/folder`). Chains are real too: a
 * capability's 400 resolves to the named `BadRequest`, whose schema is `{"$schema":
 * "ErrorResponse"}`.
 *
 * AN UNRESOLVABLE REFERENCE IS LEFT IN PLACE, not dropped and not thrown on. A dangling
 * name (the tables are built separately from the capabilities) or a cycle (a folder whose
 * schema contains folders) then shows up as the `{"$schema": "…"}` node it is, which a
 * reader can still act on, rather than as a silently truncated schema.
 */
export function resolveDeep<T>(product: ProductIndex, node: T): T {
  return resolveNode(product, node, new Set()) as T;
}

function resolveNode(
  product: ProductIndex,
  node: unknown,
  seen: Set<string>,
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => resolveNode(product, item, seen));
  }
  if (typeof node !== "object" || node === null) return node;

  const ref = node as ComponentRef;
  const kind =
    typeof ref.$response === "string"
      ? "$response"
      : typeof ref.$schema === "string"
        ? "$schema"
        : undefined;
  if (kind) {
    const name = (kind === "$response" ? ref.$response : ref.$schema) as string;
    const key = `${kind}:${name}`;
    const target =
      kind === "$response"
        ? product.responses?.[name]
        : product.schemas?.[name];
    // Leave the reference visible when it cannot be followed, or when following it would
    // revisit a name already on this path.
    if (!target || seen.has(key)) return node;
    return resolveNode(product, target, new Set([...seen, key]));
  }

  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(
    node as Record<string, unknown>,
  )) {
    out[field] = resolveNode(product, value, seen);
  }
  return out;
}

/** Which declared responses to hand back. */
export type ResponseSelection = "success" | "all" | "none";

/**
 * A capability's declared responses with every reference followed.
 *
 * SUCCESS ONLY BY DEFAULT. The error entries are near-identical across the surface — 148 of
 * 173 capabilities declare the same `InternalServerError`, and all of them bottom out in
 * one `ErrorResponse` schema — so including them multiplies a search payload by 6.4x to
 * repeat boilerplate the caller learns from the actual failure anyway. The 2xx entry is the
 * one that says what a successful call returns, which is what a caller needs BEFORE calling.
 *
 * Returns undefined when the capability declares none — which is every capability in an
 * index built before the response tables were added, and is not an error.
 */
export function resolveResponses(
  product: ProductIndex,
  capability: Capability,
  selection: ResponseSelection = "success",
): Record<string, ResponseDoc> | undefined {
  if (selection === "none" || !capability.responses) return undefined;
  const wanted =
    selection === "all"
      ? Object.entries(capability.responses)
      : Object.entries(capability.responses).filter(([status]) =>
          status.startsWith("2"),
        );
  if (wanted.length === 0) return undefined;
  return resolveDeep(product, Object.fromEntries(wanted));
}
