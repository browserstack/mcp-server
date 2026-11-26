/**
 * One parsed index per process, shared by every server built in it.
 *
 * WHY THIS EXISTS. A hosted deployment builds a `BrowserStackMcpServer` for every HTTP
 * request, and registering the capability tools used to load the index each time: read
 * every artifact from disk, `JSON.parse` it, and build the lookups. That is several
 * megabytes of synchronous work per request — `ping` included — and it was about nine
 * tenths of what constructing a server costs. On a CPU-limited pod that is the difference
 * between answering a health probe and not.
 *
 * WHY SHARING IS SAFE. The index is static data shipped with the package, not user data —
 * the reasoning `call.ts` already relies on for its own copy. Nothing about the caller
 * lives in a `CapabilityRegistry`: credentials and base URLs are closed over per server in
 * `register.ts` and read at call time. The registry is frozen below so that stays true;
 * a write that would once have changed one request's private copy now throws instead of
 * silently changing every caller's.
 */

import { statSync } from "node:fs";

import appConfig from "../../config.js";
import { CapabilityRegistry, isReadOnly } from "./index-loader.js";

let shared:
  | { key: string; registry: CapabilityRegistry; announced: boolean }
  | undefined;

/**
 * Everything the loaded registry depends on, so a change to any of it reloads.
 *
 * Size and mtime stand in for the contents: an artifact replaced on disk is picked up
 * without a restart, and seven `stat` calls cost microseconds against the milliseconds a
 * reload does. `REMOTE_MCP` is part of it because `local_only` capabilities are withheld
 * or published at load, by surface. A file that cannot be stat'd yields a key no earlier
 * load can match, so the reload runs and reports the real error.
 */
function cacheKey(files: string[]): string {
  const parts = files.map((file) => {
    try {
      const { size, mtimeMs } = statSync(file);
      return `${file}:${size}:${mtimeMs}`;
    } catch {
      return `${file}:unreadable:${Date.now()}`;
    }
  });
  return [
    `remote=${Boolean(appConfig.REMOTE_MCP)}`,
    `readonly=${isReadOnly()}`,
    ...parts,
  ].join("\n");
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

/**
 * The registry for these files, loaded at most once while they are unchanged.
 *
 * `loaded` is true for the first announcing caller after the files were read, so a load is
 * announced once instead of once per server. A caller that only reads it passes
 * `announce: false` and leaves that to the registry's own tools. A failed load is not
 * remembered: `fromFiles` throws before anything is stored, so the next call tries again.
 */
export function sharedRegistry(
  files: string[],
  { announce = true }: { announce?: boolean } = {},
): {
  registry: CapabilityRegistry;
  loaded: boolean;
} {
  const key = cacheKey(files);
  if (shared?.key !== key) {
    const registry = CapabilityRegistry.fromFiles(files);
    deepFreeze(registry.index);
    shared = { key, registry, announced: false };
  }
  const loaded = announce && !shared.announced;
  if (loaded) shared.announced = true;
  return { registry: shared.registry, loaded };
}

/** Test hook: forget the loaded index. */
export function resetSharedRegistryForTests(): void {
  shared = undefined;
}
