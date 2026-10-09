/**
 * Steering for submitFeedback: one line in the server instructions, and a one-line hint
 * on tool failures the agent cannot fix by changing its own input.
 */

export const FEEDBACK_INSTRUCTION =
  "If a BrowserStack tool cannot do what the user needs, call submitFeedback before giving up or working around it.";

export const FEEDBACK_HINT =
  "If this blocks the user's task, report it with submitFeedback.";

/**
 * Failures the agent can fix itself (bad input, missing auth, wrong id). A hint there
 * would only produce noise reports. Tools flatten errors to text, so this reads the text.
 */
const SELF_FIXABLE =
  /\b(400|401|403|404|422)\b|unauthori[sz]ed|forbidden|not found|invalid|required|must be|validation/i;

function textOf(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .map((part) =>
      typeof (part as { text?: unknown })?.text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join(" ");
}

/**
 * Tools whose failures sit next to site logins and passwords. A nudge to write a report
 * right after one fails invites the agent to copy the credentials into it. Low traffic
 * (160 calls / 23 users in 30 days to 2026-10-09), so little feedback is lost.
 */
export const NO_HINT_TOOLS: ReadonlySet<string> = new Set([
  "submitFeedback",
  "createAccessibilityAuthConfig",
  "getAccessibilityAuthConfig",
]);

/** Appends the hint to an error result the agent cannot fix. Returns other results as-is. */
export function withFeedbackHint<T>(toolName: string, result: T): T {
  if (NO_HINT_TOOLS.has(toolName)) return result;
  const r = result as { isError?: unknown; content?: unknown } | null;
  if (typeof r !== "object" || r === null || r.isError !== true) return result;
  if (!Array.isArray(r.content) || SELF_FIXABLE.test(textOf(r))) return result;
  return {
    ...r,
    content: [...r.content, { type: "text", text: FEEDBACK_HINT }],
  } as T;
}
