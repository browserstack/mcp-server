import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import {
  fetchAutomationScreenshots,
  parseScreenshotUrls,
} from "../../src/tools/automate-utils/fetch-screenshots";
import { SessionType } from "../../src/lib/constants";
import { apiClient } from "../../src/lib/apiClient";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

const S = "9eaca30c2d3fb8517ac11e469724ab2421bc63c3";
const S3 = `https://automate.browserstack.com/s3-debug/browserstack-debug-screenshots-prod-use1/${S}`;

const debugOnlyLogs = [
  `2026-10-13 9:12:45:16 REQUEST [2026-10-13 9:12:45:16] POST /session/${S}/url {"url":"https://bstackdemo.com/signin"}`,
  `2026-10-13 9:12:46:632 DEBUG ${S3}/screenshot-4.jpeg`,
  `2026-10-13 9:12:46:633 RESPONSE {"text":{"response":{"guid":"response@23b4"}}}`,
  `2026-10-13 9:12:48:839 REQUEST [2026-10-13 9:12:48:839] POST /session/${S}/click {"selector":"#username"}`,
  `2026-10-13 9:12:49:127 DEBUG ${S3}/screenshot-6.jpeg`,
  `2026-10-13 9:12:49:200 RESPONSE {"text":{}}`,
].join("\n");

const requestedOnlyLogs = [
  `2026-10-13 9:18:20:871 REQUEST [2026-10-13 9:18:20:871] GET /session/${S}/screenshot {"text":{"fullPage":false}}`,
  `2026-10-13 9:18:21:3 RESPONSE {"value":"${S3}/screenshot-playwright-85c8de7c55.png"}`,
  `2026-10-13 9:18:23:992 REQUEST [2026-10-13 9:18:23:992] GET /session/${S}/screenshot {"text":{}}`,
  `2026-10-13 9:18:24:81 RESPONSE {"value":"${S3}/screenshot-playwright-304ad8e401.png"}`,
].join("\n");

