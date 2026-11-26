import { RawLegalRuleViewer } from "./raw-legal-rule-viewer";

export interface OriginalLegalExcerptProps {
  documentTitle: string;
  documentNumber: string | null;
  locator: string;
  documentRowId: string | null;
  sourceUrl: string | null;
  effectiveStatus: string | null;
  effectiveDate: string | null;
  hasOriginal: boolean;
  rawContent?: string | null;
}

/**
 * Business purpose: Render an authentic verbatim legal excerpt and citation backed by M09's `RawLegalRuleViewer`.
 * Business rules:
 * - Never fabricates legal text when `hasOriginal` is false or `rawContent` / `documentRowId` is absent.
 * - Preserves document title, number, locator, and effective status from the legal library contract.
 * Execution flow:
 * 1. Forward authentic legal document metadata and content to `RawLegalRuleViewer`.
 * Failure cases:
 * - Missing original document displays the viewer's authentic unavailable state.
 * Side effects:
 * - `RawLegalRuleViewer` queries `useLegalLibraryChunkPageQuery` when `documentRowId` is provided.
 */
export function OriginalLegalExcerpt(props: OriginalLegalExcerptProps) {
  return <RawLegalRuleViewer {...props} />;
}
