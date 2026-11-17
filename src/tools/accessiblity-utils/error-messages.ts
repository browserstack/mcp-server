/*
 * How an error is put to the agent: as a sentence, and, for a refusal the user resolves on
 * their own account, as what to tell them instead of a fault to report.
 */

/**
 * The message as a sentence: a full stop is added only when it does not already end in
 * one (or in "!", "?" or "…", before any closing quote or bracket), so a message that
 * ends in a full stop does not end in "..".
 */
export function asSentence(message: string): string {
  const text = message.trim();
  return /[.!?…]["'”’)\]]*$/.test(text) ? text : `${text}.`;
}

/**
 * Refusals the user resolves on their own account, with what to tell them. The API's own
 * words ("You do not have access to External APIs", "user info missing") read like faults,
 * so agents retried, renamed the scan, or reported them with submitFeedback. Each pattern
 * is the API's message as logged in telemetry.
 */
export function accountRefusal(message: string): string | undefined {
  const scanLimit = message.match(/make over (\d+) scans/i);
  if (scanLimit) {
    return `This account has reached its plan's limit of ${scanLimit[1]} saved Website Scanner scans, so no new scan can be started. To scan again, delete scans that are no longer needed under Website Scanner in the Accessibility dashboard (https://accessibility.browserstack.com/site-scanner), or upgrade the plan. This is a plan limit, not a fault: tell the user, and do not retry or start the scan under another name.`;
  }
  if (/access to External APIs/i.test(message)) {
    return "This account's BrowserStack plan does not include the External APIs add-on, which the MCP's accessibility tools need: they work through the Accessibility API. Scans can still be run and read in the Accessibility dashboard (https://accessibility.browserstack.com). To use them from here, the account admin can add External APIs to the plan through BrowserStack sales. This is a plan limit, not a fault: tell the user, and do not retry.";
  }
  if (/user info missing/i.test(message)) {
    return "Website Scanner has not set this user up yet: it does that the first time they open Website Scanner in the Accessibility dashboard, and refuses its API until then. Ask the user to open https://accessibility.browserstack.com/site-scanner once while signed in to BrowserStack, then start the scan again.";
  }
  return undefined;
}
