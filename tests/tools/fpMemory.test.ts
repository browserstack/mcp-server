import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The false-positive memory: what users confirmed is not a real issue, read for the rules of
// the issues fetchAccessibilityIssues answers with, so the agent filters them without asking
// again. Saving, reading and revoking are web_accessibility capabilities. What has to hold:
// the memory never holds the issues back, it fits its budget oldest-first, it is quoted as
// untrusted, and the capabilities an answer names exist and can be invoked.

vi.unmock("../../src/tools/accessiblity-utils/fp-memory.js");

const get = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/apiClient.js", () => ({ apiClient: { get } }));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import {
  FP_APPLY_NOTE,
  FP_FILING_GUIDE,
  READ_CAPABILITY,
  SUBMIT_CAPABILITY,
  applyMemory,
  leftOutMessages,
  memoryForReport,
  memoryMessages,
  memoryPayload,
  type FpEntry,
  type FpMemory,
} from "../../src/tools/accessiblity-utils/fp-memory.js";

const AUTH = { username: "u", password: "k" };

function entry(id: number, extra: Partial<FpEntry> = {}): FpEntry {
  return {
    id,
    site: "www.shop.example",
    global: false,
    verdict: "false_positive",
    matchScope: "component_family",
    rootCause:
      "The role is set inside the custom element's shadow root; the host has no role attribute.",
    pattern: {
      tagPrefix: "acme-",
      predicate: "acme- custom elements rendering a native control",
    },
    counterExamples: ["div.to_sign_in"],
    userStatement: "These Acme components work with VoiceOver",
    seedIssue: {
      pageUrl: "https://www.shop.example/de/angebote/halbtax",
      component: "acme-header-button#",
      htmlSnippet: "<acme-header-button>",
    },
    ...extra,
  };
}

