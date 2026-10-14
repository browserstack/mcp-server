import logger from "../../logger.js";
import { maybeCompressBase64 } from "../../lib/utils.js";
import {
  ANDROID_KEYCODES,
  IOS_BUTTONS,
  MAX_PAGE_SOURCE_CHARS,
} from "./constants.js";
import {
  formatScreenElements,
  parseScreenElements,
  redactSecureValues,
} from "./screen.js";
import { DeviceSession, forgetSession } from "./session.js";

/** An error worded for the agent, passed through without extra prefixes. */
export class DeviceToolError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SESSION_GONE =
  /invalid session id|session .*(not found|does not exist|terminated|already finished|has been terminated)|no such session|ECONNREFUSED|session timed out|Could not find a session/i;

/**
 * Run a device command. If BrowserStack has already ended the session (idle
 * timeout, closed from the dashboard), drop it locally and say so plainly
 * rather than surfacing a raw WebDriver error.
 */
export async function onDevice<T>(
  session: DeviceSession,
  label: string,
  fn: (b: any) => Promise<T>,
): Promise<T> {
  try {
    const result = await fn(session.browser as any);
    session.lastActionAt = Date.now();
    session.actionCount++;
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (SESSION_GONE.test(msg)) {
      forgetSession(session.sessionId);
      throw new Error(
        `The device session ${session.sessionId} has ended on BrowserStack (it may have idled out). Start a new one with startDeviceSession.`,
      );
    }
    // Our own errors already say what went wrong; raw driver errors get the
    // action label so they are not context-free.
    throw error instanceof DeviceToolError
      ? error
      : new Error(`${label}: ${msg}`);
  }
}

/**
 * Tag an agent action on the session timeline. Best effort: an
 * annotation must never fail or slow the action it describes.
 */
export async function annotate(session: DeviceSession, text: string) {
  const payload = JSON.stringify({
    action: "annotate",
    arguments: { data: `[mcp] ${text}`.slice(0, 250), level: "info" },
  });
  try {
    await (session.browser as any).execute(`browserstack_executor: ${payload}`);
  } catch (error) {
    logger.debug("annotate failed: %s", error);
  }
}

async function settle(ms: number) {
  if (ms > 0) await sleep(ms);
}

async function windowSize(b: any): Promise<{ width: number; height: number }> {
  const size = await b.getWindowSize();
  return { width: Number(size.width), height: Number(size.height) };
}

// -- element lookup -------------------------------------------------------------

export interface ElementTarget {
  selector?: string;
  text?: string;
}

function xpathLiteral(s: string): string {
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return `concat(${s
    .split('"')
    .map((p) => `"${p}"`)
    .join(`, '"', `)})`;
}

