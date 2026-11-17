/**
 * Clashes the products have already decided between themselves.
 *
 * The routing gate has exactly one way out of a clash: the user naming a product. That is
 * right when the choice is genuinely the user's — "report" means different things in Test
 * Management and Test Reporting, and only they know which they meant. It is wrong when the
 * product owners have already written the answer down.
 *
 * App Live and App Automate are the case that forced this. Their published routing rule
 * says a NEW session goes to App Automate, and App Live is used only when the user asks
 * for it by name or the account has no App Automate — a rule the server is supposed to
 * apply, not relay. With no way to express it, every "open my app on a phone" became a
 * question put back to the user, who had already said what they wanted.
 *
 * A FAMILY, NOT A LIST OF RIVALS. The first version of this had each product name the
 * products it beat. That reads naturally and does not scale: it is a claim about a pair,
 * so N products need up to N^2 of them, every one of which has to be revisited when a
 * product is added, and a product can be declared to win by a rival that never mentions
 * it back. Here each product makes ONE statement about ITSELF — which family it is in,
 * what role it plays, where it sits in the order — and the comparison is derived. Adding
 * a product is one declaration, in its own file, reviewed with its own vocabulary.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It never invents a winner: no family, no answer. It
 * never resolves a clash that reaches outside one family — if Test Management is in the
 * set because the request also mentions a test plan, the device-session order says
 * nothing about that and the user is still asked. And it refuses to break a tie, because
 * two products claiming the same rank is a contradiction in the indexes that should be
 * seen rather than silently resolved in file order.
 */

import { ProductIndex } from "./types.js";

/** What a product declares about the family it competes in. */
export interface RoutingFamily {
  /** Products sharing this name are alternatives to each other. */
  name: string;
  /** What this member is FOR, in one word, e.g. "attended" or "unattended". */
  role?: string;
  /** Lower wins. Unique within a family; a tie resolves nothing. */
  rank: number;
  /**
   * One line saying why this member is the default, written for the user to hear. The
   * caller is expected to repeat it: a product chosen silently is the failure this
   * registry exists to stop, and that is no less true when the server did the choosing.
   */
  note?: string;
}

export interface ClashResolution {
  /** The product the declarations leave standing. */
  product: string;
  /** The family it won in, for the message and for telemetry. */
  family: string;
  /** The members it was chosen over. */
  over: string[];
  /** The winner's own words for why, or a plain fallback. */
  note: string;
}

const familyOf = (index: ProductIndex | undefined): RoutingFamily | undefined =>
  index?.routing_family;

/**
 * The one product a clash resolves to on the indexes' own declarations, if any.
 *
 * `candidates` is the clash set as the gate computed it. Returns undefined whenever the
 * declarations do not settle it outright, which is the case that must keep asking.
 */
export function resolveClash(
  products: Record<string, ProductIndex>,
  candidates: readonly string[],
): ClashResolution | undefined {
  if (candidates.length < 2) return undefined;

  const members = candidates.map((name) => ({
    name,
    family: familyOf(products[name]),
  }));
  // Every candidate must be in the SAME family. One outsider and the order says nothing
  // about the question actually being asked.
  const first = members[0].family;
  if (!first) return undefined;
  if (!members.every((m) => m.family && m.family.name === first.name))
    return undefined;

  const ranked = [...members].sort(
    (a, b) =>
      (a.family as RoutingFamily).rank - (b.family as RoutingFamily).rank,
  );
  const top = ranked[0].family as RoutingFamily;
  const runnerUp = ranked[1].family as RoutingFamily;
  // A tie at the top is a contradiction between two indexes. Surface it as a question.
  if (top.rank === runnerUp.rank) return undefined;

  const product = ranked[0].name;
  const over = ranked.slice(1).map((m) => m.name);
  return {
    product,
    family: first.name,
    over,
    note:
      top.note ??
      `${product} is the declared default in the ${first.name} family, ahead of ${over.join(", ")}.`,
  };
}
