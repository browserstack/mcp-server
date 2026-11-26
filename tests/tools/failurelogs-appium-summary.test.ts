import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "../../src/lib/apiClient";
import {
  retrieveAppiumLogs,
  summarizeAppiumFailures,
} from "../../src/tools/failurelogs-utils/app-automate";

vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: vi.fn(() => "user:key"),
}));

const DRIVER = "[XCUITestDriver@80e1 (f30db832)] [XCUITestDriver@80e1 (f30db832)]";
const SELECTOR = '//XCUIElementTypeButton[@name=\\"Pay\\"]';

function findAttempt(second: number): string[] {
  const ts = `2026-11-23 05:54:${String(second).padStart(2, "0")}`;
  return [
    `${ts}:100 - [HTTP] --> POST /wd/hub/session/f30db832/element`,
    `${ts}:101 - [HTTP] {"using":"xpath","value":"${SELECTOR}"}`,
    `${ts}:102 - [debug] [W3C (f30db832)] Calling AppiumDriver.findElement() with args: ["xpath","${SELECTOR}","f30db832"]`,
    `${ts}:300 - [debug] [W3C] [W3C] Matched W3C error code 'no such element' to NoSuchElementError`,
    `${ts}:301 - [debug] ${DRIVER} Encountered internal error running command: NoSuchElementError: An element could not be located on the page using the given search parameters.`,
    `${ts}:302 - [debug] ${DRIVER}     at errorFromW3CJsonCode (/appium/lib/protocol/errors.js:1040:25)`,
    `${ts}:303 - [HTTP] <-- POST /wd/hub/session/f30db832/element 404 201 ms - 574`,
  ];
}

const CLICK = [
  "2026-11-23 05:54:10:000 - [HTTP] --> POST /wd/hub/session/f30db832/element/abc/click",
  "2026-11-23 05:54:10:001 - [HTTP] {}",
  '2026-11-23 05:54:10:002 - [debug] [W3C (f30db832)] Calling AppiumDriver.click() with args: ["abc","f30db832"]',
  "2026-11-23 05:54:10:200 - [HTTP] <-- POST /wd/hub/session/f30db832/element/abc/click 200 198 ms - 14",
];

