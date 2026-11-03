import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ambiguousProducts,
  impliedTerms,
  productAnchors,
  unreadable,
} from "../../src/tools/capability-registry/search.js";
import {
  readRouting,
  signRouting,
} from "../../src/tools/capability-registry/routing-token.js";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";

// The first week of customer traffic put 32 routing reports on the board, and most were
// one defect: a website task on a phone was sent to mobile device control. `iphone`,
// `phone` and `tablet` were mobile's words alone, `website` was shared with the
// accessibility products, and a word only one product claims won outright — so the one
// word that named the device beat the one that named the task. These pin the repair.

const load = (p: string) => {
  const j = JSON.parse(
    readFileSync(`capability/${p}.capability-index.json`, "utf8"),
  );
  return j[p];
};
const shipped = Object.fromEntries(
  [
    "devicecontrol",
    "mobiledevicecontrol",
    "tm",
    "tra",
    "web_accessibility",
    "app_accessibility",
  ].map((p) => [p, load(p)]),
) as any;

describe("a website task on a phone is a browser task", () => {
  const web: string[] = [
    "take a screenshot of my website on an iPhone",
    "test my website on a tablet",
    "test my website on android",
    "open https://example.com on a phone",
    "open example.com on a phone and check the layout",
    "scroll down the page",
    "check the login page renders on Chrome",
    "verificar os sites no chrome",
  ];
  for (const q of web)
    it(`${JSON.stringify(q)} settles on devicecontrol`, () => {
      const verdict = ambiguousProducts(shipped, q);
      expect(verdict.products).toEqual([]);
      expect(verdict.settled).toBe("devicecontrol");
    });

  it("still sends an app on a phone to mobile device control", () => {
    expect(
      ambiguousProducts(shipped, "take a screenshot of my app on an iPhone")
        .settled,
    ).toBe("mobiledevicecontrol");
  });

  it("names the words that decided it, shared ones included", () => {
    expect(
      ambiguousProducts(shipped, "test my website on a tablet").because,
    ).toEqual(["tablet", "website"]);
  });
});

describe("a clash is between the products that claim every word", () => {
  // tm claims `screenshot` (an attachment) and not `iphone`; it cannot answer this.
  it("drops a product that claims one shared word but not the other", () => {
    const verdict = ambiguousProducts(shipped, "screenshot on an iphone");
    expect(verdict.products).toEqual(["devicecontrol", "mobiledevicecontrol"]);
    expect(verdict.terms).toEqual(["iphone", "screenshot"]);
  });

  it("asks when a device word alone could mean either", () => {
    expect(ambiguousProducts(shipped, "test on ios").products).toEqual([
      "devicecontrol",
      "mobiledevicecontrol",
    ]);
  });

  it("keeps the union when no product claims all of it", () => {
    // One shared word: its claimants are the candidates, which is what it always was.
    const verdict = ambiguousProducts(shipped, "list devices");
    expect(verdict.products.length).toBeGreaterThan(1);
    expect(verdict.settled).toBeUndefined();
  });
});

describe("everyday words do not route on their own", () => {
  // `check` is a TRA alias, `filter` a TM one, `os` an operating system to two products
  // and the Portuguese article to anyone writing in Portuguese.
  for (const q of ["check", "filter", "os", "check the filters"])
    it(`${JSON.stringify(q)} names no product`, () => {
      expect(ambiguousProducts(shipped, q).unknown).toBe(true);
    });

  it("still lets the longer phrase route", () => {
    expect(ambiguousProducts(shipped, "list the quality gates").settled).toBe(
      "tra",
    );
  });
});

describe("a pasted address names `url`", () => {
  it.each([
    "open https://example.com",
    "go to www.example.org/login",
    "load shop.example.co and click buy",
  ])("%s", (text) => expect(impliedTerms(text)).toEqual(["url"]));

  it("not for a sentence with no address in it", () =>
    expect(impliedTerms("open the login page")).toEqual([]));

  it("anchors devicecontrol when the user quotes one", () =>
    expect(
      productAnchors(shipped, "https://example.com please").products,
    ).toEqual(["devicecontrol"]));
});

