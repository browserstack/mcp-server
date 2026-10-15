import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));
vi.mock("webdriverio", () => ({ remote: vi.fn() }));
vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import { remote } from "webdriverio";
import { apiClient } from "../../src/lib/apiClient";
import appConfig from "../../src/config";
import {
  errorMessage,
  ownerKey,
  scrubSecrets,
} from "../../src/tools/device-session-utils/secrets";
import {
  __clearSessionsForTests,
  __registerSessionForTests,
  buildCapabilities,
  endDeviceSession,
  getOwnedSession,
  resolveDevice,
  sessionsOwnedBy,
  startDeviceSession,
  DeviceSession,
} from "../../src/tools/device-session-utils/session";
import {
  pressKey,
  setDeviceState,
  swipe,
  tap,
  textLocators,
  typeText,
  manageApp,
} from "../../src/tools/device-session-utils/actions";
import { uploadMedia, uploadMobileApp } from "../../src/tools/device-session-utils/rest";
import addDeviceSessionTools from "../../src/tools/device-session";
import addMobileDeviceTools from "../../src/tools/mobile-devices";

const config = {
  "browserstack-username": "alice_Ab12Cd",
  "browserstack-access-key": "fake-test-access-key",
};
const otherUser = {
  "browserstack-username": "mallory_Zz99",
  "browserstack-access-key": "other-fake-test-key",
};

function fakeBrowser(overrides: Record<string, any> = {}) {
  const el = {
    isExisting: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(undefined),
    getAttribute: vi.fn().mockResolvedValue("android.widget.EditText"),
    elementId: "el-1",
    clearValue: vi.fn(),
    addValue: vi.fn(),
  };
  return {
    el,
    browser: {
      sessionId: "sess-1",
      capabilities: { appPackage: "com.app" },
      $: vi.fn().mockResolvedValue(el),
      performActions: vi.fn().mockResolvedValue(undefined),
      releaseActions: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue(undefined),
      getWindowSize: vi.fn().mockResolvedValue({ width: 1000, height: 2000 }),
      getActiveElement: vi
        .fn()
        .mockResolvedValue({ "element-6066-11e4-a52e-4f735466cecf": "el-1" }),
      elementSendKeys: vi.fn().mockResolvedValue(undefined),
      elementClear: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      pressKeyCode: vi.fn(),
      ...overrides,
    } as any,
  };
}

function session(
  browser: any,
  platform: "android" | "ios" = "android",
  owner = ownerKey(config),
): DeviceSession {
  const s: DeviceSession = {
    sessionId: browser.sessionId ?? "sess-1",
    owner,
    platform,
    device: "Google Pixel 8",
    osVersion: "14.0",
    appUrl: "bs://abc",
    appId: platform === "ios" ? "com.app.ios" : "com.app",
    dashboardUrl: "https://app-automate.browserstack.com/x",
    startedAt: Date.now(),
    lastActionAt: Date.now(),
    actionCount: 0,
    browser,
  };
  __registerSessionForTests(s);
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
  __clearSessionsForTests();
});

describe("credential scrubbing", () => {
  it("removes username, key, url-encoded forms and url credentials", () => {
    const text = `POST https://alice_Ab12Cd:fake-test-access-key@hub/wd caps {"accessKey":"fake-test-access-key"} ${encodeURIComponent("fake-test-access-key")} https://x:y@other.com`;
    const out = scrubSecrets(text, config);
    expect(out).not.toContain("fake-test-access-key");
    expect(out).not.toContain("alice_Ab12Cd");
    expect(out).not.toContain("x:y@");
  });

  it("trims long driver errors and scrubs them", () => {
    const err = new Error(
      `boom fake-test-access-key\n${"stack line\n".repeat(50)}`,
    );
    const msg = errorMessage(err, config);
    expect(msg).not.toContain("fake-test-access-key");
    expect(msg.split("\n").length).toBeLessThanOrEqual(6);
  });
});

