import logger from "../../logger.js";
import { maybeCompressBase64 } from "../../lib/utils.js";
import { ANDROID_KEYCODES, IOS_BUTTONS } from "./constants.js";
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
 * it can pass an exact `selector` when text is ambiguous.
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
    `No element with ${what} appeared within ${Math.round(waitMs / 1000)}s. Take a screenshot to see what is on screen.`,
  );
}

function describeTarget(target: ElementTarget): string {
  return target.selector ? `selector ${target.selector}` : `"${target.text}"`;
}

// -- on-screen keyboard ----------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/**
 * Whether the on-screen keyboard is up, and on iOS where it is. Android does
 * not report the keyboard's bounds through UiAutomator2, so `rect` is iOS only.
 */
async function keyboardState(
  session: DeviceSession,
  b: any,
): Promise<{ shown: boolean; rect?: Rect }> {
  let shown = false;
  try {
    shown = Boolean(await b.isKeyboardShown());
  } catch {
    shown = false;
  }
  if (!shown || session.platform !== "ios") return { shown };
  try {
    const kb = await b.$("-ios class chain:**/XCUIElementTypeKeyboard");
    if (await kb.isExisting()) {
      return { shown, rect: await b.getElementRect(kb.elementId) };
    }
  } catch {
    // Shown, position unknown.
  }
  return { shown };
}

/**
 * Close the on-screen keyboard, trying each way in turn and checking after
 * each. Return/Go/Next keys can submit a form, so they are only tried when the
 * caller asked to close the keyboard (not before an automatic tap).
 */
export async function dismissKeyboard(
  session: DeviceSession,
  b: any,
  opts: { allowReturn: boolean },
): Promise<{ closed: boolean; how?: string; tried: string[] }> {
  const tried: string[] = [];
  const open = async () => (await keyboardState(session, b)).shown;
  if (!(await open())) return { closed: true, how: "already closed", tried };

  const steps: Array<[string, () => Promise<unknown>]> =
    session.platform === "android"
      ? [
          ["hide keyboard", () => b.execute("mobile: hideKeyboard", {})],
          ["legacy hide keyboard", () => b.hideKeyboard()],
          ["back key", () => pressAndroidKeycode(b, ANDROID_KEYCODES.back)],
        ]
      : [
          [
            "Done key",
            () =>
              b.execute("mobile: hideKeyboard", {
                keys: ["Done", "done", "Hide keyboard", "Dismiss"],
              }),
          ],
          [
            // Starts above the keyboard and stops short of it: a drag that
            // starts on the keys is read as swipe-typing and types a word
            // into the field (iOS 27 typed "to" / "TV"). Apps whose scroll
            // view dismisses the keyboard on drag close it this way.
            "drag down above the keyboard",
            async () => {
              const { rect } = await keyboardState(session, b);
              if (!rect || rect.y < 160) return;
              const x = Math.round(rect.x + rect.width / 2);
              const top = Math.round(rect.y - 120);
              await touch(b, [
                { type: "pointerMove", duration: 0, x, y: top },
                { type: "pointerDown", button: 0 },
                ...[30, 60, 90, 110].map((d) => ({
                  type: "pointerMove",
                  duration: 50,
                  x,
                  y: top + d,
                })),
                { type: "pointerUp", button: 0 },
              ]);
            },
          ],
          ...(opts.allowReturn
            ? ([
                [
                  "Return key",
                  () =>
                    b.execute("mobile: hideKeyboard", {
                      keys: [
                        "Return",
                        "return",
                        "Go",
                        "go",
                        "Next",
                        "next",
                        "Search",
                        "search",
                      ],
                    }),
                ],
              ] as Array<[string, () => Promise<unknown>]>)
            : []),
        ];
  for (const [name, step] of steps) {
    tried.push(name);
    try {
      await step();
    } catch (error) {
      logger.debug("keyboard close via %s failed: %s", name, error);
    }
    await sleep(400);
    if (!(await open())) return { closed: true, how: name, tried };
  }
  return { closed: false, tried };
}

