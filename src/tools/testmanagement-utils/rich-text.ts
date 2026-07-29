// TM's v2 API treats step/result, preconditions and description as rich-text
// fields: its write-time sanitizer entity-encodes <, > and & in text nodes
// (preserving allowed tags like <p>), and the TM UI renders the stored value
// as rich text only when it is HTML-wrapped — bare text is displayed
// literally, so a bare ">" surfaces to users as "&gt;" (PMAA-185).
// Per the TM team, external API content must be wrapped in <p> tags to opt
// into rich-text rendering. Quotes are not entity-encoded, so only values
// containing <, > or & need the wrap; everything else is left untouched.

const LOOKS_LIKE_HTML = /^\s*<[a-z][^>]*>/i;
const HAS_ENCODABLE_CHARS = /[<>&]/;

export function wrapRichText(text: string): string {
  if (LOOKS_LIKE_HTML.test(text) || !HAS_ENCODABLE_CHARS.test(text)) {
    return text;
  }
  return `<p>${text}</p>`;
}

export function wrapTestCaseSteps<T extends { step: string; result: string }>(
  steps: T[],
): T[] {
  return steps.map((s) => ({
    ...s,
    step: wrapRichText(s.step),
    result: wrapRichText(s.result),
  }));
}
