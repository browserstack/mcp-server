import { execFile } from "child_process";
import logger from "../../logger.js";
import appConfig from "../../config.js";

/**
 * Open a session's live view in the user's default browser as soon as the
 * session starts, so they can watch the agent without asking for the link.
 *
 * Only on the local server (a remote server has no browser to open), only for
 * https links on a browserstack.com host, and never through a shell: the URL
 * is passed as a single argument to the platform's opener. Best effort: a
 * failure here never fails the session start.
 */
export function openLiveView(url: string | undefined): boolean {
  if (!url || appConfig.REMOTE_MCP || !appConfig.OPEN_LIVE_VIEW) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "https:" ||
    !/(^|\.)browserstack\.com$/i.test(parsed.hostname)
  ) {
    logger.error("Refusing to open a non-BrowserStack live view link");
    return false;
  }
  const target = parsed.toString();
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", target]]
        : ["xdg-open", [target]];
  try {
    const child = execFile(
      cmd,
      args as string[],
      { timeout: 10_000 },
      (error) => {
        if (error)
          logger.debug("could not open the live view: %s", error.message);
      },
    );
    child.unref();
    return true;
  } catch (error) {
    logger.debug("could not open the live view: %s", error);
    return false;
  }
}
