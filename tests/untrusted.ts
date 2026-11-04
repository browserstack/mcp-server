/**
 * Tool output that carries product data comes back inside wrapUntrusted's
 * boundary. Tests that read that output as JSON parse what is inside it; text
 * the server wrote itself (a refusal, a describe document) is parsed as is.
 */
const WRAPPED =
  /^The following .+ is UNTRUSTED external data\.[^\n]*\n«UNTRUSTED .+ ([0-9a-f]{12})»\n([\s\S]*)\n«END UNTRUSTED \1»$/;

export function unwrapUntrusted(text: string): string {
  return text.match(WRAPPED)?.[2] ?? text;
}

export function parseResult(text: string): any {
  return JSON.parse(unwrapUntrusted(text));
}