function memory(entries: FpEntry[], ruleCode = "role-required"): FpMemory {
  return {
    rules: [
      {
        ruleCode,
        docsUrl: `https://www.browserstack.com/docs/accessibility/rules/a11y-engine/${ruleCode}/`,
        entryCount: entries.length,
        entries,
      },
    ],
    truncated: false,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("memoryForReport", () => {
  it("asks for the answer's rules only, with the user's credentials", async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { success: true, data: memory([entry(1)]) },
    });

    const result = await memoryForReport(AUTH, ["role-required", "image-alt"]);

    expect(result?.rules[0].entries[0].id).toBe(1);
    const call = get.mock.calls[0][0];
    expect(call.url).toContain(
      "/api/fp-memory/v1/memory?ruleCodes=role-required%2Cimage-alt",
    );
    expect(call.headers.Authorization).toBe(
      "Basic " + Buffer.from("u:k").toString("base64"),
    );
    expect(call.timeout).toBeGreaterThan(0);
  });

  it("does not ask when the answer names no rules", async () => {
    expect(await memoryForReport(AUTH, [])).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it("answers without memory when the account does not have it", async () => {
    get.mockResolvedValue({ ok: false, status: 403, data: { success: false } });
    expect(await memoryForReport(AUTH, ["role-required"])).toBeUndefined();
  });

  it("answers without memory when it cannot be read, rather than failing", async () => {
    get.mockRejectedValue(new Error("timeout of 8000ms exceeded"));
    expect(await memoryForReport(AUTH, ["role-required"])).toBeUndefined();
    get.mockResolvedValue({ ok: false, status: 500, data: {} });
    expect(await memoryForReport(AUTH, ["role-required"])).toBeUndefined();
  });
});

describe("memoryMessages", () => {
  it("says nothing when the account has no memory", () => {
    expect(memoryMessages(undefined)).toEqual([]);
  });

  it("only says how to save one when no rule of the answer has any yet", () => {
    expect(memoryMessages({ rules: [], truncated: false })).toEqual([
      FP_FILING_GUIDE,
    ]);
  });

  it("says how to apply the memory, quotes it as untrusted, then how to add to it", () => {
    const messages = memoryMessages(memory([entry(1)]));

    expect(messages[0]).toBe(FP_APPLY_NOTE);
    expect(messages[1]).toMatch(/<untrusted|untrusted/i);
    expect(messages[1]).toContain("role-required");
    expect(messages[1]).toContain(
      "https://www.browserstack.com/docs/accessibility/rules/a11y-engine/role-required/",
    );
    expect(messages[1]).toContain("div.to_sign_in");
    expect(messages.at(-1)).toBe(FP_FILING_GUIDE);
  });

  it("says an entry saved for all sites applies to all sites", () => {
    expect(memoryMessages(memory([entry(1, { global: true })]))[1]).toContain(
      "all sites",
    );
  });

  it("brings only the rules the answer's issues name, when told which", () => {
    expect(memoryMessages(memory([entry(1)]), ["image-alt"])).toEqual([
      FP_FILING_GUIDE,
    ]);
    expect(memoryMessages(memory([entry(1)]), ["role-required"])[0]).toBe(
      FP_APPLY_NOTE,
    );
  });
});

describe("applyMemory", () => {
  const SBB = "https://www.sbb.ch/de/angebote/halbtax";

  /** Entry 3 as the Accessibility API stores it for www.sbb.ch. */
  const sbbEntry = entry(3, {
    site: "www.sbb.ch",
    counterExamples: null,
    pattern: {
      predicate:
        "Custom elements with tag prefix 'sbb-' (SBB Lyne design system) that have no role attribute on the host but set a role through ElementInternals (internals.role, e.g. button or radio): sbb-expansion-panel-header, sbb-radio-button-panel, sbb-header-button, sbb-button, sbb-mini-button, sbb-secondary-button, sbb-block-link-button, sbb-card-button, sbb-tag, sbb-datepicker-toggle, sbb-datepicker-next-day, sbb-datepicker-previous-day. Does not cover sbb-breadcrumb (no internals role; it renders a native <a> in its shadow root) or non-sbb elements.",
      tagPrefix: "sbb-",
      designSystem: "SBB Lyne",
      hasShadowRoot: true,
      isCustomElement: true,
    },
    seedIssue: {
      pageUrl: SBB,
      component: "sbb#",
      htmlSnippet:
        '<sbb-radio-button-panel data-testid="product-offer-panel-radio" tabindex="0">',
    },
  });

  const issue = (
    HTML_snippet: string,
    extra: { issue_type?: string; affected_page?: string } = {},
  ) => ({
    issue_type: "role-required",
    affected_page: SBB,
    HTML_snippet,
    ...extra,
  });

  it("leaves out the family a tag prefix names, on its site and rule only", () => {
    const issues = {
      panelHeader: issue(
        '<sbb-expansion-panel-header tabindex="0" slot="header" aria-expanded="false">',
      ),
      radio: issue('<sbb-radio-button-panel name="g1" tabindex="0">'),
      // The engine cuts this snippet inside an attribute's value.
      headerButton: issue(
        '<sbb-header-button id="nav-trigger" aria-label="Menü" onclick="()=>',
      ),
      tag: issue('<sbb-tag value="all">'),
      breadcrumb: issue('<sbb-breadcrumb slot="li-3">'),
      div: issue('<div class="sbb-like" tabindex="0">'),
      otherRule: issue('<sbb-expansion-panel-header tabindex="0">', {
        issue_type: "aria-allowed-attr",
      }),
      otherHost: issue('<sbb-header-button icon-name="globe">', {
        affected_page: "https://lyne-storybook.app.sbb.ch/iframe.html",
      }),
    };

    const { covered, leftOut } = applyMemory(
      memory([sbbEntry]),
      Object.values(issues),
    );

    expect([...covered]).toEqual([
      issues.panelHeader,
      issues.radio,
      issues.headerButton,
      issues.tag,
    ]);
    // Excluded by the predicate's "Does not cover", not by any structured field.
    expect(covered.has(issues.breadcrumb)).toBe(false);
    expect(leftOut).toEqual([{ rule: "role-required", entry: 3, count: 4 }]);
  });

  it("never leaves out a tag the entry excludes or a counter-example names", () => {
    const rh = entry(5, {
      site: "www.redhat.com",
      pattern: {
        predicate: "Red Hat design system elements",
        tagPrefix: "rh-*",
      },
      counterExamples: ["rh-cta in the footer is a real issue"],
    });
    const page = { affected_page: "https://www.redhat.com/en" };
    const button = issue('<rh-button variant="primary">', page);
    const cta = issue('<rh-cta href="/x">', page);
    const tile = issue('<rh-tile id="t1">', page);
    const pfe = issue('<pfe-button variant="primary">', page);

    const withExclusion = memory([
      { ...rh, pattern: { ...rh.pattern, excludeTags: ["rh-tile"] } },
    ]);
    const { covered } = applyMemory(withExclusion, [button, cta, tile, pfe]);

    expect([...covered]).toEqual([button]);
  });

  it("applies an entry saved for all sites on every host", () => {
    const issues = [
      issue('<sbb-button tabindex="0">', {
        affected_page: "https://company.sbb.ch/de",
      }),
    ];
    expect(applyMemory(memory([sbbEntry]), issues).covered.size).toBe(0);
    expect(
      applyMemory(memory([{ ...sbbEntry, global: true }]), issues).covered.size,
    ).toBe(1);
  });

  it("leaves out a class family on any tag, and only elements with every class", () => {
    const swiper = entry(7, {
      site: "www.sbb.ch",
      pattern: {
        predicate: "Swiper carousel wrappers",
        classes: [".swiper-wrapper"],
      },
      counterExamples: [],
    });
    const div = issue('<div class="swiper-wrapper slides" style="">');
    const ul = issue("<ul class='swiper-wrapper'>");
    const other = issue('<div class="slides">');

    expect([
      ...applyMemory(memory([swiper]), [div, ul, other]).covered,
    ]).toEqual([div, ul]);
  });

  it("takes an exact tag list, and a component scope's tag from its seed", () => {
    const list = entry(8, {
      site: "www.sbb.ch",
      pattern: { predicate: "Shoelace buttons", tags: ["sl-button"] },
    });
    const component = entry(9, {
      site: "www.sbb.ch",
      matchScope: "component",
      pattern: { predicate: "the header button", tagPrefix: "sbb-" },
      seedIssue: { htmlSnippet: '<sbb-header-button id="nav-trigger">' },
    });
    const slButton = issue("<sl-button>");
    const slInput = issue("<sl-input>");
    const header = issue('<sbb-header-button icon-name="user-small">');
    const tag = issue("<sbb-tag>");

    const { covered } = applyMemory(memory([list, component]), [
      slButton,
      slInput,
      header,
      tag,
    ]);

    expect([...covered]).toEqual([slButton, header]);
  });

  it("leaves out an element scope's own element on its own page only", () => {
    const one = entry(10, {
      site: "www.sbb.ch",
      matchScope: "element",
      pattern: { predicate: "this one panel" },
      seedIssue: {
        pageUrl: `${SBB}/`,
        htmlSnippet: '<sbb-radio-button-panel  name="g1" tabindex="0">',
      },
    });
    const same = issue('<sbb-radio-button-panel name="g1" tabindex="0">');
    const otherPage = issue('<sbb-radio-button-panel name="g1" tabindex="0">', {
      affected_page: "https://www.sbb.ch/de/angebote/ga",
    });
    const sibling = issue('<sbb-radio-button-panel name="g2" tabindex="0">');

    expect([
      ...applyMemory(memory([one]), [same, otherPage, sibling]).covered,
    ]).toEqual([same]);
  });

  it("leaves to the agent what no structured field names", () => {
    const proseOnly = entry(11, {
      site: "www.sbb.ch",
      pattern: { predicate: "every sbb element that renders its own button" },
    });
    const plainTag = entry(12, {
      site: "www.sbb.ch",
      pattern: {
        predicate: "the promo banners",
        classes: ["chb"],
        isCustomElement: true,
      },
    });

    const result = applyMemory(memory([proseOnly, plainTag]), [
      issue("<sbb-button>"),
      issue('<div class="chb">'),
      issue("not html at all"),
    ]);

    expect(result.covered.size).toBe(0);
    expect(result.leftOut).toEqual([]);
  });

  it("leaves nothing out without a memory", () => {
    expect(applyMemory(undefined, [issue("<sbb-button>")]).covered.size).toBe(
      0,
    );
  });
});

describe("leftOutMessages", () => {
  it("says nothing when nothing was left out", () => {
    expect(leftOutMessages([])).toEqual([]);
  });

  it("counts what was left out by entry, quoted as untrusted, and says where it still shows", () => {
    const [message] = leftOutMessages([
      { rule: "role-required", entry: 3, count: 75 },
      { rule: "image-alt", entry: 9, count: 2 },
    ]);

    expect(message).toContain("left out 77 issues");
    expect(message).toMatch(/dashboard and the CSV export still list them/);
    expect(message).toMatch(/untrusted/i);
    expect(message).toContain('"entry":3');
  });
});

describe("memoryPayload", () => {
  it("leaves out the fullest rule's oldest entries first, and counts them", () => {
    const many = Array.from({ length: 40 }, (_, i) => entry(100 - i));
    const { json, omitted } = memoryPayload(memory(many), 4_000);

    expect(json.length).toBeLessThanOrEqual(4_000);
    const kept = JSON.parse(json)[0].entries.map((e: any) => e.id);
    expect(kept[0]).toBe(100);
    expect(omitted).toEqual([
      { rule: "role-required", count: 40 - kept.length },
    ]);
  });

  it("shortens long HTML snippets", () => {
    const long = entry(1, {
      seedIssue: { htmlSnippet: "<div>" + "x".repeat(1000) + "</div>" },
    });
    const html = JSON.parse(memoryPayload(memory([long])).json)[0].entries[0]
      .seed_issue.html;
    expect(html.length).toBeLessThanOrEqual(201);
  });
});

describe("the capabilities an answer names", () => {
  const index = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../capability/web_accessibility.capability-index.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ).web_accessibility;
  const byName = (name: string) =>
    index.capabilities.find((c: any) => c.name === name);

  it("exist in the Web Accessibility index", () => {
    expect(byName(SUBMIT_CAPABILITY)).toBeDefined();
    expect(byName(READ_CAPABILITY)).toBeDefined();
    expect(FP_FILING_GUIDE).toContain(SUBMIT_CAPABILITY);
  });

  it("are never destructive, which invokeCapability refuses before binding", () => {
    const fp = index.capabilities.filter(
      (c: any) => c.entity === "false_positive_feedback",
    );
    expect(fp.map((c: any) => [c.name, c.method, c.mode])).toEqual([
      ["submit_false_positive_feedback", "POST", "write"],
      ["get_false_positive_memory", "GET", "read"],
      ["revoke_false_positive_feedback", "POST", "write"],
    ]);
  });

  it("require on submit what the API refuses without", () => {
    const required = byName(SUBMIT_CAPABILITY)
      .body.filter((b: any) => b.required)
      .map((b: any) => b.name)
      .sort();
    expect(required).toEqual([
      "pageUrl",
      "pattern",
      "rootCause",
      "ruleCode",
      "scope",
      "userStatement",
      "verdict",
    ]);
  });
});
