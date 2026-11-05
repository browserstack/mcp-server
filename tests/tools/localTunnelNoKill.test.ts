import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BrowserStack Local tunnels: this MCP never kills a BrowserStackLocal process by name.
// It used to run `pkill -f BrowserStackLocal` (taskkill on Windows) for every public-URL
// scan or Live session, and before starting a tunnel for a local one, which took down the
// user's own tunnel. Now it starts its own under a unique identifier, reuses it, and stops
// only that one, through its own handle.

const t = vi.hoisted(() => {
  const state = {
    instances: [] as any[],
    startError: undefined as Error | undefined,
    /** What `pgrep -f BrowserStackLocal` finds: tunnels this process did not start. */
    otherPids: [] as number[],
    execFileSync: undefined as any,
    commands: [] as string[],
    post: undefined as any,
    get: undefined as any,
    config: {
      REMOTE_MCP: false,
      USE_OWN_LOCAL_BINARY_PROCESS: false,
      browserstackLocalOptions: { force: "true", proxyHost: "proxy.corp" } as Record<
        string,
        unknown
      >,
    },
  };
  class FakeLocal {
    startArgs?: Record<string, unknown>;
    pid?: number;
    up = false;
    stopped = 0;
    constructor() {
      state.instances.push(this);
    }
    start(args: Record<string, unknown>, callback: (error?: Error) => void) {
      this.startArgs = args;
      Promise.resolve().then(() => {
        if (state.startError) return callback(state.startError);
        this.up = true;
        callback();
      });
    }
    isRunning() {
      return this.up;
    }
    stop(callback: () => void) {
      this.stopped += 1;
      this.up = false;
      callback();
    }
  }
  return Object.assign(state, { FakeLocal });
});

// Every way to run a command is recorded, so a kill by name cannot slip through any of them.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const record =
    (name: string) =>
    (cmd: string, args?: unknown) => {
      t.commands.push(
        [name, cmd, ...(Array.isArray(args) ? args : [])].join(" "),
      );
      // A lookup finds the other tunnels, whichever way it is run.
      if (/^pgrep\b/.test(cmd)) {
        if (!t.otherPids.length) throw Object.assign(new Error("exit 1"), { status: 1 });
        return `${t.otherPids.join("\n")}\n`;
      }
      if (/^tasklist\b/.test(cmd)) {
        return t.otherPids
          .map((pid) => `"BrowserStackLocal.exe","${pid}","Console","1","10 K"`)
          .join("\r\n");
      }
      return "";
    };
  const mocked = {
    exec: vi.fn(record("exec")),
    execSync: vi.fn(record("execSync")),
    execFile: vi.fn(record("execFile")),
    execFileSync: vi.fn(record("execFileSync")),
    spawn: vi.fn(record("spawn")),
    spawnSync: vi.fn(record("spawnSync")),
  };
  return { ...actual, ...mocked, default: { ...actual, ...mocked } };
});
vi.mock("browserstack-local", () => ({ Local: t.FakeLocal }));
vi.mock("../../src/config.js", () => ({ default: t.config }));
vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: {
    post: (...a: unknown[]) => t.post(...a),
    get: (...a: unknown[]) => t.get(...a),
  },
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/get-auth.js", () => ({
  getBrowserStackAuth: () => "bs-user:bs-key",
}));
vi.mock("../../src/tools/live-utils/desktop-filter.js", () => ({
  filterDesktop: vi.fn(async () => ({
    os: "Windows",
    os_version: "11",
    browser: "chrome",
    browser_version: "latest",
  })),
}));
vi.mock("../../src/tools/live-utils/mobile-filter.js", () => ({
  filterMobile: vi.fn(),
}));

/** Commands that stop processes by name, on any platform. */
const KILL = /\b(pkill|killall|taskkill)\b|kill\s+-/;
const kills = () => t.commands.filter((c) => KILL.test(c));

const SHUTDOWN_EVENTS = ["exit", "SIGINT", "SIGTERM", "SIGHUP"] as const;
let listenersBefore: Map<string, unknown[]>;
const realPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
}

beforeEach(() => {
  vi.resetModules();
  t.instances.length = 0;
  t.commands.length = 0;
  t.otherPids = [];
  t.startError = undefined;
  t.config.REMOTE_MCP = false;
  t.config.USE_OWN_LOCAL_BINARY_PROCESS = false;
  t.post = vi.fn().mockResolvedValue({
    data: { success: true, data: { id: "scan-1", scanRunId: "run-1" } },
  });
  t.get = vi.fn();
  listenersBefore = new Map(
    SHUTDOWN_EVENTS.map((e) => [e, process.listeners(e as any)]),
  );
});

