// Endpoints and defaults for the agent-drivable device session tools.
//
// Agent-drivable sessions run on App Automate over the Appium hub. App Live has
// no input API (only a dashboard deep link for a human), so every tap / type /
// swipe / screenshot here goes through an App Automate Appium session authed
// with the user's own username:access_key.

export const APP_AUTOMATE_API_BASE =
  "https://api-cloud.browserstack.com/app-automate";
export const AUTOMATE_API_BASE = "https://api.browserstack.com/automate";
export const AUTOMATE_HUB_HOSTNAME = "hub.browserstack.com";
export const AUTOMATE_SESSION_DASHBOARD_URL = (sessionId: string) =>
  `https://automate.browserstack.com/dashboard/v2/sessions/${encodeURIComponent(sessionId)}`;

export const HUB_HOSTNAME = "hub-cloud.browserstack.com";
export const HUB_PATH = "/wd/hub";

export const SESSION_DASHBOARD_URL = (sessionId: string) =>
  `https://app-automate.browserstack.com/dashboard/v2/sessions/${encodeURIComponent(sessionId)}`;

// BrowserStack's default Appium server (1.22) predates the `mobile:` commands
// these tools use (pressKey, activateApp, terminateApp, ...). Verified working
// on 2.x in mobilerun-browserstack.
export const DEFAULT_APPIUM_VERSION = "2.19.0";

// Session defaults. idleTimeout is the backstop that releases the
// device if the client disappears without calling endDeviceSession.
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;
export const MAX_IDLE_TIMEOUT_SECONDS = 900;
export const DEFAULT_NEW_COMMAND_TIMEOUT_SECONDS = 300;

// Element lookups wait for the element; coordinate actions wait for
// the UI to settle before returning.
export const DEFAULT_ELEMENT_WAIT_MS = 10_000;
export const MAX_ELEMENT_WAIT_MS = 60_000;
export const DEFAULT_SETTLE_MS = 600;
export const MAX_SETTLE_MS = 5_000;

// Local guard on how many device sessions one MCP process holds open.
export const DEFAULT_MAX_CONCURRENT_SESSIONS = 2;

// readDeviceScreen output caps keep a single call from flooding the context.
export const MAX_SCREEN_ELEMENTS = 150;
export const MAX_PAGE_SOURCE_CHARS = 60_000;

// Session start can sit in BrowserStack's queue; give it room.
export const SESSION_START_TIMEOUT_MS = 300_000;
export const COMMAND_TIMEOUT_MS = 120_000;

export const ANDROID_KEYCODES: Record<string, number> = {
  home: 3,
  back: 4,
  enter: 66,
  delete: 67,
  tab: 61,
  menu: 82,
  search: 84,
  app_switch: 187,
  volume_up: 24,
  volume_down: 25,
  power: 26,
};

export const IOS_BUTTONS = new Set(["home", "volume_up", "volume_down"]);
