/**
 * Mechanical privacy guard for customer-facing wording: it rejects text that names internal
 * identifiers, repository files/paths or hashes. It does not judge whether the question is
 * material or well asked; that stays with the Root.
 */
export function isCustomerSafe(
  texts: readonly string[],
  internalIdentifiers: readonly string[],
): boolean {
  const unsafePatterns = [
    /\bsha256:[a-f0-9]{16,}\b/i,
    /\b[a-f0-9]{40}\b/i,
    /(?:^|[\s"'`(])(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.[a-z0-9]{1,6}\b/i,
    /\b[\w-]+\.(?:ts|tsx|js|jsx|py|java|go|rb|cs|rs|php|kt|swift|yaml|yml|json|toml)\b/i,
  ];
  return texts.every(
    (text) =>
      !unsafePatterns.some((pattern) => pattern.test(text)) &&
      !internalIdentifiers.some((id) => id.length >= 4 && text.includes(id)),
  );
}