describe("device resolution and capabilities", () => {
  const devices = [
    { os: "android", os_version: "14.0", device: "Google Pixel 8" },
    { os: "android", os_version: "13.0", device: "Google Pixel 7" },
    { os: "android", os_version: "15.0", device: "Google Pixel 9" },
    { os: "android", os_version: "16.0", device: "Google Pixel 9" },
    { os: "ios", os_version: "17", device: "iPhone 15" },
  ];

  it("matches exact names case-insensitively and picks latest by default", () => {
    expect(resolveDevice(devices, "android", "google pixel 9", undefined)).toEqual({
      device: "Google Pixel 9",
      osVersion: "16.0",
    });
  });

  it("accepts a bare major version but never substitutes a different one", () => {
    expect(resolveDevice(devices, "android", "Google Pixel 9", "15").osVersion).toBe("15.0");
    expect(() => resolveDevice(devices, "android", "Google Pixel 8", "12")).toThrow(
      /has no OS version "12". Available: 14.0/,
    );
  });

  it("requires an exact device name and only suggests near misses", () => {
    expect(() => resolveDevice(devices, "android", "Pixel 8", undefined)).toThrow(
      /No android device is named "Pixel 8". Similar: .*Google Pixel 8/,
    );
  });

  it("never puts credentials in the capabilities", () => {
    const caps = buildCapabilities(
      { platform: "android", device: "Google Pixel 8", timezone: "Paris", gpsLocation: "1,2", locale: "fr_FR" },
      { device: "Google Pixel 8", osVersion: "14.0" },
      "bs://abc",
    );
    const json = JSON.stringify(caps);
    expect(json).not.toMatch(/accessKey|userName/);
    expect(caps).toMatchObject({
      platformName: "android",
      "appium:automationName": "UiAutomator2",
      "appium:app": "bs://abc",
      "appium:locale": "fr_FR",
      "bstack:options": {
        deviceName: "Google Pixel 8",
        osVersion: "14.0",
        idleTimeout: 300,
        interactiveDebugging: true,
        timezone: "Paris",
        gpsLocation: "1,2",
      },
    });
    const ios = buildCapabilities(
      { platform: "ios", device: "iPhone 15" },
      { device: "iPhone 15", osVersion: "17" },
      "bs://abc",
    );
    expect(ios["appium:automationName"]).toBe("XCUITest");
  });
});

