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

/**
 * createProjectOrFolder must NOT carry NEEDS_PROJECT_ID: `project_identifier` is optional
 * there, and the create-a-PROJECT half needs no id at all. With the generic constant the
 * tool read "Requires a project identifier ... call askBrowserStackAI", which routed
 * "create me a project" through the agent before letting the tool run.
 */
export const PROJECT_ID_ONLY_FOR_FOLDER =
  " Creating a project needs no identifier. Creating a folder inside an EXISTING project " +
  "needs that project's identifier (PR-*); no tool here lists projects, so ask " +
  'askBrowserStackAI with product "tm" for it.';

/** A test plan id (TP-*) comes from listTestPlans. */
export const NEEDS_TEST_PLAN_ID = needsIdFrom(
  "a test plan identifier (TP-*)",
  "listTestPlans",
);

/**
 * The ONLY capability handoff here: every other constant points at a tool that produces a
 * missing *id*, but plan WRITES have no tool at all — the surface is `listTestPlans`,
 * `getTestPlan`, `listSubTestPlans`, `getSubTestPlan` and nothing else. Atlas can do them
 * (the tm harness allows POST /api/v1/projects/{id}/test-plans plus /update, /delete,
 * /clone, /test-runs and /test-runs/unlink), so without this line the model reads the four
 * read tools, finds no create, and reports the capability as absent — which is exactly what
 * a QA eval concluded.
 *
 * Deliberately narrow: it names the specific operations that are missing rather than
 * inviting the model to route plan work to the agent generally, because the tool
 * descriptions otherwise say to prefer a specific tool whenever one fits.
 *
 * Caveat worth knowing: askBrowserStackAI pins every write to human approval, so this path
 * only completes on a client that can show a prompt. On one that cannot, the intended write
 * comes back in `needs_approval` instead of happening.
 */
export const PLAN_WRITES_VIA_AGENT =
  " Creating a test plan or sub-plan, and linking or unlinking test runs on one, are not " +
  'available as tools here: call askBrowserStackAI with product "tm" and describe what you ' +
  "want. It asks you to confirm before changing anything.";

/** A build id comes from either build-lookup tool. */
export const NEEDS_BUILD_ID = needsIdFrom(
  "a BrowserStack build id",
  "getBuildId or listBuildId",
);

/**
 * Session ids ARE listable now — PR #395 added `listSessions`, which merged into main while
 * this branch was open. This used to send the model to askBrowserStackAI for want of a tool;
 * pointing at the agent when a real tool exists is exactly what the header above forbids.
 */
export const NEEDS_SESSION_ID =
  " Requires a session id. listSessions lists them for a build; if you do not have the " +
  "build either, getBuildId or listBuildId resolves one from a project and build name.";

/** A completed scan's ids come from startAccessibilityScan, or from the agent. */
export const NEEDS_A11Y_SCAN_ID =
  " Requires the ids of a completed scan, which are returned by startAccessibilityScan. " +
  "No tool here lists past scans, so if you do not have the ids, start a new scan rather " +
  "than guessing.";

/** Auth-config ids are not listable by any tool here. */
export const NEEDS_A11Y_CONFIG_ID =
  " Requires the numeric id returned by createAccessibilityAuthConfig. No tool here lists " +
  "existing configurations, so if you do not have the id, create one rather than guessing.";

/** Test ids come from listTestIds, which itself needs a build id. */
export const NEEDS_TEST_IDS = needsIdFrom("test ids", "listTestIds");
