const NAMESPACE_FALLBACK = "default_namespace";

export function toVectorNamespace(fileKey: string): string {
  const sanitized = fileKey.replace(/[^a-zA-Z0-9_-]/g, "_").trim();
  return sanitized.length > 0 ? sanitized : NAMESPACE_FALLBACK;
}