afterEach(() => {
  setPlatform(realPlatform);
  vi.restoreAllMocks();
  // Each fresh module adds its own shutdown listeners; take them off the test process.
  for (const e of SHUTDOWN_EVENTS) {
    for (const listener of process.listeners(e as any)) {
      if (!listenersBefore.get(e)!.includes(listener))
        process.removeListener(e, listener as any);
    }
  }
});

const local = () => import("../../src/lib/local.js");

async function scanner() {
  const { AccessibilityScanner } = await import(
    "../../src/tools/accessiblity-utils/scanner.js"
  );
  const s = new AccessibilityScanner();
  s.setAuth({ username: "bs-user", password: "bs-key" });
  return s;
}

const sent = (call = 0) => t.post.mock.calls[call][0].body;

describe("a public-URL scan", () => {
  it.each(["darwin", "linux", "win32"] as const)(
    "on %s, starts no tunnel and runs no kill, even with another Local running",
    async (platform) => {
      setPlatform(platform);
      t.otherPids = [4242];

      await (await scanner()).startScan("public", ["https://www.bstackdemo.com/"]);

      expect(t.instances).toHaveLength(0);
      expect(t.commands).toEqual([]);
      expect(sent().localTestingInfo).toBeUndefined();
    },
  );
});

describe("a local-URL scan without localIdentifier", () => {
  it("starts this MCP's own tunnel under a unique identifier and kills nothing", async () => {
    t.otherPids = [4242]; // the user's own tunnel

    await (await scanner()).startScan("dev", ["http://localhost:3000/cart"]);

    expect(t.instances).toHaveLength(1);
    const args = t.instances[0].startArgs;
    expect(args).toMatchObject({
      key: "bs-key",
      username: "bs-user",
      proxyHost: "proxy.corp",
    });
    expect(String(args.localIdentifier)).toMatch(/^mcp-[0-9a-f-]{36}$/);
    // `force` would make the binary stop other instances.
    expect(args).not.toHaveProperty("force");
    expect(sent().localTestingInfo).toEqual({
      localIdentifier: args.localIdentifier,
      localEnabled: true,
    });
    expect(sent().urlList).toEqual(["http://bs-local.com:3000/cart"]);
    expect(kills()).toEqual([]);
  });

  it("reuses its tunnel for the next scan, and for concurrent ones", async () => {
    const s = await scanner();
    await s.startScan("a", ["http://localhost:3000/"]);
    await Promise.all([
      s.startScan("b", ["http://localhost:4000/"]),
      s.startScan("c", ["http://app.localhost/"]),
    ]);

    expect(t.instances).toHaveLength(1);
    const ids = t.post.mock.calls.map(
      (c: any[]) => c[0].body.localTestingInfo.localIdentifier,
    );
    expect(new Set(ids)).toEqual(new Set([t.instances[0].startArgs.localIdentifier]));
    expect(t.commands).toEqual([]);
  });

  it("replaces its tunnel once it has died, stopping only that one through its handle", async () => {
    t.otherPids = [4242];
    const s = await scanner();
    await s.startScan("a", ["http://localhost:3000/"]);
    t.instances[0].up = false;

    await s.startScan("b", ["http://localhost:3000/"]);

    expect(t.instances).toHaveLength(2);
    expect(t.instances[0].stopped).toBe(1);
    expect(t.instances[1].stopped).toBe(0);
    expect(sent(1).localTestingInfo.localIdentifier).toBe(
      t.instances[1].startArgs.localIdentifier,
    );
    expect(kills()).toEqual([]);
  });

  it("when its tunnel cannot start beside another Local, says to scan through that one instead of stopping it", async () => {
    t.otherPids = [4242];
    t.startError = new Error("Either another browserstack local client is running.");

    const start = (await scanner()).startScan("dev", ["http://localhost:3000/"]);

    await expect(start).rejects.toThrow(
      /another browserstack local client is running\. Another BrowserStack Local is running on this machine \(pid 4242\), and this MCP leaves it running\. If it is your tunnel, pass the name it runs under \(its --local-identifier\) as localIdentifier/,
    );
    await expect(start).rejects.not.toThrow(/\.\./);
    expect(t.post).not.toHaveBeenCalled();
    expect(kills()).toEqual([]);
  });

  it("tries again on the next scan after a failed start", async () => {
    t.startError = new Error("bad key");
    const s = await scanner();
    await expect(s.startScan("a", ["http://localhost:3000/"])).rejects.toThrow(
      /Unable to configure local tunnel binary.*bad key/,
    );

    t.startError = undefined;
    await s.startScan("b", ["http://localhost:3000/"]);
    expect(t.instances).toHaveLength(2);
    expect(t.post).toHaveBeenCalledTimes(1);
  });

  it("goes through the user's tunnel, starting none, when localIdentifier is given", async () => {
    await (await scanner()).startScan(
      "dev",
      ["http://localhost:3000/"],
      undefined,
      {},
      "my-tunnel",
    );

    expect(t.instances).toHaveLength(0);
    expect(t.commands).toEqual([]);
    expect(sent().localTestingInfo.localIdentifier).toBe("my-tunnel");
  });
});

