import logger from "../logger.js";
import { execFileSync } from "child_process";
import { randomUUID } from "node:crypto";
import { Local } from "browserstack-local";
import config from "../config.js";

/*
 * BrowserStack Local tunnels for local URLs.
 *
 * This process never kills a BrowserStackLocal process by name. The user may have a tunnel
 * of their own up (the BrowserStack Local app, or one their test suite runs), and killing
 * every BrowserStackLocal process took theirs down whenever a tool here ran, even for a
 * public URL. The binary runs several tunnels side by side as long as each has its own
 * --local-identifier (`--force` only stops instances with the same identifier), so a tunnel
 * started here runs under a unique identifier, is kept and reused, and is the only one this
 * process ever stops, through its own handle.
 */

/**
 * Pids of the BrowserStackLocal processes on this machine, this process's own included.
 * Read-only: a lookup, never a kill. Run without a shell, so the lookup's own command
 * line is not counted.
 */
function browserStackLocalPids(): number[] {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "tasklist",
        ["/FI", "IMAGENAME eq BrowserStackLocal.exe", "/FO", "CSV", "/NH"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return [...out.matchAll(/^"BrowserStackLocal\.exe","(\d+)"/gim)].map(
        (match) => Number(match[1]),
      );
    }
    const out = execFileSync("pgrep", ["-f", "BrowserStackLocal"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch (error) {
    // pgrep exits 1 when nothing matches.
    logger.debug(`No BrowserStackLocal process found: ${error}`);
    return [];
  }
}

async function isBrowserStackLocalRunning(): Promise<boolean> {
  const running = browserStackLocalPids().length > 0;
  logger.info(
    `BrowserStackLocal binary is ${running ? "already running" : "not running"}`,
  );
  return running;
}

/** A tunnel this process started: the only kind it ever stops. */
interface OwnTunnel {
  local: Local;
  /** The identifier it runs under; Live's runs without one. */
  localIdentifier?: string;
  /** The credentials it runs with. Kept in memory only, to tell when they change. */
  credentials: string;
}

type TunnelSlot = "identified" | "unidentified";

/**
 * This process's tunnels: one under a unique identifier, for accessibility scans, and one
 * without, for Live sessions, which have no way to name a tunnel.
 */
const ownTunnels = new Map<TunnelSlot, OwnTunnel>();

/** Starts, reuses and stops one at a time, so concurrent calls share one tunnel. */
let tunnelQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = tunnelQueue.then(task, task);
  tunnelQueue = run.catch(() => undefined);
  return run;
}

function pidOf(local: Local): number | undefined {
  const pid = (local as unknown as { pid?: unknown }).pid;
  return typeof pid === "number" && pid > 0 ? pid : undefined;
}

function isUp(tunnel: OwnTunnel): boolean {
  try {
    return Boolean(tunnel.local.isRunning());
  } catch {
    return false;
  }
}

/** Stop one of this process's tunnels through its own handle; it never throws. */
function stopTunnel(tunnel: OwnTunnel): Promise<void> {
  return new Promise((resolve) => {
    try {
      // `stop` kills this instance's pid (and its children) only, and can call back twice.
      tunnel.local.stop(() => resolve());
    } catch (error) {
      logger.warn(`Could not stop this process's BrowserStack Local: ${error}`);
      resolve();
    }
  });
}

/** BrowserStackLocal processes running that this process did not start. */
export function otherBrowserStackLocalPids(): number[] {
  const own = new Set(
    [...ownTunnels.values()]
      .map((tunnel) => pidOf(tunnel.local))
      .filter((pid): pid is number => pid !== undefined),
  );
  return browserStackLocalPids().filter((pid) => !own.has(pid));
}

/**
 * Stop this process's own tunnels at once, by their pids. For an exit handler, which cannot
 * wait for `stop`'s callback.
 */
export function killOwnTunnelsNow(): void {
  for (const tunnel of ownTunnels.values()) {
    const pid = pidOf(tunnel.local);
    if (!pid) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  ownTunnels.clear();
}

/** Stop this process's own tunnels through their handles. Nothing else is touched. */
export function stopOwnTunnels(): Promise<void> {
  return serialized(async () => {
    const tunnels = [...ownTunnels.values()];
    ownTunnels.clear();
    await Promise.all(tunnels.map(stopTunnel));
  });
}

let shutdownHooked = false;

/**
 * The binary runs as a daemon and outlives this process unless stopped, so this process's
 * tunnels are stopped when it exits or is signalled to. A signal is passed on as it came
 * when nothing else listens for it, so the process still ends as it would have.
 */
function stopOwnTunnelsOnShutdown(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  process.once("exit", killOwnTunnelsNow);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      killOwnTunnelsNow();
      if (process.listenerCount(signal) > 0) return;
      try {
        process.kill(process.pid, signal);
      } catch {
        // Windows cannot send every signal to itself.
        process.exit(1);
      }
    });
  }
}

