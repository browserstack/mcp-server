import { describe, it, expect } from "vitest";
import {
  nodeUpgradeNotice,
  withNodeUpgradeNotice,
} from "../../src/lib/node-version-notice";

describe("nodeUpgradeNotice", () => {
  it.each(["18.19.0", "20.9.0", "21.7.3"])(
    "returns a nudge for Node < 22 (%s)",
    (v) => {
      expect(nodeUpgradeNotice(v)).toContain("Node version > 21.x.x");
      expect(nodeUpgradeNotice(v)).toContain(v);
    },
  );

  it.each(["22.0.0", "24.3.1", "26.1.0"])(
    "returns empty on Node >= 22 (%s)",
    (v) => {
      expect(nodeUpgradeNotice(v)).toBe("");
    },
  );
});

describe("withNodeUpgradeNotice", () => {
  const result = { content: [{ type: "text", text: "original" }] };

  it("prepends the notice when one applies", () => {
    const out = withNodeUpgradeNotice(result, "⚠️ upgrade");
    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: "text", text: "⚠️ upgrade" });
    expect(out.content[1]).toEqual({ type: "text", text: "original" });
  });

  it("returns the result unchanged when the notice is empty (Node >= 22)", () => {
    const out = withNodeUpgradeNotice(result, "");
    expect(out).toBe(result);
  });

  it("is a no-op on malformed results", () => {
    const bad = {} as any;
    expect(withNodeUpgradeNotice(bad, "⚠️ upgrade")).toBe(bad);
  });
});
