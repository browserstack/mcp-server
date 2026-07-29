// TM UI renders these fields as rich text only when HTML-wrapped; 
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
