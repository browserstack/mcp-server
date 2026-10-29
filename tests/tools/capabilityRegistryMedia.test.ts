import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import {
  detachImage,
  noteImage,
} from "../../src/tools/capability-registry/media.js";

// A WebDriver screenshot is `{"value": "<base64 png>"}` and a phone screen runs to hundreds
// of kilobytes. Inside the JSON text block it is paid for as text and still invisible to the
// model. A capability that declares `media` has the image lifted out and sent as an MCP
// image block, with a note left in the body where it sat. These pin that wiring.

// The compressor is real sharp behind a 1 MB threshold; here it is a stub so a test can say
// "this one shrank" without a megabyte fixture. BIG stands in for an image over the line.
const BIG = "B".repeat(4000);
const SMALLER = "iVBORw0KGgo=";
vi.mock("../../src/lib/image.js", () => ({
  maybeCompressBase64: async (b64: string) => (b64 === BIG ? SMALLER : b64),
}));

const SESSION = "0123456789abcdef0123456789abcdef01234567";
// A 1x1 PNG: small enough to never meet the compressor, real enough to be an image.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const MEDIA = { mime: "image/png", json_path: "/value" };

function capability(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    method: "GET",
    path: `/session/{session_id}/${name}`,
    mode: "read",
    entity: "s",
    intent: "See the screen.",
    path_params: [{ name: "session_id", type: "string", required: true }],
    ...extra,
  };
}

function index(capabilities: unknown[]) {
  return {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        capabilities,
        entities: {
          s: {
            description: "A session",
            capabilities: (capabilities as { name: string }[]).map(
              (c) => c.name,
            ),
          },
        },
      },
    },
  };
}

/** A transport answering each call from a queue of {status, body}. */
function harness(
  capabilities: unknown[],
  answers: { status: number; body: unknown }[],
) {
  const queue = [...answers];
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index(capabilities) as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async () => (queue.shift() ?? { status: 599 }) as never,
    } as never,
  );
  return (name: string) =>
    handlers.invokeCapability(
      { name, product: "p", path_params: { session_id: SESSION } },
      {} as never,
    );
}

const shot = (extra = {}) => capability("take_screenshot", extra);
const one = (status: number, body: unknown, extra = {}) =>
  harness([shot(extra)], [{ status, body }])("take_screenshot");

describe("a capability whose body carries an image", () => {
  it("sends the image as an MCP image block beside the JSON, and leaves a note in the body", async () => {
    const out = await one(200, { value: PNG }, { media: MEDIA });
    expect(out.content).toHaveLength(2);
    expect(out.content[1]).toEqual({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    });
    const text = JSON.parse(out.content[0].text);
    expect(text.ok).toBe(true);
    // no base64 anywhere in the text block
    expect(out.content[0].text).not.toContain(PNG);
    expect(text.http_response.body.value).toBe(
      "<image/png, 1 KB, attached to this result as an image>",
    );
    expect(text.image).toEqual({ mime: "image/png", bytes: 70 });
  });

  it("reports the size of the block attached, not the size received, when it was compressed", async () => {
    const out = await one(200, { value: BIG }, { media: MEDIA });
    expect(out.content[1].data).toBe(SMALLER);
    const text = JSON.parse(out.content[0].text);
    // SMALLER decodes to 8 bytes; the note and the field say so, not 3000
    expect(text.image).toEqual({ mime: "image/png", bytes: 8 });
    expect(text.http_response.body.value).toBe(
      "<image/png, 1 KB, attached to this result as an image>",
    );
  });

  it("hands an error body back whole: the diagnosis is not an image", async () => {
    const error = { value: { error: "invalid session id", message: "gone" } };
    const out = await one(404, error, { media: MEDIA });
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text).http_response.body).toEqual(error);
  });

  it("hands a success with nothing at the path back unchanged", async () => {
    const out = await one(200, { value: null }, { media: MEDIA });
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text).http_response.body).toEqual({
      value: null,
    });
  });

  it("changes nothing for a capability that declares no media", async () => {
    const out = await one(200, { value: PNG });
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text).http_response.body.value).toBe(PNG);
  });
});

