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
    pattern: /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi,
    replacement: "[email]",
  },
  // JWT: three base64url segments.
  {
    name: "jwt",
    pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g,
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
      /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g,
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
      /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,5}[\s.-]\d{3,5}(?:[\s.-]\d{2,5})?\b/g,
    replacement: "[phone]",
  },
  // Long bare digit runs: account ids, card numbers, unseparated phone numbers.
  { name: "long_number", pattern: /\b\d{9,}\b/g, replacement: "[number]" },
];

/**
 * Returns the text with shape-identifiable PII replaced, capped at MAX_LENGTH.
 *
 * FAILS CLOSED: any throw returns undefined, so the caller records no field rather than
 * the raw value. Non-string and empty input yields undefined for the same reason.
 */
export function redact(text: unknown): string | undefined {
  try {
    if (typeof text !== "string") return undefined;
    let out = text.replace(/\s+/g, " ").trim();
    if (!out) return undefined;

    for (const rule of RULES) out = out.replace(rule.pattern, rule.replacement);

    return out;
  } catch {
    return undefined;
  }
}

/** The rule names, for documenting what is covered. */
export const REDACTED_TYPES = RULES.map((r) => r.name);