function predicateLiteral(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Locators for an element by its visible text: exact match first, then
 * contains. Deterministic — choosing the right element is the agent's job;
 * it can pass an exact `selector` from readDeviceScreen when text is ambiguous.
 */
export function textLocators(
  platform: "android" | "ios",
  text: string,
): string[] {
  if (platform === "ios") {
    const q = predicateLiteral(text);
    return [
      `-ios predicate string:label == ${q} OR name == ${q} OR value == ${q} OR placeholderValue == ${q}`,
      `-ios predicate string:label CONTAINS[c] ${q} OR name CONTAINS[c] ${q} OR value CONTAINS[c] ${q} OR placeholderValue CONTAINS[c] ${q}`,
    ];
  }
  const q = xpathLiteral(text);
  return [
    `//*[@text=${q} or @content-desc=${q} or @hint=${q}]`,
    `//*[contains(@text, ${q}) or contains(@content-desc, ${q}) or contains(@hint, ${q})]`,
  ];
}

/** Poll for the element instead of failing on the first miss. */
async function findElement(
  session: DeviceSession,
  target: ElementTarget,
  waitMs: number,
): Promise<any> {
  const b = session.browser as any;
  const locators = target.selector
    ? [target.selector]
    : textLocators(session.platform, target.text!);
  const deadline = Date.now() + waitMs;
  for (;;) {
    for (const locator of locators) {
      const el = await b.$(locator);
      if (await el.isExisting().catch(() => false)) return el;
    }
    if (Date.now() >= deadline) break;
    await sleep(500);
  }
  const what = target.selector
    ? `selector ${target.selector}`
    : `text "${target.text}"`;
  throw new DeviceToolError(
    `No element with ${what} appeared within ${Math.round(waitMs / 1000)}s. Call readDeviceScreen to see what is on screen.`,
  );
}

function describeTarget(target: ElementTarget): string {
  return target.selector ? `selector ${target.selector}` : `"${target.text}"`;
}

// -- input -----------------------------------------------------------------------

async function touch(
  b: any,
  steps: Array<Record<string, unknown>>,
): Promise<void> {
  await b.performActions([
    {
      type: "pointer",
      id: "finger1",
      parameters: { pointerType: "touch" },
      actions: steps,
    },
  ]);
  await b.releaseActions().catch(() => undefined);
}

export async function tap(
  session: DeviceSession,
  args: ElementTarget & {
    x?: number;
    y?: number;
    holdMs?: number;
    waitMs: number;
    settleMs: number;
  },
): Promise<string> {
  const hold = args.holdMs ?? 0;
  let done: string;
  if (args.selector || args.text) {
    done = await onDevice(session, "Tap", async (b) => {
      const el = await findElement(session, args, args.waitMs);
      if (hold > 0) {
        const loc = await el.getLocation();
        const size = await el.getSize();
        const x = Math.round(loc.x + size.width / 2);
        const y = Math.round(loc.y + size.height / 2);
        await touch(b, [
          { type: "pointerMove", duration: 0, x, y },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: hold },
          { type: "pointerUp", button: 0 },
        ]);
        return `Long-pressed ${describeTarget(args)} at (${x},${y}) for ${hold}ms`;
      }
      await el.click();
      return `Tapped ${describeTarget(args)}`;
    });
  } else {
    if (typeof args.x !== "number" || typeof args.y !== "number") {
      throw new DeviceToolError(
        "Provide x and y, or a selector, or text to tap.",
      );
    }
    const x = Math.round(args.x);
    const y = Math.round(args.y);
    done = await onDevice(session, "Tap", async (b) => {
      await touch(b, [
        { type: "pointerMove", duration: 0, x, y },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: Math.max(hold, 50) },
        { type: "pointerUp", button: 0 },
      ]);
      return hold > 0
        ? `Long-pressed (${x},${y}) for ${hold}ms`
        : `Tapped (${x},${y})`;
    });
  }
  await annotate(session, done);
  await settle(args.settleMs);
  return done;
}

export async function typeText(
  session: DeviceSession,
  args: ElementTarget & {
    value: string;
    clear: boolean;
    submit: boolean;
    waitMs: number;
    settleMs: number;
  },
): Promise<string> {
  const into =
    args.selector || args.text ? describeTarget(args) : "the focused field";
  let warning = "";
  await onDevice(session, "Typing", async (b) => {
    let el: any;
    if (args.selector || args.text) {
      el = await findElement(session, args, args.waitMs);
      await el.click().catch(() => undefined);
    } else {
      try {
        el = await b.$(await b.getActiveElement());
      } catch {
        el = undefined;
      }
    }
    if (el && (await el.isExisting().catch(() => false))) {
      // Report, don't guess: if the target is not a text field the agent
      // decides what to do next.
      const kind = String(
        (await el
          .getAttribute(session.platform === "ios" ? "type" : "class")
          .catch(() => "")) || "",
      );
      if (kind && !/Edit|Text(Field|View)|Search|AutoComplete/i.test(kind)) {
        warning = ` (note: the target is a ${kind.replace(/^.*[.]|^XCUIElementType/g, "")}, which may not accept text)`;
      }
      // Pin the resolved element: a field found by its placeholder no longer
      // matches that selector once it holds text, and a lazy re-query would miss it.
      const id: string | undefined = el.elementId;
      if (args.clear) {
        await (id ? b.elementClear(id) : el.clearValue()).catch(
          () => undefined,
        );
      }
      await (id ? b.elementSendKeys(id, args.value) : el.addValue(args.value));
    } else if (session.platform === "android") {
      // No focused element reference: type through the Appium IME instead.
      await b.execute("mobile: type", { text: args.value });
    } else {
      throw new DeviceToolError(
        "No text field is focused. Tap the field first, or pass selector/text to target it.",
      );
    }
    if (args.submit) {
      if (session.platform === "android") {
        await pressAndroidKeycode(b, ANDROID_KEYCODES.enter);
      } else {
        await iosEnter(b);
      }
    }
  });
  // The typed value is never echoed back: it may be a password or other secret.
  const done = `Typed ${args.value.length} character(s) into ${into}${args.submit ? " and pressed enter" : ""}${warning}`;
  await annotate(session, done);
  await settle(args.settleMs);
  return done;
}

