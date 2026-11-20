import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import appConfig from "../config.js";
import {
  DEFAULT_ELEMENT_WAIT_MS,
  DEFAULT_SETTLE_MS,
  MAX_ELEMENT_WAIT_MS,
  MAX_IDLE_TIMEOUT_SECONDS,
  MAX_SETTLE_MS,
} from "./device-session-utils/constants.js";
import {
  getAutomatePlan,
  getSessionDetails,
  listAutomateBrowsers,
} from "./device-session-utils/rest.js";
import { openLiveView } from "./device-session-utils/open-url.js";
import {
  registerTool,
  text,
  withLiveView,
} from "./device-session-utils/register-helpers.js";
import {
  browserSessionsOwnedBy,
  endBrowserSession,
  getOwnedBrowserSession,
  startBrowserSession,
} from "./browser-session-utils/session.js";
import {
  click,
  navigate,
  screenshot,
  scroll,
  switchContext,
  typeOrSelect,
} from "./browser-session-utils/actions.js";

/**
 * Web: list browsers and drive a real browser on BrowserStack Automate
 * step by step (navigate, click, type, scroll, tabs and frames, screenshot,
 * page reading).
 * Same conventions as the device session tools; the agent decides, the
 * tools act.
 */

const sessionId = z
  .string()
  .min(1)
  .describe("The sessionId returned by startBrowserSession.");
const waitMs = z
  .number()
  .int()
  .min(0)
  .max(MAX_ELEMENT_WAIT_MS)
  .default(DEFAULT_ELEMENT_WAIT_MS)
  .describe("How long to wait for the element to appear, in ms.");
const settleMs = z
  .number()
  .int()
  .min(0)
  .max(MAX_SETTLE_MS)
  .default(DEFAULT_SETTLE_MS)
  .describe("Pause after the action so the page can settle, in ms.");
const selector = z.string().optional().describe("CSS selector or XPath.");
const visibleText = z
  .string()
  .optional()
  .describe(
    "Visible text, aria-label, placeholder, value, title or alt (exact match first, then contains).",
  );

