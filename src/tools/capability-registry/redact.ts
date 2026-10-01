/**
 * Strip the PII we can identify by SHAPE from agent-written intent text, before it is
 * recorded as telemetry.
 *
 * Regex only, no model call: this runs on every capability search and write, so it must
 * be deterministic, allocation-light and incapable of adding latency or a failure mode.
 *
 * WHAT THIS CANNOT DO, and must not be described as doing: a person's NAME has no shape.
 * "assign this to Priya Sharma" is PII and passes through untouched, because no pattern
 * separates a person from a project ("Payments Regression") without destroying the field's
 * value. Physical addresses are the same. Redaction here REDUCES exposure; it does not
 * eliminate it, and the sign-off should be read on those terms.
 */

interface Rule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Ordered: earlier rules win. Every rule matches a SHAPE, never a word list — nothing here
 * needs updating when a product renames a field or a new customer appears.
 */
const RULES: Rule[] = [
  // Credentials inside a URL, before the email rule so `user:pass@host` is not
  // half-matched as an address.
  {
    name: "url_credentials",
    pattern: /\b(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,
    replacement: "$1[redacted]@",
  },
  {
    name: "email",
    pattern: /\b[\w.%+-]{1,128}@[\w.-]{1,128}\.[a-z]{2,24}\b/gi,
    replacement: "[email]",
  },
  // JWT: three base64url segments.
  {
    name: "jwt",
    pattern: /\beyJ[\w-]{8,1024}\.[\w-]{8,1024}\.[\w-]{8,1024}\b/g,
    replacement: "[token]",
  },
  // A long opaque run — access keys, API keys, session ids. Requires BOTH a digit and a
  // letter, so ordinary long words ("internationalisation") are never matched. This is
  // the rule that catches a pasted credential regardless of how it was introduced, which
  // is why no vocabulary of labels ("api_key", "bearer", ...) is hardcoded: guessing the
  // wording a product uses is exactly the assumption that fails.
  {
    name: "opaque_token",
    pattern:
      /\b(?=[A-Za-z0-9_-]{0,256}\d)(?=[A-Za-z0-9_-]{0,256}[A-Za-z])[A-Za-z0-9_-]{20,256}\b/g,
    replacement: "[token]",
  },
  {
    name: "ipv4",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[ip]",
  },
  // Phone: optional country prefix, then digit groups with separators. Requires a
  // separator or a `+`, so a bare digit run falls to long_number instead.
  {
    name: "phone",
    pattern:
      /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\b\d{3,5}[\s.-]\d{3,5}(?:[\s.-]\d{2,5})?\b/g,
    replacement: "[phone]",
  },
  // Long bare digit runs: account ids, card numbers, unseparated phone numbers.
  { name: "long_number", pattern: /\b\d{9,}\b/g, replacement: "[number]" },
];

/**
 * The ceiling on any redacted field.
 *
 * The rules above catch PII by shape, and the header is explicit that a person's NAME has
 * none — so the longer the recorded string, the more unshaped personal detail rides along
 * with it. A cap does not make the field safe; it bounds how much escapes when redaction
 * misses, which it will. 512 leaves an ordinary query or change summary intact.
 *
 * This existed, was removed, and the doc comment kept claiming it for two commits. Both
 * fields it guards are free text an agent writes from what the user said.
 */
export const MAX_LENGTH = 512;

/**
 * Returns the text with shape-identifiable PII replaced, capped at `MAX_LENGTH`.
 *
 * FAILS CLOSED: any throw returns undefined, so the caller records no field rather than
 * the raw value. Non-string and empty input yields undefined for the same reason.
 */
export function redact(text: unknown): string | undefined {
  try {
    if (typeof text !== "string") return undefined;
    // Bound the working window before the rules run: they are linear on ordinary text
    // but a multi-KB run of digits backtracks, and a tool's error text can be a stack
    // trace. Generous enough that nothing inside MAX_LENGTH is affected.
    const SCAN_LIMIT = MAX_LENGTH * 8;
    let out = text.slice(0, SCAN_LIMIT).replace(/\s+/g, " ").trim();
    if (!out) return undefined;

    for (const rule of RULES) out = out.replace(rule.pattern, rule.replacement);

    // Truncate AFTER redacting, so a value that would have been replaced cannot be split
    // across the boundary and leave its first half in the clear.
    return out.length > MAX_LENGTH ? `${out.slice(0, MAX_LENGTH)}…` : out;
  } catch {
    return undefined;
  }
}

/** The rule names, for documenting what is covered. */
export const REDACTED_TYPES = RULES.map((r) => r.name);
