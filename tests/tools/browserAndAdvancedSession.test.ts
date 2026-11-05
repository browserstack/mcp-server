import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));
vi.mock("webdriverio", () => ({ remote: vi.fn() }));
vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  execFile: vi.fn(() => ({ unref: vi.fn() })),
}));
vi.mock("../../src/lib/local", () => ({
  ensureLocalBinarySetup: vi.fn().mockResolvedValue(undefined),
}));

import { remote } from "webdriverio";
import { apiClient } from "../../src/lib/apiClient";
import { ensureLocalBinarySetup } from "../../src/lib/local";
import appConfig from "../../src/config";
import {
  __clearBrowserSessionsForTests,
  __registerBrowserSessionForTests,
  buildBrowserCapabilities,
  getOwnedBrowserSession,
  resolveBrowserTarget,
  startBrowserSession,
} from "../../src/tools/browser-session-utils/session";
import {
  scroll,
  switchContext,
  typeOrSelect,
  webTextLocators,
} from "../../src/tools/browser-session-utils/actions";
import {
  checkAdbCommand,
  injectCameraImage,
  pullFile,
  runAdbShell,
  setNetwork,
} from "../../src/tools/device-session-utils/actions-advanced";
import {
  __clearSessionsForTests,
  __registerSessionForTests,
  buildCapabilities,
} from "../../src/tools/device-session-utils/session";
import {
  __resetLocalTunnelForTests,
  ensureLocalTunnel,
  localCapabilities,
} from "../../src/tools/device-session-utils/local-tunnel";
import { withLiveView } from "../../src/tools/device-session-utils/register-helpers";
import { ownerKey } from "../../src/tools/device-session-utils/secrets";
import { pushFile } from "../../src/tools/device-session-utils/actions-advanced";
import addBrowserSessionTools from "../../src/tools/browser-session";
import addDeviceSessionTools from "../../src/tools/device-session";

const config = {
  "browserstack-username": "alice_Ab12Cd",
  "browserstack-access-key": "fake-test-access-key",
};

const BROWSERS = [
  { os: "Windows", os_version: "11", browser: "chrome", browser_version: "120.0", device: null, real_mobile: null },
  { os: "Windows", os_version: "11", browser: "chrome", browser_version: "121.0", device: null, real_mobile: null },
  { os: "Windows", os_version: "11", browser: "firefox", browser_version: "119.0", device: null, real_mobile: null },
  { os: "OS X", os_version: "Sonoma", browser: "safari", browser_version: "17.0", device: null, real_mobile: null },
  { os: "android", os_version: "14.0", browser: "chrome", browser_version: null, device: "Google Pixel 8", real_mobile: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  __clearBrowserSessionsForTests();
  __clearSessionsForTests();
  __resetLocalTunnelForTests();
});

describe("browser target resolution (exact, no guessing)", () => {
  it("resolves desktop with latest by default and a bare major", () => {
    expect(resolveBrowserTarget(BROWSERS, { browser: "Chrome", os: "windows", osVersion: "11" })).toMatchObject({
      browserName: "chrome",
      browserVersion: "latest",
      os: "Windows",
      osVersion: "11",
    });
    expect(
      resolveBrowserTarget(BROWSERS, { browser: "chrome", os: "Windows", osVersion: "11", browserVersion: "120" }).browserVersion,
    ).toBe("120.0");
  });

  it("refuses unknown OS versions, browsers and versions with the valid options", () => {
    expect(() => resolveBrowserTarget(BROWSERS, { browser: "chrome", os: "Windows", osVersion: "9" })).toThrow(
      /Windows versions: 11/,
    );
    expect(() => resolveBrowserTarget(BROWSERS, { browser: "safari", os: "Windows", osVersion: "11" })).toThrow(
      /Available: chrome, firefox/,
    );
    expect(() =>
      resolveBrowserTarget(BROWSERS, { browser: "chrome", os: "Windows", osVersion: "11", browserVersion: "99" }),
    ).toThrow(/not available/);
  });

  it("resolves real mobile browsers by exact device name", () => {
    expect(resolveBrowserTarget(BROWSERS, { browser: "chrome", device: "google pixel 8" })).toMatchObject({
      device: "Google Pixel 8",
      osVersion: "14.0",
    });
    expect(() => resolveBrowserTarget(BROWSERS, { browser: "chrome", device: "Pixel 8" })).toThrow(/No real-device browser/);
  });

  it("builds capabilities without credentials, with local when asked", () => {
    const t = resolveBrowserTarget(BROWSERS, { browser: "chrome", os: "Windows", osVersion: "11" });
    const caps = buildBrowserCapabilities(
      { browser: "chrome", os: "Windows", osVersion: "11", resolution: "1920x1080" },
      t,
      localCapabilities("mcp-1"),
    );
    expect(JSON.stringify(caps)).not.toMatch(/accessKey|userName/);
    expect(caps).toMatchObject({
      browserName: "chrome",
      browserVersion: "latest",
      "bstack:options": { os: "Windows", osVersion: "11", resolution: "1920x1080", local: true, localIdentifier: "mcp-1" },
    });
  });
});

