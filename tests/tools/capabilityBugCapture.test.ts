import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { bind } from "../../src/tools/capability-registry/bind.js";
import {
  ambiguousProducts,
  searchCapabilities,
  singular,
  terms,
} from "../../src/tools/capability-registry/search.js";

// Bug Capture recordings are read through the capability registry, against the backend's
// /api/v1/mcp/bug_capture/* API. The index and that API are two descriptions of one HTTP
// contract, so the paths, parameters and
// defaults are pinned here exactly. What else has to hold: a pasted Bug Capture link routes
// here without a question, and claiming "bug" does not take other products' prompts.

const DIR = new URL("../../capability/", import.meta.url);

function shipped(): Record<string, any> {
  const products: Record<string, any> = {};
  for (const file of readdirSync(fileURLToPath(DIR))) {
    if (!file.endsWith(".capability-index.json")) continue;
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL(file, DIR)), "utf8"),
    );
    const [name] = Object.keys(raw).filter(
      (k) => !["schema_version", "version", "build_id"].includes(k),
    );
    products[name] = raw[name];
  }
  return products;
}

const products = shipped();
const bc = products.bug_capture;
const capability = (name: string) =>
  bc.capabilities.find((c: any) => c.name === name);

const LINK =
  "https://toolkit.browserstack.com/sessions/3f1c9a2e-7b4d-4c1e-9f0a-2d6b8e5c1a77";
const BASE = "/api/v1/mcp/bug_capture/recordings/{recording_id}";
const CURSOR = { name: "cursor", type: "string" };
const SEAM: Record<string, { path: string; query: Record<string, unknown>[] }> =
  {
    get_bug_capture_recording: { path: BASE, query: [] },
    list_bug_capture_console_logs: {
      path: `${BASE}/console_logs`,
      query: [
        {
          name: "level",
          type: "string",
          values: ["error", "warn", "all"],
          default: "error",
        },
        { name: "limit", type: "integer", minimum: 1, maximum: 200, default: 50 },
        CURSOR,
      ],
    },
    list_bug_capture_errors: {
      path: `${BASE}/errors`,
      query: [
        { name: "limit", type: "integer", minimum: 1, maximum: 100, default: 25 },
        CURSOR,
      ],
    },
    list_bug_capture_network_requests: {
      path: `${BASE}/network_requests`,
      query: [
        {
          name: "filter",
          type: "string",
          values: ["failed", "all"],
          default: "failed",
        },
        { name: "include_bodies", type: "boolean", default: false },
        { name: "limit", type: "integer", minimum: 1, maximum: 100, default: 25 },
        CURSOR,
      ],
    },
  };

/** The wire-relevant keys of a parameter, so prose can change without breaking the seam. */
const wire = (param: Record<string, unknown>) =>
  Object.fromEntries(
    ["name", "type", "required", "pattern", "values", "minimum", "maximum", "default"]
      .filter((key) => param[key] !== undefined)
      .map((key) => [key, param[key]]),
  );