describe("parseScreenshotUrls", () => {
  it("extracts DEBUG visual-log screenshots", () => {
    expect(parseScreenshotUrls(debugOnlyLogs)).toEqual([
      `${S3}/screenshot-4.jpeg`,
      `${S3}/screenshot-6.jpeg`,
    ]);
  });

  it("extracts screenshots requested via GET /screenshot", () => {
    expect(parseScreenshotUrls(requestedOnlyLogs)).toEqual([
      `${S3}/screenshot-playwright-85c8de7c55.png`,
      `${S3}/screenshot-playwright-304ad8e401.png`,
    ]);
  });

  it("merges both sources in log order", () => {
    const logs = [
      `2026-10-13 9:20:22:000 REQUEST [2026-10-13 9:20:22:000] POST /session/${S}/url {"url":"https://example.com"}`,
      `2026-10-13 9:20:22:114 DEBUG ${S3}/screenshot-24ff228371.jpeg`,
      `2026-10-13 9:20:22:200 RESPONSE {"value":null}`,
      `2026-10-13 9:20:23:500 REQUEST [2026-10-13 9:20:23:500] GET /session/${S}/screenshot {}`,
      `2026-10-13 9:20:23:740 RESPONSE {"value":"${S3}/screenshot-selenium-2d84facd1a.png"}`,
    ].join("\n");

    expect(parseScreenshotUrls(logs)).toEqual([
      `${S3}/screenshot-24ff228371.jpeg`,
      `${S3}/screenshot-selenium-2d84facd1a.png`,
    ]);
  });

  it("accepts B2 and direct bucket URLs on DEBUG lines", () => {
    const b2 = `https://automate.browserstack.com/b2-debug/bucket/s3.us-east-005.backblazeb2.com/${S}/screenshot-2.jpeg`;
    const direct = `https://browserstack-debug-screenshots-prod-use1.s3.amazonaws.com/${S}/screenshot-3.jpeg`;
    const logs = [
      `2026-10-13 9:00:00:000 DEBUG ${b2}`,
      `2026-10-13 9:00:01:000 DEBUG ${direct}`,
    ].join("\r\n");

    expect(parseScreenshotUrls(logs)).toEqual([b2, direct]);
  });

  it("skips intermediate lines between a screenshot request and its response", () => {
    const logs = [
      `2026-10-13 9:00:00:000 REQUEST [2026-10-13 9:00:00:000] GET /session/${S}/screenshot {}`,
      `2026-10-13 9:00:00:050 PERFORMANCE {"lcp":120}`,
      `2026-10-13 9:00:00:100 RESPONSE {"value":"${S3}/screenshot-selenium-1.png"}`,
    ].join("\n");

    expect(parseScreenshotUrls(logs)).toEqual([
      `${S3}/screenshot-selenium-1.png`,
    ]);
  });

  it("does not borrow a later request's response value", () => {
    const logs = [
      `2026-10-13 9:00:00:000 REQUEST [2026-10-13 9:00:00:000] GET /session/${S}/screenshot {}`,
      `2026-10-13 9:00:01:000 REQUEST [2026-10-13 9:00:01:000] GET /session/${S}/title`,
      `2026-10-13 9:00:01:100 RESPONSE {"value":"Example Domain"}`,
    ].join("\n");

    expect(parseScreenshotUrls(logs)).toEqual([]);
  });

  it("ignores DEBUG and response URLs echoed inside request payloads", () => {
    const logs = [
      `2026-10-13 9:00:00:000 REQUEST [2026-10-13 9:00:00:000] POST /session/${S}/value {"text":"x DEBUG https://evil.browserstack.com.attacker.io/a.png"}`,
      `2026-10-13 9:00:00:100 RESPONSE {"value":null}`,
      `2026-10-13 9:00:01:000 REQUEST [2026-10-13 9:00:01:000] POST /session/${S}/execute {"script":"GET /session/x/screenshot"}`,
      `2026-10-13 9:00:01:100 RESPONSE {"value":"https://automate.browserstack.com/not-a-screenshot"}`,
      `2026-10-13 9:00:02:000 REQUEST [2026-10-13 9:00:02:000] GET /session/${S}/screenshot {}`,
      `2026-10-13 9:00:02:100 RESPONSE {"other":{"value":"${S3}/nested.png"}}`,
    ].join("\n");

    expect(parseScreenshotUrls(logs)).toEqual([]);
  });

  it("drops URLs outside BrowserStack, S3 and B2 hosts", () => {
    const logs = [
      `2026-10-13 9:00:00:000 DEBUG http://169.254.169.254/latest/meta-data/`,
      `2026-10-13 9:00:01:000 DEBUG https://169.254.169.254/latest/meta-data/`,
      `2026-10-13 9:00:02:000 DEBUG https://localhost/screenshot-1.jpeg`,
      `2026-10-13 9:00:03:000 DEBUG https://browserstack.com.evil.io/screenshot-2.jpeg`,
      `2026-10-13 9:00:04:000 DEBUG https://sts.amazonaws.com/screenshot-3.jpeg`,
      `2026-10-13 9:00:05:000 DEBUG ${S3}/screenshot-4.jpeg`,
    ].join("\n");

    expect(parseScreenshotUrls(logs)).toEqual([`${S3}/screenshot-4.jpeg`]);
  });

  it("returns nothing when the session has no screenshots", () => {
    const logs = [
      `2026-10-13 9:21:1:278 REQUEST [2026-10-13 9:21:1:278] POST /session/${S}/url {"url":"https://example.com"}`,
      `2026-10-13 9:21:3:848 RESPONSE {"value":null}`,
    ].join("\n");

    expect(parseScreenshotUrls(logs)).toEqual([]);
  });
});

describe("fetchAutomationScreenshots", () => {
  beforeEach(() => vi.clearAllMocks());

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

  it("returns the last five screenshots with detected mime types", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `${S3}/screenshot-${i}.jpeg`);
    const logs = urls
      .map((u, i) => `2026-10-13 9:00:0${i}:000 DEBUG ${u}`)
      .concat(requestedOnlyLogs.split("\n").slice(0, 2))
      .join("\n");

    (apiClient.get as Mock).mockImplementation(async ({ url }) => {
      if (url.endsWith("/logs")) {
        return { ok: true, status: 200, data: logs };
      }
      return { ok: true, status: 200, data: url.endsWith(".png") ? png : jpeg };
    });

    const result = await fetchAutomationScreenshots(
      S,
      SessionType.Automate,
      mockConfig,
    );

    expect(result.map((s) => s.url)).toEqual([
      ...urls.slice(2),
      `${S3}/screenshot-playwright-85c8de7c55.png`,
    ]);
    expect(result.map((s) => s.mimeType)).toEqual([
      "image/jpeg",
      "image/jpeg",
      "image/jpeg",
      "image/jpeg",
      "image/png",
    ]);
  });
});