describe("browser session lifecycle and actions", () => {
  function fakeBrowser(extra: Record<string, any> = {}) {
    const el = {
      isExisting: vi.fn().mockResolvedValue(true),
      getTagName: vi.fn().mockResolvedValue("select"),
      selectByVisibleText: vi.fn().mockRejectedValue(new Error("no such text")),
      selectByAttribute: vi.fn().mockResolvedValue(undefined),
      clearValue: vi.fn().mockResolvedValue(undefined),
      addValue: vi.fn().mockResolvedValue(undefined),
      scrollIntoView: vi.fn().mockResolvedValue(undefined),
    };
    return {
      el,
      b: {
        sessionId: "web-1",
        $: vi.fn().mockResolvedValue(el),
        execute: vi.fn().mockResolvedValue([0, 600]),
        keys: vi.fn(),
        url: vi.fn(),
        getTitle: vi.fn().mockResolvedValue("T"),
        getUrl: vi.fn().mockResolvedValue("https://x"),
        getWindowHandle: vi.fn().mockResolvedValue("h1"),
        getWindowHandles: vi.fn().mockResolvedValue(["h1"]),
        switchToWindow: vi.fn(),
        closeWindow: vi.fn(),
        deleteSession: vi.fn(),
        ...extra,
      } as any,
    };
  }
  const register = (b: any) => {
    const s = {
      sessionId: b.sessionId,
      owner: ownerKey(config),
      target: "chrome on Windows 11",
      dashboardUrl: "d",
      local: false,
      startedAt: Date.now(),
      lastActionAt: Date.now(),
      actionCount: 0,
      browser: b,
    };
    __registerBrowserSessionForTests(s);
    return s;
  };

  it("starts through Local when asked, with silent webdriverio and header auth", async () => {
    (apiClient.get as any).mockResolvedValue({ data: BROWSERS });
    const { b } = fakeBrowser();
    (remote as any).mockResolvedValue(b);
    const { session } = await startBrowserSession(
      { browser: "chrome", os: "Windows", osVersion: "11", local: true, url: "http://localhost:3000" },
      config,
      2,
    );
    expect(ensureLocalBinarySetup).toHaveBeenCalledWith(
      config["browserstack-username"],
      config["browserstack-access-key"],
      `mcp-${process.pid}`,
    );
    const opts = (remote as any).mock.calls[0][0];
    expect(opts).toMatchObject({ hostname: "hub.browserstack.com", logLevel: "silent", user: config["browserstack-username"] });
    expect(opts.capabilities["bstack:options"]).toMatchObject({ local: true, localIdentifier: `mcp-${process.pid}` });
    expect(b.url).toHaveBeenCalledWith("http://localhost:3000");
    expect(session.local).toBe(true);
    expect(getOwnedBrowserSession("web-1", config).sessionId).toBe("web-1");
    expect(() => getOwnedBrowserSession("web-1", { ...config, "browserstack-username": "other" })).toThrow(/No active browser session/);
    expect(() => getOwnedBrowserSession("web-1", { ...config, "browserstack-access-key": "wrong-fake-test-key" })).toThrow(
      /No active browser session/,
    );
  });

  it("starts the Local tunnel once and shares it", async () => {
    await ensureLocalTunnel(config);
    await ensureLocalTunnel(config);
    expect(ensureLocalBinarySetup).toHaveBeenCalledTimes(1);
  });

  it("refuses Local on the remote server", async () => {
    const original = appConfig.REMOTE_MCP;
    (appConfig as any).REMOTE_MCP = true;
    try {
      await expect(ensureLocalTunnel(config)).rejects.toThrow(/remote MCP server cannot start/);
    } finally {
      (appConfig as any).REMOTE_MCP = original;
    }
  });

  it("selects an option by value when the visible text does not match", async () => {
    const { b, el } = fakeBrowser();
    const s = register(b);
    expect(await typeOrSelect(s, { selector: "#d", option: "2", clear: false, submit: false, waitMs: 0, settleMs: 0 })).toBe(
      'Selected "2" in selector #d',
    );
    expect(el.selectByAttribute).toHaveBeenCalledWith("value", "2");
  });

  it("never echoes typed web values", async () => {
    const { b, el } = fakeBrowser();
    const s = register(b);
    const msg = await typeOrSelect(s, { selector: "#pw", value: "typed-x", clear: true, submit: true, waitMs: 0, settleMs: 0 });
    expect(msg).not.toContain("typed-x");
    expect(el.addValue).toHaveBeenCalledWith("typed-x");
    expect(b.keys).toHaveBeenCalledWith("Enter");
  });

  it("scrolls by direction and refuses to close the last tab", async () => {
    const { b } = fakeBrowser();
    const s = register(b);
    expect(await scroll(s, { direction: "down", pixels: 600, waitMs: 0, settleMs: 0 })).toMatch(/Scrolled down 600px/);
    await expect(switchContext(s, { action: "closeTab", settleMs: 0 })).rejects.toThrow(/last tab/);
  });

  it("builds escaped text locators for the web", () => {
    expect(webTextLocators(`it's "x"`)[0]).toContain("concat(");
  });
});

