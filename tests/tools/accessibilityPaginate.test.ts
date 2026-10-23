import { describe, expect, it } from "vitest";

// How a report's issues are handed out a page at a time: the count of what is left must be
// exact whatever the rows' sizes, and a row larger than a page must still come out.

import { pageOf } from "../../src/tools/accessiblity-utils/paginate.js";

const row = (id: string, size: number) => ({ id, text: "x".repeat(size) });

describe("pageOf", () => {
  it("counts exactly the rows left after each page, however much their sizes differ", () => {
    const rows = [
      row("a", 10),
      row("b", 400),
      row("c", 10),
      row("d", 10),
      row("e", 400),
      row("f", 10),
    ];
    const pages = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page = pageOf(rows, { maxCharacterLength: 450, nextPage: cursor });
      pages.push(page);
      cursor = page.next_page;
    }

    expect(pages.map((p) => p.records.map((r) => r.id))).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
    expect(pages.map((p) => p.remaining)).toEqual([4, 2, 0]);
  });

  it("still returns a row larger than a page, so paging never stalls", () => {
    const rows = [row("small", 10), row("huge", 5000), row("after", 10)];

    const seen: string[] = [];
    let cursor: number | null = 0;
    for (let calls = 0; cursor !== null && calls < 10; calls++) {
      const page = pageOf(rows, { maxCharacterLength: 100, nextPage: cursor });
      expect(page.page_length).toBeGreaterThan(0);
      seen.push(...page.records.map((r) => r.id));
      cursor = page.next_page;
    }

    expect(seen).toEqual(["small", "huge", "after"]);
  });

  it("has nothing left past the end", () => {
    const page = pageOf([row("a", 10)], { nextPage: 10_000 });

    expect(page).toEqual({
      records: [],
      page_length: 0,
      next_page: null,
      remaining: 0,
    });
  });
});
