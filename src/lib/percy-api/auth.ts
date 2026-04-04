/**
 * Percy API authentication module.
 * Resolves Percy tokens via environment variables or BrowserStack credential fallback.
 *
 * SECURITY: Token values are NEVER logged or included in error messages.
 * Masked format (****<last4>) is used when referencing tokens in diagnostics.
 */

import { BrowserStackConfig } from "../types.js";
import { fetchPercyToken } from "../../tools/sdk-utils/percy-web/fetchPercyToken.js";

type TokenScope = "project" | "org" | "auto";

interface ResolveTokenOptions {
  projectName?: string;
  scope?: TokenScope;
}

/**
 * Masks a token for safe display in error messages.
 * Shows only the last 4 characters.
 */
export function maskToken(token: string): string {
  if (token.length <= 4) {
    return "****";
  }
  return `****${token.slice(-4)}`;
}

/**
 * Resolves a Percy token using the following priority:
 *
 * 1. `process.env.PERCY_TOKEN` (for project or auto scope)
 * 2. `process.env.PERCY_ORG_TOKEN` (for org scope)
 * 3. Fallback: fetch via BrowserStack API using `fetchPercyToken()`
 * 4. If nothing works, throws an enriched error with guidance
 */
export async function resolvePercyToken(
  config: BrowserStackConfig,
  options: ResolveTokenOptions = {},
): Promise<string> {
  const { projectName, scope = "auto" } = options;

  // For project or auto scope, check PERCY_TOKEN first
  if (scope === "project" || scope === "auto") {
    const envToken = process.env.PERCY_TOKEN;
    if (envToken) {
      return envToken;
    }
  }

  // For org scope, check PERCY_ORG_TOKEN
  if (scope === "org") {
    const orgToken = process.env.PERCY_ORG_TOKEN;
    if (orgToken) {
      return orgToken;
    }
  }

  // For auto scope, also check PERCY_ORG_TOKEN as secondary
  if (scope === "auto") {
    const orgToken = process.env.PERCY_ORG_TOKEN;
    if (orgToken) {
      return orgToken;
    }
  }

  // Fallback: fetch via BrowserStack credentials
  const username = config["browserstack-username"];
  const accessKey = config["browserstack-access-key"];

  if (username && accessKey) {
    const auth = `${username}:${accessKey}`;
    const resolvedProjectName = projectName || "default";

    try {
      const token = await fetchPercyToken(resolvedProjectName, auth, {});
      return token;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to fetch Percy token via BrowserStack API: ${message}. ` +
          `Set PERCY_TOKEN or PERCY_ORG_TOKEN environment variable as an alternative.`,
      );
    }
  }

  // Nothing worked — provide actionable guidance
  if (scope === "project") {
    throw new Error(
      "Percy project token not available. Set PERCY_TOKEN environment variable, " +
        "or provide BrowserStack credentials to fetch a token automatically.",
    );
  }

  if (scope === "org") {
    throw new Error(
      "Percy org token not available. Set PERCY_ORG_TOKEN environment variable.",
    );
  }

  throw new Error(
    "Percy token not available. Set PERCY_TOKEN (project) or PERCY_ORG_TOKEN (org) " +
      "environment variable, or provide BrowserStack credentials (browserstack-username " +
      "and browserstack-access-key) to fetch a token automatically.",
  );
}

/**
 * Returns headers for Percy API requests.
 * Includes Authorization, Content-Type, and User-Agent.
 */
export async function getPercyHeaders(
  config: BrowserStackConfig,
  options: { scope?: TokenScope; projectName?: string } = {},
): Promise<Record<string, string>> {
  const token = await resolvePercyToken(config, options);

  return {
    Authorization: `Token token=${token}`,
    "Content-Type": "application/json",
    "User-Agent": "browserstack-mcp-server",
  };
}

/**
 * Returns the Percy API base URL.
 * Defaults to `https://percy.io/api/v1`, overridable via `PERCY_API_URL` env var.
 */
export function getPercyApiBaseUrl(): string {
  return process.env.PERCY_API_URL || "https://percy.io/api/v1";
}
