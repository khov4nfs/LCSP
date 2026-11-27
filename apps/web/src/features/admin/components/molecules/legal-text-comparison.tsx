import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type LegalTextComparisonProps = {
  originalLabel: string;
  originalText: string;
  candidateLabel: string;
  candidateText?: string | null;
  emptyCandidateSlot?: ReactNode;
  className?: string;
};

/**
 * Business purpose: Display original legal text alongside candidate translation text for side-by-side reviewer verification.
 * Business rules:
 * - Preserves full long-form text with wrap-anywhere and whitespace-pre-wrap without clipping.
 * - Visually separates authoritative original text from unreviewed candidate output.
 * Execution flow:
 * 1. Render original legal text panel.
 * 2. Render candidate translation panel when non-empty, or optional emptyCandidateSlot.
 * Failure cases:
 * - Missing or empty candidate text omits the candidate panel cleanly unless emptyCandidateSlot is provided.
 * Side effects:
 * - Pure presentational component.
 */
export function LegalTextComparison({
  originalLabel,
  originalText,
  candidateLabel,
  candidateText,
  emptyCandidateSlot,
  className,
}: LegalTextComparisonProps) {
  const hasCandidate = Boolean(candidateText && candidateText.length > 0);

  return (
    <div
      className={cn(
        "grid gap-3",
        hasCandidate || emptyCandidateSlot ? "md:grid-cols-2" : "grid-cols-1",
        className,
      )}
      data-component="LegalTextComparison"
    >
      <div className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-3">
        <p className="text-xs font-semibold text-muted-foreground">
          {originalLabel}:
        </p>
        <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-sm text-foreground">
          {originalText}
        </p>
      </div>
      {hasCandidate ? (
        <div className="min-w-0 rounded-lg border border-border/70 bg-card p-3">
          <p className="text-xs font-semibold text-muted-foreground">
            {candidateLabel}:
          </p>
          <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-sm text-foreground">
            {candidateText}
          </p>
        </div>
      ) : (
        emptyCandidateSlot ?? null
      )}
    </div>
  );
}
