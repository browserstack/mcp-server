import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { ProductIndex } from "../../src/tools/capability-registry/types.js";

const applive: ProductIndex = JSON.parse(
  readFileSync("capability/applive.capability-index.json", "utf8"),
).applive;

const capability = (name: string) => {
  const c = applive.capabilities?.find((x) => x.name === name);
  if (!c) throw new Error(`no such capability: ${name}`);
  return c;
};

const guidanceLines = (name: string): string[] => {
  const g = capability(name).guidance;
  if (!g) return [];
  if (Array.isArray(g)) return g;
  return Object.values(g).flatMap((v) => (Array.isArray(v) ? v : []));
};

// An App Live Android session runs Appium 1.22 — read off the server's own stack traces
// on a Samsung Galaxy S23, Android 13. Its mobile: command list carries scrollGesture and
// friends but NOT activateApp, terminateApp or queryAppState, so the Appium 2 style we
// had been sending answered "unknown command" and silently did nothing. A tester watched
// an agent pick terminate_app, get that no-op, and press Home instead.
//
// App Automate sends the same scripts and works, because IT creates the session and pins
// appiumVersion 2.19.0. App Live cannot: the dashboard creates the session and we attach
// to whatever was provisioned. The classic /appium/device endpoints exist on 1.22, and
// were confirmed end to end on that device: app_state 4, terminate true, app_state 3,
// activate ok, app_state 4.
const LIFECYCLE: [string, string][] = [
  ["launch_app", "/session/{session_id}/appium/device/activate_app"],
  ["terminate_app", "/session/{session_id}/appium/device/terminate_app"],
  ["get_app_state", "/session/{session_id}/appium/device/app_state"],
];

describe("app lifecycle goes over the endpoint Appium 1.22 actually implements", () => {
  for (const [name, path] of LIFECYCLE)
    describe(name, () => {
      it("uses the classic /appium/device endpoint", () => {
        expect(capability(name).path).toBe(path);
      });

      it("does not send a mobile: script, which 1.22 has no command for", () => {
        expect(capability(name).path).not.toContain("execute/sync");
        const body = capability(name).body ?? [];
        expect(body.map((b) => b.name)).not.toContain("script");
      });

      it("takes appId as a plain body field, on both platforms", () => {
        const body = capability(name).body ?? [];
        expect(body.map((b) => b.name)).toEqual(["appId"]);
        expect(body[0].required).toBe(true);
      });

      it("records why the wire shape is what it is, so nobody 'tidies' it back", () => {
        const g = guidanceLines(name).join("\n");
        // Both Appium builds, because the reason differs per platform and the next
        // reader needs to know the endpoint was checked on each.
        expect(g).toMatch(/appium 1\.x/i);
        expect(g).toContain("1.22");
        expect(g).toContain("1.21");
        expect(g).toMatch(/both/i);
      });

      it("no longer claims the capability is unavailable on Android", () => {
        const text = [
          capability(name).intent ?? "",
          ...guidanceLines(name),
        ].join("\n");
        expect(text).not.toMatch(
          /not available on an android app live session/i,
        );
      });

      it("says where to get the id, since no upload or listing returns one", () => {
        const body = capability(name).body ?? [];
        expect(body[0].description ?? "").toContain("get_current_app");
        expect(body[0].description ?? "").toContain("get_active_app_info");
      });
    });
});

// Nothing in the App Live app API returns a package name or bundle id — confirmed
// against the live endpoint. An agent that assumes the upload hands one back guesses,
// and the launch fails: the probe's own first attempt died exactly that way, on
// org.wikipedia when the app was really org.wikipedia.alpha.
describe("what the upload does not give back", () => {
  for (const name of ["upload_app", "upload_app_from_file"])
    it(`${name} says no bundle id comes back, and where to read one`, () => {
      const g = guidanceLines(name).join("\n");
      expect(g).toMatch(/no package name or bundle id/i);
      expect(g).toContain("get_active_app_info");
      expect(g).toContain("get_current_app");
    });

  it("declares no bundle id in either upload's returns, matching the API", () => {
    for (const name of ["upload_app", "upload_app_from_file"]) {
      const returns = capability(name).returns ?? [];
      expect(returns).not.toContain("bundle_id");
      expect(returns).not.toContain("package_name");
    }
  });
});

// Both are steps of get_session and are refused if invoked on their own. Their own
// descriptions used to invite exactly that call.
describe("a chain step says it is one", () => {
  for (const name of ["get_session_appium_endpoint", "list_appium_sessions"])
    it(`${name} tells the caller it cannot be invoked alone`, () => {
      const c = capability(name);
      expect(c.internal).toBe(true);
      expect(c.intent ?? "").toMatch(/cannot be invoked on its own/i);
      expect(c.intent ?? "").toContain("get_session");
    });

  it("does not tell the caller to call it directly anyway", () => {
    const g = guidanceLines("list_appium_sessions").join("\n");
    expect(g).not.toMatch(/a direct call here is only for/i);
  });
});
