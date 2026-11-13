/**
 * Returns the body a wrapUntrusted() block carries, for assertions in tests.
 * The nonce on the open marker is matched against the close marker.
 */
export function unwrapUntrusted(text: string): string {
  const m = text.match(
    /«UNTRUSTED .+? ([0-9a-f]{12})»\n([\s\S]*)\n«END UNTRUSTED \1»/,
  );
  if (!m) throw new Error(`expected wrapped untrusted content, got: ${text}`);
  return m[2];
}
