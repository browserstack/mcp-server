/**
 * How a report's issues are handed out: most severe first, in pages measured by the length
 * of their JSON, so that a page fits a client's context whatever the rows contain. The
 * cursor an agent passes back is the character offset the next page starts at.
 */

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

/** A severity's place, most severe first; an unknown severity sorts last. */
export function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 99;
}

/** Most severe first; an unknown severity sorts last. */
export function sortBySeverity<T extends { severity: string }>(rows: T[]): T[] {
  return rows.sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
}

/** The value most rows give, the first of them on a tie. */
export function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) [best, bestCount] = [v, n];
  }
  return best;
}

/**
 * How many characters of issue JSON one call hands out by default: about 8,000 tokens, under
 * Claude Code's 10,000-token warning and its 50,000-character limit on a tool's result
 * (above which the result is saved to a file instead of shown), so a large report takes
 * few calls and a mid-size one fits in one.
 */
export const PAGE_CHARACTERS = 30_000;

export interface Page<T> {
  records: T[];
  page_length: number;
  /** Character offset of the next page, or null when this was the last. */
  next_page: number | null;
  /** How many rows the pages after this one hold. */
  remaining: number;
}

export function pageOf<T>(
  all: T[],
  {
    maxCharacterLength = PAGE_CHARACTERS,
    nextPage = 0,
    extraLength,
  }: {
    maxCharacterLength?: number;
    nextPage?: number;
    /**
     * What else a row brings onto its page, counted against the page's length but not
     * the cursor: the text of a rule the page has not named yet.
     */
    extraLength?: (record: T) => number;
  } = {},
): Page<T> {
  // Walk to the starting offset
  let charCursor = 0;
  let idx = 0;
  for (; idx < all.length; idx++) {
    const len = JSON.stringify(all[idx]).length;
    if (charCursor + len > nextPage) break;
    charCursor += len;
  }

  // Collect up to maxCharacterLength; a row larger than that still makes a page of its
  // own, or the cursor would never move past it
  const page: T[] = [];
  let extra = 0;
  for (let i = idx; i < all.length; i++) {
    const recStr = JSON.stringify(all[i]);
    const more = extraLength?.(all[i]) ?? 0;
    const fits =
      charCursor - nextPage + extra + more + recStr.length <=
      maxCharacterLength;
    if (!fits && page.length > 0) break;
    page.push(all[i]);
    charCursor += recStr.length;
    extra += more;
  }

  const remaining = all.length - idx - page.length;
  return {
    records: page,
    page_length: page.length,
    next_page: remaining > 0 ? charCursor : null,
    remaining,
  };
}