describe("the Bug Capture capability index", () => {
  it("ships the four reads, each list publishing its page ceiling", () => {
    expect(bc.title).toBe("Bug Capture");
    expect(bc.base_url).toBe("https://toolkit.browserstack.com");
    expect(bc.auth).toEqual({ type: "oauth2" });
    expect(bc.capabilities.map((c: any) => c.name).sort()).toEqual(
      Object.keys(SEAM).sort(),
    );
    for (const c of bc.capabilities) {
      expect(c.mode).toBe("read");
      expect(c.entity).toBe("recording");
      expect(c.local_only).toBeUndefined();
      expect(c.timeout_seconds).toBeUndefined();
      expect(Boolean(c.paginated)).toBe(c.name.startsWith("list_"));
      if (c.paginated) {
        const limit = c.query.find((q: any) => q.name === "limit");
        expect(c.max_page_size).toBe(limit.maximum);
      }
      expect(bc.entities.recording.capabilities).toContain(c.name);
    }
    expect(Object.keys(bc.entities)).toEqual(["recording"]);
    expect(bc.entities.recording.description.length).toBeLessThanOrEqual(140);
    expect(bc.summary.length).toBeLessThanOrEqual(900);
  });

  it("matches the Bug Capture API contract, byte for byte", () => {
    for (const [name, seam] of Object.entries(SEAM)) {
      const c = capability(name);
      expect(c.method).toBe("GET");
      expect(c.path).toBe(seam.path);
      expect(c.path_params.map(wire)).toEqual([
        {
          name: "recording_id",
          type: "string",
          required: true,
          pattern: "^[A-Za-z0-9_-]{1,64}$",
        },
      ]);
      expect((c.query ?? []).map(wire)).toEqual(seam.query);
    }
  });

  it("binds what the seam says", () => {
    const network = capability("list_bug_capture_network_requests");
    const bound = bind(network, {
      path_params: { recording_id: "demo_abc-123" },
      query: { include_bodies: "true", filter: "all" },
    });
    expect(bound.path).toBe(
      "/api/v1/mcp/bug_capture/recordings/demo_abc-123/network_requests",
    );
    // The transport sends String(true): the literal `true` the seam asks for.
    expect(bound.query).toEqual({ include_bodies: true, filter: "all" });
    expect(() =>
      bind(network, {
        path_params: { recording_id: "3f1c9a2e-7b4d-4c1e-9f0a-2d6b8e5c1a77" },
      }),
    ).not.toThrow();
  });

  it("refuses a whole link as the recording id, before any request", () => {
    expect(() =>
      bind(capability("get_bug_capture_recording"), {
        path_params: { recording_id: LINK },
      }),
    ).toThrow(/must match/);
  });

  it("declares every status the seam's error table gives each capability", () => {
    const summary = ["200", "400", "401", "403", "404", "429", "500"];
    const list = [...summary, "410", "413", "502"].sort();
    for (const c of bc.capabilities) {
      expect(Object.keys(c.responses).sort()).toEqual(
        c.name === "get_bug_capture_recording" ? summary : list,
      );
      expect(c.responses["500"]).toEqual({ $response: "InternalError" });
    }
    expect(
      bc.schemas.ErrorEnvelope.properties.error.properties.code.enum,
    ).toContain("internal_error");
    expect(bc.responses.InternalError.schema).toEqual({
      $schema: "ErrorEnvelope",
    });
  });

  // A valid sign-in whose user has never opened Testing Toolkit is also a 401, and
  // retrying cannot fix it — the user has to sign in to Toolkit once.
  it("tells the caller what a 401 from a never-used Toolkit account needs", () => {
    expect(bc.responses.Unauthenticated.description).toMatch(
      /Testing Toolkit/,
    );
    for (const c of bc.capabilities) {
      expect(c.guidance.join(" ")).toMatch(/sign in to Testing Toolkit once/);
    }
  });

  // These can arrive null, and a schema that
  // says otherwise invites the model to treat a null as a broken response.
  it("allows null exactly where the backend can send it", () => {
    const summary = bc.responses.RecordingSummary.schema.properties;
    const nullableTime = {
      type: "string",
      format: "date-time",
      nullable: true,
    };
    expect(summary.started_at).toMatchObject(nullableTime);
    expect(summary.start_url).toMatchObject({ type: "string", nullable: true });
    expect(bc.schemas.ConsoleEntry.properties.at).toMatchObject(nullableTime);
    expect(bc.schemas.ErrorEvent.properties.at).toMatchObject(nullableTime);
    expect(bc.schemas.NetworkRequest.properties.at).toEqual({
      type: "string",
      format: "date-time",
    });
  });

  it.each([
    ["console message", () => bc.schemas.ConsoleEntry.properties.message, "2,000"],
    ["error message", () => bc.schemas.ErrorEvent.properties.message, "2,000"],
    ["error stack", () => bc.schemas.ErrorEvent.properties.stack, "4,000"],
  ])("does not present the %s cap as a hard limit", (_, field, cap) => {
    const text = field().description;
    expect(text).not.toMatch(/at most/i);
    expect(text).toContain(
      `${cap} characters plus a '…[truncated N chars]' suffix`,
    );
  });

  it("says navigation is never present yet", () => {
    expect(
      bc.responses.RecordingSummary.schema.properties.data_present.properties
        .navigation.description,
    ).toMatch(/always false/i);
  });

  // describeEntity is optional, so the link shapes must be where every caller looks: the
  // summary's guidance, which search and describe both return.
  it("says how to take the id from every link shape", () => {
    const guidance = capability("get_bug_capture_recording").guidance.join(" ");
    expect(guidance).toMatch(/after \/sessions\//);
    expect(guidance).toMatch(/app\.birdeatsbug\.com\/<id>/);
    expect(guidance).toMatch(/localSessionPreview/);
    expect(guidance).toMatch(/upload/);
  });

  it("refuses a page larger than the seam allows", () => {
    expect(() =>
      bind(capability("list_bug_capture_console_logs"), {
        path_params: { recording_id: "abc" },
        query: { limit: 201 },
      }),
    ).toThrow(/at most 200/);
  });

  it.each([
    [`Review this bug and propose a fix: ${LINK}`],
    [
      "Review this bug and propose a fix: https://toolkit.browserstack.com/workspaces/5193c6dd/collections/99391146/sessions/k8hS-4kU2xTIr6Pu",
    ],
    ["Review this bug: https://app.birdeatsbug.com/k8hS-4kU2xTIr6Pu"],
    ["summarize this Bug Capture recording"],
    ["which API calls failed in this recording"],
  ])("routes %j to Bug Capture without asking", (query) => {
    expect(ambiguousProducts(products, query).settled).toBe("bug_capture");
  });

  const without = { ...products };
  delete without.bug_capture;
  /** Where a query routes — not the words cited as the reason, which may differ. */
  const verdict = (catalog: Record<string, any>, query: string) => {
    const { products: asked, settled, unknown } = ambiguousProducts(
      catalog,
      query,
    );
    return { asked, settled, unknown };
  };

  // Already a clash between devicecontrol, tra and others before Bug Capture existed
  // (`automate` and `session` are shared through summaries), so it cannot settle on
  // devicecontrol here; what must hold is that Bug Capture leaves it exactly as it was.
  it("leaves an Automate console-logs prompt where it was", () => {
    const query = "Show console logs for my Automate session";
    expect(verdict(products, query)).toEqual(verdict(without, query));
    expect(verdict(products, query).asked).not.toContain("bug_capture");
  });

  it("still files a tm bug in tm", () => {
    expect(
      ambiguousProducts(products, "File a bug against the checkout test case")
        .settled,
    ).toBe("tm");
  });

  // The summary can make a product a claimant of any word another product models, so a
  // sentence like "the browser and OS it ran on" would quietly turn every devicecontrol
  // prompt about browsers into a question. Claiming "bug" is the one deliberate change: tm
  // owns it, and without a share "review this bug <link>" pointed at two products.
  it("changes the routing of no other product's word except 'bug'", () => {
    const fold = (text: string) => terms(text).map(singular).join(" ");
    // Bug Capture can only change a word's answer by claiming a key inside it, so the word
    // must share a token with Bug Capture's own text; checking only those keeps this exact
    // and fast (re-checking all ~850 words costs ~5s).
    const ours = new Set(
      fold(
        [
          bc.summary,
          ...(bc.routing_terms ?? []),
          ...Object.entries<any>(bc.entities).flatMap(([entity, doc]) => [
            entity,
            ...(doc.aliases ?? []),
          ]),
        ].join(" "),
      ).split(" "),
    );
    const changed = new Set<string>();
    for (const [name, product] of Object.entries<any>(without)) {
      const words = [
        ...(product.routing_terms ?? []),
        ...Object.entries<any>(product.entities ?? {}).flatMap(
          ([entity, doc]) => [entity, ...(doc.aliases ?? [])],
        ),
      ].filter((word) => fold(word).split(" ").some((t) => ours.has(t)));
      for (const word of words) {
        if (
          JSON.stringify(verdict(products, word)) !==
          JSON.stringify(verdict(without, word))
        )
          changed.add(`${name}:${fold(word)}`);
      }
    }
    expect([...changed].sort()).toEqual(["tm:bug"]);
  });

  it.each([
    [`Review this bug and propose a fix: ${LINK}`, "get_bug_capture_recording"],
    ["summarize this Bug Capture recording", "get_bug_capture_recording"],
    [
      "which API calls failed in this recording",
      "list_bug_capture_network_requests",
    ],
    ["show the console logs of this recording", "list_bug_capture_console_logs"],
    ["what JavaScript errors did this recording catch", "list_bug_capture_errors"],
  ])("finds %j as %s", (query, expected) => {
    const { hits } = searchCapabilities(products, query, {
      product: "bug_capture",
    });
    expect(hits[0]?.capability.name).toBe(expected);
  });
});
