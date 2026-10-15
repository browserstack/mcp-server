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
  describeDeviceState,
  manageApp,
  pressKey,
  screenshot,
  setDeviceState,
  swipe,
  tap,
  typeText,
} from "./device-session-utils/actions.js";
import {
  endDeviceSession,
  getOwnedSession,
  sessionsOwnedBy,
  startDeviceSession,
} from "./device-session-utils/session.js";
import { getSessionDetails } from "./device-session-utils/rest.js";
import { openLiveView } from "./device-session-utils/open-url.js";
import {
  injectCameraImage,
  pullFile,
  pushFile,
  runAdbShell,
  setLocation,
  setNetwork,
  simulateBiometric,
} from "./device-session-utils/actions-advanced.js";
import {
  registerTool,
  text,
  withLiveView,
} from "./device-session-utils/register-helpers.js";

/**
 * Agent-drivable device sessions on BrowserStack real devices.
 *
 * App Live has no input API, so these run on App Automate over the Appium hub
 * with the user's own username:access_key: the agent starts a session, looks
 * at the screen, acts, and ends it. The session shows up (with video) on the
 * App Automate dashboard and can be watched live via its public link.
 *
 * Covers the session lifecycle, app control, input and device state,
 * observation, and the guard rails around them (waits, session defaults,
 * timeline tags, session caps).
 */

const sessionId = z
  .string()
  .min(1)
  .describe("The sessionId returned by startDeviceSession.");

const waitMs = z
  .number()
  .int()
  .min(0)
  .max(MAX_ELEMENT_WAIT_MS)
  .default(DEFAULT_ELEMENT_WAIT_MS)
  .describe("How long to wait for the target element to appear, in ms.");

const settleMs = z
  .number()
  .int()
  .min(0)
  .max(MAX_SETTLE_MS)
  .default(DEFAULT_SETTLE_MS)
  .describe(
    "Pause after the action so the UI can settle before the next look, in ms.",
  );

const selector = z
  .string()
  .optional()
  .describe(
    "Appium selector: '~accessibilityId', 'id=com.app:id/login', an XPath ('//...'), 'android=new UiSelector()...', or '-ios predicate string:...'.",
  );

const visibleText = z
  .string()
  .optional()
  .describe(
    "Visible text or accessibility label of the element (exact match first, then contains).",
  );

