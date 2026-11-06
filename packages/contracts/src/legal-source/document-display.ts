/**
 * Business purpose:
 * Give report readers a document name grounded in pinned Legal Source metadata.
 *
 * Business rules:
 * - Prefer the title stored on the pinned LegalSourceDocument.
 * - Format a number only from recognized Legal Source identifier conventions.
 * - Use a neutral fallback for unknown identifiers.
 *
 * Execution flow:
 * 1. Read the document identifier and optional pinned title.
 * 2. Return the verified title with its number when available, otherwise a recognized number or fallback.
 *
 * Failure cases:
 * - Missing or unrecognized metadata never produces an invented legal title.
 *
 * Side effects:
 * - None; this is a deterministic presentation helper.
 */
export function legalDocumentDisplayName(
  documentId: string,
  verifiedDocumentTitle?: string,
): string {
  const law = documentId.match(/^luat-so-(\d+)-(\d+)-qh(\d+)\b/u);
  if (law) {
    const number = `${law[1]}/${law[2]}/QH${law[3]}`;
    if (verifiedDocumentTitle) {
      return verifiedDocumentTitle.includes(number)
        ? verifiedDocumentTitle
        : `${verifiedDocumentTitle} số ${number}`;
    }
    return `Luật số ${number}`;
  }

  const decree = documentId.match(/^nghi-dinh-so-(\d+)-(\d+)-nd-cp\b/u);
  if (decree) {
    const number = `${decree[1]}/${decree[2]}/NĐ-CP`;
    if (verifiedDocumentTitle) {
      return verifiedDocumentTitle.includes(number)
        ? verifiedDocumentTitle
        : `${verifiedDocumentTitle} số ${number}`;
    }
    return `Nghị định số ${number}`;
  }

  return verifiedDocumentTitle || "Tài liệu pháp lý";
}