/**
 * Before tapping or typing into an element, make sure the keyboard is not in
 * the way. iOS: close it when it covers the element's centre. Android (no
 * keyboard bounds): close it before tapping anything that is not a text field.
 * The element is looked up again afterwards, because the layout moves.
 */
async function uncover(
  session: DeviceSession,
  b: any,
  target: ElementTarget,
  el: any,
  waitMs: number,
): Promise<{ el: any; note?: string }> {
  const kb = await keyboardState(session, b);
  if (!kb.shown) return { el };
  let covered: boolean;
  if (session.platform === "ios") {
    if (!kb.rect) return { el };
    const loc = await el.getLocation();
    const size = await el.getSize();
    covered = inside(kb.rect, loc.x + size.width / 2, loc.y + size.height / 2);
  } else {
    const cls = String((await el.getAttribute("class").catch(() => "")) || "");
    covered = !/EditText|AutoComplete/i.test(cls);
  }
  if (!covered) return { el };
  const r = await dismissKeyboard(session, b, { allowReturn: false });
  if (!r.closed) {
    throw new DeviceToolError(
      `${describeTarget(target)} is under the on-screen keyboard, which did not close (tried: ${r.tried.join(", ")}). Return was not pressed because it can submit the form: setDeviceState hideKeyboard also tries Return, which closes the keyboard in many apps. If the app submits on enter, typeOnDevice with submit: true may get past this screen. Otherwise look for a way through that needs no typing (for example, values the app can fill in for you), or leave the screen with the app's own back control, which closes the keyboard. If nothing works, a person on this phone would be blocked too: report it as an app issue.`,
    );
  }
  return {
    el: await findElement(session, target, waitMs),
    note: `closed the on-screen keyboard first (${r.how})`,
  };
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
      const found = await findElement(session, args, args.waitMs);
      const { el, note } = await uncover(session, b, args, found, args.waitMs);
      const after = note ? ` (${note})` : "";
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
        return `Long-pressed ${describeTarget(args)} at (${x},${y}) for ${hold}ms${after}`;
      }
      await el.click();
      return `Tapped ${describeTarget(args)}${after}`;
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
      const kb = await keyboardState(session, b);
      const onKeyboard = kb.rect
        ? inside(kb.rect, x, y)
        : kb.shown && session.platform === "android";
      await touch(b, [
        { type: "pointerMove", duration: 0, x, y },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: Math.max(hold, 50) },
        { type: "pointerUp", button: 0 },
      ]);
      const where =
        hold > 0
          ? `Long-pressed (${x},${y}) for ${hold}ms`
          : `Tapped (${x},${y})`;
      if (!onKeyboard) return where;
      return kb.rect
        ? `${where}. Note: this point is on the on-screen keyboard (it starts at y=${Math.round(kb.rect.y)}). To reach what is under it, tap the element by its text (the keyboard is then closed first) or use setDeviceState hideKeyboard.`
        : `${where}. Note: the on-screen keyboard is open and may cover this point. Tap elements by their text to have it closed first, or use setDeviceState hideKeyboard.`;
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
    hideKeyboard?: boolean;
    waitMs: number;
    settleMs: number;
  },
): Promise<string> {
  const into =
    args.selector || args.text ? describeTarget(args) : "the focused field";
  let warning = "";
  let keyboardNote = "";
  await onDevice(session, "Typing", async (b) => {
    let el: any;
    if (args.selector || args.text) {
      const found = await findElement(session, args, args.waitMs);
      el = (await uncover(session, b, args, found, args.waitMs)).el;
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
    if (args.hideKeyboard) {
      // Asked for explicitly, so Return is tried last, as setDeviceState does.
      const r = await dismissKeyboard(session, b, { allowReturn: true });
      keyboardNote = r.closed
        ? ` and closed the on-screen keyboard (${r.how})`
        : `. The on-screen keyboard could not be closed (tried: ${r.tried.join(", ")}); the app offers no way to close it`;
    } else if ((await keyboardState(session, b)).shown) {
      keyboardNote = `. The on-screen keyboard is open: tapOnDevice closes it automatically when it covers the next element, or pass hideKeyboard: true to close it now`;
    }
  });
  // The typed value is never echoed back: it may be a password or other secret.
  const done = `Typed ${args.value.length} character(s) into ${into}${args.submit ? " and pressed enter" : ""}${warning}${keyboardNote}`;
  await annotate(session, done);
  await settle(args.settleMs);
  return done;
}

export const SWIPE_STEPS_IOS = 5;
const swipeSteps = (n: number) =>
  Array.from({ length: n }, (_, i) => (i + 1) / n);

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
      // iOS ignores some gestures made of one long move (the edge swipe that
      // goes back is one), so the finger moves there in short steps.
      ...swipeSteps(session.platform === "ios" ? SWIPE_STEPS_IOS : 1).map(
        (f, _, all) => ({
          type: "pointerMove",
          duration: Math.max(1, Math.round(args.durationMs / all.length)),
          x: Math.round(from.x + (to.x - from.x) * f),
          y: Math.round(from.y + (to.y - from.y) * f),
        }),
      ),
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
// The edge-pan recogniser only fires when the touch starts exactly at x = 0
// and moves in steps; a start at x = 2 or one long move is ignored. Verified
// on real iPhone 15s running iOS 17 and iOS 27.
export const IOS_BACK_STEPS = [0.15, 0.3, 0.45, 0.6, 0.8];
/** Long enough for the iOS pop animation to finish before comparing screens. */
export const IOS_BACK_SETTLE_MS = 800;

async function iosBack(b: any): Promise<string> {
  const { width, height } = await windowSize(b);
  const y = Math.round(height / 2);
  const source = async (): Promise<string | undefined> => {
    try {
      return await b.getPageSource();
    } catch {
      return undefined;
    }
  };
  const before = await source();
  await touch(b, [
    { type: "pointerMove", duration: 0, x: 0, y },
    { type: "pointerDown", button: 0 },
    ...IOS_BACK_STEPS.map((f) => ({
      type: "pointerMove",
      duration: 60,
      x: Math.round(width * f),
      y,
    })),
    { type: "pointerUp", button: 0 },
  ]);
  await sleep(IOS_BACK_SETTLE_MS);
  const after = await source();
  if (before !== undefined && before === after) {
    // Screens an app draws with its own header instead of an iOS navigation
    // bar ignore the system swipe; a person's swipe does nothing there too.
    return "Swiped from the left edge (iOS back gesture), but the screen did not change: this screen does not respond to the iOS back swipe. Tap the app's own back control instead, usually at the top left.";
  }
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
      // activateApp can return without the app reaching the front (for
      // example, apps restricted on shared devices); check before claiming it.
      let front = await foregroundAppId(session, b);
      for (let i = 0; i < 3 && front && front !== appId; i++) {
        await sleep(700);
        front = await foregroundAppId(session, b);
      }
      if (front && front !== appId) {
        throw new DeviceToolError(
          `${appId} did not come to the front; ${front} is still showing. The app may be restricted on this device. Take a screenshot to check.`,
        );
      }
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
      const r = await dismissKeyboard(session, b, { allowReturn: true });
      if (!r.closed) {
        throw new DeviceToolError(
          `The on-screen keyboard is still open: this app offers no way to close it (tried: ${r.tried.join(", ")}). Look for a way through that needs no typing (for example, values the app can fill in for you), or leave the screen with the app's own back control, which closes the keyboard. If nothing works, a person on this phone would be blocked too: report it as an app issue.`,
        );
      }
      done.push(
        r.how === "already closed"
          ? "The keyboard was already closed"
          : `Closed the on-screen keyboard (${r.how})`,
      );
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
 * shares one coordinate space with the tap and swipe tools.
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