export async function swipe(
  session: DeviceSession,
  args: {
    direction?: "up" | "down" | "left" | "right";
    distance?: number;
    from?: { x: number; y: number };
    to?: { x: number; y: number };
    durationMs: number;
    settleMs: number;
  },
): Promise<string> {
  const done = await onDevice(session, "Swipe", async (b) => {
    let from = args.from;
    let to = args.to;
    if (!from || !to) {
      if (!args.direction) {
        throw new DeviceToolError(
          "Provide a direction, or both from and to points.",
        );
      }
      const { width, height } = await windowSize(b);
      const frac = Math.min(Math.max(args.distance ?? 0.5, 0.1), 0.9);
      const cx = Math.round(width / 2);
      const cy = Math.round(height / 2);
      const dx = Math.round((width * frac) / 2);
      const dy = Math.round((height * frac) / 2);
      // direction = the way the finger moves ("up" reveals content further down).
      const paths = {
        up: [
          { x: cx, y: cy + dy },
          { x: cx, y: cy - dy },
        ],
        down: [
          { x: cx, y: cy - dy },
          { x: cx, y: cy + dy },
        ],
        left: [
          { x: cx + dx, y: cy },
          { x: cx - dx, y: cy },
        ],
        right: [
          { x: cx - dx, y: cy },
          { x: cx + dx, y: cy },
        ],
      } as const;
      [from, to] = paths[args.direction];
    }
    await touch(b, [
      {
        type: "pointerMove",
        duration: 0,
        x: Math.round(from.x),
        y: Math.round(from.y),
      },
      { type: "pointerDown", button: 0 },
      { type: "pause", duration: 100 },
      {
        type: "pointerMove",
        duration: args.durationMs,
        x: Math.round(to.x),
        y: Math.round(to.y),
      },
      { type: "pointerUp", button: 0 },
    ]);
    return `Swiped from (${Math.round(from.x)},${Math.round(from.y)}) to (${Math.round(to.x)},${Math.round(to.y)})`;
  });
  await annotate(session, done);
  await settle(args.settleMs);
  return done;
}

async function pressAndroidKeycode(b: any, keycode: number) {
  try {
    await b.execute("mobile: pressKey", { keycode });
  } catch {
    // Older Appium servers only serve the legacy endpoint.
    await b.pressKeyCode(keycode);
  }
}

/**
 * iOS has no enter keycode. Press the keyboard's own action key; if there is
 * no keyboard, send a newline to whatever has focus.
 */
async function iosEnter(b: any): Promise<void> {
  const key = await b.$(
    '-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeKey") AND name IN {"Return", "return", "Done", "done", "Go", "go", "Search", "search", "Next", "next", "Send", "send", "Join", "join"}',
  );
  if (await key.isExisting().catch(() => false)) {
    await key.click();
    return;
  }
  const ref = await b.getActiveElement();
  const id = ref?.["element-6066-11e4-a52e-4f735466cecf"] ?? ref?.ELEMENT;
  if (!id) {
    throw new DeviceToolError("Nothing is focused to press enter on.");
  }
  await b.elementSendKeys(id, "\n");
}

/** iOS back: the system back gesture, a left-edge swipe. */
async function iosBack(b: any): Promise<string> {
  const { width, height } = await windowSize(b);
  const y = Math.round(height / 2);
  await touch(b, [
    { type: "pointerMove", duration: 0, x: 2, y },
    { type: "pointerDown", button: 0 },
    { type: "pause", duration: 100 },
    { type: "pointerMove", duration: 300, x: Math.round(width * 0.7), y },
    { type: "pointerUp", button: 0 },
  ]);
  return "Swiped from the left edge (iOS back gesture)";
}