describe("stopping", () => {
  it("stopOwnTunnels stops only this process's tunnels, through their handles", async () => {
    t.otherPids = [4242];
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const { ensureOwnTunnel, ensureLocalBinarySetup, stopOwnTunnels } =
      await local();
    t.otherPids = [];
    await ensureOwnTunnel("bs-user", "bs-key");
    await ensureLocalBinarySetup("bs-user", "bs-key");
    t.otherPids = [4242];
    expect(t.instances).toHaveLength(2);

    await stopOwnTunnels();

    expect(t.instances.map((i) => i.stopped)).toEqual([1, 1]);
    expect(kill).not.toHaveBeenCalled();
    expect(kills()).toEqual([]);

    // Nothing of its own is left to stop, so a second stop touches nothing.
    await stopOwnTunnels();
    expect(t.instances.map((i) => i.stopped)).toEqual([1, 1]);
  });

  it("on exit, signals only its own tunnel's pid", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    t.otherPids = [4242];
    const { ensureOwnTunnel } = await local();
    await ensureOwnTunnel("bs-user", "bs-key");
    t.instances[0].pid = 31337;

    const added = process
      .listeners("exit")
      .filter((l) => !listenersBefore.get("exit")!.includes(l));
    expect(added).toHaveLength(1);
    (added[0] as () => void)();

    expect(kill.mock.calls).toEqual([[31337, "SIGTERM"]]);
    expect(kills()).toEqual([]);
  });

  it("registers its shutdown listeners once, and only after starting a tunnel", async () => {
    const { ensureOwnTunnel, ensureLocalBinarySetup } = await local();
    const added = (e: string) =>
      process.listeners(e as any).filter((l) => !listenersBefore.get(e)!.includes(l));
    expect(added("exit")).toHaveLength(0);

    await ensureOwnTunnel("bs-user", "bs-key");
    await ensureLocalBinarySetup("bs-user", "bs-key");

    for (const e of SHUTDOWN_EVENTS) expect(added(e)).toHaveLength(1);
  });

  it("replaces its tunnel when the credentials change, stopping the old one", async () => {
    const { ensureOwnTunnel } = await local();
    const first = await ensureOwnTunnel("bs-user", "bs-key");
    const second = await ensureOwnTunnel("bs-user", "rotated-key");

    expect(first).not.toBe(second);
    expect(t.instances.map((i) => i.stopped)).toEqual([1, 0]);
  });
});

describe("Live sessions", () => {
  const desktop = (url: string) => ({
    platformType: "desktop",
    url,
    desiredOS: "Windows",
    desiredOSVersion: "11",
    desiredBrowser: "chrome",
    desiredBrowserVersion: "latest",
  });
  const start = async (url: string) => {
    const { startBrowserSession } = await import(
      "../../src/tools/live-utils/start-session.js"
    );
    return startBrowserSession(desktop(url) as any, {} as any);
  };

  it("for a public URL, touches no tunnel", async () => {
    t.otherPids = [4242];
    const url = await start("https://www.bstackdemo.com/");

    expect(url).toContain("local=false");
    expect(t.instances).toHaveLength(0);
    expect(t.commands).toEqual([]);
  });

  it("for a local URL with another Local running, uses it and stops nothing", async () => {
    t.otherPids = [4242];
    const url = await start("http://localhost:3000/");

    expect(url).toContain("local=true");
    expect(t.instances).toHaveLength(0);
    expect(kills()).toEqual([]);
  });

  it("for a local URL with none running, starts its own without an identifier and reuses it", async () => {
    await start("http://localhost:3000/");
    t.otherPids = [];
    await start("http://localhost:4000/");

    expect(t.instances).toHaveLength(1);
    expect(t.instances[0].startArgs).not.toHaveProperty("localIdentifier");
    expect(t.instances[0].startArgs).not.toHaveProperty("force");
    expect(kills()).toEqual([]);
  });

  it("does not count this MCP's own scan tunnel as someone else's", async () => {
    const { ensureOwnTunnel } = await local();
    await ensureOwnTunnel("bs-user", "bs-key");
    t.instances[0].pid = 5555;
    t.otherPids = [5555]; // only our scan tunnel is up

    await start("http://localhost:3000/");

    expect(t.instances).toHaveLength(2);
    expect(t.instances[1].startArgs).not.toHaveProperty("localIdentifier");
    t.instances[0].pid = undefined;
  });
});