describe("session lifecycle", () => {
  it("passes credentials as hub auth, silences webdriverio, and tracks the session", async () => {
    (apiClient.get as any).mockResolvedValue({
      data: [{ os: "android", os_version: "14.0", device: "Google Pixel 8" }],
    });
    const { browser } = fakeBrowser();
    (remote as any).mockResolvedValue(browser);
    const { session: s } = await startDeviceSession(
      { platform: "android", device: "Google Pixel 8", app: "bs://abc" },
      config,
      2,
    );
    const opts = (remote as any).mock.calls[0][0];
    expect(opts.user).toBe(config["browserstack-username"]);
    expect(opts.key).toBe(config["browserstack-access-key"]);
    expect(opts.logLevel).toBe("silent");
    expect(JSON.stringify(opts.capabilities)).not.toContain(config["browserstack-access-key"]);
    expect(s.appId).toBe("com.app");
    expect(sessionsOwnedBy(config)).toHaveLength(1);
  });

  it("enforces the concurrent session limit before touching the network", async () => {
    session(fakeBrowser().browser);
    await expect(
      startDeviceSession({ platform: "android", device: "x", app: "bs://a" }, config, 1),
    ).rejects.toThrow(/limit is 1/);
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it("requires exactly one app source", async () => {
    (apiClient.get as any).mockResolvedValue({
      data: [{ os: "android", os_version: "14.0", device: "Google Pixel 8" }],
    });
    await expect(
      startDeviceSession({ platform: "android", device: "Google Pixel 8" }, config, 2),
    ).rejects.toThrow(/exactly one of app/);
  });

  it("hides sessions owned by another BrowserStack user", () => {
    session(fakeBrowser().browser);
    expect(() => getOwnedSession("sess-1", otherUser)).toThrow(/No active device session/);
    // Same username with a different key is not the owner either.
    expect(() =>
      getOwnedSession("sess-1", { ...config, "browserstack-access-key": "wrong-fake-test-key" }),
    ).toThrow(/No active device session/);
    expect(getOwnedSession("sess-1", config).sessionId).toBe("sess-1");
  });

  it("ends the session, sets status, and survives an already-dead session", async () => {
    const { browser } = fakeBrowser({
      deleteSession: vi.fn().mockRejectedValue(new Error("invalid session id")),
    });
    session(browser);
    (apiClient.put as any).mockResolvedValue({ data: {} });
    const r = await endDeviceSession("sess-1", config, { status: "failed", reason: "x" });
    expect(r.statusError).toBeUndefined();
    expect((apiClient.put as any).mock.calls[0][0].body).toEqual({ status: "failed", reason: "x" });
    expect(sessionsOwnedBy(config)).toHaveLength(0);
  });
});

describe("device actions", () => {
  it("taps coordinates with a W3C touch pointer and annotates the timeline", async () => {
    const { browser } = fakeBrowser();
    const s = session(browser);
    const msg = await tap(s, { x: 10.4, y: 20.6, waitMs: 0, settleMs: 0 });
    expect(msg).toBe("Tapped (10,21)");
    const action = browser.performActions.mock.calls[0][0][0];
    expect(action.parameters.pointerType).toBe("touch");
    expect(action.actions[0]).toMatchObject({ type: "pointerMove", x: 10, y: 21 });
    expect(browser.execute.mock.calls.some((c: any[]) => String(c[0]).startsWith("browserstack_executor:"))).toBe(true);
    expect(s.actionCount).toBe(1);
  });

  it("finds elements by text with escaped locators", () => {
    expect(textLocators("android", `it's "x"`)[0]).toContain("concat(");
    expect(textLocators("ios", 'a"b')[0]).toContain('"a\\"b"');
  });

  it("waits for the element and reports a helpful miss", async () => {
    const { browser, el } = fakeBrowser();
    el.isExisting.mockResolvedValue(false);
    const s = session(browser);
    await expect(tap(s, { text: "Nope", waitMs: 0, settleMs: 0 })).rejects.toThrow(
      /No element with text "Nope" appeared/,
    );
  });

  it("types into a pinned element without echoing the value", async () => {
    const { browser } = fakeBrowser();
    const s = session(browser);
    const msg = await typeText(s, {
      value: "typed-xyz",
      text: "Password",
      clear: true,
      submit: true,
      waitMs: 0,
      settleMs: 0,
    });
    expect(msg).not.toContain("typed-xyz");
    expect(msg).toContain("Typed 9 character(s)");
    expect(browser.elementClear).toHaveBeenCalledWith("el-1");
    expect(browser.elementSendKeys).toHaveBeenCalledWith("el-1", "typed-xyz");
    expect(browser.execute).toHaveBeenCalledWith("mobile: pressKey", { keycode: 66 });
    // The annotation describes the action without the value either.
    const annotations = browser.execute.mock.calls
      .filter((c: any[]) => String(c[0]).startsWith("browserstack_executor:"))
      .map((c: any[]) => c[0]);
    expect(annotations.join(" ")).not.toContain("typed-xyz");
  });

  it("types into the element it was given and reports a non-text target instead of guessing", async () => {
    const { browser, el } = fakeBrowser();
    el.getAttribute.mockResolvedValue("android.widget.ImageView");
    const s = session(browser);
    const msg = await typeText(s, { value: "abc", text: "Search", clear: false, submit: false, waitMs: 0, settleMs: 0 });
    expect(browser.elementSendKeys).toHaveBeenCalledWith("el-1", "abc");
    expect(browser.getActiveElement).not.toHaveBeenCalled();
    expect(msg).toContain("ImageView, which may not accept text");
  });

  it("swipes in the finger's direction across the screen center", async () => {
    const { browser } = fakeBrowser();
    const s = session(browser);
    expect(await swipe(s, { direction: "up", durationMs: 300, settleMs: 0 })).toBe(
      "Swiped from (500,1500) to (500,500)",
    );
  });

  it("maps Android keys, falls back to the legacy endpoint, and rejects unknown keys", async () => {
    const { browser } = fakeBrowser();
    browser.execute.mockImplementation(async (cmd: string) => {
      if (cmd === "mobile: pressKey") throw new Error("unknown method");
    });
    const s = session(browser);
    await pressKey(s, { key: "Back", settleMs: 0 });
    expect(browser.pressKeyCode).toHaveBeenCalledWith(4);
    await expect(pressKey(s, { key: "launch_rockets", settleMs: 0 })).rejects.toThrow(/Unknown key/);
  });

  it("does the iOS back gesture from the very edge, in steps (what iOS 17 and 27 respond to)", async () => {
    const { browser } = fakeBrowser({ sessionId: "ios-1" });
    const s = session(browser, "ios");
    expect(await pressKey(s, { key: "back", settleMs: 0 })).toMatch(/left edge/);
    const steps = browser.performActions.mock.calls[0][0][0].actions;
    expect(steps[0]).toMatchObject({ type: "pointerMove", x: 0, y: 1000 });
    const moves = steps.filter((a: any) => a.type === "pointerMove").slice(1);
    expect(moves.map((m: any) => m.x)).toEqual([150, 300, 450, 600, 800]);
    expect(moves.every((m: any) => m.duration > 0)).toBe(true);
    await expect(pressKey(s, { keycode: 4, settleMs: 0 })).rejects.toThrow(/no numeric keycodes/);
  });

  it("restarts the app under test with platform-specific ids", async () => {
    const { browser } = fakeBrowser({ sessionId: "ios-2" });
    const s = session(browser, "ios");
    expect(await manageApp(s, { action: "restart", settleMs: 0 })).toBe("Restarted com.app.ios");
    const cmds = browser.execute.mock.calls.filter((c: any[]) => String(c[0]).startsWith("mobile:"));
    expect(cmds).toEqual([
      ["mobile: terminateApp", { bundleId: "com.app.ios" }],
      ["mobile: activateApp", { bundleId: "com.app.ios" }],
    ]);
  });

  it("drops a session BrowserStack already ended and says how to recover", async () => {
    const { browser } = fakeBrowser({
      performActions: vi.fn().mockRejectedValue(new Error("invalid session id: session has been terminated")),
    });
    const s = session(browser);
    await expect(tap(s, { x: 1, y: 1, waitMs: 0, settleMs: 0 })).rejects.toThrow(/has ended on BrowserStack/);
    expect(sessionsOwnedBy(config)).toHaveLength(0);
  });
});

// A phone with an on-screen keyboard: `shown` is read in order from `states`,
// then stays at the last value. On iOS the keyboard sits at y >= 561.
function keyboardPhone(platform: "ios" | "android", states: boolean[], target: Record<string, any> = {}) {
  const el = {
    isExisting: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(undefined),
    getAttribute: vi.fn().mockResolvedValue(platform === "ios" ? "XCUIElementTypeButton" : "android.widget.Button"),
    getLocation: vi.fn().mockResolvedValue({ x: 16, y: 692 }),
    getSize: vi.fn().mockResolvedValue({ width: 361, height: 48 }),
    elementId: "login",
    ...target,
  };
  const kb = { isExisting: vi.fn().mockResolvedValue(true), elementId: "kb" };
  let i = 0;
  const { browser } = fakeBrowser({
    sessionId: `${platform}-kb`,
    $: vi.fn(async (sel: string) => (String(sel).includes("XCUIElementTypeKeyboard") ? kb : el)),
    isKeyboardShown: vi.fn(async () => states[Math.min(i++, states.length - 1)]),
    getElementRect: vi.fn().mockResolvedValue({ x: 0, y: 561, width: 393, height: 233 }),
    hideKeyboard: vi.fn().mockRejectedValue(new Error("no")),
  });
  return { browser, el, s: session(browser, platform) };
}

describe("on-screen keyboard", () => {
  it("iOS: closes the keyboard before tapping an element it covers, then taps it", async () => {
    const { browser, el, s } = keyboardPhone("ios", [true, true, false]);
    const msg = await tap(s, { text: "Login", waitMs: 0, settleMs: 0 });
    expect(msg).toBe('Tapped "Login" (closed the on-screen keyboard first (Done key))');
    expect(browser.execute).toHaveBeenCalledWith("mobile: hideKeyboard", expect.objectContaining({ keys: expect.arrayContaining(["Done"]) }));
    expect(el.click).toHaveBeenCalled();
  });

  it("iOS: says plainly when the app gives no way to close the keyboard, without pressing Return", async () => {
    const { browser, el, s } = keyboardPhone("ios", [true]);
    await expect(tap(s, { text: "Login", waitMs: 0, settleMs: 0 })).rejects.toThrow(
      /"Login" is under the on-screen keyboard, and the app offers no way to close it \(tried: Done key, swipe down on the keyboard\)/,
    );
    expect(el.click).not.toHaveBeenCalled();
    const returnPressed = browser.execute.mock.calls.some((c: any[]) => c[1]?.keys?.includes("Return"));
    expect(returnPressed).toBe(false);
  });

  it("iOS: leaves the keyboard alone when it does not cover the element", async () => {
    const { browser, el, s } = keyboardPhone("ios", [true], { getLocation: vi.fn().mockResolvedValue({ x: 16, y: 286 }) });
    expect(await tap(s, { text: "User Name", waitMs: 0, settleMs: 0 })).toBe('Tapped "User Name"');
    expect(browser.execute.mock.calls.some((c: any[]) => c[0] === "mobile: hideKeyboard")).toBe(false);
    expect(el.click).toHaveBeenCalled();
  });

  it("Android: closes the keyboard before tapping a non-text element", async () => {
    const { browser, s } = keyboardPhone("android", [true, true, false]);
    expect(await tap(s, { text: "Login", waitMs: 0, settleMs: 0 })).toBe(
      'Tapped "Login" (closed the on-screen keyboard first (hide keyboard))',
    );
    expect(browser.execute).toHaveBeenCalledWith("mobile: hideKeyboard", {});
  });

  it("notes when a coordinate tap lands on the iOS keyboard instead of guessing", async () => {
    const { s } = keyboardPhone("ios", [true]);
    expect(await tap(s, { x: 196, y: 716, waitMs: 0, settleMs: 0 })).toMatch(
      /Tapped \(196,716\)\. Note: this point is on the on-screen keyboard \(it starts at y=561\)/,
    );
  });

  it("typeOnDevice: closes the keyboard afterwards when asked, and otherwise says it is open", async () => {
    const closed = keyboardPhone("android", [false, true, false], { getAttribute: vi.fn().mockResolvedValue("android.widget.EditText") });
    const msg = await typeText(closed.s, { value: "bob", text: "User", clear: false, submit: false, hideKeyboard: true, waitMs: 0, settleMs: 0 });
    expect(msg).toBe('Typed 3 character(s) into "User" and closed the on-screen keyboard');

    const open = keyboardPhone("android", [false, true], { getAttribute: vi.fn().mockResolvedValue("android.widget.EditText") });
    const msg2 = await typeText(open.s, { value: "bob", text: "User", clear: false, submit: false, waitMs: 0, settleMs: 0 });
    expect(msg2).toMatch(/The on-screen keyboard is open: tapOnDevice closes it automatically/);
  });

  it("setDeviceState hideKeyboard tries Return as a last resort and fails clearly", async () => {
    const { browser, s } = keyboardPhone("ios", [true]);
    await expect(setDeviceState(s, { hideKeyboard: true, settleMs: 0 })).rejects.toThrow(
      /keyboard is still open: this app offers no way to close it \(tried: Done key, swipe down on the keyboard, Return key\)/,
    );
    expect(browser.execute.mock.calls.some((c: any[]) => c[1]?.keys?.includes("Return"))).toBe(true);
  });
});

describe("app upload validation", () => {
  it("rejects ambiguous or unsafe sources before any request", async () => {
    await expect(uploadMobileApp({}, config)).rejects.toThrow(/exactly one/);
    await expect(
      uploadMobileApp({ url: "http://example.com/a.apk", filePath: "/x.apk" }, config),
    ).rejects.toThrow(/exactly one/);
    await expect(uploadMobileApp({ url: "http://example.com/a.apk" }, config)).rejects.toThrow(/https/);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("refuses server-local file uploads on the remote server", async () => {
    const original = appConfig.REMOTE_MCP;
    (appConfig as any).REMOTE_MCP = true;
    try {
      await expect(
        uploadMobileApp({ filePath: "/srv/uploads/app.apk" }, config),
      ).rejects.toThrow(/not available on the remote server/);
      await expect(uploadMedia({ filePath: "/srv/uploads/a.png" }, config)).rejects.toThrow(
        /not available on the remote server/,
      );
      expect(apiClient.post).not.toHaveBeenCalled();
    } finally {
      (appConfig as any).REMOTE_MCP = original;
    }
  });

  it("uploads by URL to App Automate with Basic auth and an optional custom id", async () => {
    (apiClient.post as any).mockResolvedValue({ data: { app_url: "bs://new", custom_id: "demo" } });
    const r = await uploadMobileApp({ url: "https://example.com/a.apk", customId: "demo" }, config);
    expect(r).toEqual({ app_url: "bs://new", custom_id: "demo" });
    const req = (apiClient.post as any).mock.calls[0][0];
    expect(req.url).toBe("https://api-cloud.browserstack.com/app-automate/upload");
    expect(req.headers.Authorization).toMatch(/^Basic /);
  });

  it("lists devices from App Automate only, with names startDeviceSession accepts", async () => {
    (apiClient.get as any).mockResolvedValue({
      data: [
        { os: "android", os_version: "14.0", device: "Google Pixel 8", device_tier: "Tier 3" },
        { os: "ios", os_version: "17", device: "iPhone 15" },
      ],
    });
    const tools = collect(addMobileDeviceTools);
    const r = await tools.listMobileDevices.handler({ platform: "android", limit: 10 });
    expect((apiClient.get as any).mock.calls[0][0].url).toBe(
      "https://api-cloud.browserstack.com/app-automate/devices.json",
    );
    expect(r.content[0].text).toContain("- [android] Google Pixel 8 — OS 14.0 (Tier 3)");
    expect(r.content[0].text).not.toContain("iPhone 15");
    expect(r.content[0].text).toContain("startDeviceSession");
  });
});

function collect(register: (server: any, config: any) => unknown) {
  const tools: Record<string, any> = {};
  const serverMock = {
    tool: vi.fn((...args: any[]) => {
      tools[args[0]] = { annotations: args[3], handler: args[4] };
      return {};
    }),
    server: { getClientVersion: vi.fn().mockReturnValue({ name: "t", version: "1" }) },
  };
  register(serverMock, config);
  return tools;
}

describe("tool registration", () => {
  it("registers the device session group with honest annotations", () => {
    const tools = collect(addDeviceSessionTools);
    expect(Object.keys(tools).sort()).toEqual(
      [
        "endDeviceSession",
        "getDeviceSession",
        "manageDeviceApp",
        "pressDeviceKey",
        "setDeviceState",
        "startDeviceSession",
        "swipeOnDevice",
        "takeDeviceScreenshot",
        "tapOnDevice",
        "typeOnDevice",
        "uninstallDeviceApp",
        "simulateBiometric",
        "runAdbShellCommand",
        "pushFileToDevice",
        "pullFileFromDevice",
        "injectCameraImage",
        "setDeviceLocation",
        "setNetworkConditions",
      ].sort(),
    );
    expect(tools.uninstallDeviceApp.annotations.destructiveHint).toBe(true);
    expect(tools.takeDeviceScreenshot.annotations.readOnlyHint).toBe(true);
    expect(tools.tapOnDevice.annotations.readOnlyHint).toBe(false);
    expect(tools.startDeviceSession.annotations.openWorldHint).toBe(true);
  });

  it("registers the catalog group", () => {
    const tools = collect(addMobileDeviceTools);
    expect(Object.keys(tools).sort()).toEqual(
      ["getAppAutomatePlan", "getTeamDefaultDevices", "listDedicatedDevices", "listMobileDevices", "listUploadedApps", "uploadMediaFile", "uploadMobileApp"].sort(),
    );
    expect(tools.listMobileDevices.annotations.readOnlyHint).toBe(true);
  });

  it("can be switched off as a group", () => {
    const original = appConfig.DEVICE_SESSION_TOOLS_ENABLED;
    (appConfig as any).DEVICE_SESSION_TOOLS_ENABLED = false;
    try {
      expect(Object.keys(collect(addDeviceSessionTools))).toEqual([]);
    } finally {
      (appConfig as any).DEVICE_SESSION_TOOLS_ENABLED = original;
    }
  });

  it("returns scrubbed isError results instead of throwing", async () => {
    const tools = collect(addDeviceSessionTools);
    const r = await tools.tapOnDevice.handler({ sessionId: "nope", x: 1, y: 1 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Failed to tap: No active device session/);

    (apiClient.get as any).mockRejectedValue(
      Object.assign(new Error(`401 for ${config["browserstack-access-key"]}`), {}),
    );
    const r2 = await tools.getDeviceSession.handler({ sessionId: "abc" });
    expect(r2.isError).toBe(true);
    expect(r2.content[0].text).not.toContain(config["browserstack-access-key"]);
  });
});
