import { describe, expect, it } from "vitest";
import {
  bind,
  withoutFixed,
} from "../../src/tools/capability-registry/bind.js";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseResult } from "../untrusted.js";

// A required parameter that may take exactly one value is the server's to send.
//
// Fourteen device-control capabilities are `execute/sync` with `script` pinned to one
// command, and the caller's only decision is `args`. Agents left `script` out, wrote their
// own, or sent `args` without the brackets — none of which carries information the server
// does not already hold. So bind fills a fixed parameter in, overwrites a paraphrase, wraps a
// lone item as a list of one, and describeCapability stops publishing the parameter at all.

const SCRIPT =
  "var a=arguments[0]; if(a==='bottom'){window.scrollTo(0,9e9);} return window.scrollY;";

const SCROLL_PAGE = {
  name: "scroll_page",
  method: "POST",
  path: "/wd/hub/session/{session_id}/execute/sync",
  mode: "write",
  entity: "page",
  intent: "Scroll the page.",
  path_params: [{ name: "session_id", type: "string", required: true }],
  body: [
    { name: "script", type: "string", required: true, values: [SCRIPT] },
    {
      name: "args",
      type: "array",
      required: true,
      description: 'Exactly one value: "bottom", "top", or a number of pixels.',
    },
  ],
} as const;

const LAUNCH_APP = {
  name: "launch_app",
  method: "POST",
  path: "/wd/hub/session/{session_id}/execute/sync",
  mode: "write",
  entity: "page",
  intent: "Bring the app to the foreground.",
  path_params: [{ name: "session_id", type: "string", required: true }],
  body: [
    {
      name: "script",
      type: "string",
      required: true,
      values: ["mobile: activateApp"],
    },
    { name: "args", type: "array", required: true },
  ],
} as const;

const CURRENT_APP = {
  name: "get_current_app",
  method: "POST",
  path: "/wd/hub/session/{session_id}/execute/sync",
  mode: "read",
  entity: "page",
  intent: "Which app is in front.",
  path_params: [{ name: "session_id", type: "string", required: true }],
  body: [
    {
      name: "script",
      type: "string",
      required: true,
      values: ["mobile: getCurrentPackage"],
    },
    { name: "args", type: "array", required: true, values: [[]] },
  ],
} as const;

// A toggle with one value is NOT fixed: its presence is the request.
const CREATE_SESSION = {
  name: "create_session",
  method: "POST",
  path: "/session",
  mode: "write",
  entity: "page",
  intent: "Start a session.",
  body: [
    { name: "browser_name", type: "string", required: true },
    { name: "real_mobile", type: "boolean", values: [true] },
  ],
} as const;

const cap = (c: unknown) => c as never;

describe("bind supplies a fixed parameter", () => {
  it("fills `script` in when the caller sends only the decision", () => {
    const out = bind(cap(SCROLL_PAGE), {
      path_params: { session_id: "s1" },
      body: { args: ["bottom"] },
    });
    expect(out.body).toEqual({ script: SCRIPT, args: ["bottom"] });
    expect(out.path).toBe("/wd/hub/session/s1/execute/sync");
  });

  it("overwrites a script the caller wrote themselves", () => {
    // The refusal used to quote the whole snippet back; sending it is strictly better.
    const out = bind(cap(SCROLL_PAGE), {
      path_params: { session_id: "s1" },
      body: {
        script: "window.scrollTo(0, document.body.scrollHeight)",
        args: ["bottom"],
      },
    });
    expect(out.body?.script).toBe(SCRIPT);
  });

  it("wraps a lone value sent for a list", () => {
    const out = bind(cap(SCROLL_PAGE), {
      path_params: { session_id: "s1" },
      body: { args: "bottom" },
    });
    expect(out.body?.args).toEqual(["bottom"]);
  });

  it("wraps a lone object sent for a list of one object", () => {
    const out = bind(cap(LAUNCH_APP), {
      path_params: { session_id: "s1" },
      body: { args: { appId: "com.example.app" } },
    });
    expect(out.body).toEqual({
      script: "mobile: activateApp",
      args: [{ appId: "com.example.app" }],
    });
  });

  it("still refuses null for a list, which would send [null]", () => {
    expect(() =>
      bind(cap(SCROLL_PAGE), {
        path_params: { session_id: "s1" },
        body: { args: null },
      }),
    ).toThrow(/'args' must be a list/);
  });

  it("fills an always-empty args too, so a read needs only the session id", () => {
    const out = bind(cap(CURRENT_APP), {
      path_params: { session_id: "s1" },
    });
    expect(out.body).toEqual({ script: "mobile: getCurrentPackage", args: [] });
  });

  it("still reports the parameters that are the caller's to send", () => {
    expect(() =>
      bind(cap(SCROLL_PAGE), { path_params: { session_id: "s1" } }),
    ).toThrow(/missing required parameter\(s\): args$/);
  });

  it("does not fill an optional single-value toggle", () => {
    const out = bind(cap(CREATE_SESSION), { body: { browser_name: "chrome" } });
    expect(out.body).toEqual({ browser_name: "chrome" });
  });
});

