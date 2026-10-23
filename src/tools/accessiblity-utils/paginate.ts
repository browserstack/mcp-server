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

/** Most severe first; an unknown severity sorts last. */
export function sortBySeverity<T extends { severity: string }>(rows: T[]): T[] {
  return rows.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );
}

/**
 * How many characters of issue JSON one call hands out by default: about 2,500 tokens, so
 * a page stays small next to a client's own limit on tool output while a large report
 * still takes few calls.
 */
export const PAGE_CHARACTERS = 10_000;

export interface Page<T> {
  records: T[];
  page_length: number;
  /** Character offset of the next page, or null when this was the last. */
  next_page: number | null;
}

export function pageOf<T>(
  all: T[],
  { maxCharacterLength = PAGE_CHARACTERS, nextPage = 0 } = {},
): Page<T> {
  // Walk to the starting offset
  let charCursor = 0;
  let idx = 0;
  for (; idx < all.length; idx++) {
    const len = JSON.stringify(all[idx]).length;
    if (charCursor + len > nextPage) break;
    charCursor += len;
  }

  // Collect up to maxCharacterLength; a record longer than that goes out on a page of its
  // own, or the cursor could never move past it.
  const page: T[] = [];
  for (let i = idx; i < all.length; i++) {
    const recStr = JSON.stringify(all[i]);
    if (
      page.length > 0 &&
      charCursor - nextPage + recStr.length > maxCharacterLength
    ) {
      break;
    }
    page.push(all[i]);
    charCursor += recStr.length;
  }

  const hasMore = idx + page.length < all.length;
  return {
    records: page,
    page_length: page.length,
    next_page: hasMore ? charCursor : null,
  };
}