describe("summarizeAppiumFailures", () => {
  it("keeps each distinct error once, with its command, locator and the command before it", () => {
    const log = [...CLICK, ...findAttempt(11), ...findAttempt(12), ...findAttempt(13)].join("\n");

    const { failures, totalLines, omitted } = summarizeAppiumFailures(log);

    expect(totalLines).toBe(6);
    expect(omitted).toBe(0);
    expect(failures).toHaveLength(2);
    expect(failures[1]).toEqual({
      error:
        "Encountered internal error running command: NoSuchElementError: An element could not be located on the page using the given search parameters.",
      count: 3,
      first_seen: "2026-11-23 05:54:11:301",
      last_seen: "2026-11-23 05:54:13:301",
      command: `findElement(["xpath","${SELECTOR}","f30db832"])`,
      previous_command: 'click(["abc","f30db832"])',
    });
  });

  it("drops stack frames and lines without a failure keyword", () => {
    const { failures } = summarizeAppiumFailures(findAttempt(11).join("\n"));

    expect(failures.map((f) => f.error)).not.toContainEqual(expect.stringMatching(/^at /));
    expect(failures.map((f) => f.error)).not.toContainEqual(expect.stringContaining("<-- POST"));
  });

  it("uses the HTTP request and body when no Calling line follows", () => {
    const log = [
      "2026-11-23 05:54:11:100 - [HTTP] --> POST /wd/hub/session/f30db832/element",
      '2026-11-23 05:54:11:101 - [HTTP] {"using":"accessibility id","value":"payBill"}',
      "2026-11-23 05:54:11:300 - [W3C] Matched W3C error code 'no such element' to NoSuchElementError",
    ].join("\n");

    const { failures } = summarizeAppiumFailures(log);

    expect(failures[0].command).toBe(
      'POST /wd/hub/session/f30db832/element {"using":"accessibility id","value":"payBill"}',
    );
    expect(failures[0]).not.toHaveProperty("last_seen");
  });

  it("hides text typed into the app", () => {
    const log = [
      '2026-11-23 05:54:20:100 - [debug] [W3C (f30db832)] Calling AppiumDriver.setValue() with args: [["s","3","c","r","3","t"],"0A01","f30db832"]',
      "2026-11-23 05:54:20:300 - [W3C] Encountered internal error running command: InvalidElementStateError: element is not editable",
      "2026-11-23 05:54:21:100 - [HTTP] --> POST /wd/hub/session/f30db832/element/0A02/value",
      '2026-11-23 05:54:21:101 - [HTTP] {"text":"s3cr3t","value":["s","3","c","r","3","t"]}',
      "2026-11-23 05:54:21:300 - [W3C] Command failed: element is not editable",
      '2026-11-23 05:54:22:100 - [debug] [W3C (f30db832)] Calling AppiumDriver.performActions() with args: [[{"type":"key","id":"k","actions":[{"type":"keyDown","value":"s"}]}],"f30db832"]',
      "2026-11-23 05:54:22:300 - [W3C] Command failed: no keyboard",
    ].join("\n");

    const { failures } = summarizeAppiumFailures(log);

    expect(JSON.stringify(failures)).not.toMatch(/s3cr3t|"s","3"|"value":"s"/);
    expect(failures[0].command).toBe('setValue(["[redacted]","0A01","f30db832"])');
    expect(failures[1].command).toBe(
      'POST /wd/hub/session/f30db832/element/0A02/value {"text":"[redacted]","value":"[redacted]"}',
    );
    expect(failures[2].command).toContain('"type":"keyDown","value":"[redacted]"');
  });

  it("hides text typed through execute", () => {
    const log = [
      "2026-11-23 05:54:30:100 - [HTTP] --> POST /wd/hub/session/f30db832/execute/sync",
      '2026-11-23 05:54:30:101 - [HTTP] {"script":"mobile: type","args":[{"text":"otp-482913"}]}',
      '2026-11-23 05:54:30:102 - [debug] [W3C (f30db832)] Calling AppiumDriver.execute() with args: ["mobile: type",[{"text":"otp-482913"}],"f30db832"]',
      "2026-11-23 05:54:30:300 - [W3C] Command failed: no focused element",
      '2026-11-23 05:54:31:102 - [debug] [W3C (f30db832)] Calling AppiumDriver.execute() with args: ["mobile: keys",{"keys":["p","4","s","s"]},"f30db832"]',
      "2026-11-23 05:54:31:300 - [W3C] Command failed: keyboard not shown",
    ].join("\n");

    const { failures } = summarizeAppiumFailures(log);
    const text = JSON.stringify(failures);

    expect(text).not.toContain("otp-482913");
    expect(text).not.toMatch(/"p","4"/);
    expect(failures[0].command).toBe(
      'execute(["mobile: type",[{"text":"[redacted]"}],"f30db832"])',
    );
    expect(failures[1].command).toBe(
      'execute(["mobile: keys",{"keys":"[redacted]"},"f30db832"])',
    );
    expect(failures[1].previous_command).toBe(failures[0].command);
  });

  it("keeps the locator of a find command", () => {
    const { failures } = summarizeAppiumFailures(findAttempt(11).join("\n"));

    expect(failures[0].command).toContain(SELECTOR);
  });

  it("stops adding failures at the total size budget", () => {
    const log = Array.from(
      { length: 50 },
      (_, i) =>
        `2026-11-23 05:54:11:${String(i).padStart(3, "0")} - [W3C] Command failed: ${String(i).padStart(3, "0")} ${"y".repeat(900)}`,
    ).join("\n");

    const { failures, omitted } = summarizeAppiumFailures(log);

    expect(JSON.stringify(failures).length).toBeLessThanOrEqual(30_000);
    expect(failures.length + omitted).toBe(50);
    expect(omitted).toBeGreaterThan(0);
  });

  it("caps the number of distinct failures and reports the rest", () => {
    const log = Array.from(
      { length: 60 },
      (_, i) => `2026-11-23 05:54:11:${String(i).padStart(3, "0")} - [W3C] Command failed: step ${i}`,
    ).join("\n");

    const { failures, omitted } = summarizeAppiumFailures(log);

    expect(failures).toHaveLength(50);
    expect(omitted).toBe(10);
  });
});

describe("retrieveAppiumLogs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the summarised failures with their commands", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({
      ok: true,
      status: 200,
      data: [...CLICK, ...findAttempt(11), ...findAttempt(12)].join("\n"),
    } as any);

    const text = await retrieveAppiumLogs("session456", "build123", {} as any);

    expect(text).toContain("Appium Failures (2 distinct, 4 lines");
    expect(text).toContain('"count": 2');
    expect(text).toContain("findElement(");
  });

  it("says so when the log has no failures", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({
      ok: true,
      status: 200,
      data: CLICK.join("\n"),
    } as any);

    expect(await retrieveAppiumLogs("session456", "build123", {} as any)).toBe(
      "No Appium failures found",
    );
  });
});
