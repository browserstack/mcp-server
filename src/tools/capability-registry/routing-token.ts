/**
 * The routing step's verdict, signed so it can be handed back instead of remembered.
 *
 * The gate needs to know what the LAST routing call concluded — whether the request
 * clashed, or settled, and on what. That is a fact about the conversation, and a tool call
 * carries no conversation, so the server kept it: a set of unspent tokens and the listing's
 * last verdict, both living for the life of the connection. Under stdio that is one process
 * per client and harmless; it stops being harmless the moment one process serves several
 * sessions, where a single shared `settledByListing` lets one client's listing satisfy
 * another client's gate.
 *
 * So the verdict travels with the caller instead. It is signed with a per-process secret,
 * which is what keeps it honest: the caller cannot mint one, cannot edit the product inside
 * it, and cannot produce one at all without having made the routing call that issues it.
 * Verification is recomputation — there is nothing to store, nothing to grow, and nothing
 * to leak between sessions.
 *
 * WHAT THIS CANNOT DO, stated plainly: it proves a routing call happened and what it said.
 * It cannot prove a human answered. Nothing a caller transmits can. A caller that reworded
 * its request and ran discovery again on the new words holds a genuine token for a verdict
 * it manufactured — closing THAT needs memory of the first question, which is the thing
 * being removed here. `user_words`, checked against the index, remains the part that
 * carries what the user actually said.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** What a routing call concluded about the user's request. */
export interface RoutingVerdict {
  /** `clash`: several products claim it. `blank`: no product's words at all. `settled`: one. */
  verdict: "clash" | "blank" | "settled";
  /** The product it settled on, for `settled`. */
  product?: string;
  /** The shared words, for `clash` — what the user has to be asked about. */
  terms?: string[];
  /** Issued-at, epoch seconds. */
  iat: number;
}

/**
 * Per process, and deliberately not persisted.
 *
 * A restart invalidates every outstanding token, which is the right behaviour: a new
 * process is a new conversation, and a verdict from the last one says nothing about this
 * one. It also means nothing has to be configured to run the server.
 */
const SECRET = randomBytes(32);

/** Tokens outlive a turn, not a sitting. Long enough to answer a question, not to bank. */
export const TOKEN_TTL_SECONDS = 60 * 30;

const b64 = (b: Buffer): string => b.toString("base64url");

function seal(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** Sign a verdict into an opaque token the caller hands back. */
export function signRouting(
  verdict: Omit<RoutingVerdict, "iat"> & { iat?: number },
): string {
  const body: RoutingVerdict = {
    ...verdict,
    iat: verdict.iat ?? Math.floor(Date.now() / 1000),
  };
  const payload = b64(Buffer.from(JSON.stringify(body)));
  return `${payload}.${seal(payload)}`;
}

/**
 * Read a token back, or `undefined` if it was not issued here, was edited, or has expired.
 *
 * Every failure returns the same nothing on purpose: a caller learning WHY its token was
 * rejected learns how to build a better one, and there is no legitimate caller that needs
 * to know the difference.
 */
export function readRouting(
  token: string | undefined,
  now = Math.floor(Date.now() / 1000),
): RoutingVerdict | undefined {
  if (!token) return undefined;
  const cut = token.lastIndexOf(".");
  if (cut <= 0) return undefined;
  const payload = token.slice(0, cut);
  const signature = token.slice(cut + 1);

  const expected = Buffer.from(seal(payload));
  const given = Buffer.from(signature);
  // Length has to match before timingSafeEqual will look at the bytes, and comparing
  // lengths first leaks only the length, which the caller already knows.
  if (expected.length !== given.length) return undefined;
  if (!timingSafeEqual(expected, given)) return undefined;

  try {
    const body = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as RoutingVerdict;
    if (typeof body?.iat !== "number") return undefined;
    if (now - body.iat > TOKEN_TTL_SECONDS) return undefined;
    if (
      body.verdict !== "clash" &&
      body.verdict !== "blank" &&
      body.verdict !== "settled"
    )
      return undefined;
    return body;
  } catch {
    return undefined;
  }
}
