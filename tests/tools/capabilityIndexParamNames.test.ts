import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PARAMETER NAMES ARE UNIQUE WITHIN EACH GROUP OF EVERY CAPABILITY.
 *
 * The caller sends a flat `{name: value}` map per group and the binder places each value by
 * the param's `json_path`. It looks params up by name, so when two params in one group share
 * a name the last definition wins and the other is unreachable: a value meant for one lands
 * at the other's path, and nothing fails. Two params with the same wire name at different
 * paths must be published under distinct role names (e.g. `source_folder_id` with
 * `json_path: /folder_id`).
 *
 * Disabled capabilities are checked too: re-enabling one must not bring the defect back.
 * The same name across groups (a path param and a body field) is fine; the groups bind
 * separately.
 */
describe("capability parameter names in every shipped index", () => {
  it("never repeat within path_params, query or body", () => {
    const files = readdirSync("capability").filter((f) =>
      f.endsWith(".capability-index.json"),
    );
    expect(files.length).toBeGreaterThan(0);

    let checked = 0;
    const repeats: string[] = [];
    for (const file of files) {
      const raw = JSON.parse(readFileSync(`capability/${file}`, "utf8"));
      for (const [product, bundle] of Object.entries<any>(raw)) {
        for (const c of bundle?.capabilities ?? []) {
          checked++;
          for (const group of ["path_params", "query", "body"]) {
            const params = Array.isArray(c[group]) ? c[group] : [];
            const seen = new Map<string, number>();
            for (const p of params) {
              const name = String(p?.name);
              seen.set(name, (seen.get(name) ?? 0) + 1);
            }
            for (const [name, count] of seen) {
              if (count > 1) {
                repeats.push(
                  `${product}.${c.name}: ${group}.${name} x${count}`,
                );
              }
            }
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect(repeats).toEqual([]);
  });
});