export async function pressKey(
  session: DeviceSession,
  args: { key?: string; keycode?: number; settleMs: number },
): Promise<string> {
  const key = args.key?.toLowerCase().replace(/[\s-]+/g, "_");
  const done = await onDevice(session, "Key press", async (b) => {
    if (session.platform === "android") {
      const keycode = args.keycode ?? (key ? ANDROID_KEYCODES[key] : undefined);
      if (keycode === undefined) {
        throw new DeviceToolError(
          `Unknown key "${args.key}". Android keys: ${Object.keys(ANDROID_KEYCODES).join(", ")}, or pass a numeric keycode.`,
        );
      }
      await pressAndroidKeycode(b, keycode);
      return `Pressed ${key ?? `keycode ${keycode}`}`;
    }
    if (args.keycode !== undefined) {
      throw new DeviceToolError(
        "iOS has no numeric keycodes; use key instead.",
      );
    }
    if (key === "back") return iosBack(b);
    if (key === "enter") {
      await iosEnter(b);
      return "Pressed enter";
    }
    if (key && IOS_BUTTONS.has(key)) {
      await b.execute("mobile: pressButton", { name: key.replace("_", "") });
      return `Pressed ${key}`;
    }
    throw new DeviceToolError(
      `Unsupported iOS key "${args.key}". iOS keys: back, enter, ${[...IOS_BUTTONS].join(", ")}.`,
    );
  });
  await annotate(session, done);
  await settle(args.settleMs);
  return done;
}

// -- app control -----------------------------------------------------------------

async function foregroundAppId(
  session: DeviceSession,
  b: any,
): Promise<string | undefined> {
  try {
    if (session.platform === "android") {
      return (await b.execute("mobile: getCurrentPackage")) || undefined;
    }
    const info = await b.execute("mobile: activeAppInfo");
    return info?.bundleId || undefined;
  } catch {
    return undefined;
  }
}

function appParam(session: DeviceSession, appId: string) {
  return session.platform === "ios" ? { bundleId: appId } : { appId };
}

export async function manageApp(
  session: DeviceSession,
  args: {
    action: "launch" | "terminate" | "restart" | "uninstall";
    appId?: string;
    settleMs: number;
  },
): Promise<string> {
  const done = await onDevice(session, `App ${args.action}`, async (b) => {
    const appId =
      args.appId || session.appId || (await foregroundAppId(session, b));
    if (!appId) {
      throw new DeviceToolError(
        "Could not tell which app to act on. Pass appId (Android package or iOS bundle id).",
      );
    }
    if (!session.appId && !args.appId) session.appId = appId;
    const p = appParam(session, appId);
    if (args.action === "terminate" || args.action === "restart") {
      await b.execute("mobile: terminateApp", p);
    }
    if (args.action === "launch" || args.action === "restart") {
      await b.execute("mobile: activateApp", p);
    }
    if (args.action === "uninstall") {
      await b.execute("mobile: removeApp", p);
    }
    const verb = {
      launch: "Launched",
      terminate: "Closed",
      restart: "Restarted",
      uninstall: "Uninstalled",
    }[args.action];
    return `${verb} ${appId}`;
  });
  await annotate(session, done);
  await settle(args.settleMs);
  return done;
}

// -- device state ----------------------------------------------------------------

export async function setDeviceState(
  session: DeviceSession,
  args: {
    orientation?: "portrait" | "landscape";
    hideKeyboard?: boolean;
    context?: string;
    settleMs: number;
  },
): Promise<string[]> {
  const done: string[] = [];
  await onDevice(session, "Device state change", async (b) => {
    if (args.hideKeyboard) {
      try {
        // WebDriverAgent needs to be told which key dismisses the keyboard.
        await b.execute(
          "mobile: hideKeyboard",
          session.platform === "ios"
            ? { keys: ["done", "Done", "return", "Return", "go", "Go"] }
            : {},
        );
      } catch {
        await b.hideKeyboard();
      }
      done.push("Hid the keyboard");
    }
    if (args.orientation) {
      await b.setOrientation(args.orientation.toUpperCase());
      done.push(`Rotated to ${args.orientation}`);
    }
    if (args.context) {
      const contexts = await listContexts(b);
      const wanted = args.context.trim();
      const match =
        contexts.find((c) => c === wanted) ||
        (wanted.toLowerCase() === "native"
          ? contexts.find((c) => c === "NATIVE_APP")
          : wanted.toLowerCase() === "webview"
            ? contexts.find((c) => c.startsWith("WEBVIEW"))
            : undefined);
      if (!match) {
        throw new DeviceToolError(
          `Context "${wanted}" is not available. Available: ${contexts.join(", ") || "none"}.`,
        );
      }
      await b.switchAppiumContext(match);
      done.push(`Switched to context ${match}`);
    }
  });
  if (!done.length) {
    throw new Error(
      "Nothing to change: pass orientation, hideKeyboard or context.",
    );
  }
  await annotate(session, done.join("; "));
  await settle(args.settleMs);
  return done;
}

