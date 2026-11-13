/**
 * Turn an id into a single URL path segment.
 *
 * Resource ids identify one resource and go straight into request URLs. A value
 * carrying `/`, `?`, `#` or other URL-significant characters would change which
 * endpoint the request reaches rather than name a resource under it, so every id
 * is percent-encoded before it joins a path.
 *
 * `encodeURIComponent` leaves `.` untouched, and `new URL()` resolves `.` and
 * `..` the way a filesystem would — `..` walks up a segment and the request
 * lands on a different resource. Empty and `.` collapse the segment the same way.
 * All three are refused; pass the id exactly as a read returned it.
 */
export function encodePathSegment(value: string | number, name = "id"): string {
  const text = String(value);
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "..") {
    throw new Error(
      `'${name}' is not a usable path value: ${JSON.stringify(text)} would ` +
        `point the request at a different resource rather than identify one. ` +
        `Pass the id exactly as a read returned it.`,
    );
  }
  return encodeURIComponent(text);
}
