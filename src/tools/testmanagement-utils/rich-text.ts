// TM renders these fields as rich text only when the value is HTML; 
const TM_ALLOWED_TAG =
  /^\s*<(div|img|b|em|i|strong|u|span|abbr|br|cite|code|dd|dfn|dl|dt|kbd|li|mark|ol|p|pre|q|s|samp|small|strike|sub|sup|time|ul|var|table|td|th|thead|tbody|tr|col|colgroup|a)[\s/>]/i;
const HAS_ENCODABLE_CHARS = /[<>&]/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function wrapRichText(text: string): string {
  if (TM_ALLOWED_TAG.test(text) || !HAS_ENCODABLE_CHARS.test(text)) {
    return text;
  }
  return `<p>${escapeHtml(text)}</p>`;
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
