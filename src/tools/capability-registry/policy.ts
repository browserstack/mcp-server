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
 * question put back to the user, who had already said what they wanted. A QA pass over 71
 * prompts put 19 of them into that clash with nothing else in it.
 *
 * So a product may declare which products it is chosen over. That is a claim about the
 * product, belongs beside its vocabulary, and is reviewed with it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It never invents a winner: with no declaration the
 * clash is still the user's question. It never resolves a clash it only partly covers —
 * if Test Management is in the set because the request also mentions a test plan, the
 * App Automate rule says nothing about that and the user is still asked. And a mutual
 * declaration (each product claiming precedence over the other) resolves to nothing
 * rather than to whichever was listed first, because that is a contradiction in the
 * indexes and guessing past it would hide it.
 */

import { ProductIndex } from "./types.js";

/** What a product declares about clashes it is in. */
export interface RoutingPolicy {
  /**
   * Products this one is chosen over when a request could be either and the user has
   * named neither. Names are product keys, as `listProducts` reports them.
   */
  preferred_over?: string[];
  /**
   * One line saying WHY, written for the user to hear. The caller is expected to repeat
   * it, because a product chosen silently is the failure this registry exists to stop.
   */
  note?: string;
}

export interface ClashResolution {
  /** The product the declarations leave standing. */
  product: string;
  /** The products it was chosen over, for the note and for telemetry. */
  over: string[];
  /** The winner's own words for why, or a plain fallback. */
  note: string;
}

const policyOf = (index: ProductIndex | undefined): RoutingPolicy | undefined =>
  index?.routing_policy;

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

  // A product is out if any OTHER candidate declares precedence over it. Computed in one
  // pass against the original set, so a mutual pair eliminates both and resolves nothing
  // — the contradiction surfaces as a question rather than as a coin toss.
  const out = new Set<string>();
  for (const winner of candidates) {
    const over = policyOf(products[winner])?.preferred_over ?? [];
    for (const loser of over)
      if (loser !== winner && candidates.includes(loser)) out.add(loser);
  }

  const left = candidates.filter((name) => !out.has(name));
  if (left.length !== 1) return undefined;

  const product = left[0];
  // The winner must have WON, not merely survived. Without this a clash between two
  // products that declare nothing and one that is declared over by a third would
  // "resolve" to a product no declaration mentions.
  const over = (policyOf(products[product])?.preferred_over ?? []).filter(
    (name) => candidates.includes(name),
  );
  if (over.length === 0) return undefined;

  return {
    product,
    over,
    note:
      policyOf(products[product])?.note ??
      `${product} is the declared default over ${over.join(", ")} for this kind of request.`,
  };
}
