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
 * Returns the text with shape-identifiable PII replaced, capped at `maxLength`.
 *
 * `maxLength` exists for agent feedback, whose value is its repro detail; every other
 * caller keeps the default. A larger cap lets more unshaped detail through, so raise it
 * only where the field is useless without the length.
 *
 * FAILS CLOSED: any throw returns undefined, so the caller records no field rather than
 * the raw value. Non-string and empty input yields undefined for the same reason.
 */
export function redact(
  text: unknown,
  maxLength: number = MAX_LENGTH,
): string | undefined {
  try {
    if (typeof text !== "string") return undefined;
    // Slice before the rules run; a multi-KB digit run makes them backtrack.
    const SCAN_LIMIT = maxLength * 8;
    let out = text.slice(0, SCAN_LIMIT).replace(/\s+/g, " ").trim();
    if (!out) return undefined;

    for (const rule of RULES) out = out.replace(rule.pattern, rule.replacement);

    // Truncate AFTER redacting, so a value that would have been replaced cannot be split
    // across the boundary and leave its first half in the clear.
    return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
  } catch {
    return undefined;
  }
}

/** The rule names, for documenting what is covered. */
export const REDACTED_TYPES = RULES.map((r) => r.name);

/**
 * Extra rules for agent feedback, run BEFORE `RULES`.
 *
 * Feedback is a free-form report, so the agent copies whatever blocked it: a failed login
 * from an auth config, a log line, a scanned URL. Those carry secrets too short for
 * `opaque_token` and card numbers the `phone` rule half-matches. Unlike `RULES` these do
 * use a few labels (`password`, `api_key`, `otp`): a short secret has no shape, only the
 * word in front of it.
 */
interface FeedbackRule {
  name: string;
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

/** Labels that may take a bare space before the value ("password Hunter2!"). */
const BARE_SECRET_LABEL = /^(password|passwd|pwd|passphrase|bearer)$/i;

const FEEDBACK_RULES: FeedbackRule[] = [
  // A value after a secret label, at any length. After `:` or `=` any value goes. After a
  // bare space only `password`/`bearer`-style labels count, and only when the value has a
  // digit or symbol — so "password Hunter2!" is redacted but "password reset page" and
  // "token expired" survive. A letters-only password after a bare space still passes.
  {
    name: "labelled_secret",
    pattern:
      /\b(password|passwd|pwd|passphrase|bearer|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token|session[_-]?id)(\s*[:=]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi,
    replacement: (match, label, sep, value) => {
      const explicit = /[:=]/.test(sep);
      const bare =
        BARE_SECRET_LABEL.test(label) && /[\d!@#$%^&*_+~]/.test(value);
      return explicit || bare ? `${label}${sep}[secret]` : match;
    },
  },
  // 13–19 digits with optional space/dash groups: card numbers. Before `phone`, which
  // would otherwise take the first groups and leave the tail.
  {
    name: "card",
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    replacement: "[card]",
  },
  // One-time codes. 4–8 digits after the label; "status code 500" keeps its 3 digits and
  // "error code 1001" is spared by the lookbehind.
  {
    name: "otp",
    pattern:
      /\b(otp|pin|passcode|(?<!(?:status|error|exit|response|http)\s)code)(\s*[:=]?\s*)\d{4,8}\b/gi,
    replacement: "$1$2[code]",
  },
  // Query strings and fragments carry customer ids and tokens; scheme, host and path stay
  // so the report still says which page failed.
  {
    name: "url_query",
    pattern: /\b(https?:\/\/[^\s?#]+)[?#]\S*/gi,
    replacement: "$1?[query]",
  },
];

/** The feedback-only rule names, for documenting what is covered. */
export const FEEDBACK_REDACTED_TYPES = FEEDBACK_RULES.map((r) => r.name);

/**
 * `redact` plus `FEEDBACK_RULES`. Same guarantees: fails closed to undefined, capped at
 * `maxLength`. Names, addresses and internal hostnames still pass, as with `redact`.
 */
export function redactFeedback(
  text: unknown,
  maxLength: number = MAX_LENGTH,
): string | undefined {
  try {
    if (typeof text !== "string") return undefined;
    let out = text.slice(0, maxLength * 8);
    for (const rule of FEEDBACK_RULES)
      out = out.replace(rule.pattern, rule.replacement as never);
    return redact(out, maxLength);
  } catch {
    return undefined;
  }
}
