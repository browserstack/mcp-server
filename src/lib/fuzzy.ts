// 1. Compute Levenshtein distance between two strings
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array(a.length + 1)
    .fill(0)
    .map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
    }
  }
  return dp[a.length][b.length];
}

// 2. Score one item against the query (normalized score 0–1)
function scoreItem<T>(
  item: T,
  keys: Array<keyof T | string>,
  queryTokens: string[],
): number {
  let best = Infinity;
  for (const key of keys) {
    const field = String(item[key as keyof T] ?? "").toLowerCase();
    const fieldTokens = field.split(/\s+/);
    const tokenScores = queryTokens.map((qt) => {
      const minNormalized = Math.min(
        ...fieldTokens.map((ft) => {
          const rawDist = levenshtein(ft, qt);
          const maxLen = Math.max(ft.length, qt.length);
          return maxLen === 0 ? 0 : rawDist / maxLen; // normalized 0–1
        }),
      );
      return minNormalized;
    });
    const avg = tokenScores.reduce((a, b) => a + b, 0) / tokenScores.length;
    best = Math.min(best, avg);
  }
  return best;
}

// 3. The search entrypoint
export function customFuzzySearch<T>(
  list: T[],
  keys: Array<keyof T | string>,
  query: string,
  limit: number = 5,
  maxDistance: number = 0.6,
): T[] {
  const q = query.toLowerCase().trim();
  const queryTokens = q.split(/\s+/);

  return list
    .map((item) => ({ item, score: scoreItem(item, keys, queryTokens) }))
    .filter((x) => x.score <= maxDistance)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.item);
}