const writeHints = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const readHints = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export default function addBrowserSessionTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.listBrowsers = registerTool(server, config, {
    name: "listBrowsers",
    title: "List Browsers and OS",
    description:
      "List the desktop OS / browser / version combinations (or real mobile devices and their browsers) available on BrowserStack Automate. Filter by os, osVersion, browser, or device; pass the exact values to startBrowserSession.",
    schema: {
      os: z.string().optional().describe("e.g. 'Windows', 'OS X'."),
      osVersion: z.string().optional().describe("e.g. '11', 'Sonoma'."),
      browser: z
        .string()
        .optional()
        .describe("e.g. 'chrome', 'firefox', 'safari', 'edge'."),
      device: z
        .string()
        .optional()
        .describe("Substring of a real mobile device name."),
      deviceOnly: z
        .boolean()
        .default(false)
        .describe("List real mobile devices instead of desktops."),
      limit: z.number().int().min(1).max(200).default(60),
    },
    hints: { ...readHints },
    failurePrefix: "Failed to list browsers",
    run: async (args) => {
      const eq = (a: unknown, b?: string) =>
        !b || String(a ?? "").toLowerCase() === b.trim().toLowerCase();
      let all = await listAutomateBrowsers(config);
      const mobile = args.deviceOnly || !!args.device;
      all = all.filter(
        (b) =>
          !!b.device === mobile &&
          eq(b.os, args.os) &&
          eq(b.os_version, args.osVersion) &&
          eq(b.browser, args.browser) &&
          (!args.device ||
            String(b.device).toLowerCase().includes(args.device.toLowerCase())),
      );
      const groups = new Map<string, Set<string>>();
      for (const b of all) {
        const key = mobile
          ? `${b.device} (${b.os} ${b.os_version}) — ${b.browser}`
          : `${b.os} ${b.os_version} — ${b.browser}`;
        const set = groups.get(key) ?? new Set<string>();
        if (!mobile && b.browser_version) set.add(String(b.browser_version));
        groups.set(key, set);
      }
      if (!groups.size) return text("Nothing matches those filters.");
      const rows = [...groups.entries()].map(([k, versions]) => {
        if (!versions.size) return `- ${k}`;
        const sorted = [...versions].sort(
          (a, b) => parseFloat(b) - parseFloat(a) || b.localeCompare(a),
        );
        return `- ${k}: ${sorted.slice(0, 8).join(", ")}${sorted.length > 8 ? ` … (${sorted.length} versions)` : ""}`;
      });
      return text(
        `${rows.length} match(es)${rows.length > args.limit ? ` (showing ${args.limit}; narrow the filters)` : ""}:`,
        ...rows.slice(0, args.limit),
      );
    },
  });

  tools.getAutomatePlan = registerTool(server, config, {
    name: "getAutomatePlan",
    title: "Get Automate Plan",
    description:
      "Show the Automate (web) plan and parallel-session usage (running, maximum, queued).",
    schema: {},
    hints: readHints,
    failurePrefix: "Failed to fetch the Automate plan",
    run: async () => {
      const p = await getAutomatePlan(config);
      return text(
        `Plan: ${p.automate_plan ?? "unknown"}`,
        `Parallel sessions running: ${p.parallel_sessions_running ?? "?"} of ${p.parallel_sessions_max_allowed ?? "?"}`,
        `Queued sessions: ${p.queued_sessions ?? "?"} of ${p.queued_sessions_max_allowed ?? "?"}`,
      );
    },
  });

  if (!appConfig.DEVICE_SESSION_TOOLS_ENABLED) {
    logger.info(
      "Browser session tools disabled (BROWSERSTACK_DEVICE_SESSION_TOOLS=false)",
    );
    return tools;
  }

  tools.startBrowserSession = registerTool(server, config, {
    name: "startBrowserSession",
    title: "Start Browser Session",
    description:
      "Start a real browser on BrowserStack Automate that you can drive step by step (navigate, click, type, scroll, switch tabs/frames, read the page, screenshot). Desktop: give os, osVersion, browser (and optionally browserVersion). Real mobile browser: give device and browser. Use exact values from listBrowsers. Set local: true to reach localhost / staging hosts through BrowserStack Local. End it with endBrowserSession.",
    schema: {
      browser: z
        .string()
        .describe("e.g. 'chrome', 'firefox', 'safari', 'edge'."),
      browserVersion: z
        .string()
        .optional()
        .describe(
          "Exact version, a bare major, or 'latest' (default) / 'latest-1' / 'beta'.",
        ),
      os: z.string().optional(),
      osVersion: z.string().optional(),
      device: z
        .string()
        .optional()
        .describe("Real mobile device name (instead of os)."),
      url: z
        .string()
        .optional()
        .describe("Page to open once the browser is up."),
      local: z
        .boolean()
        .optional()
        .describe(
          "Route traffic through BrowserStack Local (local server only).",
        ),
      resolution: z
        .string()
        .optional()
        .describe("Desktop screen, e.g. '1920x1080'."),
      sessionName: z.string().max(255).optional(),
      buildName: z.string().max(255).optional(),
      projectName: z.string().max(255).optional(),
      idleTimeoutSeconds: z
        .number()
        .int()
        .min(60)
        .max(MAX_IDLE_TIMEOUT_SECONDS)
        .optional(),
      video: z.boolean().optional(),
      networkLogs: z.boolean().optional(),
      consoleLogs: z.boolean().optional(),
    },
    hints: writeHints,
    failurePrefix: "Failed to start browser session",
    run: async (args) => {
      const { session, label } = await startBrowserSession(
        args,
        config,
        appConfig.DEVICE_SESSION_MAX_CONCURRENT,
      );
      let publicUrl: string | undefined;
      try {
        publicUrl = (
          await getSessionDetails(session.sessionId, config, "automate")
        ).public_url;
      } catch (error) {
        logger.debug("browser session details unavailable: %s", error);
      }
      let at = "";
      try {
        at = `${await session.browser.getTitle()} — ${await session.browser.getUrl()}`;
      } catch {
        // Not fatal.
      }
      const opened = openLiveView(publicUrl ?? session.dashboardUrl);
      return withLiveView(
        text(
          "Browser session started.",
          `sessionId: ${session.sessionId}`,
          `Browser: ${label}${session.local ? " (via BrowserStack Local)" : ""}`,
          at ? `Page: ${at}` : undefined,
          `Dashboard: ${session.dashboardUrl}`,
          publicUrl
            ? `Live view (shareable, no login): ${publicUrl}`
            : undefined,
          opened ? "Opened the live view in your browser." : undefined,
        ),
        publicUrl,
        `${label} live view`,
      );
    },
  });

  tools.getBrowserSession = registerTool(server, config, {
    name: "getBrowserSession",
    title: "Get Browser Session",
    description:
      "Without a sessionId: list browser sessions this MCP server has open. With one: status, current page, dashboard / shareable live-view / video links. Works for any Automate session id on your account.",
    schema: { sessionId: sessionId.optional() },
    hints: readHints,
    failurePrefix: "Failed to get browser session",
    run: async (args) => {
      if (!args.sessionId) {
        const open = browserSessionsOwnedBy(config);
        return open.length
          ? text(
              `${open.length} open browser session(s):`,
              ...open.map(
                (s) =>
                  `- ${s.sessionId}: ${s.target}, ${s.actionCount} action(s), last action ${Math.round((Date.now() - s.lastActionAt) / 1000)}s ago`,
              ),
            )
          : text(
              "No browser sessions are open. Start one with startBrowserSession.",
            );
      }
      const local = browserSessionsOwnedBy(config).find(
        (s) => s.sessionId === args.sessionId,
      );
      const d = await getSessionDetails(args.sessionId, config, "automate");
      let page = "";
      if (local) {
        try {
          page = `${await local.browser.getTitle()} — ${await local.browser.getUrl()}`;
        } catch {
          // Session may have ended.
        }
      }
      return text(
        `Session ${args.sessionId}${local ? " (open in this MCP server)" : ""}`,
        d.status
          ? `Status: ${d.status}${d.reason ? ` (${d.reason})` : ""}`
          : undefined,
        page ? `Page: ${page}` : undefined,
        typeof d.duration === "number" ? `Duration: ${d.duration}s` : undefined,
        d.browser_url ? `Dashboard: ${d.browser_url}` : undefined,
        d.public_url
          ? `Live view (shareable, no login): ${d.public_url}`
          : undefined,
        d.video_url ? `Video: ${d.video_url}` : undefined,
      );
    },
  });

  tools.endBrowserSession = registerTool(server, config, {
    name: "endBrowserSession",
    title: "End Browser Session",
    description:
      "End a browser session; optionally mark it passed or failed with a reason (shown on the Automate dashboard).",
    schema: {
      sessionId,
      status: z.enum(["passed", "failed"]).optional(),
      reason: z.string().max(255).optional(),
    },
    hints: { ...writeHints, openWorldHint: false, idempotentHint: true },
    failurePrefix: "Failed to end browser session",
    run: async (args) => {
      const { statusError } = await endBrowserSession(
        args.sessionId,
        config,
        args.status ? { status: args.status, reason: args.reason } : undefined,
      );
      return text(
        `Session ${args.sessionId} ended.`,
        args.status && !statusError ? `Marked ${args.status}.` : undefined,
        statusError ? `Could not set the status: ${statusError}` : undefined,
      );
    },
  });

  tools.navigateBrowser = registerTool(server, config, {
    name: "navigateBrowser",
    title: "Open URL / Navigate",
    description:
      "Open a URL in the browser session, or go back, forward, or refresh.",
    schema: {
      sessionId,
      url: z.string().optional(),
      action: z.enum(["back", "forward", "refresh"]).optional(),
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to navigate",
    run: async (args) =>
      text(
        await navigate(getOwnedBrowserSession(args.sessionId, config), args),
      ),
  });

  tools.clickInBrowser = registerTool(server, config, {
    name: "clickInBrowser",
    title: "Click In Browser",
    description:
      "Click an element by CSS/XPath selector or visible text; it is scrolled into view and waited for automatically.",
    schema: { sessionId, selector, text: visibleText, waitMs, settleMs },
    hints: writeHints,
    failurePrefix: "Failed to click",
    run: async (args) =>
      text(await click(getOwnedBrowserSession(args.sessionId, config), args)),
  });

  tools.typeInBrowser = registerTool(server, config, {
    name: "typeInBrowser",
    title: "Type or Select In Browser",
    description:
      "Type into a field (value), or pick an option in a <select> (option, by visible text or value). Optional clear first and Enter after. Typed values are not echoed.",
    schema: {
      sessionId,
      selector,
      text: visibleText,
      value: z.string().max(5000).optional(),
      option: z.string().optional(),
      clear: z.boolean().default(false),
      submit: z.boolean().default(false),
      waitMs,
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to type or select",
    run: async (args) =>
      text(
        await typeOrSelect(
          getOwnedBrowserSession(args.sessionId, config),
          args,
        ),
      ),
  });

  tools.scrollBrowser = registerTool(server, config, {
    name: "scrollBrowser",
    title: "Scroll Browser",
    description:
      "Scroll the page by direction and pixels, to the top or bottom, or bring an element (selector/text) into view.",
    schema: {
      sessionId,
      direction: z.enum(["up", "down", "left", "right"]).optional(),
      pixels: z.number().int().min(1).max(20000).optional(),
      to: z.enum(["top", "bottom"]).optional(),
      selector,
      text: visibleText,
      waitMs,
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to scroll",
    run: async (args) =>
      text(await scroll(getOwnedBrowserSession(args.sessionId, config), args)),
  });

  tools.switchBrowserContext = registerTool(server, config, {
    name: "switchBrowserContext",
    title: "Switch Tab, Window or Frame",
    description:
      "Work with tabs, windows and frames: 'list' open windows; switch to a 'window' by handle or index; open a 'newTab' (optionally at url); 'closeTab'; enter a 'frame' by selector or index; go to 'parentFrame' or 'topFrame'.",
    schema: {
      sessionId,
      action: z.enum([
        "list",
        "window",
        "newTab",
        "closeTab",
        "frame",
        "parentFrame",
        "topFrame",
      ]),
      handle: z.string().optional(),
      index: z.number().int().min(0).optional(),
      url: z.string().optional(),
      selector: z.string().optional(),
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to switch context",
    run: async (args) =>
      text(
        await switchContext(
          getOwnedBrowserSession(args.sessionId, config),
          args,
        ),
      ),
  });

  tools.takeBrowserScreenshot = registerTool(server, config, {
    name: "takeBrowserScreenshot",
    title: "Take Browser Screenshot",
    description: "Screenshot of the current page in a browser session.",
    schema: { sessionId },
    hints: readHints,
    failurePrefix: "Failed to take screenshot",
    run: async (args) => ({
      content: [
        {
          type: "image",
          data: await screenshot(
            getOwnedBrowserSession(args.sessionId, config),
          ),
          mimeType: "image/png",
        },
      ],
    }),
  });

  return tools;
}
