import { describe, expect, it } from "vitest";

// How a report's issues are handed out a page at a time: the count of what is left must be
// exact whatever the rows' sizes, and a row larger than a page must still come out.

import {
  laterPagesOf,
  pageOf,
} from "../../src/tools/accessiblity-utils/paginate.js";

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

describe("laterPagesOf", () => {
  it("gives the pages, and the cursors, that later calls with each next_page return", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`,
      issue_type: `rule${i % 3}`,
      text: "x".repeat((i * 37) % 90),
    }));
    // Each call names a rule's text once, counted against its page.
    const ruleText = () => {
      const named = new Set<string>();
      return (r: { issue_type: string }) => {
        if (named.has(r.issue_type)) return 0;
        named.add(r.issue_type);
        return 25;
      };
    };
    const options = { maxCharacterLength: 400 };
    const first = pageOf(rows, { ...options, extraLength: ruleText() });
    const expected: { cursor: number; records: typeof rows }[] = [];
    for (let cursor = first.next_page; cursor !== null; ) {
      const page = pageOf(rows, {
        ...options,
        nextPage: cursor,
        extraLength: ruleText(),
      });
      expected.push({ cursor, records: page.records });
      cursor = page.next_page;
    }
    expect(expected.length).toBeGreaterThan(2);
    expect(
      laterPagesOf(rows, first, { ...options, extraLength: ruleText }),
    ).toEqual(expected);
  });

  it("is empty when the first page is the only one", () => {
    const rows = [{ id: "a" }];
    expect(laterPagesOf(rows, pageOf(rows))).toEqual([]);
  });
});