const writeHints = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const readHints = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function ageOf(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function addDeviceSessionTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  if (!appConfig.DEVICE_SESSION_TOOLS_ENABLED) {
    logger.info(
      "Device session tools disabled (BROWSERSTACK_DEVICE_SESSION_TOOLS=false)",
    );
    return tools;
  }

  tools.startDeviceSession = registerTool(server, config, {
    name: "startDeviceSession",
    title: "Start Device Session",
    description:
      "Start a real iOS/Android device on BrowserStack that you can drive step by step (tap, type, swipe, read the screen, take screenshots). Installs and opens the given app. Returns a sessionId for the other device tools and a live-view link. Always end it with endDeviceSession when finished; it is also released automatically after idleTimeoutSeconds without commands. Find device names with listMobileDevices and reuse uploaded builds via listUploadedApps.",
    schema: {
      platform: z.enum(["android", "ios"]),
      device: z
        .string()
        .describe(
          "Device name, e.g. 'Google Pixel 8' or 'iPhone 15 Pro'. Ask the user if they have not said.",
        ),
      osVersion: z
        .string()
        .optional()
        .describe(
          "OS version exactly as listed (e.g. '14.0'), a bare major ('14'), or 'latest' (default) / 'oldest'.",
        ),
      app: z
        .string()
        .optional()
        .describe(
          "A bs:// app URL or custom id of an uploaded App Automate build.",
        ),
      appPath: z
        .string()
        .optional()
        .describe(
          "Local .apk/.aab/.ipa to upload first (must be inside MCP_UPLOAD_BASE_DIR).",
        ),
      appDownloadUrl: z
        .string()
        .optional()
        .describe("Public https:// link to the build; uploaded first."),
      sessionName: z.string().max(255).optional(),
      buildName: z.string().max(255).optional(),
      projectName: z.string().max(255).optional(),
      idleTimeoutSeconds: z
        .number()
        .int()
        .min(60)
        .max(MAX_IDLE_TIMEOUT_SECONDS)
        .optional()
        .describe(
          "Release the device after this many seconds without a command (default 300).",
        ),
      interactiveDebugging: z
        .boolean()
        .optional()
        .describe(
          "Let a person interact with the device from the dashboard while the agent drives it (default true).",
        ),
      video: z
        .boolean()
        .optional()
        .describe("Record a session video (default true)."),
      networkLogs: z
        .boolean()
        .optional()
        .describe(
          "Capture network traffic, readable afterwards with getFailureLogs.",
        ),
      language: z.string().optional().describe("Device language, e.g. 'fr'."),
      locale: z.string().optional().describe("Device locale, e.g. 'fr_CA'."),
      timezone: z
        .string()
        .optional()
        .describe("Device time zone, e.g. 'Paris'."),
      gpsLocation: z
        .string()
        .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
        .optional()
        .describe(
          "Simulated GPS as 'latitude,longitude', e.g. '48.8566,2.3522'.",
        ),
      local: z
        .boolean()
        .optional()
        .describe(
          "Route the device's traffic through BrowserStack Local so the app can reach localhost / staging hosts on this machine (local server only).",
        ),
      enableBiometric: z
        .boolean()
        .optional()
        .describe(
          "Instrument the app so simulateBiometric can answer Touch ID / Face ID / fingerprint prompts.",
        ),
      enableCameraImageInjection: z
        .boolean()
        .optional()
        .describe(
          "Instrument the app so injectCameraImage can feed images to its camera.",
        ),
      uploadMedia: z
        .array(z.string().regex(/^media:\/\//))
        .max(10)
        .optional()
        .describe(
          "media:// URLs from uploadMediaFile to preload into the device gallery / storage.",
        ),
      deviceTunnel: z
        .boolean()
        .optional()
        .describe(
          "Open a device tunnel so a framework MCP on this machine (via browserstack-sdk device-tunnel) can reach the device. Private dedicated devices only; BrowserStack rejects it elsewhere.",
        ),
      networkProfile: z
        .string()
        .optional()
        .describe(
          "Start under a network profile, e.g. '2g-gprs-good', '3g-umts-good', '4g-lte-good', 'no-network'.",
        ),
    },
    hints: { ...writeHints, openWorldHint: true },
    failurePrefix: "Failed to start device session",
    run: async (args) => {
      const { session, notes } = await startDeviceSession(
        args,
        config,
        appConfig.DEVICE_SESSION_MAX_CONCURRENT,
      );
      let publicUrl: string | undefined;
      try {
        publicUrl = (await getSessionDetails(session.sessionId, config))
          .public_url;
      } catch (error) {
        logger.debug(
          "session details unavailable right after start: %s",
          error,
        );
      }
      const opened = openLiveView(publicUrl ?? session.dashboardUrl);
      return withLiveView(
        text(
          `Device session started.`,
          `sessionId: ${session.sessionId}`,
          `Device: ${session.device} (${session.platform} ${session.osVersion})`,
          `App: ${session.appUrl}${session.appId ? ` (${session.appId})` : ""}`,
          `Dashboard: ${session.dashboardUrl}`,
          publicUrl
            ? `Live view (shareable, no login): ${publicUrl}`
            : undefined,
          opened ? "Opened the live view in your browser." : undefined,
          ...notes,
          "",
          "Next: takeDeviceScreenshot to see the screen, then tapOnDevice / typeOnDevice / swipeOnDevice. Call endDeviceSession when done.",
        ),
        publicUrl,
        `${session.device} live view`,
      );
    },
  });

  tools.getDeviceSession = registerTool(server, config, {
    name: "getDeviceSession",
    title: "Get Device Session",
    description:
      "Without a sessionId: list the device sessions this MCP server has open. With a sessionId: show its status, dashboard and shareable live-view link, video link, and current device state (orientation, foreground app, keyboard, contexts). Also works for any App Automate session id on your account.",
    schema: { sessionId: sessionId.optional() },
    hints: readHints,
    failurePrefix: "Failed to get device session",
    run: async (args) => {
      if (!args.sessionId) {
        const open = sessionsOwnedBy(config);
        if (!open.length) {
          return text(
            "No device sessions are open. Start one with startDeviceSession.",
          );
        }
        return text(
          `${open.length} open device session(s):`,
          ...open.map(
            (s) =>
              `- ${s.sessionId}: ${s.device} (${s.platform} ${s.osVersion}), started ${ageOf(s.startedAt)} ago, ${s.actionCount} action(s), last action ${ageOf(s.lastActionAt)} ago`,
          ),
        );
      }
      const local = sessionsOwnedBy(config).find(
        (s) => s.sessionId === args.sessionId,
      );
      const details = await getSessionDetails(args.sessionId, config);
      let state: Awaited<ReturnType<typeof describeDeviceState>> | undefined;
      if (local) {
        state = await describeDeviceState(local).catch(() => undefined);
      }
      return text(
        `Session ${args.sessionId}${local ? " (open in this MCP server)" : ""}`,
        details.status
          ? `Status: ${details.status}${details.reason ? ` (${details.reason})` : ""}`
          : undefined,
        details.device
          ? `Device: ${details.device} (${details.os ?? ""} ${details.os_version ?? ""})`
          : undefined,
        typeof details.duration === "number"
          ? `Duration: ${details.duration}s`
          : undefined,
        details.browser_url ? `Dashboard: ${details.browser_url}` : undefined,
        details.public_url
          ? `Live view (shareable, no login): ${details.public_url}`
          : undefined,
        details.video_url ? `Video: ${details.video_url}` : undefined,
        state?.foregroundApp
          ? `Foreground app: ${state.foregroundApp}`
          : undefined,
        state?.orientation ? `Orientation: ${state.orientation}` : undefined,
        state?.keyboardShown !== undefined
          ? `Keyboard shown: ${state.keyboardShown}`
          : undefined,
        state?.contexts?.length
          ? `Contexts: ${state.contexts.join(", ")} (current: ${state.context ?? "?"})`
          : undefined,
      );
    },
  });

  tools.endDeviceSession = registerTool(server, config, {
    name: "endDeviceSession",
    title: "End Device Session",
    description:
      "End a device session and release the device. Optionally mark it passed or failed with a reason, which shows on the App Automate dashboard. The video and logs stay available.",
    schema: {
      sessionId,
      status: z.enum(["passed", "failed"]).optional(),
      reason: z.string().max(255).optional(),
    },
    hints: { ...writeHints, idempotentHint: true },
    failurePrefix: "Failed to end device session",
    run: async (args) => {
      const { statusError } = await endDeviceSession(
        args.sessionId,
        config,
        args.status ? { status: args.status, reason: args.reason } : undefined,
      );
      return text(
        `Session ${args.sessionId} ended and the device was released.`,
        args.status && !statusError ? `Marked ${args.status}.` : undefined,
        statusError ? `Could not set the status: ${statusError}` : undefined,
      );
    },
  });

  tools.takeDeviceScreenshot = registerTool(server, config, {
    name: "takeDeviceScreenshot",
    title: "Take Device Screenshot",
    description:
      "Take a screenshot of the device in an open session. Image coordinates match tapOnDevice and swipeOnDevice (pixels on Android, points on iOS).",
    schema: { sessionId },
    hints: readHints,
    failurePrefix: "Failed to take screenshot",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      const shot = await screenshot(session);
      return {
        content: [
          { type: "image", data: shot.base64, mimeType: "image/png" },
          {
            type: "text",
            text:
              shot.width && shot.height
                ? `Screenshot ${shot.width}x${shot.height} (${session.platform === "ios" ? "points" : "pixels"}).`
                : "Screenshot taken.",
          },
        ],
      };
    },
  });

  tools.tapOnDevice = registerTool(server, config, {
    name: "tapOnDevice",
    title: "Tap On Device",
    description:
      "Tap (or long-press with holdMs) on the device: at x,y coordinates from takeDeviceScreenshot, or on an element by its visible text or a selector. Element targets are waited for automatically, and if the on-screen keyboard covers the element it is closed first.",
    schema: {
      sessionId,
      x: z.number().optional(),
      y: z.number().optional(),
      selector,
      text: visibleText,
      holdMs: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional()
        .describe("Hold for this long to long-press."),
      waitMs,
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to tap",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await tap(session, args));
    },
  });

  tools.typeOnDevice = registerTool(server, config, {
    name: "typeOnDevice",
    title: "Type On Device",
    description:
      "Type text into a field on the device: the field matching selector/text (tapped first), or the currently focused field. Can clear the field first, press enter after, or close the on-screen keyboard after (hideKeyboard) so buttons below the field can be tapped. The typed value is not echoed back.",
    schema: {
      sessionId,
      value: z.string().min(1).max(5000).describe("The text to type."),
      selector,
      text: visibleText,
      clear: z
        .boolean()
        .default(false)
        .describe("Clear the field before typing."),
      submit: z.boolean().default(false).describe("Press enter after typing."),
      hideKeyboard: z
        .boolean()
        .default(false)
        .describe(
          "Close the on-screen keyboard after typing, e.g. before tapping a button that sits below the field. Tries the Done key and a swipe down, then Return as a last resort (Return can submit the form).",
        ),
      waitMs,
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to type",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await typeText(session, args));
    },
  });

  tools.swipeOnDevice = registerTool(server, config, {
    name: "swipeOnDevice",
    title: "Swipe On Device",
    description:
      "Swipe or scroll on the device. Give a direction (the way the finger moves: 'up' scrolls to content further down) with an optional distance as a fraction of the screen, or exact from/to points.",
    schema: {
      sessionId,
      direction: z.enum(["up", "down", "left", "right"]).optional(),
      distance: z
        .number()
        .min(0.1)
        .max(0.9)
        .optional()
        .describe("Fraction of the screen to swipe across (default 0.5)."),
      from: z.object({ x: z.number(), y: z.number() }).optional(),
      to: z.object({ x: z.number(), y: z.number() }).optional(),
      durationMs: z.number().int().min(50).max(5000).default(400),
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to swipe",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await swipe(session, args));
    },
  });

  tools.pressDeviceKey = registerTool(server, config, {
    name: "pressDeviceKey",
    title: "Press Device Key",
    description:
      "Press a device key. 'back' works on both platforms (on iOS it is the left-edge back swipe; to use an in-app back button, tap it). Android: back, home, enter, delete, tab, menu, search, app_switch, volume_up, volume_down, power, or any numeric keycode. iOS: back, home, enter, volume_up, volume_down.",
    schema: {
      sessionId,
      key: z
        .string()
        .optional()
        .describe("Key name, e.g. 'back', 'home', 'enter'."),
      keycode: z
        .number()
        .int()
        .min(0)
        .max(400)
        .optional()
        .describe("Android only: raw KeyEvent code."),
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to press key",
    run: async (args) => {
      if (!args.key && args.keycode === undefined) {
        throw new Error("Provide key or keycode.");
      }
      const session = getOwnedSession(args.sessionId, config);
      return text(await pressKey(session, args));
    },
  });

  tools.manageDeviceApp = registerTool(server, config, {
    name: "manageDeviceApp",
    title: "Launch, Close or Restart App",
    description:
      "Launch, close (terminate) or restart an app on the device. Defaults to the app under test; pass appId (Android package or iOS bundle id) for another installed app.",
    schema: {
      sessionId,
      action: z.enum(["launch", "terminate", "restart"]),
      appId: z.string().optional(),
      settleMs: settleMs.default(1500),
    },
    hints: writeHints,
    failurePrefix: "Failed to manage app",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await manageApp(session, args));
    },
  });

  tools.uninstallDeviceApp = registerTool(server, config, {
    name: "uninstallDeviceApp",
    title: "Uninstall App From Device",
    description:
      "Uninstall an app from the device in an open session (defaults to the app under test). Removes the app and its data from that device for the rest of the session; confirm with the user first.",
    schema: { sessionId, appId: z.string().optional(), settleMs },
    hints: { ...writeHints, destructiveHint: true },
    failurePrefix: "Failed to uninstall app",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await manageApp(session, { ...args, action: "uninstall" }));
    },
  });

  tools.setDeviceState = registerTool(server, config, {
    name: "setDeviceState",
    title: "Set Device State",
    description:
      "Change device state in an open session: rotate (portrait/landscape), close the on-screen keyboard (hideKeyboard: true; use it when the keyboard covers a field or button), and/or switch between the native app and a web view ('native', 'webview', or an exact context name from getDeviceSession).",
    schema: {
      sessionId,
      orientation: z.enum(["portrait", "landscape"]).optional(),
      hideKeyboard: z.boolean().optional(),
      context: z.string().optional(),
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to change device state",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(...(await setDeviceState(session, args)));
    },
  });

  tools.simulateBiometric = registerTool(server, config, {
    name: "simulateBiometric",
    title: "Simulate Biometric",
    description:
      "Answer a fingerprint / Touch ID / Face ID prompt on the device with a pass or a fail. The session must have been started with enableBiometric: true.",
    schema: { sessionId, match: z.enum(["pass", "fail"]), settleMs },
    hints: writeHints,
    failurePrefix: "Failed to simulate biometric",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      const done = await simulateBiometric(session, args.match);
      await new Promise((r) => setTimeout(r, args.settleMs));
      return text(done);
    },
  });

  tools.runAdbShellCommand = registerTool(server, config, {
    name: "runAdbShellCommand",
    title: "Run adb Shell Command",
    description:
      "Read a device property on an Android phone in an open session with adb getprop, e.g. 'getprop ro.build.version.release' or 'getprop ro.product.manufacturer'. Only 'getprop <property>' is accepted: commands that list apps or system state could show other customers' apps on shared phones. BrowserStack itself allows only some properties on shared phones; for the device name and OS version, use getDeviceSession.",
    schema: {
      sessionId,
      command: z.string().min(1).max(500),
    },
    hints: readHints,
    failurePrefix: "Failed to run adb shell command",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await runAdbShell(session, args.command));
    },
  });

  tools.pushFileToDevice = registerTool(server, config, {
    name: "pushFileToDevice",
    title: "Push File To Device",
    description:
      "Write a file onto the device in an open session: a local file (inside MCP_UPLOAD_BASE_DIR, up to 10 MB) or inline text. Android paths like '/sdcard/Download/a.txt'; iOS app-container paths like '@com.example.app:documents/a.txt'.",
    schema: {
      sessionId,
      devicePath: z.string().min(1),
      filePath: z.string().optional(),
      text: z.string().max(1_000_000).optional(),
    },
    hints: writeHints,
    failurePrefix: "Failed to push file",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await pushFile(session, args));
    },
  });

  tools.pullFileFromDevice = registerTool(server, config, {
    name: "pullFileFromDevice",
    title: "Pull File From Device",
    description:
      "Read a file from the device in an open session (up to 5 MB). Text comes back as text, images as an image, anything else as base64.",
    schema: { sessionId, devicePath: z.string().min(1) },
    hints: readHints,
    failurePrefix: "Failed to pull file",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      const f = await pullFile(session, args.devicePath);
      if (f.imageBase64) {
        return {
          content: [
            { type: "image", data: f.imageBase64, mimeType: f.mimeType! },
            { type: "text", text: `${args.devicePath} (${f.bytes} bytes)` },
          ],
        };
      }
      if (f.text !== undefined) {
        return text(`${args.devicePath} (${f.bytes} bytes):`, f.text);
      }
      return text(
        `${args.devicePath} (${f.bytes} bytes, binary, base64):`,
        f.base64,
      );
    },
  });

  tools.injectCameraImage = registerTool(server, config, {
    name: "injectCameraImage",
    title: "Inject Camera Image",
    description:
      "Make the app's camera see an image (QR code, document, photo) uploaded with uploadMediaFile. The session must have been started with enableCameraImageInjection: true; call this before the app opens the camera.",
    schema: {
      sessionId,
      imageUrl: z.string().describe("media:// URL from uploadMediaFile."),
    },
    hints: writeHints,
    failurePrefix: "Failed to inject camera image",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await injectCameraImage(session, args.imageUrl));
    },
  });

  tools.setDeviceLocation = registerTool(server, config, {
    name: "setDeviceLocation",
    title: "Set Device Location",
    description:
      "Change the device's simulated GPS location during an open session (to set it at start, use startDeviceSession gpsLocation).",
    schema: {
      sessionId,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      altitude: z.number().optional(),
      settleMs,
    },
    hints: writeHints,
    failurePrefix: "Failed to set location",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      const done = await setLocation(session, args);
      await new Promise((r) => setTimeout(r, args.settleMs));
      return text(done);
    },
  });

  tools.setNetworkConditions = registerTool(server, config, {
    name: "setNetworkConditions",
    title: "Set Network Conditions",
    description:
      "Change the device's network during an open session to a named profile: 'no-network', '2g-gprs-good', '2g-gprs-lossy', '3g-umts-good', '3g-umts-lossy', '4g-lte-good', '4g-lte-advanced-good', or 'reset' to restore the default.",
    schema: {
      sessionId,
      profile: z.string().min(1),
    },
    hints: writeHints,
    failurePrefix: "Failed to set network conditions",
    run: async (args) => {
      const session = getOwnedSession(args.sessionId, config);
      return text(await setNetwork(session, args.profile, config));
    },
  });

  return tools;
}
