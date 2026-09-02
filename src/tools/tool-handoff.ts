/**
 * Precondition sentences appended to a tool's description.
 *
 * WHY THESE EXIST. Nothing routes an MCP call: the client's model picks a tool from the
 * descriptions alone. A tool that needs an identifier the caller does not have is a dead
 * end — the model either asks the user for something they also do not know, or gives up.
 * These sentences turn that dead end into a HANDOFF by naming, in the description itself,
 * where the missing identifier comes from.
 *
 * Point at a sibling tool whenever one can produce the id — it is faster and more
 * predictable than an agent. Point at `askBrowserStackAI` only when NO tool here can.
 *
 * The one that matters most: 15 of the 17 Test Management tools require a project
 * identifier and NONE of them accepts its absence, yet no tool in this server lists
 * projects. "List my projects" is the first step of nearly every Test Management journey
 * and it was unserved, which is exactly why that request did not reach any tool unless a
 * user named one explicitly.
 *
 * Keep these as shared constants, not per-tool prose: the wording is a routing signal, and
 * twenty hand-written variants drift into twenty different signals.
 */

/** No tool lists projects, so this genuinely has to go to the agent. */
export const NEEDS_PROJECT_ID =
  " Requires a project identifier (PR-*). No tool here lists projects, so if you do not " +
  'have one, call askBrowserStackAI with product "tm" and ask which projects exist, then ' +
  "retry this tool with the identifier it returns.";

/** A sibling tool can produce the id — prefer it over the agent. */
export function needsIdFrom(idLabel: string, sourceTool: string): string {
  return ` Requires ${idLabel}. Call ${sourceTool} first if you do not have it.`;
}

/** A test plan id (TP-*) comes from listTestPlans. */
export const NEEDS_TEST_PLAN_ID = needsIdFrom(
  "a test plan identifier (TP-*)",
  "listTestPlans",
);

/** A build id comes from either build-lookup tool. */
export const NEEDS_BUILD_ID = needsIdFrom(
  "a BrowserStack build id",
  "getBuildId or listBuildId",
);

/** Session ids are not listable by any tool here. */
export const NEEDS_SESSION_ID =
  " Requires a session id, which no tool here lists. If you only know the build, call " +
  "getBuildId or listBuildId; if you have neither, call askBrowserStackAI with product " +
  '"tra" and describe the run you mean.';

/** A completed scan's ids come from startAccessibilityScan, or from the agent. */
export const NEEDS_A11Y_SCAN_ID =
  " Requires the ids of a completed scan. They are returned by startAccessibilityScan; " +
  'for a scan run earlier, call askBrowserStackAI with product "a11y" to locate it, since ' +
  "no tool here lists past scans.";

/** Auth-config ids are not listable by any tool here. */
export const NEEDS_A11Y_CONFIG_ID =
  " Requires the numeric id returned by createAccessibilityAuthConfig. No tool here lists " +
  "existing configurations, so if you do not have the id, call askBrowserStackAI with " +
  'product "a11y".';

/** Test ids come from listTestIds, which itself needs a build id. */
export const NEEDS_TEST_IDS = needsIdFrom("test ids", "listTestIds");
