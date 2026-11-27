import type { ToolSpec } from "../harness/cases.js";
import { accessibilityPercySpecs } from "./accessibility-percy.js";
import { automateLiveSpecs } from "./automate-live.js";
import { capabilityMiscSpecs } from "./capability-misc.js";
import { testManagementSpecs } from "./testmanagement.js";

/** Every L3 tool spec. One entry for each tool in tools/list. */
export const ALL_SPECS: ToolSpec[] = [
  ...accessibilityPercySpecs,
  ...automateLiveSpecs,
  ...capabilityMiscSpecs,
  ...testManagementSpecs,
];
