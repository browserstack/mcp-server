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
