import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The shipped Load Testing index (not a fixture) — this guards the name contract
// the registry depends on: describeEntity advertises capabilities by name, and
// searchCapability/invokeCapability/describeCapability address them by that name.
// Every LT capability was unnamed at one point, which left those handles
// unresolvable ("unknown_capability … search again"); this test stops that
// regressing.
const INDEX = fileURLToPath(
  new URL("../../capability/loadtesting.capability-index.json", import.meta.url),
);

const lt = JSON.parse(readFileSync(INDEX, "utf8")).loadtesting;

describe("loadtesting capability index — name contract", () => {
  it("every capability publishes a name", () => {
    const unnamed = lt.capabilities.filter((c: any) => !c.name);
    expect(unnamed, unnamed.map((c: any) => `${c.method} ${c.path}`).join(", ")).toHaveLength(0);
  });

  it("capability names are unique", () => {
    const names = lt.capabilities.map((c: any) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every name an entity references resolves to a real capability", () => {
    const capNames = new Set(lt.capabilities.map((c: any) => c.name));
    const referenced = new Set<string>();
    for (const doc of Object.values(lt.entities) as any[]) {
      (doc.capabilities || []).forEach((n: string) => referenced.add(n));
    }
    const unresolvable = [...referenced].filter((n) => !capNames.has(n));
    expect(unresolvable, unresolvable.join(", ")).toHaveLength(0);
  });

  it("every entity carries the describeEntity fields, including relations", () => {
    for (const [name, doc] of Object.entries(lt.entities) as [string, any][]) {
      expect(doc.title, name).toBeTruthy();
      expect(Array.isArray(doc.aliases), name).toBe(true);
      expect(doc.id_convention, name).toBeTruthy();
      expect(Array.isArray(doc.relations), `${name}.relations`).toBe(true);
      expect(Array.isArray(doc.capabilities), name).toBe(true);
    }
  });
});