describe("a summary that points at a separate product does not claim its words", () => {
  it("app accessibility does not claim `website`", () => {
    const verdict = ambiguousProducts(shipped, "website");
    expect(verdict.products).not.toContain("app_accessibility");
  });
});

describe("an answer the index cannot read", () => {
  it("is recognised by its letters, not by its length", () => {
    expect(unreadable("モバイルの方")).toBe(true);
    expect(unreadable("Gerätesteuerung")).toBe(true);
    expect(unreadable("yes")).toBe(false);
    expect(unreadable("— ok —")).toBe(false);
    expect(unreadable(undefined)).toBe(false);
  });

  it("the clash token names the products it was between", () => {
    const token = signRouting({
      verdict: "clash",
      terms: ["session"],
      products: ["mobiledevicecontrol", "tm"],
    });
    expect(readRouting(token)?.products).toEqual(["mobiledevicecontrol", "tm"]);
  });
});

describe("the gate takes a quote it cannot read on the caller's word", () => {
  // Two products share `session`. The question is put; the user answers in Japanese.
  const product = (key: string, title: string, entity: string) => ({
    title,
    summary: `${title}.`,
    base_url: "https://p.example",
    capabilities: [
      {
        name: `list_${entity}s`,
        method: "GET",
        path: `/${entity}s`,
        mode: "read",
        entity,
        intent: `List ${entity}s.`,
      },
    ],
    entities: {
      [entity]: {
        description: `A ${entity} in ${title}`,
        aliases: ["session"],
        capabilities: [`list_${entity}s`],
      },
    },
  });
  const index = {
    schema_version: 1,
    build_id: "t",
    products: {
      mobiledevicecontrol: product(
        "mobiledevicecontrol",
        "Mobile Device Control",
        "app_session",
      ),
      tm: product("tm", "Test Management", "exploratory_session"),
    },
  };
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async () => ({ status: 200, body: {} }) as never,
    } as never,
  );
  const search = async (args: Record<string, unknown>) =>
    JSON.parse(
      (await handlers.searchCapability(args, {} as never)).content[0].text,
    );
  const tokenIn = (out: any): string => out.routing_token;

  it("refuses the first search and hands back a token", async () => {
    const out = await search({ query: "end my session", product: "tm" });
    expect(out.ok).toBe(false);
    expect(tokenIn(out)).toBeTruthy();
  });

  it("accepts the user's answer in a script the index cannot read", async () => {
    const first = await search({ query: "end my session", product: "tm" });
    const out = await search({
      query: "end my session",
      product: "mobiledevicecontrol",
      routing_token: tokenIn(first),
      user_words: "モバイルの方でお願いします",
    });
    // A search answers with its hits and no `ok`; only a refusal says `ok: false`.
    expect(out.ok).toBeUndefined();
    expect(out.error).toBeUndefined();
    expect(out.capabilities).toBeDefined();
  });

  it("still refuses a readable quote that names nothing", async () => {
    const first = await search({ query: "end my session", product: "tm" });
    const out = await search({
      query: "end my session",
      product: "mobiledevicecontrol",
      routing_token: tokenIn(first),
      user_words: "yes go ahead",
    });
    expect(out.ok).toBe(false);
  });

  it("still refuses a product the clash was not between", async () => {
    const token = signRouting({
      verdict: "clash",
      terms: ["session"],
      products: ["tra", "tm"],
    });
    const out = await search({
      query: "end my session",
      product: "mobiledevicecontrol",
      routing_token: token,
      user_words: "モバイルの方でお願いします",
    });
    expect(out.ok).toBe(false);
  });

  it("still judges a readable quote that names the other product", async () => {
    const first = await search({ query: "end my session", product: "tm" });
    const out = await search({
      query: "end my session",
      product: "mobiledevicecontrol",
      routing_token: tokenIn(first),
      user_words: "Test Management, bitte",
    });
    expect(out.ok).toBe(false);
  });
});
