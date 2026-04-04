/**
 * Simple in-memory cache with per-entry TTL.
 *
 * Used to cache Percy API responses and avoid redundant network calls
 * within short time windows (e.g., multiple tools querying the same build).
 */

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000; // 30 seconds

export class PercyCache {
  private store: Map<string, CacheEntry> = new Map();

  /**
   * Returns the cached value if it exists and has not expired.
   * Expired entries are deleted on access.
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  /**
   * Stores a value with an optional TTL (defaults to 30 seconds).
   */
  set(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Removes all entries from the cache.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Removes a single entry from the cache.
   */
  delete(key: string): void {
    this.store.delete(key);
  }
}

/** Singleton cache instance shared across Percy API tools. */
export const percyCache = new PercyCache();