describe("App Automate V2 extras", () => {
  function deviceSession(platform: "android" | "ios", execute = vi.fn().mockResolvedValue("14")) {
    const b: any = {
      sessionId: `d-${platform}`,
      execute,
      pullFile: vi.fn(),
      pushFile: vi.fn(),
    };
    const s: any = {
      sessionId: b.sessionId,
      owner: ownerKey(config),
      platform,
      device: "x",
      osVersion: "1",
      appUrl: "bs://a",
      dashboardUrl: "d",
      startedAt: Date.now(),
      lastActionAt: Date.now(),
      actionCount: 0,
      browser: b,
    };
    __registerSessionForTests(s);
    return { s, b };
  }

  it("allows only getprop, so nothing can list apps other customers left on shared phones", () => {
    expect(checkAdbCommand(" getprop  ro.build.version.release ")).toBe("getprop ro.build.version.release");
    expect(() => checkAdbCommand("getprop")).toThrow(/Only "getprop <property>"/);
    for (const leaky of ["pm list packages -3", "pm list packages", "dumpsys location", "dumpsys window displays", "dumpsys package", "cmd package list packages", "ls /data/app"]) {
      expect(() => checkAdbCommand(leaky), leaky).toThrow(/Only "getprop <property>"/);
    }
    expect(() => checkAdbCommand("getprop ro.x extra")).toThrow(/not allowed/);
    expect(() => checkAdbCommand("rm -rf /sdcard")).toThrow(/not allowed/);
    expect(() => checkAdbCommand("getprop; reboot")).toThrow(/Shell operators/);
    expect(() => checkAdbCommand("getprop $(id)")).toThrow(/Shell operators/);
  });

  it("runs adb through the BrowserStack executor, Android only", async () => {
    const { s, b } = deviceSession("android");
    expect(await runAdbShell(s, "getprop ro.build.version.release")).toBe("14");
    expect(b.execute.mock.calls[0][0]).toBe(
      'browserstack_executor: {"action":"adbShell","arguments":{"command":"getprop ro.build.version.release"}}',
    );
    const ios = deviceSession("ios").s;
    await expect(runAdbShell(ios, "getprop ro.product.model")).rejects.toThrow(/only available on Android/);
  });

  it("explains BrowserStack's own refusal of a property instead of passing the raw error on", async () => {
    const { s, b } = deviceSession("android");
    b.execute.mockRejectedValueOnce(
      new Error("Error executing browserstack_executor command. BROWSERSTACK_UNSUPPORTED_ADB_SHELL_COMMAND] getprop ro.product.model is not supported on BrowserStack"),
    );
    await expect(runAdbShell(s, "getprop ro.product.model")).rejects.toThrow(
      /BrowserStack does not allow "getprop ro\.product\.model" on this phone; it accepts only some properties, such as getprop ro\.build\.version\.release/,
    );
  });

  it("returns pulled text files as text and refuses non-media camera URLs", async () => {
    const { s, b } = deviceSession("android");
    b.pullFile.mockResolvedValue(Buffer.from("hello").toString("base64"));
    expect(await pullFile(s, "/sdcard/a.txt")).toEqual({ bytes: 5, text: "hello" });
    await expect(injectCameraImage(s, "https://x/y.png")).rejects.toThrow(/media:\/\//);
  });

  it("pushes only allow-listed file types, and never local paths on the remote server", async () => {
    const { s } = deviceSession("android");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-"));
    const key = path.join(dir, "id_rsa.pem");
    fs.writeFileSync(key, "secret");
    const original = { base: appConfig.UPLOAD_BASE_DIR, remote: appConfig.REMOTE_MCP };
    (appConfig as any).UPLOAD_BASE_DIR = dir;
    try {
      await expect(pushFile(s, { devicePath: "/sdcard/x", filePath: key })).rejects.toThrow(/not in the allowed list/);
      (appConfig as any).REMOTE_MCP = true;
      await expect(pushFile(s, { devicePath: "/sdcard/x", filePath: key })).rejects.toThrow(/not available on the remote server/);
      expect(await pushFile(s, { devicePath: "/sdcard/x.txt", text: "ok" })).toBe("Pushed 2 byte(s) to /sdcard/x.txt");
    } finally {
      (appConfig as any).UPLOAD_BASE_DIR = original.base;
      (appConfig as any).REMOTE_MCP = original.remote;
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("updates network by profile through REST", async () => {
    const { s } = deviceSession("android");
    (apiClient.put as any).mockResolvedValue({ data: {} });
    expect(await setNetwork(s, "3g-umts-good", config)).toBe("Network profile set to 3g-umts-good");
    const req = (apiClient.put as any).mock.calls[0][0];
    expect(req.url).toBe("https://api-cloud.browserstack.com/app-automate/sessions/d-android/update_network.json");
    expect(req.body).toEqual({ networkProfile: "3g-umts-good" });
  });

  it("puts the V2 start options in bstack:options", () => {
    const caps: any = buildCapabilities(
      {
        platform: "android",
        device: "x",
        enableBiometric: true,
        enableCameraImageInjection: true,
        uploadMedia: ["media://abc"],
        networkProfile: "4g-lte-good",
        deviceTunnel: true,
      },
      { device: "x", osVersion: "14.0" },
      "bs://a",
      localCapabilities(undefined),
    );
    expect(caps["bstack:options"]).toMatchObject({
      enableBiometric: true,
      enableCameraImageInjection: true,
      uploadMedia: ["media://abc"],
      networkProfile: "4g-lte-good",
      deviceTunnel: true,
      local: true,
    });
  });
});

describe("opening the live view", () => {
  it("opens only https BrowserStack links, only on the local server, without a shell", async () => {
    const { execFile } = await import("child_process");
    const spy = execFile as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();
    const { openLiveView } = await import("../../src/tools/device-session-utils/open-url");
    const original = { remote: appConfig.REMOTE_MCP, open: appConfig.OPEN_LIVE_VIEW };
    try {
      (appConfig as any).REMOTE_MCP = false;
      (appConfig as any).OPEN_LIVE_VIEW = true;
      expect(openLiveView("https://app-automate.browserstack.com/builds/x/sessions/y?auth_token=z")).toBe(true);
      const [cmd, args] = spy.mock.calls[0] as any[];
      expect(Array.isArray(args) && args.includes("https://app-automate.browserstack.com/builds/x/sessions/y?auth_token=z")).toBe(true);
      expect(["open", "xdg-open", "rundll32"]).toContain(cmd);
      for (const bad of ["http://app-automate.browserstack.com/x", "https://evil.example.com/x", "https://browserstack.com.evil.io/x", "file:///etc/passwd", "not a url", undefined]) {
        expect(openLiveView(bad as any), String(bad)).toBe(false);
      }
      (appConfig as any).OPEN_LIVE_VIEW = false;
      expect(openLiveView("https://app-automate.browserstack.com/x")).toBe(false);
      (appConfig as any).OPEN_LIVE_VIEW = true;
      (appConfig as any).REMOTE_MCP = true;
      expect(openLiveView("https://app-automate.browserstack.com/x")).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      (appConfig as any).REMOTE_MCP = original.remote;
      (appConfig as any).OPEN_LIVE_VIEW = original.open;
    }
  });
});

describe("live view link", () => {
  it("adds a resource_link only when there is a URL", () => {
    const base = { content: [{ type: "text" as const, text: "x" }] };
    expect(withLiveView(base, undefined, "n").content).toHaveLength(1);
    const r: any = withLiveView(base, "https://live", "n");
    expect(r.content[1]).toMatchObject({ type: "resource_link", uri: "https://live" });
  });
});

describe("registration", () => {
  const collect = (register: (s: any, c: any) => unknown) => {
    const tools: Record<string, any> = {};
    register(
      {
        tool: vi.fn((...a: any[]) => {
          tools[a[0]] = a[3];
          return {};
        }),
        server: { getClientVersion: () => ({}) },
      },
      config,
    );
    return tools;
  };

  it("registers the web group with read-only hints on reads", () => {
    const t = collect(addBrowserSessionTools);
    expect(Object.keys(t).sort()).toEqual(
      [
        "clickInBrowser",
        "endBrowserSession",
        "getAutomatePlan",
        "getBrowserSession",
        "listBrowsers",
        "navigateBrowser",
        "scrollBrowser",
        "startBrowserSession",
        "switchBrowserContext",
        "takeBrowserScreenshot",
        "typeInBrowser",
      ].sort(),
    );
    expect(t.readBrowserPage).toBeUndefined();
    expect(t.listBrowsers.readOnlyHint).toBe(true);
    expect(t.clickInBrowser.readOnlyHint).toBe(false);
  });

  it("registers the V2 device tools; adb is read-only", () => {
    const t = collect(addDeviceSessionTools);
    for (const name of [
      "simulateBiometric",
      "runAdbShellCommand",
      "pushFileToDevice",
      "pullFileFromDevice",
      "injectCameraImage",
      "setDeviceLocation",
      "setNetworkConditions",
    ]) {
      expect(t[name], name).toBeDefined();
    }
    expect(t.runAdbShellCommand.readOnlyHint).toBe(true);
    expect(t.pullFileFromDevice.readOnlyHint).toBe(true);
  });

  it("the kill switch removes browser sessions but keeps the catalog tools", () => {
    const original = appConfig.DEVICE_SESSION_TOOLS_ENABLED;
    (appConfig as any).DEVICE_SESSION_TOOLS_ENABLED = false;
    try {
      expect(Object.keys(collect(addBrowserSessionTools)).sort()).toEqual(["getAutomatePlan", "listBrowsers"]);
    } finally {
      (appConfig as any).DEVICE_SESSION_TOOLS_ENABLED = original;
    }
  });
});
