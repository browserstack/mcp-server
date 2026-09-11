import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation", () => ({ trackMCP: vi.fn() }));

import addAccessibilityTools from "../../src/tools/accessibility";
import addSelfHealTools from "../../src/tools/selfheal";

const mockConfig = {
  "browserstack-username": "fake-user",
  "browserstack-access-key": "fake-key",
};

// Captures the annotations object passed as the 4th argument to server.tool().
function collectAnnotations(register: (server: any, config: any) => unknown) {
  const annotations: Record<string, any> = {};
  const serverMock = {
    tool: vi.fn((...toolArgs: any[]) => {
      annotations[toolArgs[0]] = toolArgs[3];
    }),
    server: {
      getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }),
      getClientCapabilities: vi.fn().mockReturnValue({}),
      elicitInput: vi.fn(),
    },
  };
  register(serverMock, mockConfig);
  return annotations;
}

// These values were flagged in the OpenAI marketplace review of v1.3.0; the
// assertions pin the corrected hints so they cannot silently regress.
describe("tool annotations flagged in marketplace review", () => {
  it("startAccessibilityScan is open-world: it loads an arbitrary public URL (and can submit login forms)", () => {
    const annotations = collectAnnotations(addAccessibilityTools);
    expect(annotations.startAccessibilityScan).toMatchObject({
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    });
  });

  it("prepareSelfHealingPlan is not read-only: it drives a code-edit workflow", () => {
    const annotations = collectAnnotations(addSelfHealTools);
    expect(annotations.prepareSelfHealingPlan).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
  });
});
