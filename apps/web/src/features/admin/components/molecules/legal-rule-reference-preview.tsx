import type { LegalRuleSourceProvision } from "@lcsp/contracts/legal-rule-catalog";
import { LEGAL_REFERENCE_RESOLUTION_STATES as ReferenceStates } from "@lcsp/contracts/legal-source";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";

/** Keep excerpts expandable independently of the enclosing provision selection. */
export function LegalRuleReferencePreview({
  referenceContext,
}: Pick<LegalRuleSourceProvision, "referenceContext">) {
  if (!referenceContext?.length) return null;

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
    </details>
  );
}
