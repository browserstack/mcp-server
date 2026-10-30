import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ambiguousProducts,
  searchCapabilities,
} from "../../src/tools/capability-registry/search.js";

// App Accessibility's lists (its projects, a project's builds, manual reports) are reached
// through the capability registry rather than a dedicated tool: they are documented,
// access-key reads with nothing to add on top. What has to hold is that an agent finds
// them from the words users say, and that they do not pull other products' questions in.

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
const app = products.app_accessibility;

describe("the App Accessibility capability index", () => {
  it("ships the three lists, as reads, each on an entity that names it", () => {
    const names = app.capabilities.map((c: any) => c.name).sort();
    expect(names).toEqual([
      "list_app_accessibility_builds",
      "list_app_accessibility_projects",
      "list_manual_app_accessibility_reports",
    ]);
    for (const capability of app.capabilities) {
      expect(capability.mode).toBe("read");
      expect(capability.paginated).toBe(true);
      expect(app.entities[capability.entity].capabilities).toContain(
        capability.name,
      );
    }
    for (const entity of Object.values<any>(app.entities)) {
      expect(entity.description.length).toBeLessThanOrEqual(140);
    }
    expect(app.summary.length).toBeLessThanOrEqual(900);
  });

  it("does not offer the parameters the API takes and ignores", () => {
    const manual = app.capabilities.find(
      (c: any) => c.name === "list_manual_app_accessibility_reports",
    );
    // created_between is echoed back but never narrows the list, and user_id applies to
    // account admins only: offered, either would return a wider list that looks filtered.
    expect(manual.query.map((q: any) => q.name)).not.toContain(
      "created_between",
    );
    expect(manual.query.map((q: any) => q.name)).not.toContain("user_id");
    const projects = app.capabilities.find(
      (c: any) => c.name === "list_app_accessibility_projects",
    );
    // The docs call it page_number; the API reads page.
    expect(projects.query.map((q: any) => q.name)).toContain("page");
    expect(projects.query.map((q: any) => q.name)).not.toContain(
      "page_number",
    );
  });

  it.each([
    ["List my App Accessibility reports"],
    ["Show the manual app accessibility reports QA ran last week"],
    ["What builds does my app accessibility project have?"],
  ])("routes %j to App Accessibility without asking", (query) => {
    expect(ambiguousProducts(products, query).settled).toBe(
      "app_accessibility",
    );
  });

  it("leaves Test Reporting's questions where they were", () => {
    expect(
      ambiguousProducts(products, "Which tests are flaky in my build?").settled,
    ).toBe("tra");
  });

  it.each([
    ["list manual app accessibility reports", "list_manual_app_accessibility_reports"],
    ["list the builds of an app accessibility project", "list_app_accessibility_builds"],
    ["find an app accessibility project by name", "list_app_accessibility_projects"],
  ])("finds %j as %s", (query, expected) => {
    const { hits } = searchCapabilities(products, query, {
      product: "app_accessibility",
    });
    expect(hits[0]?.capability.name).toBe(expected);
  });
});
