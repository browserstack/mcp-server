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
  { maxCharacterLength = 5000, nextPage = 0 } = {},
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
  for (let i = idx; i < all.length; i++) {
    const recStr = JSON.stringify(all[i]);
    const fits = charCursor - nextPage + recStr.length <= maxCharacterLength;
    if (!fits && page.length > 0) break;
    page.push(all[i]);
    charCursor += recStr.length;
  }

  const remaining = all.length - idx - page.length;
  return {
    records: page,
    page_length: page.length,
    next_page: remaining > 0 ? charCursor : null,
    remaining,
  };
}
