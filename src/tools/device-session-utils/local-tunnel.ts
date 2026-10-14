import { execFileSync } from "child_process";
import { ensureLocalBinarySetup } from "../../lib/local.js";
import { BrowserStackConfig } from "../../lib/types.js";
import appConfig from "../../config.js";

/**
 * BrowserStack Local tunnel for testing local / staging environments.
 *
 * One tunnel per MCP process under a fixed identifier, started on the first
 * session that asks for it and shared by the rest: starting a second tunnel
 * would replace the first and cut off sessions already using it.
 */
let started: Promise<string | undefined> | undefined;

export function ensureLocalTunnel(
  config: BrowserStackConfig,
): Promise<string | undefined> {
  if (appConfig.REMOTE_MCP) {
    return Promise.reject(
      new Error(
        "Local testing needs the BrowserStack Local binary on your machine, which the remote MCP server cannot start. Use the local (npx) server.",
      ),
    );
  }
  if (!started) {
    // With USE_OWN_LOCAL_BINARY_PROCESS the user's own binary is used, and
    // its identifier (if any) is theirs, so none is set here.
    const identifier = appConfig.USE_OWN_LOCAL_BINARY_PROCESS
      ? undefined
      : `mcp-${process.pid}`;
    started = ensureLocalBinarySetup(
      config["browserstack-username"],
      config["browserstack-access-key"],
      identifier,
    ).then(
      () => {
        if (identifier) stopOnExit(identifier);
        return identifier;
      },
      (error) => {
        started = undefined;
        throw error;
      },
    );
  }
  return started;
}

/**
 * The Local binary daemonises and would outlive this server. Stop exactly the
 * tunnel this process started (matched by its identifier) when the server
 * exits. Registered only once a tunnel exists, so servers that never use
 * Local keep their default signal handling.
 */
function stopOnExit(identifier: string) {
  const stop = () => {
    if (process.platform === "win32") return;
    try {
      execFileSync("pkill", ["-f", `local-identifier ${identifier}( |$)`], {
        stdio: "ignore",
      });
    } catch {
      // Already gone.
    }
  };
  process.once("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      stop();
      process.exit(
        128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 } as const)[signal],
      );
    });
  }
}

/** Capabilities that route a session through the tunnel. */
export function localCapabilities(
  identifier: string | undefined,
): Record<string, unknown> {
  return identifier
    ? { local: true, localIdentifier: identifier }
    : { local: true };
}

export function __resetLocalTunnelForTests(): void {
  started = undefined;
}
