/**
 * Percy API HTTP client.
 *
 * Uses native `fetch` (consistent with existing Percy tools in this repo).
 * Handles JSON:API deserialization, rate limiting, and error enrichment.
 *
 * SECURITY: Token values are NEVER logged or exposed in error messages.
 */

import { BrowserStackConfig } from "../types.js";
import { getPercyHeaders, getPercyApiBaseUrl } from "./auth.js";
import { PercyApiError, enrichPercyError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TokenScope = "project" | "org" | "auto";

interface ClientOptions {
  scope?: TokenScope;
  projectName?: string;
}

interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { data: { id: string; type: string } | Array<{ id: string; type: string }> | null }
  >;
}

interface JsonApiEnvelope {
  data: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers – kebab-case to camelCase
// ---------------------------------------------------------------------------

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function camelCaseKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(camelCaseKeys);
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = kebabToCamel(key);
      result[camelKey] =
        value !== null && typeof value === "object" ? camelCaseKeys(value) : value;
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// JSON:API Deserializer
// ---------------------------------------------------------------------------

/**
 * Builds a lookup index of included resources keyed by `type:id`.
 */
function buildIncludedIndex(
  included: JsonApiResource[],
): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();
  for (const resource of included) {
    const flattened = flattenResource(resource);
    index.set(`${resource.type}:${resource.id}`, flattened);
  }
  return index;
}

/**
 * Flattens a single JSON:API resource — merges `attributes` into the top
 * level alongside `id` and `type`, converting keys to camelCase.
 */
function flattenResource(resource: JsonApiResource): Record<string, unknown> {
  const attrs = resource.attributes
    ? (camelCaseKeys(resource.attributes) as Record<string, unknown>)
    : {};
  return {
    id: resource.id,
    type: resource.type,
    ...attrs,
  };
}

/**
 * Resolves relationships for a resource against the included index.
 * Returns the resolved object(s) or the raw { id, type } ref when not found.
 */
function resolveRelationships(
  resource: JsonApiResource,
  index: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  if (!resource.relationships) {
    return {};
  }

  const resolved: Record<string, unknown> = {};

  for (const [relName, relValue] of Object.entries(resource.relationships)) {
    const camelName = kebabToCamel(relName);
    const { data } = relValue;

    if (data === null || data === undefined) {
      resolved[camelName] = null;
    } else if (Array.isArray(data)) {
      resolved[camelName] = data.map(
        (ref) => index.get(`${ref.type}:${ref.id}`) ?? { id: ref.id, type: ref.type },
      );
    } else {
      resolved[camelName] =
        index.get(`${data.type}:${data.id}`) ?? { id: data.id, type: data.type };
    }
  }

  return resolved;
}

/**
 * Deserializes a JSON:API envelope into plain objects.
 *
 * - `data: null` → returns `null`
 * - `data: []` → returns `[]`
 * - `data: { ... }` → returns a single deserialized object
 * - `data: [{ ... }, ...]` → returns an array of deserialized objects
 */
export function deserialize(envelope: JsonApiEnvelope): {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  meta?: Record<string, unknown>;
} {
  const included = envelope.included ?? [];
  const index = buildIncludedIndex(included);

  if (envelope.data === null || envelope.data === undefined) {
    return { data: null, meta: envelope.meta };
  }

  if (Array.isArray(envelope.data)) {
    const records = envelope.data.map((resource) => ({
      ...flattenResource(resource),
      ...resolveRelationships(resource, index),
    }));
    return { data: records, meta: envelope.meta };
  }

  const record = {
    ...flattenResource(envelope.data),
    ...resolveRelationships(envelope.data, index),
  };
  return { data: record, meta: envelope.meta };
}

// ---------------------------------------------------------------------------
// Rate Limit / Retry
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// PercyClient
// ---------------------------------------------------------------------------

export class PercyClient {
  private config: BrowserStackConfig;
  private options: ClientOptions;

  constructor(config: BrowserStackConfig, options?: ClientOptions) {
    this.config = config;
    this.options = options ?? {};
  }

  // -----------------------------------------------------------------------
  // Public HTTP methods
  // -----------------------------------------------------------------------

  /**
   * GET request with optional query params and JSON:API `include`.
   */
  async get<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string>,
    includes?: string[],
  ): Promise<T> {
    const url = this.buildUrl(path, params, includes);
    return this.request<T>("GET", url);
  }

  /**
   * POST request with an optional JSON body.
   */
  async post<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>("POST", url, body);
  }

  /**
   * PATCH request with an optional JSON body.
   */
  async patch<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>("PATCH", url, body);
  }

  /**
   * DELETE request.
   */
  async del(path: string): Promise<void> {
    const url = this.buildUrl(path);
    await this.request<void>("DELETE", url);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private buildUrl(
    path: string,
    params?: Record<string, string>,
    includes?: string[],
  ): string {
    const base = getPercyApiBaseUrl();
    // Ensure no double slashes between base and path
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    if (includes && includes.length > 0) {
      url.searchParams.set("include", includes.join(","));
    }

    return url.toString();
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const headers = await getPercyHeaders(this.config, {
      scope: this.options.scope,
      projectName: this.options.projectName,
    });

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body);
      }

      let response: Response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (networkError) {
        lastError =
          networkError instanceof Error
            ? networkError
            : new Error(String(networkError));
        // Network errors are not retryable via the rate-limit path,
        // but we still respect the retry loop for consistency.
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
      }

      // 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      // Rate limited — retry with backoff
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter
          ? parseFloat(retryAfter) * 1_000
          : BASE_RETRY_DELAY_MS * Math.pow(2, attempt);

        if (attempt < MAX_RETRIES) {
          await sleep(delayMs);
          continue;
        }

        // Exhausted retries — throw enriched error
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = undefined;
        }
        throw enrichPercyError(429, errorBody, `${method} ${url}`);
      }

      // Non-2xx error
      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = undefined;
        }
        throw enrichPercyError(response.status, errorBody, `${method} ${url}`);
      }

      // Successful JSON response — deserialize JSON:API
      const json = await response.json();

      // If the response has a JSON:API `data` key, deserialize it
      if (json && typeof json === "object" && "data" in json) {
        const deserialized = deserialize(json as JsonApiEnvelope);
        return deserialized as T;
      }

      // Non-JSON:API response — return as-is
      return json as T;
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError ?? new Error("Request failed after retries");
  }
}
