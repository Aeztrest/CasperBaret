/** Extract an API key from an `Authorization` (Bearer) or `x-api-key` header. */
export function extractApiKeyFromHeader(
  headerVal: string | string[] | undefined,
): string | null {
  if (!headerVal) return null;
  const v = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!v) return null;
  const m = /^Bearer\s+(.+)$/i.exec(v.trim());
  if (m) return m[1] ?? null;
  return v.trim();
}
