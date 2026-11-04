import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertSelectable,
  narrowResponse,
} from "../../src/tools/capability-registry/narrow.js";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { parseResult } from "../untrusted.js";

// `select` on a single record, and on the device-control lists that lacked it.
//
// Agents kept sending `select` to capabilities that had not opted in: get_session (wanting
// `browser_url` out of a 30-field record), list_devices (the whole catalogue for one
// Pixel), list_team_app_builds and find_elements. The lists just needed `narrowable`
// declared. The record needed a shape the narrowing code did not have: one object, not
// rows, where only `fields` can mean anything.

const SESSION = {
  automation_session: {
    hashed_id: "abc",
    name: "sign in",
    status: "running",
    browser: "chrome",
    browser_url: "https://automate.browserstack.com/builds/1/sessions/abc",
    public_url:
      "https://automate.browserstack.com/builds/1/sessions/abc?auth_token=t",
    duration: null,
  },
};

const GET_SESSION = {
  name: "get_session",
  method: "GET",
  path: "/sessions/{session_id}.json",
  mode: "read",
  entity: "session",
  intent: "Read a session record.",
  path_params: [{ name: "session_id", type: "string", required: true }],
  narrowable: {
    record: true,
    path: "automation_session",
    fields: [
      "hashed_id",
      "name",
      "status",
      "browser",
      "browser_url",
      "public_url",
    ],
  },
} as const;

const cap = (c: unknown) => c as never;

describe("a record narrows on fields only", () => {
  it("an empty fields list is no selection, not an empty record", () => {
    expect(narrowResponse(cap(GET_SESSION), SESSION, { fields: [] })).toBe(
      undefined,
    );
    expect(() =>
      assertSelectable(cap(GET_SESSION), { fields: [] }),
    ).not.toThrow();
  });

  it("keeps the named fields, in the order asked, inside the envelope", () => {
    const out = narrowResponse(cap(GET_SESSION), SESSION, {
      fields: ["browser_url", "status"],
    });
    expect(out?.body).toEqual({
      automation_session: {
        browser_url: SESSION.automation_session.browser_url,
        status: "running",
      },
    });
    expect(out?.narrowing).toEqual({
      from: 7,
      to: 2,
      by: { fields: ["browser_url", "status"] },
    });
  });

  it("refuses where, distinct and limit before anything is sent, naming fields instead", () => {
    expect(() =>
      assertSelectable(cap(GET_SESSION), { where: { status: "running" } }),
    ).toThrow(
      /one record, not rows, so `where` cannot apply.*Use `fields`.*browser_url/s,
    );
    expect(() =>
      assertSelectable(cap(GET_SESSION), { distinct: ["status"], limit: 1 }),
    ).toThrow(/`distinct`, `limit` cannot apply/);
  });

  it("still refuses a field outside the declared set, with the set", () => {
    expect(() =>
      assertSelectable(cap(GET_SESSION), { fields: ["video"] }),
    ).toThrow(/`fields` names 'video'.*hashed_id, name, status/s);
  });

  it("hands back whole a body that is not a record at the declared path", () => {
    expect(
      narrowResponse(
        cap(GET_SESSION),
        { message: "not found" },
        { fields: ["status"] },
      ),
    ).toBeUndefined();
    expect(
      narrowResponse(
        cap(GET_SESSION),
        { automation_session: [1] },
        { fields: ["status"] },
      ),
    ).toBeUndefined();
  });

  it("does nothing without a selection", () => {
    expect(
      narrowResponse(cap(GET_SESSION), SESSION, undefined),
    ).toBeUndefined();
    expect(narrowResponse(cap(GET_SESSION), SESSION, {})).toBeUndefined();
  });
});

function tools(body: unknown) {
  const index = {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        capabilities: [GET_SESSION],
        entities: {
          session: { description: "A session", capabilities: ["get_session"] },
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
      transport: async () => ({ status: 200, body }) as never,
    } as never,
  );
  return handlers;
}

const text = (result: any) => parseResult(result.content[0].text);

describe("through the registered tool", () => {
  it("get_session with fields returns the links and says so", async () => {
    const out = text(
      await tools(SESSION).invokeCapability(
        {
          name: "get_session",
          product: "p",
          path_params: { session_id: "abc" },
          select: { fields: ["browser_url", "public_url"] },
        },
        {} as never,
      ),
    );
    expect(out.http_response.body).toEqual({
      automation_session: {
        browser_url: SESSION.automation_session.browser_url,
        public_url: SESSION.automation_session.public_url,
      },
    });
    expect(out.narrowed).toEqual({
      from: 7,
      to: 2,
      by: { fields: ["browser_url", "public_url"] },
    });
  });

  it("describeCapability publishes the record flag with the fields", async () => {
    const doc = text(
      await tools(SESSION).describeCapability(
        { name: "get_session", product: "p" },
        {} as never,
      ),
    );
    expect(doc.narrowable.record).toBe(true);
    expect(doc.narrowable.fields).toContain("browser_url");
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
  const find = (product: string, name: string) =>
    load(product).capabilities.find((c: { name: string }) => c.name === name);

  it("narrow get_session as a record under automation_session, on both products", () => {
    for (const product of ["devicecontrol", "mobiledevicecontrol"]) {
      const c = find(product, "get_session");
      expect(c.narrowable.record, product).toBe(true);
      expect(c.narrowable.path, product).toBe("automation_session");
      expect(c.narrowable.fields, product).toEqual(c.returns);
      // The usual ask, end to end on the shipped contract.
      const out = narrowResponse(c, SESSION, { fields: ["browser_url"] });
      expect(out?.body).toEqual({
        automation_session: {
          browser_url: SESSION.automation_session.browser_url,
        },
      });
    }
  });

  it("narrow list_devices on the catalogue's own columns", () => {
    const c = find("mobiledevicecontrol", "list_devices");
    expect(c.narrowable.fields).toEqual(c.returns);
    const rows = [
      {
        device: "Google Pixel 8",
        os: "android",
        os_version: "14.0",
        realMobile: true,
      },
      { device: "iPhone 15", os: "ios", os_version: "17", realMobile: true },
    ];
    const out = narrowResponse(c, rows, { where: { os: "android" } });
    expect(out?.body).toEqual([rows[0]]);
  });

  it("narrow both build lists and find_elements too", () => {
    for (const name of ["list_app_builds", "list_team_app_builds"])
      expect(find("mobiledevicecontrol", name).narrowable.fields).toContain(
        "custom_id",
      );
    for (const product of ["devicecontrol", "mobiledevicecontrol"]) {
      const c = find(product, "find_elements");
      const out = narrowResponse(
        c,
        {
          value: [
            { "element-6066-11e4-a52e-4f735466cecf": "e1" },
            { "element-6066-11e4-a52e-4f735466cecf": "e2" },
          ],
        },
        { limit: 1 },
      );
      expect(out?.body).toEqual({
        value: [{ "element-6066-11e4-a52e-4f735466cecf": "e1" }],
      });
    }
  });
});
