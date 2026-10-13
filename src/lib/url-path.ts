// Safe interpolation of a caller-supplied id into a URL path segment.
// encodeURIComponent already escapes "/ \ ? #", so the only residual bypass is a
// segment that is exactly "." or ".." (a dot-segment the URL parser resolves).
export function encodePathSegment(value: string | number): string {
  const segment = String(value);
  if (segment === "" || segment === "." || segment === "..") {
    throw new Error("Invalid identifier for URL path");
  }
  return encodeURIComponent(segment);
}
