import { createHmac } from "node:crypto";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";

const CONFIRM_TOKEN_TTL_MINUTES = 5;

/**
 * Shared confirmation gate for state-changing Test Management tools.
 *
 * Shared test-case/plan descriptions can prompt-inject the caller's LLM into
 * silently invoking a TM write tool. Requiring an explicit, short-lived
 * confirmation token means a write cannot execute from a single injected
 * instruction — the user (or a second, deliberate turn) has to re-issue the
 * call with the token. Mirrors the pattern proposed for managePercyBuildApproval.
 */

function mintToken(
  authString: string,
  operation: string,
  payloadKey: string,
  bucket: number,
): string {
  return createHmac("sha256", authString)
    .update(`${operation}:${payloadKey}:${bucket}`)
    .digest("hex")
    .slice(0, 16);
}

// Stable key for the write's arguments, excluding confirmToken itself, so the
// token is bound to the exact operation being confirmed.
function payloadKeyOf(args: Record<string, unknown>): string {
  const rest: Record<string, unknown> = { ...(args ?? {}) };
  delete rest.confirmToken;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/**
 * Returns a confirmation-prompt CallToolResult when the caller has not supplied
 * a valid `confirmToken` for this exact operation+arguments, or `null` when the
 * token is valid and the write may proceed.
 */
export function requireWriteConfirmation(
  operation: string,
  actionDescription: string,
  args: object,
  config: BrowserStackConfig,
): CallToolResult | null {
  const a = args as { confirmToken?: string } & Record<string, unknown>;
  const authString = getBrowserStackAuth(config);
  const payloadKey = payloadKeyOf(a);
  const nowBucket = Math.floor(Date.now() / 60000);

  // Accept any bucket within the TTL so the token stays valid across the round-trip.
  const valid = new Set<string>();
  for (let i = 0; i <= CONFIRM_TOKEN_TTL_MINUTES; i++) {
    valid.add(mintToken(authString, operation, payloadKey, nowBucket - i));
  }

  if (a.confirmToken && valid.has(a.confirmToken)) {
    return null;
  }

  const token = mintToken(authString, operation, payloadKey, nowBucket);
  return {
    content: [
      {
        type: "text",
        text:
          `Confirmation required — ${actionDescription} ` +
          `Show the user what will happen and get their explicit approval, then re-call ${operation} ` +
          `with the same arguments plus confirmToken:"${token}" (valid ${CONFIRM_TOKEN_TTL_MINUTES} minutes). ` +
          `Do not supply the token on the user's behalf without that approval.`,
      },
    ],
  };
}

export const CONFIRM_TOKEN_FIELD_DESCRIPTION =
  "Confirmation token from the tool's prior response. Required to actually perform this write; obtain the user's explicit approval before re-calling with it.";
