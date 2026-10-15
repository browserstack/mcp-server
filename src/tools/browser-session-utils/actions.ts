import logger from "../../logger.js";
import { maybeCompressBase64 } from "../../lib/utils.js";
import { DeviceToolError } from "../device-session-utils/actions.js";
import { BrowserSession, forgetBrowserSession } from "./session.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SESSION_GONE =
  /invalid session id|session .*(not found|does not exist|terminated|already finished)|no such session|Could not find a session/i;

async function onBrowser<T>(
  session: BrowserSession,
  label: string,
  fn: (b: any) => Promise<T>,
): Promise<T> {
  try {
    const r = await fn(session.browser as any);
    session.lastActionAt = Date.now();
    session.actionCount++;
    return r;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (SESSION_GONE.test(msg)) {
      forgetBrowserSession(session.sessionId);
      throw new Error(
        `The browser session ${session.sessionId} has ended on BrowserStack (it may have idled out). Start a new one with startBrowserSession.`,
      );
    }
    throw error instanceof DeviceToolError
      ? error
      : new Error(`${label}: ${msg}`);
  }
}

/** Timeline annotations on web sessions too. */
async function annotate(session: BrowserSession, text: string) {
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

async function finish(session: BrowserSession, done: string, settleMs: number) {
  await annotate(session, done);
  if (settleMs > 0) await sleep(settleMs);
  return done;
}

export interface WebTarget {
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

/** Visible text / label locators: exact first, then contains. */
export function webTextLocators(text: string): string[] {
  const q = xpathLiteral(text);
  const attrs = (op: (a: string) => string) =>
    [
      "normalize-space(.)",
      "@aria-label",
      "@placeholder",
      "@value",
      "@title",
      "@alt",
    ]
      .map(op)
      .join(" or ");
  return [
    `//*[not(self::script or self::style)][${attrs((a) => `${a}=${q}`)}][not(*[${attrs((a) => `${a}=${q}`)}])]`,
    `//*[not(self::script or self::style)][${attrs((a) => `contains(${a}, ${q})`)}][not(*[${attrs((a) => `contains(${a}, ${q})`)}])]`,
  ];
}

async function findWebElement(b: any, target: WebTarget, waitMs: number) {
  if (!target.selector && !target.text) {
    throw new DeviceToolError("Provide selector (CSS or XPath) or text.");
  }
  const locators = target.selector
    ? [target.selector]
    : webTextLocators(target.text!);
  const deadline = Date.now() + waitMs;
  for (;;) {
    for (const loc of locators) {
      const el = await b.$(loc);
      if (await el.isExisting().catch(() => false)) return el;
    }
    if (Date.now() >= deadline) break;
    await sleep(500);
  }
  throw new DeviceToolError(
    `No element with ${target.selector ? `selector ${target.selector}` : `text "${target.text}"`} appeared within ${Math.round(waitMs / 1000)}s. Take a screenshot to see the page.`,
  );
}

const describe = (t: WebTarget) =>
  t.selector ? `selector ${t.selector}` : `"${t.text}"`;

/** Open a URL, or go back, forward or refresh. */
export async function navigate(
  session: BrowserSession,
  args: {
    url?: string;
    action?: "back" | "forward" | "refresh";
    settleMs: number;
  },
): Promise<string> {
  if (!!args.url === !!args.action) {
    throw new DeviceToolError("Provide exactly one of url or action.");
  }
  const where = await onBrowser(session, "Navigation", async (b) => {
    if (args.url) await b.url(args.url);
    else if (args.action === "back") await b.back();
    else if (args.action === "forward") await b.forward();
    else await b.refresh();
    return { url: await b.getUrl(), title: await b.getTitle() };
  });
  return finish(
    session,
    `${args.url ? "Opened" : args.action === "refresh" ? "Refreshed" : `Went ${args.action}`}: ${where.title || "(no title)"} — ${where.url}`,
    args.settleMs,
  );
}

/** Click an element. */
export async function click(
  session: BrowserSession,
  args: WebTarget & { waitMs: number; settleMs: number },
): Promise<string> {
  await onBrowser(session, "Click", async (b) => {
    const el = await findWebElement(b, args, args.waitMs);
    await el.scrollIntoView({ block: "center" }).catch(() => undefined);
    await el.click();
  });
  return finish(session, `Clicked ${describe(args)}`, args.settleMs);
}

/** Type into a field, or pick an option in a <select>. */
export async function typeOrSelect(
  session: BrowserSession,
  args: WebTarget & {
    value?: string;
    option?: string;
    clear: boolean;
    submit: boolean;
    waitMs: number;
    settleMs: number;
  },
): Promise<string> {
  if ((args.value === undefined) === (args.option === undefined)) {
    throw new DeviceToolError(
      "Provide exactly one of value (to type) or option (to select).",
    );
  }
  let done = "";
  await onBrowser(
    session,
    args.option !== undefined ? "Select" : "Typing",
    async (b) => {
      const el = await findWebElement(b, args, args.waitMs);
      if (args.option !== undefined) {
        const tag = String(await el.getTagName()).toLowerCase();
        if (tag !== "select") {
          throw new DeviceToolError(
            `The target is a <${tag}>, not a <select>.`,
          );
        }
        try {
          await el.selectByVisibleText(args.option);
        } catch {
          await el.selectByAttribute("value", args.option);
        }
        done = `Selected "${args.option}" in ${describe(args)}`;
        return;
      }
      if (args.clear) await el.clearValue().catch(() => undefined);
      await el.addValue(args.value!);
      if (args.submit) await b.keys("Enter");
      // Never echo the value: it may be a password.
      done = `Typed ${args.value!.length} character(s) into ${describe(args)}${args.submit ? " and pressed Enter" : ""}`;
    },
  );
  return finish(session, done, args.settleMs);
}

/** Scroll the page or bring an element into view. */
export async function scroll(
  session: BrowserSession,
  args: WebTarget & {
    direction?: "up" | "down" | "left" | "right";
    pixels?: number;
    to?: "top" | "bottom";
    waitMs: number;
    settleMs: number;
  },
): Promise<string> {
  const done = await onBrowser(session, "Scroll", async (b) => {
    if (args.selector || args.text) {
      const el = await findWebElement(b, args, args.waitMs);
      await el.scrollIntoView({ block: "center" });
      return `Scrolled ${describe(args)} into view`;
    }
    if (args.to) {
      await b.execute(
        args.to === "top"
          ? "window.scrollTo(0, 0)"
          : "window.scrollTo(0, document.documentElement.scrollHeight)",
      );
      return `Scrolled to the ${args.to}`;
    }
    if (!args.direction) {
      throw new DeviceToolError(
        "Provide direction, to, or an element (selector/text).",
      );
    }
    const px = args.pixels ?? 600;
    const [x, y] = {
      up: [0, -px],
      down: [0, px],
      left: [-px, 0],
      right: [px, 0],
    }[args.direction];
    await b.execute(`window.scrollBy(${x}, ${y})`);
    const pos = await b.execute("return [window.scrollX, window.scrollY]");
    return `Scrolled ${args.direction} ${px}px (now at ${pos?.[0] ?? "?"},${pos?.[1] ?? "?"})`;
  });
  return finish(session, done, args.settleMs);
}

/** Tabs, windows and frames. */
export async function switchContext(
  session: BrowserSession,
  args: {
    action:
      | "list"
      | "window"
      | "newTab"
      | "closeTab"
      | "frame"
      | "parentFrame"
      | "topFrame";
    handle?: string;
    index?: number;
    url?: string;
    selector?: string;
    settleMs: number;
  },
): Promise<string> {
  const done = await onBrowser(session, "Context switch", async (b) => {
    const describeWindows = async () => {
      const current = await b.getWindowHandle().catch(() => undefined);
      const handles: string[] = await b.getWindowHandles();
      const rows: string[] = [];
      for (const [i, h] of handles.entries()) {
        await b.switchToWindow(h);
        rows.push(
          `[${i}] ${h}${h === current ? " (current)" : ""} — ${await b.getTitle()} — ${await b.getUrl()}`,
        );
      }
      if (current) await b.switchToWindow(current);
      return rows.join("\n");
    };
    switch (args.action) {
      case "list":
        return `Open windows/tabs:\n${await describeWindows()}`;
      case "window": {
        const handles: string[] = await b.getWindowHandles();
        const handle =
          args.handle ??
          (args.index !== undefined ? handles[args.index] : undefined);
        if (!handle || !handles.includes(handle)) {
          throw new DeviceToolError(
            `No such window. Open:\n${await describeWindows()}`,
          );
        }
        await b.switchToWindow(handle);
        return `Switched to window ${handle}: ${await b.getTitle()}`;
      }
      case "newTab": {
        const w = await b.createWindow("tab");
        await b.switchToWindow(w.handle);
        if (args.url) await b.url(args.url);
        return `Opened new tab ${w.handle}${args.url ? ` at ${args.url}` : ""}`;
      }
      case "closeTab": {
        const handles: string[] = await b.getWindowHandles();
        if (handles.length <= 1) {
          throw new DeviceToolError(
            "This is the last tab; end the session instead.",
          );
        }
        const closing = await b.getWindowHandle();
        await b.closeWindow();
        const rest = handles.filter((h) => h !== closing);
        await b.switchToWindow(rest[rest.length - 1]);
        return `Closed tab ${closing}; now on ${rest[rest.length - 1]}`;
      }
      case "frame": {
        if (args.selector) {
          const el = await findWebElement(b, { selector: args.selector }, 5000);
          await b.switchFrame(el);
          return `Switched into frame ${args.selector}`;
        }
        if (args.index !== undefined) {
          await b.switchToFrame(args.index);
          return `Switched into frame #${args.index}`;
        }
        throw new DeviceToolError("frame needs selector or index.");
      }
      case "parentFrame":
        await b.switchToParentFrame();
        return "Switched to the parent frame";
      case "topFrame":
        await b.switchToFrame(null);
        return "Switched to the top-level page";
    }
  });
  return args.action === "list" ? done : finish(session, done, args.settleMs);
}

export async function screenshot(session: BrowserSession): Promise<string> {
  const raw: string = await onBrowser(session, "Screenshot", (b) =>
    b.takeScreenshot(),
  );
  return maybeCompressBase64(raw);
}