/**
 * The configured BrowserStack Local options, less `force`: it tells the binary to stop
 * other instances, and this process stops only its own.
 */
function localOptions(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config.browserstackLocalOptions || {}).filter(
      ([key]) => key !== "force",
    ),
  );
}

/**
 * The tunnel in this slot, reused while it runs with these credentials, or else a new
 * one. A tunnel being replaced, because it died or the credentials changed, is stopped
 * through its own handle first. `start` says whether to start one when there is none to
 * reuse; a slot left empty gives undefined.
 */
function ensureTunnel(
  slot: TunnelSlot,
  username: string,
  password: string,
  localIdentifier: () => string | undefined,
  start: () => boolean = () => true,
): Promise<OwnTunnel | undefined> {
  return serialized(async () => {
    const credentials = `${username}:${password}`;
    const current = ownTunnels.get(slot);
    const label = (tunnel: OwnTunnel) =>
      tunnel.localIdentifier ? ` (${tunnel.localIdentifier})` : "";
    if (current) {
      if (current.credentials === credentials && isUp(current)) {
        logger.info(
          `Reusing this process's BrowserStack Local tunnel${label(current)}`,
        );
        return current;
      }
      logger.info(
        `Replacing this process's BrowserStack Local tunnel${label(current)}, which ${isUp(current) ? "runs with other credentials" : "is no longer running"}`,
      );
      ownTunnels.delete(slot);
      await stopTunnel(current);
    }
    if (!start()) return undefined;

    const identifier = localIdentifier();
    const local = new Local();
    const args = {
      ...localOptions(),
      key: password,
      username,
      ...(identifier ? { localIdentifier: identifier } : {}),
    };
    await new Promise<void>((resolve, reject) => {
      local.start(args, (error?: Error) => {
        if (error) {
          logger.error(
            `Unable to start BrowserStack Local... please check your credentials and try again. Error: ${error}`,
          );
          reject(
            new Error(
              `Unable to configure local tunnel binary, please check your credentials and try again. Error: ${error}`,
            ),
          );
        } else {
          logger.info(
            `Successfully started BrowserStack Local${identifier ? ` (${identifier})` : ""}`,
          );
          resolve();
        }
      });
    });
    const tunnel: OwnTunnel = {
      local,
      localIdentifier: identifier,
      credentials,
    };
    ownTunnels.set(slot, tunnel);
    stopOwnTunnelsOnShutdown();
    return tunnel;
  });
}

/**
 * This process's own tunnel for these credentials, started or reused, and the unique local
 * identifier it runs under. It runs alongside any other tunnel on the machine.
 */
export async function ensureOwnTunnel(
  username: string,
  password: string,
): Promise<string> {
  const tunnel = await ensureTunnel(
    "identified",
    username,
    password,
    () => `mcp-${randomUUID()}`,
  );
  return tunnel!.localIdentifier!;
}

/**
 * A tunnel without an identifier, as a Live session uses. This process's own is reused
 * while it runs. A BrowserStack Local someone else started is left alone and used as it
 * is: a second one without an identifier would clash with it. Otherwise one is started.
 */
export async function ensureLocalBinarySetup(
  username: string,
  password: string,
): Promise<void> {
  logger.info(
    "Ensuring local binary setup as it is required for private URLs...",
  );

  if (config.USE_OWN_LOCAL_BINARY_PROCESS) {
    logger.info(
      "Using user's own BrowserStack Local binary process, checking if it's running...",
    );

    const isRunning = await isBrowserStackLocalRunning();
    if (!isRunning) {
      throw new Error(
        "USE_OWN_LOCAL_BINARY_PROCESS is enabled but BrowserStack Local process is not running. Please start your BrowserStack Local binary process first.",
      );
    }

    logger.info(
      "BrowserStack Local process is running, proceeding with user's own process.",
    );
    return;
  }

  await ensureTunnel(
    "unidentified",
    username,
    password,
    () => undefined,
    () => {
      const others = otherBrowserStackLocalPids();
      if (others.length === 0) return true;
      logger.info(
        `A BrowserStack Local this process did not start is running (pid ${others.join(", ")}); using it and leaving it alone`,
      );
      return false;
    },
  );
}

export function isLocalURL(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost")
    );
  } catch (error) {
    logger.error(`Error checking if URL is local: ${error}`);
    return false;
  }
}
