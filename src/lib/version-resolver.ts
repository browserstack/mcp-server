/**
 * If req === "latest" or "oldest", returns max/min numeric (or lex)
 * Else if exact match, returns that
 * Else picks the numerically closest (or first)
 */
export function resolveVersion(requested: string, available: string[]): string {
  // strip duplicates & sort
  const uniq = Array.from(new Set(available));
  // pick min/max
  if (requested === "latest" || requested === "oldest") {
    // try numeric
    const nums = uniq
      .map((v) => ({ v, n: parseFloat(v) }))
      .filter((x) => !isNaN(x.n))
      .sort((a, b) => a.n - b.n);
    if (nums.length) {
      return requested === "latest" ? nums[nums.length - 1].v : nums[0].v;
    }
    // fallback lex
    const lex = uniq.slice().sort();
    return requested === "latest" ? lex[lex.length - 1] : lex[0];
  }

  // exact?
  if (uniq.includes(requested)) {
    return requested;
  }

  // try closest numeric
  const reqNum = parseFloat(requested);
  const nums = uniq
    .map((v) => ({ v, n: parseFloat(v) }))
    .filter((x) => !isNaN(x.n));
  if (!isNaN(reqNum) && nums.length) {
    let best = nums[0],
      bestDiff = Math.abs(nums[0].n - reqNum);
    for (const x of nums) {
      const d = Math.abs(x.n - reqNum);
      if (d < bestDiff) {
        best = x;
        bestDiff = d;
      }
    }
    return best.v;
  }

  // final fallback
  return uniq[0];
}