describe("after a fallback, the capability that answered decides", () => {
  // The first call is refused; the step that answers 2xx carries the image, the
  // original does not. The body is the step's, so the step's `media` applies.
  const chain = [
    capability("plain", {
      fallbacks: [{ when: { status: 400 }, capability: "with_image" }],
    }),
    capability("with_image", { media: MEDIA }),
  ];

  it("detaches the image the answering step declares, though the original declared none", async () => {
    const out = await harness(chain, [
      { status: 400, body: { value: { error: "no" } } },
      { status: 200, body: { value: PNG } },
    ])("plain");
    expect(out.content).toHaveLength(2);
    expect(out.content[1].mimeType).toBe("image/png");
    const text = JSON.parse(out.content[0].text);
    expect(text.fallback.attempts).toHaveLength(2);
    expect(text.http_response.body.value).toMatch(/attached to this result/);
  });

  it("leaves the body alone when the answering step declares none, though the original did", async () => {
    const reversed = [
      capability("plain", {
        media: MEDIA,
        fallbacks: [{ when: { status: 400 }, capability: "bare" }],
      }),
      capability("bare"),
    ];
    const out = await harness(reversed, [
      { status: 400, body: { value: { error: "no" } } },
      { status: 200, body: { value: PNG } },
    ])("plain");
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text).http_response.body.value).toBe(PNG);
  });
});

describe("the index is refused at load when media could not be honoured", () => {
  it.each(["application/pdf", "image/jpeg"])(
    "for %s, which the attached block would not be",
    (mime) => {
      expect(
        () =>
          new CapabilityRegistry(
            index([shot({ media: { mime, json_path: "/value" } })]) as never,
          ),
      ).toThrow(/is not a type the attached image can be \(image\/png\)/);
    },
  );

  it("for a path that is not a JSON pointer", () => {
    expect(
      () =>
        new CapabilityRegistry(
          index([
            shot({ media: { mime: "image/png", json_path: "value" } }),
          ]) as never,
        ),
    ).toThrow(/must be a JSON pointer/);
  });
});

describe("detachImage and noteImage", () => {
  const cap = { name: "c", media: MEDIA } as never;

  it("finds the image and its place, without touching the body", () => {
    const body = { value: PNG, other: 1 };
    const image = detachImage(cap, body);
    expect(image).toEqual({
      data: PNG,
      mimeType: "image/png",
      bytes: 70,
      keys: ["value"],
    });
    expect(body.value).toBe(PNG);
    const noted = noteImage(body, image!, 2048) as any;
    expect(noted.value).toBe(
      "<image/png, 2 KB, attached to this result as an image>",
    );
    expect(noted.other).toBe(1);
    expect(body.value).toBe(PNG);
  });

  it("reaches a nested pointer, escaped per RFC 6901", () => {
    const nested = {
      name: "n",
      media: { mime: "image/png", json_path: "/data/a~1b" },
    } as never;
    const body = { data: { "a/b": PNG } };
    const image = detachImage(nested, body);
    expect(image?.keys).toEqual(["data", "a/b"]);
    expect((noteImage(body, image!, 1) as any).data["a/b"]).toMatch(
      /attached to this result/,
    );
  });

  it("finds nothing for a non-string at the path, or a body that is not an object", () => {
    expect(detachImage(cap, { value: 42 })).toBeUndefined();
    expect(detachImage(cap, [PNG])).toBeUndefined();
    expect(detachImage(cap, { value: "" })).toBeUndefined();
  });

  it("sizes in MB past a megabyte", () => {
    const image = detachImage(cap, { value: PNG })!;
    expect((noteImage({ value: PNG }, image, 1_700_000) as any).value).toBe(
      "<image/png, 1.6 MB, attached to this result as an image>",
    );
  });
});

describe("the shipped indexes", () => {
  it.each(["devicecontrol", "mobiledevicecontrol"])(
    "%s publishes take_screenshot with its image at /value",
    (product) => {
      const file = JSON.parse(
        readFileSync(`capability/${product}.capability-index.json`, "utf8"),
      );
      const cap = file[product].capabilities.find(
        (c: { name: string }) => c.name === "take_screenshot",
      );
      expect(cap.media).toEqual({ mime: "image/png", json_path: "/value" });
      // The record must not promise base64 text any more.
      expect(cap.intent).not.toMatch(/base64/i);
    },
  );
});
