import { AlertCircleIcon, FileCode2Icon } from "lucide-react";
import type { CredentialProvider } from "@lcsp/contracts/github-integration";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { LegalRuleEvidenceItem } from "../../types/legal-rule-output.types";
import { EvidenceRelationshipViewer } from "./evidence-relationship-viewer";

export interface EvidenceSourceContext {
  provider: CredentialProvider;
  canonicalRepositoryUrl: string;
  commitSha: string;
}

/**
 * Business purpose: Render a compact evidence summary card or distinct missing-evidence callout for a finding.
 * Business rules:
 * - Missing evidence is rendered distinctly with semantic warning tokens rather than hidden or coerced to zero.
 * Execution flow:
 * 1. Check whether `evidenceCount === 0` or `hasEvidenceGap` is true.
 * 2. Render either the missing-evidence warning card or the recorded evidence count card.
 * Failure cases:
 * - None.
 * Side effects:
 * - Pure presentational component.
 */
export function EvidenceCard({
  evidenceCount,
  hasEvidenceGap,
  className,
}: {
  evidenceCount: number;
  hasEvidenceGap: boolean;
  className?: string;
}) {
  const isMissing = hasEvidenceGap || evidenceCount === 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs",
        isMissing
          ? "border-status-warning-border bg-status-warning-bg text-status-warning"
          : "border-border bg-muted/40 text-foreground",
        className,
      )}
    >
      {isMissing ? (
        <AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <FileCode2Icon
          className="size-4 shrink-0 text-brand"
          aria-hidden="true"
        />
      )}
      <span className="font-medium">
        {isMissing
          ? resolveAppMessage("pages.assessmentWorkspace.findings.missingEvidence")
          : resolveAppMessage(
              "pages.assessmentWorkspace.findings.evidenceCount",
            ).replace("{count}", String(evidenceCount))}
      </span>
    </div>
  );
}

/**
 * Business purpose: Provide the single shared EvidenceInspector for Findings detail views and the Source & evidence tab.
 * Business rules:
 * - Reuses M07's `EvidenceRelationshipViewer` so E1/E2 evidence links, copy actions, and missing-evidence warnings follow one contract.
 * Execution flow:
 * 1. Render `EvidenceCard` summary header.
 * 2. Render `EvidenceRelationshipViewer` with `evidenceList`, `hasEvidenceGap`, and optional `sourceContext`.
 * Failure cases:
 * - Empty evidence list displays the distinct missing-evidence gap notice.
 * Side effects:
 * - Pure composition around `EvidenceRelationshipViewer`.
 */
export function EvidenceInspector({
  evidenceList,
  hasEvidenceGap,
  sourceContext,
  onNavigateToObligation,
  className,
}: {
  evidenceList: LegalRuleEvidenceItem[];
  hasEvidenceGap: boolean;
  sourceContext?: EvidenceSourceContext | null;
  onNavigateToObligation?: (criterionId?: string | null) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)} data-component="EvidenceInspector">
      <EvidenceCard
        evidenceCount={evidenceList.length}
        hasEvidenceGap={hasEvidenceGap}
      />
      <EvidenceRelationshipViewer
        evidenceList={evidenceList}
        hasEvidenceGap={hasEvidenceGap}
        sourceContext={sourceContext}
        onNavigateToObligation={onNavigateToObligation}
      />
    </div>
  );
}
