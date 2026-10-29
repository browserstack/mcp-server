import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { detachImage } from "../../src/tools/capability-registry/media.js";

// A WebDriver screenshot is `{"value": "<base64 png>"}` and a phone screen runs to hundreds
// of kilobytes. Inside the JSON text block it is paid for as text and still invisible to the
// model. A capability that declares `media` has the image lifted out and sent as an MCP
// image block, with a note left in the body where it sat. These pin that wiring.

const SESSION = "0123456789abcdef0123456789abcdef01234567";
// A 1x1 PNG: small enough to never meet the compressor, real enough to be an image.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function index(media?: unknown) {
  return {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        capabilities: [
          {
            name: "take_screenshot",
            method: "GET",
            path: "/session/{session_id}/screenshot",
            mode: "read",
            entity: "s",
            intent: "See the screen.",
            path_params: [
              { name: "session_id", type: "string", required: true },
            ],
            ...(media ? { media } : {}),
          },
        ],
        entities: {
          s: { description: "A session", capabilities: ["take_screenshot"] },
        },
      },
    },
  };
}

function harness(status: number, body: unknown, media?: unknown) {
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index(media) as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async () => ({ status, body }) as never,
    } as never,
  );
  return () =>
    handlers.invokeCapability(
      {
        name: "take_screenshot",
        product: "p",
        path_params: { session_id: SESSION },
      },
      {} as never,
    );
}

const MEDIA = { mime: "image/png", json_path: "/value" };

describe("a capability whose body carries an image", () => {
  it("sends the image as an MCP image block beside the JSON, and leaves a note in the body", async () => {
    const out = await harness(200, { value: PNG }, MEDIA)();
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
    expect(text.http_response.body.value).toMatch(
      /^<image\/png, \d+ KB, attached to this result as an image>$/,
    );
    expect(text.image).toEqual({ mime: "image/png", bytes: 70 });
  });

  it("hands an error body back whole: the diagnosis is not an image", async () => {
    const error = { value: { error: "invalid session id", message: "gone" } };
    const out = await harness(404, error, MEDIA)();
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text).http_response.body).toEqual(error);
  });

  it("hands a success with nothing at the path back unchanged", async () => {
    const out = await harness(200, { value: null }, MEDIA)();
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text).http_response.body).toEqual({
      value: null,
    });
  });

  it("changes nothing for a capability that declares no media", async () => {
    const out = await harness(200, { value: PNG })();
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text).http_response.body.value).toBe(PNG);
  });
});

describe("the index is refused at load when media could not be acted on", () => {
  it("for a type no client renders", () => {
    expect(
      () =>
        new CapabilityRegistry(
          index({ mime: "application/pdf", json_path: "/value" }) as never,
        ),
    ).toThrow(/media\.mime 'application\/pdf' is not an image type/);
  });

  it("for a path that is not a JSON pointer", () => {
    expect(
      () =>
        new CapabilityRegistry(
          index({ mime: "image/png", json_path: "value" }) as never,
        ),
    ).toThrow(/must be a JSON pointer/);
  });
});

describe("detachImage", () => {
  const cap = { name: "c", media: MEDIA } as never;

  it("copies rather than mutates the body it was given", () => {
    const body = { value: PNG, other: 1 };
    const { body: replaced, image } = detachImage(cap, body);
    expect(body.value).toBe(PNG);
    expect((replaced as any).other).toBe(1);
    expect(image?.bytes).toBe(70);
  });

  it("reaches a nested pointer, escaped per RFC 6901", () => {
    const nested = {
      name: "n",
      media: { mime: "image/png", json_path: "/data/a~1b" },
    } as never;
    const { body, image } = detachImage(nested, { data: { "a/b": PNG } });
    expect(image?.data).toBe(PNG);
    expect((body as any).data["a/b"]).toMatch(/attached to this result/);
  });

  it("ignores a non-string at the path", () => {
    expect(detachImage(cap, { value: 42 })).toEqual({ body: { value: 42 } });
    expect(detachImage(cap, [PNG])).toEqual({ body: [PNG] });
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
