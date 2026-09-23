import { describe, it, expect } from "vitest";
import { nodeUpgradeNotice } from "../../src/lib/node-version-notice";

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
