/* A question for accessibilityExpert, fitted to the length the knowledge base takes. */

/** The longest question the accessibility knowledge base takes; longer ones are refused. */
export const EXPERT_QUERY_MAX_CHARS = 500;

/** The opening of `text` within `max` characters, cut at a word break when one is near. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text.trimEnd();
  const head = text.slice(0, max);
  const lastBreak = head.search(/\s\S*$/);
  return (lastBreak > max * 0.6 ? head.slice(0, lastBreak) : head).trimEnd();
}

/**
 * A question the knowledge base will take. It refuses anything over 500 characters
 * ("Query is too long"), and agents writing a detailed question hit that: two refusals on
 * 4 Nov alone. Agents put the question itself last, after the context, so a longer one
 * keeps its last sentence and as much of its opening as fits around it.
 */
export function fitExpertQuery(query: string): {
  query: string;
  shortened: boolean;
} {
  if (query.length <= EXPERT_QUERY_MAX_CHARS)
    return { query, shortened: false };
  const text = query.trim();
  const sentences = text.match(/[^.?!]+(?:[.?!]+["')\]]*\s*|$)/g) ?? [text];
  const last = sentences[sentences.length - 1].trim();
  const gap = " … ";
  if (sentences.length < 2 || last.length > EXPERT_QUERY_MAX_CHARS * 0.6) {
    return { query: cutAtWord(text, EXPERT_QUERY_MAX_CHARS), shortened: true };
  }
  const opening = text.slice(0, text.length - last.length);
  const room = EXPERT_QUERY_MAX_CHARS - last.length - gap.length;
  return { query: `${cutAtWord(opening, room)}${gap}${last}`, shortened: true };
}
