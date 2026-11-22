import { LEGAL_REFERENCE_RESOLUTION_STATES as ReferenceStates } from "@lcsp/contracts/legal-source";
import type { LegalRuleReferencePreviewProps } from "../../types/legal-rule-catalog.types";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";

/**
 * Business purpose: Keep source evidence accessible when a provision's reference has no unique target.
 * Business rules:
 * - Show the originating provision's text and document identity once if any target is missing or ambiguous.
 * - Display evidence inline. A recorded HTTP(S) source link is available for documents without a stored file.
 * Execution flow:
 * 1. Display each reference with its resolved excerpt or its resolution status.
 * 2. When any reference lacks a target, show the originating text and any eligible web source link.
 * Failure cases:
 * - An absent or unsupported web source URL leaves the originating text readable on its own.
 * Side effects:
 * - No mutation or automatic fetch. Opening evidence does not toggle the surrounding rule selection.
 */
export function LegalRuleReferencePreview({
  provision,
  sourceDocument,
}: LegalRuleReferencePreviewProps) {
  const { referenceContext, documentTitle, description } = provision;
  if (!referenceContext?.length) return null;

  const showSource = referenceContext.some(({ target }) => !target);
  // Preserve the recorded web link for snapshots without a stored original.
  const sourceUrl = sourceDocument?.hasOriginal
    ? null
    : sourceDocument?.sourceUrl.trim();
  const externalSource =
    sourceUrl && /^https?:\/\//iu.test(sourceUrl) ? sourceUrl : null;

  return (
    <details
      className="mt-2 cursor-auto border-l pl-3 text-xs"
      onClick={(event) => event.stopPropagation()}
    >
      <summary className="cursor-pointer font-medium text-foreground">
        {t("referenceContext")}
      </summary>
      <ul className="mt-2 space-y-2">
        {referenceContext.map(
          ({ referenceId, text, resolutionState, target }) => (
            <li key={referenceId}>
              <p className="font-medium text-foreground">{text}</p>
              {target ? (
                <>
                  <p className="break-all text-muted-foreground">
                    {target.documentTitle} · {target.locator}
                  </p>
                  <blockquote className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {target.excerpt}
                  </blockquote>
                  {target.truncated && (
                    <p className="text-muted-foreground">
                      {t("referenceTruncated")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  {t(
                    resolutionState === ReferenceStates.AMBIGUOUS
                      ? "referenceAmbiguous"
                      : "referenceUnresolved",
                  )}
                </p>
              )}
            </li>
          ),
        )}
      </ul>
      {showSource && (
        <div className="mt-3 space-y-1 border-t pt-2">
          <p className="font-medium text-foreground">{t("referenceOrigin")}</p>
          <p className="text-muted-foreground">{documentTitle}</p>
          <blockquote className="max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">
            {description}
          </blockquote>
          {externalSource && (
            <a
              href={externalSource}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-primary underline"
            >
              {t("referenceOpenSource")}
            </a>
          )}
        </div>
      )}
    </details>
  );
}
