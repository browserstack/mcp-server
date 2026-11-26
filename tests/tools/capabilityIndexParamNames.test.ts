import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bind } from "../../src/tools/capability-registry/bind.js";

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

describe("callers on the contract before the renames", () => {
  const tm = JSON.parse(
    readFileSync("capability/tm.capability-index.json", "utf8"),
  ).tm.capabilities;
  const find = (name: string) =>
    tm.find((c: { name: string }) => c.name === name);

  it.each(["bulk_move_test_cases", "bulk_replace_test_case_fields"])(
    "%s: an old top-level folder_id is pointed at source_folder_id, not called a wrapper",
    (name) => {
      let message = "";
      try {
        bind(find(name), {
          path_params: { project_id: 1 },
          body: { folder_id: 11, select_all: true },
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/^unknown body: folder_id\. /);
      expect(message).toContain("Send folder_id as source_folder_id");
      expect(message).not.toContain("wrapper");
    },
  );

  it("search: an old custom_fields column list is pointed at required_custom_fields", () => {
    expect(() =>
      bind(find("search_project_entities_by_filter"), {
        path_params: { project_id: 1 },
        body: { custom_fields: "121,119" },
      }),
    ).toThrow(
      /'custom_fields' must be an object.*If you meant the other field the API calls custom_fields, send it as required_custom_fields/,
    );
  });

  it("a hand-built wrapper is still called a wrapper", () => {
    expect(() =>
      bind(find("bulk_move_test_cases"), {
        path_params: { project_id: 1 },
        body: { test_case: { select_all: true } },
      }),
    ).toThrow(/test_case is a wrapper this surface builds for you/);
  });
});