async function listContexts(b: any): Promise<string[]> {
  const raw = await b.getAppiumContexts();
  return (Array.isArray(raw) ? raw : [])
    .map((c: any) => (typeof c === "string" ? c : c?.id))
    .filter(Boolean);
}

export async function describeDeviceState(session: DeviceSession) {
  return onDevice(session, "Reading device state", async (b) => {
    const [orientation, contexts, context, keyboard] = await Promise.all([
      b.getOrientation().catch(() => undefined),
      listContexts(b).catch(() => [] as string[]),
      b.getAppiumContext().catch(() => undefined),
      b.isKeyboardShown().catch(() => undefined),
    ]);
    return {
      orientation:
        typeof orientation === "string" ? orientation.toLowerCase() : undefined,
      context: typeof context === "string" ? context : (context as any)?.id,
      contexts,
      keyboardShown: keyboard,
      foregroundApp: await foregroundAppId(session, b),
    };
  });
}

// -- observation -------------------------------------------------------------------

/**
 * On iOS the screenshot is downscaled from pixels to points so it
 * shares one coordinate space with readDeviceScreen and the tap/swipe tools.
 */
export async function screenshot(session: DeviceSession): Promise<{
  base64: string;
  width?: number;
  height?: number;
}> {
  return onDevice(session, "Screenshot", async (b) => {
    const raw: string = await b.takeScreenshot();
    let base64 = raw;
    let width: number | undefined;
    let height: number | undefined;
    try {
      const { default: sharp } = await import("sharp");
      const buf = Buffer.from(raw, "base64");
      const meta = await sharp(buf).metadata();
      width = meta.width;
      height = meta.height;
      if (session.platform === "ios" && meta.width) {
        if (session.iosScale === undefined) {
          const size = await windowSize(b).catch(() => undefined);
          session.iosScale = size?.width ? meta.width / size.width : 1;
        }
        if (session.iosScale > 1.01) {
          width = Math.round(meta.width / session.iosScale);
          height = Math.round((meta.height ?? 0) / session.iosScale);
          base64 = (
            await sharp(buf).resize(width, height).png().toBuffer()
          ).toString("base64");
        }
      }
    } catch (error) {
      logger.debug("screenshot post-processing skipped: %s", error);
    }
    return { base64: await maybeCompressBase64(base64), width, height };
  });
}

export async function readScreen(
  session: DeviceSession,
  args: { mode: "elements" | "source"; limit: number },
): Promise<string> {
  const source: string = await onDevice(session, "Reading the screen", (b) =>
    b.getPageSource(),
  );
  if (args.mode === "source") {
    const safe = redactSecureValues(source);
    return safe.length > MAX_PAGE_SOURCE_CHARS
      ? `${safe.slice(0, MAX_PAGE_SOURCE_CHARS)}\n<!-- truncated: ${safe.length - MAX_PAGE_SOURCE_CHARS} more characters. Use mode "elements" for a compact view. -->`
      : safe;
  }
  const { elements, total } = parseScreenElements(
    source,
    session.platform,
    args.limit,
  );
  const space = session.platform === "ios" ? "points" : "device pixels";
  const header = `${total} actionable element(s) on screen${total > elements.length ? `, showing the first ${elements.length}` : ""}. Coordinates are ${space}; pass tap=(x,y) to tapOnDevice.`;
  return elements.length
    ? `${header}\n${formatScreenElements(elements)}`
    : `${header}\nNothing actionable was found; the screen may still be loading, or it is a canvas/game view. Take a screenshot to see it.`;
}