describe("withoutFixed", () => {
  it("drops the fixed parameters and keeps the rest", () => {
    expect(withoutFixed(cap(SCROLL_PAGE))).toEqual({
      path_params: SCROLL_PAGE.path_params,
      body: [SCROLL_PAGE.body[1]],
    });
  });

  it("drops a group that is left empty rather than publishing []", () => {
    expect(withoutFixed(cap(CURRENT_APP))).toEqual({
      path_params: CURRENT_APP.path_params,
    });
  });

  it("keeps an optional single-value toggle visible", () => {
    expect(withoutFixed(cap(CREATE_SESSION)).body).toHaveLength(2);
  });
});

function tools(seen: unknown[]) {
  const index = {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        capabilities: [SCROLL_PAGE, LAUNCH_APP, CURRENT_APP],
        entities: {
          page: {
            description: "A page",
            capabilities: ["scroll_page", "launch_app", "get_current_app"],
          },
        },
      },
    },
  };
  const handlers: Record<string, any> = {};
  const server = {
    tool: (...args: unknown[]) => {
      handlers[args[0] as string] = args.find((a) => typeof a === "function");
      return { name: args[0] };
    },
  };
  addCapabilityRegistryTools(
    server as never,
    {
      registry: new CapabilityRegistry(index as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async (...call: unknown[]) => {
        seen.push(call);
        return { status: 200, body: { value: 0 } } as never;
      },
    } as never,
  );
  return handlers;
}

const text = (result: any) => parseResult(result.content[0].text);

describe("through the registered tools", () => {
  it("describeCapability does not publish `script`", async () => {
    const handlers = tools([]);
    const doc = text(
      await handlers.describeCapability(
        { name: "scroll_page", product: "p" },
        {} as never,
      ),
    );
    expect(doc.body.map((p: { name: string }) => p.name)).toEqual(["args"]);
    expect(doc.path_params.map((p: { name: string }) => p.name)).toEqual([
      "session_id",
    ]);
  });

  it("describeCapability publishes no body at all when every field is fixed", async () => {
    const handlers = tools([]);
    const doc = text(
      await handlers.describeCapability(
        { name: "get_current_app", product: "p" },
        {} as never,
      ),
    );
    expect(doc.body).toBeUndefined();
  });

  it("invokeCapability sends the script the caller never saw", async () => {
    const seen: any[] = [];
    const handlers = tools(seen);
    const out = text(
      await handlers.invokeCapability(
        {
          name: "scroll_page",
          product: "p",
          path_params: { session_id: "s1" },
          body: { args: "bottom" },
          user_permission: "granted",
          change_summary: "scroll to the bottom",
        },
        {} as never,
      ),
    );
    expect(out.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const [method, url, , , body] = seen[0];
    expect(method).toBe("POST");
    expect(url).toBe("https://p.example/wd/hub/session/s1/execute/sync");
    expect(body).toEqual({ script: SCRIPT, args: ["bottom"] });
    expect(out.note).toBeUndefined();
  });

  it("says so when it replaced a script the caller wrote", async () => {
    const seen: any[] = [];
    const handlers = tools(seen);
    const out = text(
      await handlers.invokeCapability(
        {
          name: "scroll_page",
          product: "p",
          path_params: { session_id: "s1" },
          body: { script: "window.scrollTo(0, 99999)", args: ["bottom"] },
          user_permission: "granted",
          change_summary: "scroll to the bottom",
        },
        {} as never,
      ),
    );
    expect(out.ok).toBe(true);
    expect(seen[0][4]).toEqual({ script: SCRIPT, args: ["bottom"] });
    expect(out.note).toMatch(/`script` was replaced by the server's own value/);
  });

  it("stays quiet when the caller sent the published value itself", async () => {
    const seen: any[] = [];
    const handlers = tools(seen);
    const out = text(
      await handlers.invokeCapability(
        {
          name: "scroll_page",
          product: "p",
          path_params: { session_id: "s1" },
          body: { script: SCRIPT, args: ["bottom"] },
          user_permission: "granted",
          change_summary: "scroll to the bottom",
        },
        {} as never,
      ),
    );
    expect(out.ok).toBe(true);
    expect(out.note).toBeUndefined();
  });
});

describe("the shipped indexes", () => {
  const load = (product: string) =>
    JSON.parse(
      readFileSync(
        resolve(__dirname, `../../capability/${product}.capability-index.json`),
        "utf8",
      ),
    )[product];

  it("hide `script` on every execute/sync capability that pins it", () => {
    for (const product of ["devicecontrol", "mobiledevicecontrol"]) {
      for (const c of load(product).capabilities) {
        const script = (c.body ?? []).find(
          (p: { name: string }) => p.name === "script",
        );
        if (!script?.values || script.values.length !== 1) continue;
        const shown = (withoutFixed(c).body ?? []).map(
          (p: { name: string }) => p.name,
        );
        expect(shown, `${product}.${c.name}`).not.toContain("script");
      }
    }
  });

  it("let get_current_app be called with nothing but the session id", () => {
    const c = load("mobiledevicecontrol").capabilities.find(
      (x: { name: string }) => x.name === "get_current_app",
    );
    const out = bind(c, { path_params: { session_id: "s1" } });
    expect(out.body).toEqual({ script: "mobile: getCurrentPackage", args: [] });
    expect(withoutFixed(c).body).toBeUndefined();
  });
});
