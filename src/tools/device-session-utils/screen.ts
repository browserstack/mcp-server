/**
 * Turns Appium page source into a short list of elements an agent can act on.
 *
 * Coordinates are always in the space the tap/swipe tools take: device pixels
 * on Android (UiAutomator2 `bounds`), points on iOS (XCUITest x/y/width/height).
 * takeDeviceScreenshot scales iOS images to points so all three agree.
 *
 * A tag scanner rather than a DOM parser: Appium emits well-formed XML and we
 * only need each node's attributes, not the hierarchy.
 */

export interface ScreenElement {
  index: number;
  type: string;
  text?: string;
  id?: string;
  desc?: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  flags: string[];
}

const TAG = /<([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
const ATTR = /([\w.:-]+)\s*=\s*"([^"]*)"/g;

function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attributesOf(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) attrs[m[1]] = decode(m[2]);
  return attrs;
}

function shortType(tag: string, attrs: Record<string, string>): string {
  const cls = attrs.class || tag;
  return cls
    .replace(/^XCUIElementType/, "")
    .replace(/^android\.(widget|view|webkit)\./, "")
    .replace(/^.*\./, "");
}

const ANDROID_BOUNDS = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/;

function androidElement(tag: string, a: Record<string, string>) {
  const b = ANDROID_BOUNDS.exec(a.bounds || "");
  if (!b) return null;
  const [x1, y1, x2, y2] = b.slice(1).map(Number);
  const flags: string[] = [];
  if (a.clickable === "true") flags.push("clickable");
  if (a["long-clickable"] === "true") flags.push("long-clickable");
  if (a.scrollable === "true") flags.push("scrollable");
  if (a.checkable === "true")
    flags.push(a.checked === "true" ? "checked" : "unchecked");
  if (a.focused === "true") flags.push("focused");
  if (a.selected === "true") flags.push("selected");
  if (a.enabled === "false") flags.push("disabled");
  if (a.password === "true") flags.push("password");
  const type = shortType(tag, a);
  if (/EditText|TextField|AutoComplete/i.test(type)) flags.push("editable");
  const text = a.password === "true" ? undefined : a.text || undefined;
  const interesting =
    !!text ||
    !!a["content-desc"] ||
    flags.some((f) =>
      [
        "clickable",
        "long-clickable",
        "scrollable",
        "editable",
        "checked",
        "unchecked",
      ].includes(f),
    );
  if (!interesting || a.displayed === "false") return null;
  return {
    type,
    text,
    id: a["resource-id"] || undefined,
    desc: a["content-desc"] || undefined,
    bounds: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
    flags,
  };
}

const IOS_INTERACTIVE =
  /^(Button|Link|Cell|TextField|SecureTextField|SearchField|TextView|Switch|Slider|Stepper|SegmentedControl|Picker|PickerWheel|Tab|Key|Toggle|MenuItem|PageIndicator|Image)$/;

function iosElement(tag: string, a: Record<string, string>) {
  if (a.visible === "false") return null;
  const [x, y, width, height] = ["x", "y", "width", "height"].map((k) =>
    Number(a[k]),
  );
  if ([x, y, width, height].some((n) => Number.isNaN(n))) return null;
  const type = shortType(tag, a);
  const flags: string[] = [];
  if (a.enabled === "false") flags.push("disabled");
  if (a.selected === "true") flags.push("selected");
  if (/TextField|SearchField|TextView/.test(type)) flags.push("editable");
  if (type === "SecureTextField") flags.push("editable", "password");
  if (type === "Switch" || type === "Toggle")
    flags.push(a.value === "1" ? "checked" : "unchecked");
  const label = a.label || undefined;
  const value = type === "SecureTextField" ? undefined : a.value || undefined;
  const text = label ?? value;
  const interesting = !!text || IOS_INTERACTIVE.test(type);
  // Container noise: an Other/Window without text is never a useful target.
  if (!interesting || ((type === "Other" || type === "Window") && !text))
    return null;
  if (width <= 0 || height <= 0) return null;
  return {
    type,
    text,
    id: a.name && a.name !== label ? a.name : undefined,
    desc: value && value !== text ? value : undefined,
    bounds: { x, y, width, height },
    flags,
  };
}

export function parseScreenElements(
  pageSource: string,
  platform: "android" | "ios",
  limit: number,
): { elements: ScreenElement[]; total: number } {
  const elements: ScreenElement[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const m of pageSource.matchAll(TAG)) {
    const tag = m[1];
    if (tag === "hierarchy" || tag === "AppiumAUT" || tag.startsWith("?"))
      continue;
    const attrs = attributesOf(m[2] || "");
    const el =
      platform === "ios" ? iosElement(tag, attrs) : androidElement(tag, attrs);
    if (!el) continue;
    // iOS repeats the same label at several container depths; keep one.
    const key = `${el.type}|${el.text ?? ""}|${el.id ?? ""}|${el.bounds.x},${el.bounds.y},${el.bounds.width},${el.bounds.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    if (elements.length >= limit) continue;
    elements.push({
      index: elements.length,
      ...el,
      center: {
        x: Math.round(el.bounds.x + el.bounds.width / 2),
        y: Math.round(el.bounds.y + el.bounds.height / 2),
      },
    });
  }
  return { elements, total };
}

/** One element per line: compact for the model, still unambiguous. */
export function formatScreenElements(elements: ScreenElement[]): string {
  return elements
    .map((e) => {
      const parts = [`[${e.index}] ${e.type}`];
      if (e.text) parts.push(`"${e.text.slice(0, 120)}"`);
      if (e.id) parts.push(`id=${e.id}`);
      if (e.desc) parts.push(`desc="${e.desc.slice(0, 80)}"`);
      parts.push(`tap=(${e.center.x},${e.center.y})`);
      parts.push(
        `bounds=${e.bounds.x},${e.bounds.y} ${e.bounds.width}x${e.bounds.height}`,
      );
      if (e.flags.length) parts.push(`{${e.flags.join(",")}}`);
      return parts.join(" ");
    })
    .join("\n");
}

/** Values of password fields must not reach the model when it asks for raw source. */
export function redactSecureValues(pageSource: string): string {
  return pageSource
    .replace(
      /(<XCUIElementTypeSecureTextField\b[^>]*?\bvalue=")[^"]*(")/g,
      "$1•••$2",
    )
    .replace(/(<[^>]*\bpassword="true"[^>]*?\btext=")[^"]*(")/g, "$1•••$2")
    .replace(/(<[^>]*\btext=")[^"]*("[^>]*\bpassword="true")/g, "$1•••$2");
}
