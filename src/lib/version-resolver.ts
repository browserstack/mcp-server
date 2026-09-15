/**
 * If req === "latest" or "oldest", returns max/min numeric (or lex)
 * Else if exact match, returns that
 * Else picks the numerically closest (or first)
 */
const PRERELEASE_CHANNEL = /\b(beta|dev|alpha|canary|nightly|preview)\b/i;

export function resolveVersion(requested: string, available: string[]): string {
  // strip duplicates & sort
  const uniq = Array.from(new Set(available));

  // pick min/max
  if (requested === "latest" || requested === "oldest") {
    // Prefer stable releases: BrowserStack lists pre-release channels such as
    // "154.0 beta" / "155.0 dev" alongside stable versions, and "latest"
    // should never resolve to one of those while a stable version exists.
    const stable = uniq.filter((v) => !PRERELEASE_CHANNEL.test(v));
    const candidates = stable.length > 0 ? stable : uniq;
    // try numeric
    const nums = candidates
      .map((v) => ({ v, n: parseFloat(v) }))
      .filter((x) => !isNaN(x.n))
      .sort((a, b) => a.n - b.n);
    if (nums.length) {
      return requested === "latest" ? nums[nums.length - 1].v : nums[0].v;
    }
    // fallback lex
    const lex = candidates.slice().sort();
    return requested === "latest" ? lex[lex.length - 1] : lex[0];
  }

  // exact match?
  if (uniq.includes(requested)) {
    return requested;
  }

  const caseInsensitiveMatch = uniq.find(
    (v) => v.toLowerCase() === requested.toLowerCase(),
  );
  if (caseInsensitiveMatch) {
    return caseInsensitiveMatch;
  }

  // Try major version matching (e.g., "14" matches "14.0", "14.1", etc.)
  const reqNum = parseFloat(requested);
  if (!isNaN(reqNum)) {
    const majorVersionMatches = uniq.filter((v) => {
      const vNum = parseFloat(v);
      return !isNaN(vNum) && Math.floor(vNum) === Math.floor(reqNum);
    });

    if (majorVersionMatches.length > 0) {
      // If multiple matches, prefer the most common format or latest
      const exactMatch = majorVersionMatches.find(
        (v) => v === `${Math.floor(reqNum)}.0`,
      );
      if (exactMatch) {
        return exactMatch;
      }
      // Return the first match (usually the most common format)
      return majorVersionMatches[0];
    }
  }

  // Fuzzy matching: find the closest version
  const reqNumForFuzzy = parseFloat(requested);
  if (!isNaN(reqNumForFuzzy)) {
    const numericVersions = uniq
      .map((v) => ({ v, n: parseFloat(v) }))
      .filter((x) => !isNaN(x.n))
      .sort(
        (a, b) =>
          Math.abs(a.n - reqNumForFuzzy) - Math.abs(b.n - reqNumForFuzzy),
      );

    if (numericVersions.length > 0) {
      return numericVersions[0].v;
    }
  }

  // Fallback: return the first available version
  return uniq[0];
}
