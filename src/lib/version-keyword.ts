import { z } from "zod";

/**
 * Version fields (OS, browser, platform) accept a version number or one of two keywords,
 * "latest" and "oldest", and the code downstream compares against those exact strings.
 * Models and users say the same thing in other words — "newest", "most recent",
 * "earliest", "first", "Latest" — so the mapping lives here, in the schema, rather than in
 * description prose a model may or may not follow.
 */
const LATEST = new Set(["latest", "newest", "most recent", "most-recent"]);
const OLDEST = new Set(["oldest", "earliest", "first"]);

export function normalizeVersionKeyword(value: string): string {
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (LATEST.has(key)) return "latest";
  if (OLDEST.has(key)) return "oldest";
  return value.trim();
}

/** A version string whose keyword synonyms are normalised to "latest" / "oldest". */
export function versionString() {
  return z.string().transform(normalizeVersionKeyword);
}
